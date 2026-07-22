/* ===================== 주요 주가지수 + 지수별 기간 선택 (Yahoo Finance) ===================== */
/* 코스피·다우존스·나스닥·S&P 500 지수를 조회한다.
   각 지수 카드마다 기간(1일·1주·1개월·3개월·1년)을 독립적으로 선택하며, 기간을 바꾸면
   해당 지수만 다시 로드한다. 변동 기준은 기간 시작 직전 종가(chartPreviousClose).
   fx.js 와 동일한 CORS 프록시 fallback + localStorage 캐시(TTL 5분, 지수·기간별로 분리). */

const IDX_PROXY_URL = (url) => `https://corsproxy.io/?url=${encodeURIComponent(url)}`;
const IDX_CACHE_TTL = 5 * 60 * 1000; // 5분
const IDX_CHART_URL = (sym, range, interval) =>
  `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=${range}&interval=${interval}`;

/* 선택 가능한 기간.
   type: 'line'(종가 선 그래프) | 'candle'(OHLC 캔들). changeMode: 'period'(기간 시작 직전 종가 대비)
   | 'bar'(직전 봉 종가 대비). changeLabel: 변동 접미사, rangeLabel: 최고/최저 칩 접두어,
   intraday: 최고/최저를 시각으로 표기할지 여부. */
const PERIODS = {
  '1D': { label: '1일',  range: '1d',  interval: '5m',  type: 'line',   changeMode: 'period', changeLabel: '전일 대비',   rangeLabel: '1일',   intraday: true },
  '1W': { label: '1주',  range: '5d',  interval: '30m', type: 'line',   changeMode: 'period', changeLabel: '1주 전 대비',  rangeLabel: '1주',   intraday: true },
  '1M': { label: '1개월', range: '1mo', interval: '1d',  type: 'line',   changeMode: 'period', changeLabel: '1개월 전 대비', rangeLabel: '1개월', intraday: false },
  '3M': { label: '3개월', range: '3mo', interval: '1d',  type: 'line',   changeMode: 'period', changeLabel: '3개월 전 대비', rangeLabel: '3개월', intraday: false },
  '1Y': { label: '1년',  range: '1y',  interval: '1d',  type: 'line',   changeMode: 'period', changeLabel: '1년 전 대비',  rangeLabel: '1년',   intraday: false },
  'D':  { label: '일봉',  range: '6mo', interval: '1d',  type: 'candle', changeMode: 'bar',    changeLabel: '전일 대비',   rangeLabel: '6개월', intraday: false },
  'W':  { label: '주봉',  range: '2y',  interval: '1wk', type: 'candle', changeMode: 'bar',    changeLabel: '전주 대비',   rangeLabel: '2년',   intraday: false },
  'M':  { label: '월봉',  range: '5y',  interval: '1mo', type: 'candle', changeMode: 'bar',    changeLabel: '전월 대비',   rangeLabel: '5년',   intraday: false },
};
const DEFAULT_PERIOD = '1D';
/* 상승하락 방향별 선 그래프 색상: 상승=빨강 · 하락=파랑 · 보합=회색 (.fx-change 색과 통일) */
const DIR_COLORS = { up: '#f87171', down: '#6c8cff', flat: '#94a3b8' };
const CANDLE_UP = '#f87171';   // 양봉(상승) = 빨강
const CANDLE_DOWN = '#6c8cff'; // 음봉(하락) = 파랑

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

/* 주/월 집계 간격에서 같은 기간에 속하는지 판별하는 버킷 키 (일·분봉은 타임스탬프 고유). */
function periodBucket(ms, interval) {
  const d = new Date(ms);
  if (interval === '1mo') return d.getUTCFullYear() * 12 + d.getUTCMonth();
  if (interval === '1wk') return Math.floor(ms / (7 * 24 * 3600 * 1000));
  return ms;
}

/* Yahoo chart 응답 -> { series: [{x,o,h,l,c,y}...], prevClose }. 실패 시 null.
   OHLC 중 일부가 없으면 종가(c)로 대체해 캔들 형태를 유지한다. y=c 로 선 그래프와 호환.
   주봉·월봉에서 Yahoo 가 현재 기간 봉을 중복으로 덧붙이므로, 같은 기간 마지막 봉은 병합한다. */
function dataFromChart(json, interval) {
  const result = json?.chart?.result?.[0];
  const ts = result?.timestamp;
  const q = result?.indicators?.quote?.[0];
  if (!Array.isArray(ts) || !q || !Array.isArray(q.close)) return null;

  const num = (v, fallback) => (typeof v === 'number' && isFinite(v) ? v : fallback);
  const series = [];
  for (let i = 0; i < ts.length; i++) {
    const c = q.close[i];
    if (typeof c === 'number' && c > 0) {
      const o = num(q.open?.[i], c);
      series.push({ x: ts[i] * 1000, o, h: Math.max(num(q.high?.[i], c), o, c), l: Math.min(num(q.low?.[i], c), o, c), c, y: c });
    }
  }
  if (series.length < 2) return null;

  /* 현재 기간 중복 봉 병합 (최신 종가·고저 반영 후 제거) */
  const n = series.length;
  if (periodBucket(series[n - 1].x, interval) === periodBucket(series[n - 2].x, interval)) {
    const dup = series.pop();
    const cur = series[series.length - 1];
    cur.c = dup.c; cur.y = dup.c;
    cur.h = Math.max(cur.h, dup.h);
    cur.l = Math.min(cur.l, dup.l);
  }

  const meta = result.meta || {};
  const pc = meta.chartPreviousClose ?? meta.previousClose;
  const prevClose = typeof pc === 'number' && pc > 0 ? pc : series[0].c;
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
  return dataFromChart(json, p.interval);
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

/* OHLC 시계열 -> 인라인 SVG 캔들 차트 (양봉=빨강, 음봉=파랑). */
function buildCandleSVG(series, W = 260, H = 90) {
  const PAD = 6;
  const n = series.length;
  const yMin = Math.min(...series.map((b) => b.l));
  const yMax = Math.max(...series.map((b) => b.h));
  const yPad = (yMax - yMin) * 0.08 || 1;
  const lo = yMin - yPad, hi = yMax + yPad;
  const yScale = (y) => PAD + (1 - (y - lo) / (hi - lo || 1)) * (H - 2 * PAD);
  const slot = (W - 2 * PAD) / n;
  const bodyW = Math.max(1, slot * 0.62);

  const bars = series.map((b, i) => {
    const cx = PAD + slot * (i + 0.5);
    const color = b.c >= b.o ? CANDLE_UP : CANDLE_DOWN;
    const yHigh = yScale(b.h), yLow = yScale(b.l);
    const top = Math.min(yScale(b.o), yScale(b.c));
    const bodyH = Math.max(1, Math.abs(yScale(b.o) - yScale(b.c)));
    return (
      `<line x1="${cx.toFixed(1)}" y1="${yHigh.toFixed(1)}" x2="${cx.toFixed(1)}" y2="${yLow.toFixed(1)}" stroke="${color}" stroke-width="1" vector-effect="non-scaling-stroke" />` +
      `<rect x="${(cx - bodyW / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${bodyW.toFixed(1)}" height="${bodyH.toFixed(1)}" fill="${color}" />`
    );
  }).join('');

  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="캔들 차트">${bars}</svg>`;
}

function renderAsset(asset, data) {
  const rateEl = document.getElementById(asset.rateEl);
  const changeEl = document.getElementById(asset.changeEl);
  const chartEl = document.getElementById(asset.chartEl);
  const rangeEl = document.getElementById(asset.rangeEl);
  if (!rateEl || !data) return;

  const p = PERIODS[asset.period];
  const isCandle = p.type === 'candle';
  const stamp = p.intraday ? timeFmt : dateFmt;
  const { series, prevClose } = data;
  const cur = series[series.length - 1].c;

  /* 현재값 */
  rateEl.classList.remove('loading');
  rateEl.textContent = numFmt(cur);

  /* 변동: 캔들(전일/전주/전월)은 직전 봉 종가 대비, 선 그래프는 기간 시작 직전 종가 대비 */
  const baseline = p.changeMode === 'bar' ? series[series.length - 2].c : prevClose;
  const diff = cur - baseline;
  const pct = baseline !== 0 ? (diff / baseline) * 100 : 0;
  const dir = diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat';
  const arrow = diff > 0 ? '▲' : diff < 0 ? '▼' : '−';
  const sign = diff > 0 ? '+' : diff < 0 ? '-' : '';
  changeEl.className = `fx-change ${dir}`;
  changeEl.textContent = `${arrow} ${sign}${numFmt(Math.abs(diff))} (${sign}${Math.abs(pct).toFixed(2)}%) · ${p.changeLabel}`;

  /* 차트 (캔들 / 선) */
  chartEl.innerHTML = isCandle
    ? buildCandleSVG(series, asset.chartW, asset.chartH)
    : buildChartSVG(series, DIR_COLORS[dir], asset.chartW, asset.chartH);

  /* 기간 최저·최고 (캔들은 봉의 고가/저가, 선은 종가 기준) */
  const highVals = series.map((b) => (isCandle ? b.h : b.c));
  const lowVals = series.map((b) => (isCandle ? b.l : b.c));
  const highIdx = highVals.indexOf(Math.max(...highVals));
  const lowIdx = lowVals.indexOf(Math.min(...lowVals));
  const rl = p.rangeLabel || p.label;
  rangeEl.innerHTML =
    `<div class="fx-range-item">` +
      `<div class="fx-range-top">` +
        `<span class="fx-range-label">${rl} 최고</span>` +
        `<span class="fx-range-date">${stamp(series[highIdx].x)}</span>` +
      `</div>` +
      `<span class="fx-range-val high">${numFmt(highVals[highIdx])}</span>` +
    `</div>` +
    `<div class="fx-range-item">` +
      `<div class="fx-range-top">` +
        `<span class="fx-range-label">${rl} 최저</span>` +
        `<span class="fx-range-date">${stamp(series[lowIdx].x)}</span>` +
      `</div>` +
      `<span class="fx-range-val low">${numFmt(lowVals[lowIdx])}</span>` +
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
