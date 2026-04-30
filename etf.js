/* ===================== 상수 ===================== */
const USD_TO_KRW     = 1450;
const WITHHOLDING_US = 0.15;
const WITHHOLDING_KR = 0.154;

const ETF_DATA = {
  /* 미국 ETF */
  SCHD: { yield: 0.034, color: 'var(--accent)',  fullName: 'Schwab US Dividend Equity ETF' },
  JEPI: { yield: 0.088, color: 'var(--green)',   fullName: 'JPMorgan Equity Premium Income ETF' },
  JEPQ: { yield: 0.105, color: 'var(--accent2)', fullName: 'JPMorgan Nasdaq Equity Premium Income ETF' },
  SPYI: { yield: 0.120, color: 'var(--yellow)',  fullName: 'NEOS S&P 500 High Income ETF' },
  /* 국내 ETF */
  'TIGER배당다우':      { yield: 0.035, color: 'var(--accent)',  fullName: 'TIGER 미국배당다우존스' },
  'SOL배당다우':        { yield: 0.035, color: 'var(--accent)',  fullName: 'SOL 미국배당다우존스' },
  'TIGER프리미엄':      { yield: 0.075, color: 'var(--green)',   fullName: 'TIGER 미국배당+7%프리미엄' },
  'KODEX프리미엄':      { yield: 0.075, color: 'var(--green)',   fullName: 'KODEX 미국배당프리미엄' },
  'KODEX나스닥프리미엄': { yield: 0.090, color: 'var(--accent2)', fullName: 'KODEX 미국배당나스닥프리미엄' },
  'TIGER고배당':        { yield: 0.045, color: 'var(--yellow)',  fullName: 'TIGER 고배당' },
};

/* 커스텀 빌더에서 선택 가능한 ETF 목록 */
const CUSTOM_ETFS_US = ['SCHD', 'JEPI', 'JEPQ', 'SPYI'];
const CUSTOM_ETFS_KR = ['TIGER배당다우', 'SOL배당다우', 'TIGER프리미엄', 'KODEX프리미엄', 'KODEX나스닥프리미엄', 'TIGER고배당'];

/* 커스텀 초기 배분 (합계 = 100) */
const customAllocations = {
  us: { SCHD: 40, JEPI: 30, JEPQ: 20, SPYI: 10 },
  kr: { 'TIGER배당다우': 50, 'SOL배당다우': 0, 'TIGER프리미엄': 50, 'KODEX프리미엄': 0, 'KODEX나스닥프리미엄': 0, 'TIGER고배당': 0 },
};

const STRATEGIES_US = [
  {
    id: 'growth',
    name: '성장 중심',
    desc: 'SCHD 50% · JEPI 30% · JEPQ 20%',
    tag: '주가 성장 + 배당 균형',
    etfs: [
      { key: 'SCHD', label: 'SCHD', weight: 0.50 },
      { key: 'JEPI', label: 'JEPI', weight: 0.30 },
      { key: 'JEPQ', label: 'JEPQ', weight: 0.20 },
    ],
  },
  {
    id: 'balanced',
    name: '균형형',
    desc: 'SCHD 40% · JEPI 30% · JEPQ 30%',
    tag: '가장 대중적인 조합',
    etfs: [
      { key: 'SCHD', label: 'SCHD', weight: 0.40 },
      { key: 'JEPI', label: 'JEPI', weight: 0.30 },
      { key: 'JEPQ', label: 'JEPQ', weight: 0.30 },
    ],
  },
  {
    id: 'highdiv',
    name: '고배당 중심',
    desc: 'SCHD 20% · JEPI 40% · JEPQ 40%',
    tag: '현금흐름 극대화',
    etfs: [
      { key: 'SCHD', label: 'SCHD', weight: 0.20 },
      { key: 'JEPI', label: 'JEPI', weight: 0.40 },
      { key: 'JEPQ', label: 'JEPQ', weight: 0.40 },
    ],
  },
  {
    id: 'spyi_highdiv',
    name: 'SPYI 고배당형',
    desc: 'SCHD 20% · SPYI 40% · JEPQ 40%',
    tag: 'JEPI → SPYI 교체, 최고 배당',
    etfs: [
      { key: 'SCHD', label: 'SCHD', weight: 0.20 },
      { key: 'SPYI', label: 'SPYI', weight: 0.40 },
      { key: 'JEPQ', label: 'JEPQ', weight: 0.40 },
    ],
  },
  { id: 'custom', name: '직접 구성', desc: 'ETF 종목과 비율을 직접 설정', tag: '나만의 포트폴리오', etfs: [], isCustom: true },
];

const STRATEGIES_KR = [
  {
    id: 'kr_popular',
    name: 'SCHD형 + 커버드콜',
    desc: 'TIGER 미국배당다우존스 50%\nTIGER 미국배당+7%프리미엄 50%',
    tag: '가장 대중적인 조합',
    etfs: [
      { key: 'TIGER배당다우', label: 'TIGER배당', weight: 0.50 },
      { key: 'TIGER프리미엄', label: 'TIGER프리미엄', weight: 0.50 },
    ],
  },
  {
    id: 'kr_highdiv',
    name: '순수 월배당 극대화',
    desc: 'SOL 미국배당다우존스 40%\nKODEX 미국배당프리미엄 60%',
    tag: '현금흐름 극대화',
    etfs: [
      { key: 'SOL배당다우',   label: 'SOL배당',     weight: 0.40 },
      { key: 'KODEX프리미엄', label: 'KODEX프리미엄', weight: 0.60 },
    ],
  },
  {
    id: 'kr_isa',
    name: 'ISA 절세 조합',
    desc: 'TIGER 미국배당다우존스 60%\nTIGER 미국배당+7%프리미엄 40%',
    tag: 'ISA 계좌 활용 절세',
    etfs: [
      { key: 'TIGER배당다우', label: 'TIGER배당',    weight: 0.60 },
      { key: 'TIGER프리미엄', label: 'TIGER프리미엄', weight: 0.40 },
    ],
  },
  {
    id: 'kr_mixed',
    name: '국내 + 해외 혼합',
    desc: 'TIGER 고배당 30% · TIGER 미국배당다우존스 40%\nTIGER 미국배당+7%프리미엄 30%',
    tag: '환율 리스크 분산',
    etfs: [
      { key: 'TIGER고배당',   label: 'TIGER고배당',  weight: 0.30 },
      { key: 'TIGER배당다우', label: 'TIGER배당',    weight: 0.40 },
      { key: 'TIGER프리미엄', label: 'TIGER프리미엄', weight: 0.30 },
    ],
  },
  { id: 'custom', name: '직접 구성', desc: 'ETF 종목과 비율을 직접 설정', tag: '나만의 포트폴리오', etfs: [], isCustom: true },
];

let currentCountry = 'us';

/* ===================== 포맷 ===================== */
function fmtShortKRW(n) {
  if (Math.abs(n) >= 1_0000_0000) return (n / 1_0000_0000).toFixed(1) + '억원';
  if (Math.abs(n) >= 1_0000) return Math.round(n / 10_000).toLocaleString('ko-KR') + '만원';
  return Math.round(n).toLocaleString('ko-KR') + '원';
}
function fmtUSD(n) { return '$' + Math.round(n).toLocaleString('en-US'); }

/* ===================== 수익률 계산 ===================== */
function getBlendedYield(strategy) {
  return strategy.etfs.reduce((sum, e) => sum + e.weight * ETF_DATA[e.key].yield, 0);
}

function getCustomBlendedYield() {
  const allocs = customAllocations[currentCountry];
  const keys   = currentCountry === 'us' ? CUSTOM_ETFS_US : CUSTOM_ETFS_KR;
  return keys.reduce((sum, k) => sum + (allocs[k] / 100) * ETF_DATA[k].yield, 0);
}

function getCustomTotal() {
  const allocs = customAllocations[currentCountry];
  const keys   = currentCountry === 'us' ? CUSTOM_ETFS_US : CUSTOM_ETFS_KR;
  return keys.reduce((sum, k) => sum + (allocs[k] || 0), 0);
}

/* ===================== 국가 전환 ===================== */
function setCountry(country) {
  currentCountry = country;
  document.getElementById('btn-us').classList.toggle('active', country === 'us');
  document.getElementById('btn-kr').classList.toggle('active', country === 'kr');
  // 항상 3열 고정 (grid-4 불필요)
  renderStrategyCards();
  calculate();
}

/* ===================== 메인 계산 ===================== */
function calculate() {
  const investKRW  = parseFloat(document.getElementById('investment').value) || 0;
  const selected   = document.querySelector('input[name="strategy"]:checked');
  if (!selected) return;

  const strategies = currentCountry === 'us' ? STRATEGIES_US : STRATEGIES_KR;
  const strategy   = strategies.find(s => s.id === selected.value);
  if (!strategy) return;

  const isCustom = strategy.isCustom;
  document.getElementById('customBuilder').style.display = isCustom ? 'block' : 'none';

  if (isCustom) {
    renderCustomBuilder();
    const total = getCustomTotal();
    if (total !== 100) return; // 합계가 100이 아니면 결과 미표시
  }

  const withholding  = currentCountry === 'us' ? WITHHOLDING_US : WITHHOLDING_KR;
  const blendedYield = isCustom ? getCustomBlendedYield() : getBlendedYield(strategy);

  const annualKRW       = investKRW * blendedYield;
  const monthlyKRW      = annualKRW / 12;
  const annualAfterKRW  = annualKRW * (1 - withholding);
  const monthlyAfterKRW = annualAfterKRW / 12;
  const yieldAfter      = blendedYield * (1 - withholding);
  const investUSD       = investKRW / USD_TO_KRW;

  const taxLabel = currentCountry === 'us' ? '미국 원천징수 15% 적용' : '배당소득세 15.4% 적용';
  document.querySelector('.result-main .after-label').textContent = `세후 (${taxLabel})`;

  document.getElementById('resultMonthly').textContent         = fmtShortKRW(monthlyKRW);
  document.getElementById('resultMonthlyUSD').textContent      = fmtUSD(monthlyKRW / USD_TO_KRW) + '/월';
  document.getElementById('resultMonthlyAfter').textContent    = fmtShortKRW(monthlyAfterKRW);
  document.getElementById('resultMonthlyAfterUSD').textContent = fmtUSD(monthlyAfterKRW / USD_TO_KRW) + '/월';
  document.getElementById('resultAnnual').textContent          = fmtShortKRW(annualKRW);
  document.getElementById('resultAnnualAfter').textContent     = fmtShortKRW(annualAfterKRW);
  document.getElementById('resultAnnualUSD').textContent       = fmtUSD(annualAfterKRW / USD_TO_KRW) + '/년 (세후)';
  document.getElementById('resultYield').textContent           = (blendedYield * 100).toFixed(2) + '%';
  document.getElementById('resultYieldAfter').textContent      = (yieldAfter * 100).toFixed(2) + '%';
  document.getElementById('resultInvestUSD').textContent       = '≈ ' + fmtUSD(investUSD);

  /* 세율 배너 */
  const infoEl = document.getElementById('taxInfoBanner');
  infoEl.innerHTML = currentCountry === 'kr'
    ? `⚠️ 국내 ETF 배당소득세 <strong>15.4%</strong> 적용 · ISA 계좌 활용 시 비과세 한도 내 절세 가능.<br>ETF 수익률은 최근 1년(TTM) 기준이며 향후 변동될 수 있습니다.`
    : `⚠️ 미국 주식 배당 <strong>원천징수 15%</strong> 적용 시 실수령은 약 15% 낮아집니다. ETF 수익률은 최근 1년(TTM) 기준이며 향후 변동될 수 있습니다.`;

  /* ETF별 기여 */
  const breakdownEl = document.getElementById('etfBreakdown');
  breakdownEl.innerHTML = '';

  const breakdownEtfs = isCustom
    ? (currentCountry === 'us' ? CUSTOM_ETFS_US : CUSTOM_ETFS_KR)
        .filter(k => customAllocations[currentCountry][k] > 0)
        .map(k => ({ key: k, label: k, weight: customAllocations[currentCountry][k] / 100 }))
    : strategy.etfs;

  breakdownEtfs.forEach(e => {
    const portion = investKRW * e.weight;
    const divKRW  = portion * ETF_DATA[e.key].yield;
    const row = document.createElement('tr');
    row.innerHTML = `
      <td><strong>${e.label}</strong></td>
      <td>${(e.weight * 100).toFixed(0)}%</td>
      <td>${fmtShortKRW(portion)}</td>
      <td class="green">${fmtShortKRW(divKRW / 12)}<span class="muted">/월</span></td>
      <td class="right muted">${(ETF_DATA[e.key].yield * 100).toFixed(1)}%</td>
    `;
    breakdownEl.appendChild(row);
  });

  document.getElementById('resultSection').style.display = 'block';

  /* 커스텀 카드 수익률 뱃지 갱신 */
  const badge = document.getElementById('customYieldBadge');
  if (badge && isCustom) badge.textContent = (blendedYield * 100).toFixed(1) + '%';
}

/* ===================== 커스텀 빌더 렌더 ===================== */
function renderCustomBuilder() {
  const container = document.getElementById('customEtfList');
  const keys      = currentCountry === 'us' ? CUSTOM_ETFS_US : CUSTOM_ETFS_KR;
  const allocs    = customAllocations[currentCountry];

  if (container.dataset.country === currentCountry) {
    updateCustomTotalUI();
    return; // 이미 렌더됨
  }
  container.dataset.country = currentCountry;
  container.innerHTML = '';

  keys.forEach(key => {
    const etf = ETF_DATA[key];
    const val = allocs[key] || 0;
    const row = document.createElement('div');
    row.className = 'custom-etf-row';
    row.dataset.key = key;
    row.innerHTML = `
      <div class="custom-etf-info">
        <span class="custom-etf-ticker">${key}</span>
        <span class="custom-etf-name">${etf.fullName}</span>
      </div>
      <span class="custom-yield-badge" style="background:${etf.color}22;color:${etf.color}">
        ${(etf.yield * 100).toFixed(1)}%
      </span>
      <div class="custom-alloc">
        <input type="range" class="custom-range" min="0" max="100" value="${val}"
               oninput="syncCustomAlloc('${key}', this.value, 'range')">
        <input type="number" class="custom-number" min="0" max="100" value="${val}"
               oninput="syncCustomAlloc('${key}', this.value, 'num')">
        <span class="custom-pct">%</span>
      </div>
    `;
    container.appendChild(row);
  });

  updateCustomTotalUI();
}

function syncCustomAlloc(key, rawVal, source) {
  const val = Math.max(0, Math.min(100, parseInt(rawVal) || 0));
  customAllocations[currentCountry][key] = val;

  const row = document.querySelector(`.custom-etf-row[data-key="${CSS.escape(key)}"]`);
  if (row) {
    if (source !== 'range') row.querySelector('.custom-range').value = val;
    if (source !== 'num')   row.querySelector('.custom-number').value = val;
  }

  updateCustomTotalUI();
  const total = getCustomTotal();
  if (total === 100) calculate();
  else document.getElementById('resultSection').style.display = 'none';

  /* 커스텀 뱃지 갱신 */
  const badge = document.getElementById('customYieldBadge');
  if (badge) {
    const y = total === 100 ? (getCustomBlendedYield() * 100).toFixed(1) + '%' : '—';
    badge.textContent = y;
  }
}

function updateCustomTotalUI() {
  const total   = getCustomTotal();
  const el      = document.getElementById('customTotalText');
  const warn    = document.getElementById('customWarning');
  const fillEl  = document.getElementById('customTotalFill');

  el.textContent  = total + '%';
  el.className    = 'custom-total-text ' + (total === 100 ? 'ok' : total > 100 ? 'over' : 'under');
  warn.style.display = total !== 100 ? 'block' : 'none';
  warn.textContent   = total > 100
    ? `⚠️ 합계가 ${total}%입니다. 100%가 되도록 조정해주세요.`
    : `⚠️ 합계가 ${total}%입니다. 100%가 되도록 조정해주세요.`;
  if (fillEl) {
    fillEl.style.width = Math.min(total, 100) + '%';
    fillEl.style.background = total === 100 ? 'var(--green)' : total > 100 ? 'var(--red)' : 'var(--accent)';
  }
}

function distributeEvenly() {
  const keys  = currentCountry === 'us' ? CUSTOM_ETFS_US : CUSTOM_ETFS_KR;
  const each  = Math.floor(100 / keys.length);
  const rem   = 100 - each * keys.length;
  keys.forEach((k, i) => {
    customAllocations[currentCountry][k] = each + (i < rem ? 1 : 0);
  });
  // 컨테이너 리셋 후 재렌더
  document.getElementById('customEtfList').dataset.country = '';
  renderCustomBuilder();
  calculate();
}

/* ===================== 슬라이더 동기화 ===================== */
function syncSlider(id) {
  const val = parseFloat(document.getElementById(id).value) || 0;
  document.getElementById(id + 'Range').value = val;
  updateSliderLabel(id, val);
  calculate();
}
function syncInput(id) {
  const val = parseFloat(document.getElementById(id + 'Range').value) || 0;
  document.getElementById(id).value = val;
  updateSliderLabel(id, val);
  calculate();
}
function updateSliderLabel(id, val) {
  document.getElementById(id + 'Label').textContent = fmtShortKRW(val);
}

/* ===================== 전략 카드 렌더 ===================== */
function renderStrategyCards() {
  const container  = document.getElementById('strategyCards');
  const strategies = currentCountry === 'us' ? STRATEGIES_US : STRATEGIES_KR;
  container.innerHTML = '';

  strategies.forEach((s, i) => {
    const label = document.createElement('label');
    label.className = 'strategy-card';
    label.htmlFor = 'strategy_' + s.id;

    if (s.isCustom) {
      label.innerHTML = `
        <input type="radio" id="strategy_${s.id}" name="strategy" value="${s.id}" onchange="calculate()">
        <div class="strategy-card-inner custom-card-inner">
          <div class="strategy-card-header">
            <span class="strategy-name">✏️ ${s.name}</span>
            <span class="strategy-yield-badge" id="customYieldBadge">—</span>
          </div>
          <div class="strategy-desc">${s.desc}</div>
          <div class="strategy-tag">${s.tag}</div>
          <div class="custom-card-hint">아래에서 ETF 비율을 설정하세요</div>
        </div>
      `;
    } else {
      const blendedYield = getBlendedYield(s);
      const barsHTML = s.etfs.map(e => `
        <div class="bar-row">
          <span class="bar-label">${e.label}</span>
          <div class="bar-track">
            <div class="bar-fill" style="width:${e.weight * 100}%;background:${ETF_DATA[e.key].color}"></div>
          </div>
          <span class="bar-pct">${(e.weight * 100).toFixed(0)}%</span>
        </div>
      `).join('');
      const descHTML = s.desc.split('\n').join('<br>');

      label.innerHTML = `
        <input type="radio" id="strategy_${s.id}" name="strategy" value="${s.id}" onchange="calculate()" ${i === 0 ? 'checked' : ''}>
        <div class="strategy-card-inner">
          <div class="strategy-card-header">
            <span class="strategy-name">${s.name}</span>
            <span class="strategy-yield-badge">${(blendedYield * 100).toFixed(1)}%</span>
          </div>
          <div class="strategy-desc">${descHTML}</div>
          <div class="strategy-tag">${s.tag}</div>
          <div class="strategy-bars">${barsHTML}</div>
        </div>
      `;
    }
    container.appendChild(label);
  });

  document.getElementById('strategyCards').classList.remove('grid-4');
  document.getElementById('customBuilder').style.display = 'none';
  document.getElementById('customEtfList').dataset.country = '';
}

/* ===================== 초기화 ===================== */
renderStrategyCards();
updateSliderLabel('investment', parseFloat(document.getElementById('investment').value) || 0);
calculate();
