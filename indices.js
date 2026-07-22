/* ===================== 주요 주가지수 + 지수별 기간 선택 (Yahoo Finance) ===================== */
/* 코스피·다우존스·나스닥·S&P 500 지수를 조회한다.
   각 지수 카드마다 기간(1일·1주·1개월·3개월·1년)을 독립적으로 선택하며, 기간을 바꾸면
   해당 지수만 다시 로드한다. 변동 기준은 기간 시작 직전 종가(chartPreviousClose).
   fx.js 와 동일한 CORS 프록시 fallback + localStorage 캐시(TTL 5분, 지수·기간별로 분리). */

const IDX_PROXY_URL = (url) => `https://corsproxy.io/?url=${encodeURIComponent(url)}`;
const IDX_CACHE_TTL = 5 * 60 * 1000; // 5분
const IDX_CHART_URL = (sym, range, interval) =>
  `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=${range}&interval=${interval}`;

/* 선택 가능한 기간. changeLabel 은 변동 표시 접미사, intraday 는 최고/최저를 시각으로 표기할지 여부. */
const PERIODS = {
  '1D': { label: '1일',  range: '1d',  interval: '5m',  changeLabel: '전일 대비',   intraday: true },
  '1W': { label: '1주',  range: '5d',  interval: '30m', changeLabel: '1주 전 대비',  intraday: true },
  '1M': { label: '1개월', range: '1mo', interval: '1d',  changeLabel: '1개월 전 대비', intraday: false },
  '3M': { label: '3개월', range: '3mo', interval: '1d',  changeLabel: '3개월 전 대비', intraday: false },
  '1Y': { label: '1년',  range: '1y',  interval: '1d',  changeLabel: '1년 전 대비',  intraday: false },
};
const DEFAULT_PERIOD = '1D';

/* 지수 정의: color 는 차트 색상, period 는 카드별 현재 선택 기간(기본 3개월). */
const ASSETS = [
  { code: 'KOSPI', symbol: '^KS11', color: '#f87171', period: DEFAULT_PERIOD,
    rateEl: 'rateKOSPI', changeEl: 'changeKOSPI', chartEl: 'chartKOSPI', rangeEl: 'rangeKOSPI', periodsEl: 'periodsKOSPI',
    chartW: 820, chartH: 130 },
  { code: 'DJI',  symbol: '^DJI',  color: '#6c8cff', period: DEFAULT_PERIOD,
    rateEl: 'rateDJI',  changeEl: 'changeDJI',  chartEl: 'chartDJI',  rangeEl: 'rangeDJI', periodsEl: 'periodsDJI',
    chartW: 820, chartH: 130 },
  { code: 'IXIC', symbol: '^IXIC', color: '#a78bfa', period: DEFAULT_PERIOD,
    rateEl: 'rateIXIC', changeEl: 'changeIXIC', chartEl: 'chartIXIC', rangeEl: 'rangeIXIC', periodsEl: 'periodsIXIC',
    chartW: 820, chartH: 130 },
  { code: 'GSPC', symbol: '^GSPC', color: '#34d399', period: DEFAULT_PERIOD,
    rateEl: 'rateGSPC', changeEl: 'changeGSPC', chartEl: 'chartGSPC', rangeEl: 'rangeGSPC', periodsEl: 'periodsGSPC',
    chartW: 820, chartH: 130 },
];

async function idxTryFetch(url) {
  const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

/* Yahoo chart 응답 -> { series: [{x,y}...], prevClose }. 실패 시 null. */
function dataFromChart(json) {
  const result = json?.chart?.result?.[0];
  const ts = result?.timestamp;
  const closes = result?.indicators?.quote?.[0]?.close;
  if (!Array.isArray(ts) || !Array.isArray(closes)) return null;

  const series = [];
  for (let i = 0; i < ts.length; i++) {
    const c = closes[i];
    if (typeof c === 'number' && c > 0) series.push({ x: ts[i] * 1000, y: c });
  }
  if (series.length < 2) return null;

  const meta = result.meta || {};
  const pc = meta.chartPreviousClose ?? meta.previousClose;
  const prevClose = typeof pc === 'number' && pc > 0 ? pc : series[0].y;
  return { series, prevClose };
}

async function fetchIdxData(symbol, period) {
  const p = PERIODS[period];
  const url = IDX_CHART_URL(symbol, p.range, p.interval);
  let json;
  try {
    json = await idxTryFetch(url);
  } catch (e1) {
    json = await idxTryFetch(IDX_PROXY_URL(url)); // CORS 프록시 fallback
  }
  return dataFromChart(json);
}

const numFmt = (n) => n.toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateFmt = (ms) => new Date(ms).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
const timeFmt = (ms) => new Date(ms).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });

/* 종가 시계열 -> 인라인 SVG 라인+영역 차트. */
function buildChartSVG(series, color, W = 260, H = 90) {
  const PAD = 6;
  const xs = series.map((p) => p.x);
  const ys = series.map((p) => p.y);
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const yMin = Math.min(...ys), yMax = Math.max(...ys);
  const yPad = (yMax - yMin) * 0.12 || 1;
  const lo = yMin - yPad, hi = yMax + yPad;

  const xScale = (x) => PAD + ((x - xMin) / (xMax - xMin || 1)) * (W - 2 * PAD);
  const yScale = (y) => PAD + (1 - (y - lo) / (hi - lo || 1)) * (H - 2 * PAD);

  const line = series
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${xScale(p.x).toFixed(1)} ${yScale(p.y).toFixed(1)}`)
    .join(' ');
  const area = `${line} L ${xScale(xMax).toFixed(1)} ${H - PAD} L ${xScale(xMin).toFixed(1)} ${H - PAD} Z`;
  const last = series[series.length - 1];

  return `
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="기간 지수 추이">
      <path class="fx-chart-area" d="${area}" fill="${color}" />
      <path class="fx-chart-line" d="${line}" stroke="${color}" />
      <circle cx="${xScale(last.x).toFixed(1)}" cy="${yScale(last.y).toFixed(1)}" r="2.5" fill="${color}" />
    </svg>`;
}

function renderAsset(asset, data) {
  const rateEl = document.getElementById(asset.rateEl);
  const changeEl = document.getElementById(asset.changeEl);
  const chartEl = document.getElementById(asset.chartEl);
  const rangeEl = document.getElementById(asset.rangeEl);
  if (!rateEl || !data) return;

  const p = PERIODS[asset.period];
  const stamp = p.intraday ? timeFmt : dateFmt;
  const { series, prevClose } = data;
  const cur = series[series.length - 1].y;

  /* 현재값 */
  rateEl.classList.remove('loading');
  rateEl.textContent = numFmt(cur);

  /* 기간 대비 변동 (기간 시작 직전 종가 기준) */
  const diff = cur - prevClose;
  const pct = prevClose !== 0 ? (diff / prevClose) * 100 : 0;
  const dir = diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat';
  const arrow = diff > 0 ? '▲' : diff < 0 ? '▼' : '−';
  const sign = diff > 0 ? '+' : diff < 0 ? '-' : '';
  changeEl.className = `fx-change ${dir}`;
  changeEl.textContent = `${arrow} ${sign}${numFmt(Math.abs(diff))} (${sign}${Math.abs(pct).toFixed(2)}%) · ${p.changeLabel}`;

  /* 차트 */
  chartEl.innerHTML = buildChartSVG(series, asset.color, asset.chartW, asset.chartH);

  /* 기간 최저·최고 */
  const ys = series.map((pt) => pt.y);
  const lowIdx = ys.indexOf(Math.min(...ys));
  const highIdx = ys.indexOf(Math.max(...ys));
  rangeEl.innerHTML =
    `<div class="fx-range-item">` +
      `<div class="fx-range-top">` +
        `<span class="fx-range-label">${p.label} 최고</span>` +
        `<span class="fx-range-date">${stamp(series[highIdx].x)}</span>` +
      `</div>` +
      `<span class="fx-range-val high">${numFmt(ys[highIdx])}</span>` +
    `</div>` +
    `<div class="fx-range-item">` +
      `<div class="fx-range-top">` +
        `<span class="fx-range-label">${p.label} 최저</span>` +
        `<span class="fx-range-date">${stamp(series[lowIdx].x)}</span>` +
      `</div>` +
      `<span class="fx-range-val low">${numFmt(ys[lowIdx])}</span>` +
    `</div>`;
}

/* 카드별 기간 로드 (지수·기간별 캐시). */
async function loadAsset(asset) {
  const period = asset.period;
  const cacheKey = `idx_${asset.code}_${period}`;

  /* 캐시 확인 */
  try {
    const cached = JSON.parse(localStorage.getItem(cacheKey) || 'null');
    if (cached && Date.now() - cached.ts < IDX_CACHE_TTL) {
      if (asset.period === period) renderAsset(asset, cached.data);
      return;
    }
  } catch (e) {}

  const data = await fetchIdxData(asset.symbol, period);
  if (asset.period !== period) return; // 그 사이 다른 기간이 선택됨 → 최신 요청만 반영

  if (!data) {
    const rateEl = document.getElementById(asset.rateEl);
    if (rateEl && rateEl.classList.contains('loading')) rateEl.textContent = '조회 실패';
    return;
  }

  renderAsset(asset, data);
  localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), data }));
}

/* 카드별 기간 토글 버튼 생성 + 이벤트 연결. */
function buildPeriodButtons(asset) {
  const container = document.getElementById(asset.periodsEl);
  if (!container) return;
  container.innerHTML = Object.keys(PERIODS)
    .map((k) => `<button class="card-period-btn${k === asset.period ? ' active' : ''}" data-period="${k}">${PERIODS[k].label}</button>`)
    .join('');
  container.addEventListener('click', (e) => {
    const btn = e.target.closest('.card-period-btn');
    if (!btn) return;
    const p = btn.dataset.period;
    if (p === asset.period || !PERIODS[p]) return;
    asset.period = p;
    container.querySelectorAll('.card-period-btn').forEach((b) => b.classList.toggle('active', b.dataset.period === p));
    loadAsset(asset);
  });
}

/* ===================== 초기화 ===================== */
ASSETS.forEach((asset) => {
  buildPeriodButtons(asset);
  loadAsset(asset);
});
