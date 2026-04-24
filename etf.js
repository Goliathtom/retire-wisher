/* ===================== 상수 ===================== */
const USD_TO_KRW    = 1450;
const WITHHOLDING_US = 0.15;   // 미국 원천징수
const WITHHOLDING_KR = 0.154;  // 국내 배당소득세

const ETF_DATA = {
  /* 미국 */
  SCHD:            { yield: 0.034, color: 'var(--accent)'  },
  JEPI:            { yield: 0.088, color: 'var(--green)'   },
  JEPQ:            { yield: 0.105, color: 'var(--accent2)' },
  /* 국내 */
  'TIGER배당다우':  { yield: 0.035, color: 'var(--accent)'  },
  'SOL배당다우':    { yield: 0.035, color: 'var(--accent)'  },
  'TIGER프리미엄':  { yield: 0.075, color: 'var(--green)'   },
  'KODEX프리미엄':  { yield: 0.075, color: 'var(--green)'   },
  'TIGER고배당':    { yield: 0.045, color: 'var(--yellow)'  },
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
      { key: 'SOL배당다우',   label: 'SOL배당',    weight: 0.40 },
      { key: 'KODEX프리미엄', label: 'KODEX프리미엄', weight: 0.60 },
    ],
  },
  {
    id: 'kr_isa',
    name: 'ISA 절세 조합',
    desc: 'TIGER 미국배당다우존스 60%\nTIGER 미국배당+7%프리미엄 40%',
    tag: 'ISA 계좌 활용 절세',
    etfs: [
      { key: 'TIGER배당다우', label: 'TIGER배당',   weight: 0.60 },
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
];

let currentCountry = 'us';

/* ===================== 포맷 ===================== */
function fmtKRW(n) {
  return Math.round(n).toLocaleString('ko-KR') + '원';
}
function fmtShortKRW(n) {
  if (Math.abs(n) >= 1_0000_0000) return (n / 1_0000_0000).toFixed(1) + '억원';
  if (Math.abs(n) >= 1_0000) return Math.round(n / 10_000).toLocaleString('ko-KR') + '만원';
  return Math.round(n).toLocaleString('ko-KR') + '원';
}
function fmtUSD(n) {
  return '$' + Math.round(n).toLocaleString('en-US');
}

/* ===================== 블렌딩 수익률 ===================== */
function getBlendedYield(strategy) {
  return strategy.etfs.reduce((sum, e) => sum + e.weight * ETF_DATA[e.key].yield, 0);
}

/* ===================== 국가 전환 ===================== */
function setCountry(country) {
  currentCountry = country;
  document.getElementById('btn-us').classList.toggle('active', country === 'us');
  document.getElementById('btn-kr').classList.toggle('active', country === 'kr');

  const grid = document.getElementById('strategyCards');
  grid.classList.toggle('grid-4', country === 'kr');

  renderStrategyCards();
  calculate();
}

/* ===================== 계산 ===================== */
function calculate() {
  const investKRW    = parseFloat(document.getElementById('investment').value) || 0;
  const selected     = document.querySelector('input[name="strategy"]:checked');
  if (!selected) return;

  const strategies   = currentCountry === 'us' ? STRATEGIES_US : STRATEGIES_KR;
  const strategy     = strategies.find(s => s.id === selected.value);
  if (!strategy) return;

  const withholding     = currentCountry === 'us' ? WITHHOLDING_US : WITHHOLDING_KR;
  const blendedYield    = getBlendedYield(strategy);
  const annualKRW       = investKRW * blendedYield;
  const monthlyKRW      = annualKRW / 12;
  const annualAfterKRW  = annualKRW * (1 - withholding);
  const monthlyAfterKRW = annualAfterKRW / 12;
  const yieldAfter      = blendedYield * (1 - withholding);
  const investUSD       = investKRW / USD_TO_KRW;

  /* 결과 표시 */
  const taxLabel = currentCountry === 'us' ? '미국 원천징수 15% 적용' : '배당소득세 15.4% 적용';
  document.querySelector('.result-main .after-label').textContent = `세후 (${taxLabel})`;

  document.getElementById('resultMonthly').textContent        = fmtShortKRW(monthlyKRW);
  document.getElementById('resultMonthlyUSD').textContent     = fmtUSD(monthlyKRW / USD_TO_KRW) + '/월';
  document.getElementById('resultMonthlyAfter').textContent   = fmtShortKRW(monthlyAfterKRW);
  document.getElementById('resultMonthlyAfterUSD').textContent = fmtUSD(monthlyAfterKRW / USD_TO_KRW) + '/월';
  document.getElementById('resultAnnual').textContent         = fmtShortKRW(annualKRW);
  document.getElementById('resultAnnualAfter').textContent    = fmtShortKRW(annualAfterKRW);
  document.getElementById('resultAnnualUSD').textContent      = fmtUSD(annualAfterKRW / USD_TO_KRW) + '/년 (세후)';
  document.getElementById('resultYield').textContent          = (blendedYield * 100).toFixed(2) + '%';
  document.getElementById('resultYieldAfter').textContent     = (yieldAfter * 100).toFixed(2) + '%';
  document.getElementById('resultInvestUSD').textContent      = '≈ ' + fmtUSD(investUSD);

  /* 세율 배너 */
  const infoEl = document.getElementById('taxInfoBanner');
  if (currentCountry === 'kr') {
    infoEl.innerHTML = `⚠️ 국내 ETF 배당소득세 <strong>15.4%</strong> 적용 · ISA 계좌 활용 시 비과세 한도 내 절세 가능.<br>
    ETF 수익률은 최근 1년(TTM) 기준이며 향후 변동될 수 있습니다.`;
  } else {
    infoEl.innerHTML = `⚠️ 미국 주식 배당 <strong>원천징수 15%</strong> 적용 시 실수령은 약 15% 낮아집니다.
    ETF 수익률은 최근 1년(TTM) 기준이며 향후 변동될 수 있습니다.`;
  }

  /* ETF별 기여 breakdown */
  const breakdownEl = document.getElementById('etfBreakdown');
  breakdownEl.innerHTML = '';
  strategy.etfs.forEach(e => {
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
    const blendedYield = getBlendedYield(s);
    const label = document.createElement('label');
    label.className = 'strategy-card';
    label.htmlFor = 'strategy_' + s.id;

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
    container.appendChild(label);
  });
}

/* ===================== 초기화 ===================== */
renderStrategyCards();
updateSliderLabel('investment', parseFloat(document.getElementById('investment').value) || 0);
calculate();
