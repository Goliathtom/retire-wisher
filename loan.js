/* ===================== 대출 계산기 ===================== */
/* 연봉·집값으로 주택구입 목적 주담대 최대 가능액을 계산한다 (은행권 · 무주택자 기준).
   최대 가능액 = min(LTV 한도, DSR 한도, 정책 최대한도). DSR 은 실제 금리에 스트레스 금리를
   더해 선택한 상환 방식(원리금균등·원금균등)으로 계산하고, 월 상환액은 실제 금리로 계산한다.
   금리는 금감원 '금융상품 한눈에' 공시(Worker /fss/mortgage)를 금리 페이지와 같은 캐시로 쓴다. */

/* ── 규제 수치 (기준일 이후 규제가 바뀌면 여기만 고친다) ──
   근거: 6·27 가계부채 관리 강화 방안(한도 6억·만기 30년·생애최초 70%), 10·15 주택시장 안정화
   대책(규제지역 LTV 40%·시가별 최대한도·수도권·규제지역 스트레스 금리 하한 3%),
   3단계 스트레스 DSR(혼합형·주기형 적용비율, 지방 0.75%·2단계 비율 2026년 말까지). */
const LOAN_RULES = {
  asOf: '2026년 9월',
  dsrLimit: 0.40, // 은행권 차주단위 DSR
  regions: {
    regulated: { label: '규제지역',      ltv: 0.40, ltvFirst: 0.70, capByPrice: true,  stress: 3.0,  stage: 3, maxTerm: 30 },
    metro:     { label: '비규제 수도권', ltv: 0.70, ltvFirst: 0.70, capByPrice: true,  stress: 3.0,  stage: 3, maxTerm: 30 },
    local:     { label: '지방',          ltv: 0.70, ltvFirst: 0.80, capByPrice: false, stress: 0.75, stage: 2, maxTerm: 40 },
  },
  /* 수도권·규제지역 주택구입 목적 주담대 최대한도 (시가 기준) */
  priceCaps: [
    { upTo: 1_500_000_000, cap: 600_000_000 },
    { upTo: 2_500_000_000, cap: 400_000_000 },
    { upTo: Infinity,      cap: 200_000_000 },
  ],
  /* 혼합형·주기형 스트레스 금리 적용비율 — [고정기간(변동주기)/만기 30% 미만, 30~50%, 50~70%].
     고정 5년 미만·변동형은 100%, 70% 이상·순수 고정은 미적용. */
  ratios: {
    3: { mixed: [0.8, 0.6, 0.4], periodic: [0.4, 0.3, 0.2] },
    2: { mixed: [0.6, 0.4, 0.2], periodic: [0.3, 0.2, 0.1] },
  },
};

const PRODUCTS = {
  variable: { label: '변동형',   rateType: 'C' },
  mixed:    { label: '혼합형',   rateType: 'F' },
  periodic: { label: '주기형',   rateType: 'F' },
  fixed:    { label: '순수고정', rateType: 'F' },
};

/* 상품 유형별 스트레스 금리 적용비율 (0~1). */
function stressRatio(product, fixedYears, termYears, stage) {
  if (product === 'variable') return 1;
  if (product === 'fixed') return 0;
  if (fixedYears < 5) return 1;
  const share = fixedYears / termYears;
  if (share >= 0.7) return 0;
  const r = LOAN_RULES.ratios[stage][product];
  return share >= 0.5 ? r[2] : share >= 0.3 ? r[1] : r[0];
}

/* 원리금균등 — 월 상환액 m 으로 갚을 수 있는 원금, 원금 p 의 월 상환액. rate 는 연 %. */
function annuityPrincipal(m, rate, months) {
  const r = rate / 100 / 12;
  return r === 0 ? m * months : (m * (1 - Math.pow(1 + r, -months))) / r;
}
function annuityPayment(p, rate, months) {
  const r = rate / 100 / 12;
  return r === 0 ? p / months : (p * r) / (1 - Math.pow(1 + r, -months));
}

/* 상환 스케줄 (원 단위) — 이자는 원 미만 버림, 마지막 회차에서 남은 원금을 모두 갚는다.
   원리금균등(annuity): 월 상환액 일정(반올림). 원금균등(equal): 월 원금 일정(원 미만 버림), 이자 감소.
   rows: { n, payment, principal, interest, balance } */
function amortizationSchedule(principal, rate, months, repayment = 'annuity') {
  const P = Math.round(principal);
  if (P <= 0 || months <= 0) return [];
  const r = rate / 100 / 12;
  const payment = Math.round(annuityPayment(P, rate, months));
  const equalPrincipal = Math.floor(P / months);
  const rows = [];
  let balance = P;
  for (let n = 1; n <= months; n++) {
    const interest = Math.floor(balance * r);
    const regular = repayment === 'equal' ? equalPrincipal : payment - interest;
    const princ = n === months ? balance : Math.min(balance, regular);
    balance -= princ;
    rows.push({ n, payment: princ + interest, principal: princ, interest, balance });
  }
  return rows;
}

const floorMan = (n) => Math.max(0, Math.floor(n / 10_000) * 10_000); // 만원 단위 내림

/* 실제 금리 기준 첫 달·마지막 달 월 상환액 (원리금균등은 두 값이 같다). */
function monthlyPayments(principal, rate, months, repayment) {
  if (repayment !== 'equal') {
    const m = annuityPayment(principal, rate, months);
    return { monthly: m, monthlyLast: m };
  }
  const r = rate / 100 / 12;
  const unit = principal / months;
  return { monthly: unit + principal * r, monthlyLast: unit * (1 + r) };
}

/* 입력 -> 한도 계산 결과. capLimit 이 null 이면 정책 최대한도 없음(지방).
   price 는 매매가(필요 자기자본), kbPrice 는 KB 시세(LTV 담보가치·정책 최대한도 시가 구간).
   일반 은행 주담대는 시세 정보로 담보가치를 정하며 매매가와 비교해 낮은 값을 쓰는 규정은 없다.
   repayment: 'annuity'(원리금균등, 기본) | 'equal'(원금균등). DSR 은 분할상환 개시 이후 실제 상환액
   기준(은행업감독업무시행세칙 별표 18) — 원금균등은 첫해 원리금이 가장 커서 한도가 더 작다. */
function calcLoan({ income, price, kbPrice, region, firstHome, existingAnnual, product, fixedYears, termYears, rate, repayment = 'annuity' }) {
  const rule = LOAN_RULES.regions[region];
  const term = Math.min(termYears, rule.maxTerm);
  const fixed = Math.min(fixedYears, term);

  const ltvRate = firstHome ? rule.ltvFirst : rule.ltv;
  const ltvLimit = floorMan(kbPrice * ltvRate);

  const ratio = stressRatio(product, fixed, term, rule.stage);
  const stressAdd = rule.stress * ratio;
  const dsrRate = rate + stressAdd;
  const annualCapacity = Math.max(0, income * LOAN_RULES.dsrLimit - existingAnnual);
  const months = term * 12;
  let dsrLimit;
  if (repayment === 'equal') {
    /* 첫 12개월 원리금 = P × [12/N + r × (12 − 66/N)] (매달 원금 P/N, 잔액 P(1 − (k−1)/N) 에 이자) */
    const r = dsrRate / 100 / 12;
    dsrLimit = floorMan(annualCapacity / (12 / months + r * (12 - 66 / months)));
  } else {
    dsrLimit = floorMan(annuityPrincipal(annualCapacity / 12, dsrRate, months));
  }

  const capLimit = rule.capByPrice ? LOAN_RULES.priceCaps.find((c) => kbPrice <= c.upTo).cap : null;

  const candidates = [['dsr', dsrLimit], ['ltv', ltvLimit]];
  if (capLimit !== null) candidates.push(['cap', capLimit]);
  const [binding, max] = candidates.reduce((a, b) => (b[1] < a[1] ? b : a));

  return {
    termYears: term, fixedYears: fixed,
    ltvRate, ltvLimit, dsrLimit, capLimit, max, binding,
    stressBase: rule.stress, stressRatio: ratio, stressAdd, dsrRate,
    repayment,
    ...monthlyPayments(max, rate, months, repayment),
    equity: Math.max(0, price - max),
  };
}

/* 금액 -> '2억 7,809만원' / '6억원' / '5,000만원' / '0원' (만원 미만 버림). */
function wonShort(n) {
  const man = Math.floor(Math.max(0, n) / 10_000);
  const eok = Math.floor(man / 10_000);
  const rest = man % 10_000;
  if (!eok && !rest) return '0원';
  if (!eok) return `${rest.toLocaleString('ko-KR')}만원`;
  return rest ? `${eok}억 ${rest.toLocaleString('ko-KR')}만원` : `${eok}억원`;
}

/* 은행 공시 요약 -> 적용 금리(%). bankKey 'MAJOR' 는 5대 시중은행 전월 평균. 없으면 null. */
function pickRate(banks, bankKey, product) {
  const list = banks?.[PRODUCTS[product].rateType];
  if (!Array.isArray(list) || !list.length) return null;
  const pool = bankKey === 'MAJOR' ? list.filter((b) => b.major) : list.filter((b) => b.name === bankKey);
  if (!pool.length) return null;
  return pool.reduce((s, b) => s + b.avg, 0) / pool.length;
}

/* ===================== 은행 공시 (금리 페이지와 같은 캐시) ===================== */
/* rates.js 가 저장한 요약 데이터(rt_BANKS)를 그대로 쓰고, 없거나 오래됐으면 직접 조회한다.
   요약 형식을 맞추기 위해 summarizeBanks 는 rates.js 와 같은 로직을 쓴다. */
const BANK_ENDPOINT = 'https://retire-wisher.goliathtom11.workers.dev/fss/mortgage';
const BANK_CACHE_TTL = 6 * 60 * 60 * 1000;
const BANK_CACHE_KEY = 'rt_BANKS';
const BANK_RATE_TYPES = { F: '고정금리', C: '변동금리' };
const MAJOR_BANKS = /국민|신한|하나|우리|농협/; // 5대 시중은행
const FALLBACK_RATE = 5.0; // 공시 조회 실패 시 기본 금리 (직접 수정 안내)

const escHtml = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const bankName = (nm) => String(nm || '').replace(/주식회사|\(주\)/g, '').trim();

function summarizeBanks(json) {
  const base = Array.isArray(json?.base) ? json.base : [];
  const options = Array.isArray(json?.options) ? json.options : [];
  if (!base.length || !options.length) return null;

  const names = new Map(base.map((b) => [b.fin_co_no, bankName(b.kor_co_nm)]));
  const month = base.reduce((m, b) => (String(b.dcls_month) > m ? String(b.dcls_month) : m), '');
  if (!/^\d{6}$/.test(month)) return null;

  const out = { month };
  for (const type of Object.keys(BANK_RATE_TYPES)) {
    const byBank = new Map();
    for (const o of options) {
      if (o.mrtg_type !== 'A' || o.rpay_type !== 'D' || o.lend_rate_type !== type) continue;
      const avg = parseFloat(o.lend_rate_avg);
      if (!isFinite(avg)) continue;
      const rawMin = parseFloat(o.lend_rate_min), rawMax = parseFloat(o.lend_rate_max);
      const min = isFinite(rawMin) ? rawMin : avg, max = isFinite(rawMax) ? rawMax : avg;
      const b = byBank.get(o.fin_co_no);
      if (!b) {
        byBank.set(o.fin_co_no, { name: names.get(o.fin_co_no) || o.fin_co_no, avg, min, max });
        continue;
      }
      b.avg = Math.min(b.avg, avg);
      b.min = Math.min(b.min, min);
      b.max = Math.max(b.max, max);
    }
    out[type] = [...byBank.values()].map((b) => ({ ...b, major: MAJOR_BANKS.test(b.name) }));
  }
  return out.F.length || out.C.length ? out : null;
}

async function loadBankData() {
  try {
    const cached = JSON.parse(localStorage.getItem(BANK_CACHE_KEY) || 'null');
    if (cached?.data && Date.now() - cached.ts < BANK_CACHE_TTL) return cached.data;
  } catch (e) {}
  try {
    const res = await fetch(BANK_ENDPOINT, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) return null;
    const data = summarizeBanks(await res.json());
    if (data) {
      try { localStorage.setItem(BANK_CACHE_KEY, JSON.stringify({ ts: Date.now(), data })); } catch (e) {}
    }
    return data;
  } catch (e) {
    return null; // Worker 실패 → 기본 금리 + 직접 입력 안내
  }
}

/* ===================== 화면 ===================== */
const LOAN_STORE_KEY = 'loan_inputs';
const LOAN_DEFAULTS = {
  income: 60_000_000, price: 800_000_000, kbPrice: 800_000_000, kbManual: false,
  region: 'regulated', firstHome: false, existingAnnual: 0,
  product: 'mixed', fixedYears: 5, termYears: 30, repayment: 'annuity', bank: 'MAJOR', rate: FALLBACK_RATE, rateManual: false,
};
const TERM_OPTIONS = [10, 15, 20, 25, 30, 35, 40];
const MONEY_FIELDS = { income: 'income', price: 'price', kb: 'kbPrice', existing: 'existingAnnual' };
const REGION_HINTS = {
  regulated: '서울 전역과 경기 일부 등 투기과열지구·조정대상지역이에요. 지정 지역은 바뀔 수 있어요.',
  metro: '규제지역이 아닌 경기·인천 지역이에요.',
  local: '서울·경기·인천 밖의 비규제지역이에요.',
};
const LIMIT_LABELS = { dsr: 'DSR', ltv: 'LTV', cap: '정책 최대한도' };
const REPAY_LABELS = { annuity: '원리금균등', equal: '원금균등' };
const REPAY_HINTS = {
  annuity: '매달 같은 금액을 갚아요. DSR 은 매년 같은 원리금으로 계산해요.',
  equal: '매달 같은 원금에 줄어드는 이자를 더해 갚아요. DSR 은 상환액이 가장 큰 첫해 기준이라 한도가 원리금균등보다 작아요.',
};
const PRODUCT_TIPS = {
  variable: '코픽스·금융채 6개월물 등을 따라 보통 6개월마다, 상품에 따라 1년마다 금리가 바뀌어요. 금리가 오르면 월 상환액도 바로 늘어요. 변동주기가 5년 미만이라 스트레스 금리를 100% 반영해요.',
  mixed: '처음 5년 등 정해진 기간은 금리가 고정되고, 그 뒤로는 변동형처럼 바뀌어요. 은행의 \'고정금리\' 주담대는 대부분 이 유형이에요. 고정기간이 만기에서 차지하는 비중이 클수록 스트레스 금리를 덜 반영해요.',
  periodic: '5년 등 정해진 주기마다 그 시점 금리로 다시 정하고 다음 주기까지 고정해요. 만기까지 주기 단위로 고정돼서 같은 기간의 혼합형보다 스트레스 금리를 덜 반영해요. 주기가 5년 미만이면 변동형과 같아요.',
  fixed: '만기 내내 처음 금리가 그대로예요. 보금자리론 같은 정책 모기지에 많고 은행 상품은 드물어요. 스트레스 금리를 반영하지 않아 DSR 한도가 가장 커요. 공시 고정금리에는 혼합형이 섞여 있어 실제 금리는 더 높을 수 있으니 직접 고쳐 넣어주세요.',
};

const loanState = { ...LOAN_DEFAULTS };
let bankData = null;
let bankLoadFailed = false;

const pctText = (v) => `${Math.round(v * 100)}%`;
const rateText = (v) => v.toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const $ = (id) => document.getElementById(id);

function loadLoanState() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(LOAN_STORE_KEY) || 'null'); } catch (e) {}
  if (saved && typeof saved === 'object') {
    for (const k of Object.keys(LOAN_DEFAULTS)) {
      if (typeof saved[k] === typeof LOAN_DEFAULTS[k]) loanState[k] = saved[k];
    }
    if (!LOAN_RULES.regions[loanState.region]) loanState.region = LOAN_DEFAULTS.region;
    if (!PRODUCTS[loanState.product]) loanState.product = LOAN_DEFAULTS.product;
    if (!REPAY_LABELS[loanState.repayment]) loanState.repayment = LOAN_DEFAULTS.repayment;
    if (!loanState.kbManual) loanState.kbPrice = loanState.price; // 직접 입력 전에는 매매가를 따른다
    return;
  }
  /* 처음 방문: 소득 계산기에 저장된 연봉이 있으면 가져온다 */
  try {
    const salary = parseFloat(localStorage.getItem('income_salary'));
    if (isFinite(salary) && salary > 0) loanState.income = salary;
  } catch (e) {}
}

function saveLoanState() {
  try { localStorage.setItem(LOAN_STORE_KEY, JSON.stringify(loanState)); } catch (e) {}
}

/* 공시 금리로 채우기 — 수동 입력 중이면 건드리지 않는다. */
function fillRate() {
  if (loanState.rateManual) return;
  const rate = pickRate(bankData, loanState.bank, loanState.product) ?? pickRate(bankData, 'MAJOR', loanState.product);
  loanState.rate = Math.round((rate ?? FALLBACK_RATE) * 100) / 100; // 화면 표시(소수 둘째 자리)와 계산값 일치
  $('rate').value = loanState.rate.toFixed(2);
}

function renderRateHint() {
  const el = $('rateHint');
  if (loanState.rateManual) {
    el.textContent = '직접 입력한 금리예요. 은행이나 상품 유형을 바꾸면 공시 금리로 다시 채워요.';
    return;
  }
  if (!bankData) {
    el.textContent = bankLoadFailed
      ? `공시를 불러오지 못해 기본값 ${rateText(FALLBACK_RATE)}%를 넣었어요. 실제 금리로 고쳐주세요.`
      : '금감원 공시 금리를 불러오는 중이에요.';
    return;
  }
  const type = PRODUCTS[loanState.product].rateType;
  const month = `${bankData.month.slice(0, 4)}년 ${+bankData.month.slice(4)}월 공시`;
  const bank = (bankData[type] || []).find((b) => b.name === loanState.bank);
  if (loanState.bank !== 'MAJOR' && bank) {
    el.textContent = `금감원 ${month} · ${BANK_RATE_TYPES[type]} 전월 취급 평균 · 현재 공시 ${rateText(bank.min)}~${rateText(bank.max)}%`;
  } else if (loanState.bank !== 'MAJOR') {
    el.textContent = `이 은행은 ${BANK_RATE_TYPES[type]} 공시가 없어 5대 시중은행 평균을 넣었어요.`;
  } else {
    el.textContent = `금감원 ${month} · 5대 시중은행 ${BANK_RATE_TYPES[type]} 전월 취급 평균`;
  }
}

function renderBankOptions() {
  const select = $('bank');
  const names = bankData
    ? [...new Set([...(bankData.F || []), ...(bankData.C || [])].map((b) => b.name))].sort((a, b) => a.localeCompare(b, 'ko'))
    : [];
  if (loanState.bank !== 'MAJOR' && !names.includes(loanState.bank)) loanState.bank = 'MAJOR';
  select.innerHTML = `<option value="MAJOR">5대 시중은행 평균</option>` +
    names.map((n) => `<option value="${escHtml(n)}">${escHtml(n)}</option>`).join('');
  select.value = loanState.bank;
}

function renderSegments() {
  document.querySelectorAll('.seg').forEach((seg) => {
    const key = seg.dataset.key;
    seg.querySelectorAll('.seg-btn').forEach((b) => {
      const v = key === 'firstHome' ? b.dataset.value === 'true' : b.dataset.value;
      b.classList.toggle('active', v === loanState[key]);
    });
  });
}

function renderTermOptions() {
  const maxTerm = LOAN_RULES.regions[loanState.region].maxTerm;
  if (loanState.termYears > maxTerm) loanState.termYears = maxTerm;
  $('termYears').innerHTML = TERM_OPTIONS
    .map((t) => `<option value="${t}"${t > maxTerm ? ' disabled' : ''}>${t}년${t > maxTerm ? ' (불가)' : ''}</option>`)
    .join('');
  $('termYears').value = String(loanState.termYears);
  $('termHint').textContent = maxTerm === 30
    ? '수도권·규제지역 주담대는 만기가 최장 30년이에요.'
    : '지방 주담대 만기는 은행마다 달라요. 최장 40년까지 계산해요.';
}

function renderFixedYears(r) {
  const input = $('fixedYears');
  const usesFixed = loanState.product === 'mixed' || loanState.product === 'periodic';
  input.disabled = !usesFixed;
  input.max = String(loanState.termYears);
  input.value = String(loanState.fixedYears);
  const hint = $('fixedHint');
  if (loanState.product === 'variable') hint.textContent = '변동형은 스트레스 금리를 100% 반영해요.';
  else if (loanState.product === 'fixed') hint.textContent = '순수 고정금리는 스트레스 금리를 반영하지 않아요.';
  else {
    const share = Math.round((r.fixedYears / r.termYears) * 100);
    hint.textContent = r.fixedYears < 5
      ? '고정기간이 5년 미만이면 스트레스 금리를 100% 반영해요.'
      : `고정기간 비중 ${share}% → 스트레스 금리 ${pctText(r.stressRatio)} 반영`;
  }
}

/* 상품 유형 말풍선 — 기본은 선택한 유형, PC 호버 시 해당 유형을 미리 보여준다. */
function renderProductTip(product = loanState.product) {
  const btn = document.querySelector(`.seg[data-key="product"] .seg-btn[data-value="${product}"]`);
  const tip = $('productTip');
  if (!btn || !tip) return;
  tip.innerHTML = `<span class="tip-title">${PRODUCTS[product].label}</span>${PRODUCT_TIPS[product]}`;
  const segLeft = btn.parentElement.getBoundingClientRect().left;
  const b = btn.getBoundingClientRect();
  tip.style.setProperty('--tip-x', `${(b.left - segLeft + b.width / 2).toFixed(1)}px`);
}

function renderKbHint() {
  const { price, kbPrice, kbManual } = loanState;
  $('kbReset').hidden = !kbManual;
  if (!kbManual) {
    $('kbHint').textContent = '매매가와 같은 값으로 계산하고 있어요. KB 시세를 알면 직접 입력하세요.';
  } else if (kbPrice < price) {
    $('kbHint').textContent = `매매가보다 ${wonShort(price - kbPrice)} 낮아요. LTV 한도는 KB 시세로 계산해요.`;
  } else if (kbPrice > price) {
    $('kbHint').textContent = `매매가보다 ${wonShort(kbPrice - price)} 높아요.`;
  } else {
    $('kbHint').textContent = '매매가와 같아요.';
  }
}

function renderMoney() {
  for (const [id, key] of Object.entries(MONEY_FIELDS)) {
    const v = loanState[key];
    if (document.activeElement !== $(id)) $(id).value = String(v);
    const range = $(id + 'Range');
    range.value = String(Math.min(v, +range.max));
    $(id + 'Label').textContent = wonShort(v);
  }
}

function renderResult(r) {
  $('maxAmount').textContent = wonShort(r.max);
  const existingFull = loanState.existingAnnual >= loanState.income * LOAN_RULES.dsrLimit && loanState.income > 0;
  $('bindingNote').textContent = r.max === 0
    ? (existingFull ? '기존 대출 원리금이 DSR 40%를 모두 쓰고 있어요.' : '연봉과 집값을 입력해주세요.')
    : `${LIMIT_LABELS[r.binding]} 한도가 가장 작아요.`;

  const rows = [
    { key: 'dsr', label: `DSR ${pctText(LOAN_RULES.dsrLimit)}`, value: r.dsrLimit },
    { key: 'ltv', label: `LTV ${pctText(r.ltvRate)}`, value: r.ltvLimit },
    { key: 'cap', label: '정책 최대한도', value: r.capLimit },
  ];
  const scale = Math.max(1, ...rows.filter((x) => x.value !== null).map((x) => x.value));
  $('limitBars').innerHTML = rows.map((x) => {
    const on = r.max > 0 && x.key === r.binding;
    const width = x.value === null ? 0 : (x.value / scale) * 100;
    return `<div class="limit-row${on ? ' binding' : ''}">` +
        `<div class="limit-top"><span>${x.label}</span><span>${x.value === null ? '없음 (지방)' : wonShort(x.value)}</span></div>` +
        `<div class="limit-bar"><span style="width:${width.toFixed(1)}%"></span></div>` +
      `</div>`;
  }).join('');

  /* 강조 카드 — 월 상환액(실제 금리, 만원 반올림)과 필요 자기자본 */
  const manText = (n) => `${Math.round(n / 10_000).toLocaleString('ko-KR')}만원`;
  const isEqual = r.repayment === 'equal';
  $('monthlyLabel').textContent = isEqual ? '💳 첫 달 상환액 (실제 금리)' : '💳 월 상환액 (실제 금리)';
  $('monthlyAmount').textContent = r.max > 0 ? manText(r.monthly) : '0원';
  $('monthlySub').textContent = r.max <= 0
    ? '대출 가능액이 없어요'
    : isEqual
      ? `마지막 달 ${manText(r.monthlyLast)} · 금리 ${rateText(loanState.rate)}%`
      : `연 ${manText(r.monthly * 12)} · 금리 ${rateText(loanState.rate)}%`;
  $('scheduleOpen').hidden = r.max <= 0;
  $('equityAmount').textContent = wonShort(r.equity);
  $('equitySub').textContent = `매매가 ${wonShort(loanState.price)} − 대출 ${wonShort(r.max)}`;

  $('detailList').innerHTML = [
    ['LTV·최대한도 기준', `KB 시세 ${wonShort(loanState.kbPrice)}`],
    ['스트레스 금리', `${rateText(r.stressBase)}%p × ${pctText(r.stressRatio)} = ${rateText(r.stressAdd)}%p`],
    ['DSR 심사 금리', `${rateText(loanState.rate)}% + ${rateText(r.stressAdd)}%p = ${rateText(r.dsrRate)}%`],
    ['만기 · 상환 방식', `${r.termYears}년 · ${REPAY_LABELS[r.repayment]}`],
  ].map(([k, v]) => `<div class="detail-row"><span>${k}</span><span>${v}</span></div>`).join('');
}

function updateLoan() {
  renderTermOptions();
  const r = calcLoan(loanState);
  renderSegments();
  renderMoney();
  renderKbHint();
  renderFixedYears(r);
  renderProductTip();
  renderRateHint();
  $('regionHint').textContent = REGION_HINTS[loanState.region];
  $('repayHint').textContent = REPAY_HINTS[loanState.repayment];
  renderResult(r);
  saveLoanState();
}

function bindLoanInputs() {
  /* KB 시세는 직접 입력하기 전까지 매매가를 따라간다 */
  const setMoney = (key, v) => {
    loanState[key] = v;
    if (key === 'kbPrice') loanState.kbManual = true;
    if (key === 'price' && !loanState.kbManual) loanState.kbPrice = v;
    updateLoan();
  };
  for (const [id, key] of Object.entries(MONEY_FIELDS)) {
    $(id).addEventListener('input', () => setMoney(key, Math.max(0, parseFloat($(id).value) || 0)));
    $(id + 'Range').addEventListener('input', () => setMoney(key, +$(id + 'Range').value));
  }
  $('kbReset').addEventListener('click', () => {
    loanState.kbManual = false;
    loanState.kbPrice = loanState.price;
    updateLoan();
  });
  document.querySelectorAll('.seg').forEach((seg) => {
    seg.addEventListener('click', (e) => {
      const btn = e.target.closest('.seg-btn');
      if (!btn) return;
      const key = seg.dataset.key;
      const value = key === 'firstHome' ? btn.dataset.value === 'true' : btn.dataset.value;
      if (loanState[key] === value) return;
      loanState[key] = value;
      if (key === 'product') { loanState.rateManual = false; fillRate(); }
      updateLoan();
    });
  });
  const productSeg = document.querySelector('.seg[data-key="product"]');
  const previewTip = (e) => {
    const btn = e.target.closest('.seg-btn');
    if (btn) renderProductTip(btn.dataset.value);
  };
  productSeg.addEventListener('mouseover', previewTip);
  productSeg.addEventListener('focusin', previewTip);
  productSeg.addEventListener('mouseleave', () => renderProductTip());
  productSeg.addEventListener('focusout', () => renderProductTip());
  window.addEventListener('resize', () => renderProductTip());

  $('fixedYears').addEventListener('input', () => {
    const v = parseInt($('fixedYears').value, 10);
    if (isFinite(v) && v >= 1) { loanState.fixedYears = v; updateLoan(); }
  });
  $('termYears').addEventListener('change', () => { loanState.termYears = +$('termYears').value; updateLoan(); });
  $('bank').addEventListener('change', () => { loanState.bank = $('bank').value; loanState.rateManual = false; fillRate(); updateLoan(); });
  $('rate').addEventListener('input', () => {
    const v = parseFloat($('rate').value);
    if (!isFinite(v) || v < 0) return;
    loanState.rate = v;
    loanState.rateManual = true;
    updateLoan();
  });
}

/* ===================== 월별 상환 스케줄 팝업 ===================== */
function renderSchedule() {
  const r = calcLoan(loanState);
  const rows = amortizationSchedule(r.max, loanState.rate, r.termYears * 12, r.repayment);
  if (!rows.length) return false;
  const won = (n) => n.toLocaleString('ko-KR');
  const totalInterest = rows.reduce((s, x) => s + x.interest, 0);

  $('scheduleSub').textContent = `대출 ${wonShort(r.max)} · 금리 ${rateText(loanState.rate)}% · ${r.termYears}년 ${REPAY_LABELS[r.repayment]}`;
  $('scheduleSummary').innerHTML = [
    [r.repayment === 'equal' ? '첫 달 상환액' : '월 상환액', `${won(rows[0].payment)}원`],
    ['총 이자', wonShort(totalInterest)],
    ['총 상환액', wonShort(r.max + totalInterest)],
  ].map(([k, v]) => `<div class="summary-item"><span>${k}</span><strong>${v}</strong></div>`).join('');

  /* 12회차마다 연차 구분 행 (연간 원금·이자 합계) */
  let html = '';
  for (let i = 0; i < rows.length; i += 12) {
    const year = rows.slice(i, i + 12);
    const yp = year.reduce((s, x) => s + x.principal, 0);
    const yi = year.reduce((s, x) => s + x.interest, 0);
    html += `<tr class="year-row"><td colspan="5">${i / 12 + 1}년차 · 원금 ${wonShort(yp)} · 이자 ${wonShort(yi)}</td></tr>`;
    html += year.map((x) =>
      `<tr><td>${x.n}회</td><td>${won(x.principal)}</td><td>${won(x.interest)}</td>` +
      `<td class="col-pay">${won(x.payment)}</td><td>${won(x.balance)}</td></tr>`).join('');
  }
  $('scheduleBody').innerHTML = html;
  return true;
}

function openSchedule() {
  if (!renderSchedule()) return;
  $('scheduleModal').hidden = false;
  document.body.style.overflow = 'hidden'; // 뒤쪽 페이지 스크롤 잠금
  $('scheduleModal').querySelector('.modal-body').scrollTop = 0;
  $('scheduleModal').querySelector('.modal').focus();
}

function closeSchedule() {
  if ($('scheduleModal').hidden) return;
  $('scheduleModal').hidden = true;
  document.body.style.overflow = '';
  $('scheduleOpen').focus();
}

function bindSchedule() {
  $('scheduleOpen').addEventListener('click', openSchedule);
  $('scheduleClose').addEventListener('click', closeSchedule);
  $('scheduleModal').addEventListener('click', (e) => { if (e.target === $('scheduleModal')) closeSchedule(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSchedule(); });
}

async function initLoanPage() {
  $('rulesAsOf').textContent = LOAN_RULES.asOf;
  loadLoanState();
  renderBankOptions();
  $('rate').value = loanState.rate.toFixed(2);
  bindLoanInputs();
  bindSchedule();
  updateLoan();

  bankData = await loadBankData();
  bankLoadFailed = !bankData;
  renderBankOptions();
  fillRate();
  updateLoan();
}

if (typeof document !== 'undefined') initLoanPage();
