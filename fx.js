/* ===================== 실시간 환율 + 통화별 기간 선택 (Yahoo Finance) ===================== */
/* Yahoo Finance chart 엔드포인트에서 원/달러·원/유로·원/엔·달러 인덱스 시세를 조회한다.
   각 통화 카드마다 기간(1일·1주·1개월·3개월·1년)을 독립적으로 선택하며, 기간을 바꾸면
   해당 통화만 다시 로드한다. 변동 기준은 기간 시작 직전 종가(chartPreviousClose).
   indices.js 와 동일한 CORS 프록시 fallback + localStorage 캐시(TTL 5분, 통화·기간별로 분리). */

/* CORS 프록시 — 자체 Cloudflare Worker(cloudflare-worker.js) 우선, 실패 시 공개 프록시 순차 시도 */
const FX_PROXIES = [
  (url) => `https://retire-wisher.goliathtom11.workers.dev/?url=${encodeURIComponent(url)}`,
  (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  (url) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
];
const FX_CACHE_TTL = 5 * 60 * 1000; // 5분
const FX_CHART_URL = (sym, range, interval) =>
  `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=${range}&interval=${interval}`;

/* 선택 가능한 기간. changeLabel 은 변동 표시 접미사, rangeLabel 은 최고/최저 칩 접두어,
   intraday 는 최고/최저를 시각으로 표기할지 여부. */
const PERIODS = {
  '1D': { label: '1일',  range: '1d',  interval: '5m',  changeLabel: '전일 대비',   rangeLabel: '1일',   intraday: true },
  '1W': { label: '1주',  range: '5d',  interval: '30m', changeLabel: '1주 전 대비',  rangeLabel: '1주',   intraday: true },
  '1M': { label: '1개월', range: '1mo', interval: '1d',  changeLabel: '1개월 전 대비', rangeLabel: '1개월', intraday: false },
  '3M': { label: '3개월', range: '3mo', interval: '1d',  changeLabel: '3개월 전 대비', rangeLabel: '3개월', intraday: false },
  '1Y': { label: '1년',  range: '1y',  interval: '1d',  changeLabel: '1년 전 대비',  rangeLabel: '1년',   intraday: false },
  '3Y': { label: '3년',  range: '3y',  interval: '1wk', changeLabel: '3년 전 대비',  rangeLabel: '3년',   intraday: false, longDate: true },
  '5Y': { label: '5년',  range: '5y',  interval: '1wk', changeLabel: '5년 전 대비',  rangeLabel: '5년',   intraday: false, longDate: true },
};
const DEFAULT_PERIOD = '1D';

/* 지표 정의: multiplier 는 표시 단위(엔은 100엔 기준), unit 은 값 뒤 단위(달러 인덱스는 없음),
   period 는 카드별 현재 선택 기간. 달러 인덱스(DXY)는 넓은 카드용 차트 크기(chartW/chartH)를 별도 지정. */
const CURRENCIES = [
  { code: 'USD', symbol: 'KRW=X',    multiplier: 1,   unit: '원', period: DEFAULT_PERIOD, cardEl: 'cardUSD',
    rateEl: 'rateUSD', changeEl: 'changeUSD', chartEl: 'chartUSD', rangeEl: 'rangeUSD', periodsEl: 'periodsUSD',
    chartW: 820, chartH: 240 },
  { code: 'EUR', symbol: 'EURKRW=X', multiplier: 1,   unit: '원', period: DEFAULT_PERIOD, cardEl: 'cardEUR',
    rateEl: 'rateEUR', changeEl: 'changeEUR', chartEl: 'chartEUR', rangeEl: 'rangeEUR', periodsEl: 'periodsEUR',
    chartW: 820, chartH: 240 },
  { code: 'JPY', symbol: 'JPYKRW=X', multiplier: 100, unit: '원', period: DEFAULT_PERIOD, cardEl: 'cardJPY',
    rateEl: 'rateJPY', changeEl: 'changeJPY', chartEl: 'chartJPY', rangeEl: 'rangeJPY', periodsEl: 'periodsJPY',
    chartW: 820, chartH: 240 },
  { code: 'DXY', symbol: 'DX-Y.NYB', multiplier: 1,   unit: '',   period: DEFAULT_PERIOD, cardEl: 'cardDXY',
    rateEl: 'rateDXY', changeEl: 'changeDXY', chartEl: 'chartDXY', rangeEl: 'rangeDXY', periodsEl: 'periodsDXY',
    chartW: 820, chartH: 240 },
];

async function fxTryFetch(url) {
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

/* 직접 호출(CORS 로 대부분 실패) 후 프록시 목록을 순차 시도. */
async function fxFetchJson(url) {
  try { return await fxTryFetch(url); } catch (e) {}
  let lastErr;
  for (const proxy of FX_PROXIES) {
    try { return await fxTryFetch(proxy(url)); } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('all proxies failed');
}

async function fetchFxData(symbol, period) {
  const p = PERIODS[period];
  const json = await fxFetchJson(FX_CHART_URL(symbol, p.range, p.interval));
  return dataFromChart(json);
}

const wonFmt = (n) => n.toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateFmt = (ms) => new Date(ms).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
const timeFmt = (ms) => new Date(ms).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
const ymdFmt = (ms) => { const d = new Date(ms); return `${String(d.getFullYear()).slice(2)}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/* 상승하락 방향별 그래프 색상: 상승=빨강 · 하락=파랑 · 보합=회색 (.fx-change 색과 통일) */
const DIR_COLORS = { up: '#f87171', down: '#6c8cff', flat: '#94a3b8' };

const CHART_MARGIN = { L: 46, R: 10, T: 10, B: 22 };

/* 차트 축(y축 값 그리드 + x축 라벨) SVG. 눈금 간격이 1 미만이면 소수 2자리로 표기(intraday 환율 대응). */
function buildAxes(W, PAD_L, PAD_R, PAD_T, plotH, yMin, yMax, yScale, xTicks) {
  let g = '';
  const yN = 4;
  const digits = (yMax - yMin) / (yN - 1) >= 1 ? 0 : 2;
  for (let i = 0; i < yN; i++) {
    const v = yMin + ((yMax - yMin) * i) / (yN - 1);
    const y = yScale(v);
    g += `<line class="fx-grid-line" x1="${PAD_L}" y1="${y.toFixed(1)}" x2="${(W - PAD_R).toFixed(1)}" y2="${y.toFixed(1)}" />`;
    g += `<text class="fx-axis-label" x="${PAD_L - 6}" y="${(y + 3).toFixed(1)}" text-anchor="end">${v.toLocaleString('ko-KR', { maximumFractionDigits: digits })}</text>`;
  }
  const yBase = PAD_T + plotH + 15;
  xTicks.forEach((t) => {
    g += `<text class="fx-axis-label" x="${t.x.toFixed(1)}" y="${yBase.toFixed(1)}" text-anchor="${t.anchor}">${t.label}</text>`;
  });
  return g;
}

/* 종가 시계열 -> 인라인 SVG 라인+영역 차트 (x/y축 포함). */
function buildChartSVG(series, color, W = 820, H = 240, xFmt = ymdFmt) {
  const { L: PAD_L, R: PAD_R, T: PAD_T, B: PAD_B } = CHART_MARGIN;
  const plotW = W - PAD_L - PAD_R, plotH = H - PAD_T - PAD_B;
  const xs = series.map((p) => p.x);
  const ys = series.map((p) => p.y);
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const yMin = Math.min(...ys), yMax = Math.max(...ys);
  const yPad = (yMax - yMin) * 0.08 || 1;
  const lo = yMin - yPad, hi = yMax + yPad;

  const xScale = (x) => PAD_L + ((x - xMin) / (xMax - xMin || 1)) * plotW;
  const yScale = (y) => PAD_T + (1 - (y - lo) / (hi - lo || 1)) * plotH;

  const line = series
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${xScale(p.x).toFixed(1)} ${yScale(p.y).toFixed(1)}`)
    .join(' ');
  const bottom = (PAD_T + plotH).toFixed(1);
  const area = `${line} L ${xScale(xMax).toFixed(1)} ${bottom} L ${xScale(xMin).toFixed(1)} ${bottom} Z`;
  const last = series[series.length - 1];

  const xN = 4;
  const xTicks = Array.from({ length: xN }, (_, i) => {
    const t = xMin + ((xMax - xMin) * i) / (xN - 1);
    return { x: xScale(t), label: xFmt(t), anchor: i === 0 ? 'start' : i === xN - 1 ? 'end' : 'middle' };
  });

  return `
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="기간 환율 추이">
      ${buildAxes(W, PAD_L, PAD_R, PAD_T, plotH, yMin, yMax, yScale, xTicks)}
      <path class="fx-chart-area" d="${area}" fill="${color}" />
      <path class="fx-chart-line" d="${line}" stroke="${color}" />
      <circle cx="${xScale(last.x).toFixed(1)}" cy="${yScale(last.y).toFixed(1)}" r="2.5" fill="${color}" />
    </svg>`;
}

function renderCurrency(cur, data) {
  const rateEl = document.getElementById(cur.rateEl);
  const changeEl = document.getElementById(cur.changeEl);
  const chartEl = document.getElementById(cur.chartEl);
  const rangeEl = document.getElementById(cur.rangeEl);
  if (!rateEl || !data) return;

  const p = PERIODS[cur.period];
  const stamp = p.intraday ? timeFmt : p.longDate ? ymdFmt : dateFmt; // 1년 초과 기간은 연도 포함
  const m = cur.multiplier;
  const u = cur.unit; // '원' 또는 '' (달러 인덱스)
  const { series, prevClose } = data;
  const cur_ = series[series.length - 1].y * m;
  const base = prevClose * m;

  /* 현재값 */
  rateEl.classList.remove('loading');
  rateEl.innerHTML = `${wonFmt(cur_)}${u ? `<span class="won">${u}</span>` : ''}`;

  /* 기간 대비 변동 (기간 시작 직전 종가 기준) */
  const diff = cur_ - base;
  const pct = base !== 0 ? (diff / base) * 100 : 0;
  const dir = diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat';
  const arrow = diff > 0 ? '▲' : diff < 0 ? '▼' : '−';
  const sign = diff > 0 ? '+' : diff < 0 ? '-' : '';
  changeEl.className = `fx-change ${dir}`;
  changeEl.textContent = `${arrow} ${sign}${wonFmt(Math.abs(diff))}${u} (${sign}${Math.abs(pct).toFixed(2)}%) · ${p.changeLabel}`;

  /* 기간 차트 (y축은 표시 단위로 환산한 값, x축은 단기=시각·장기=날짜) */
  const xFmt = p.intraday ? timeFmt : ymdFmt;
  const dispSeries = m === 1 ? series : series.map((pt) => ({ x: pt.x, y: pt.y * m }));
  chartEl.innerHTML = buildChartSVG(dispSeries, DIR_COLORS[dir], cur.chartW, cur.chartH, xFmt);

  /* 기간 최고·평균·최저 */
  const ys = series.map((pt) => pt.y * m);
  const lowIdx = ys.indexOf(Math.min(...ys));
  const highIdx = ys.indexOf(Math.max(...ys));
  const avg = ys.reduce((s, v) => s + v, 0) / ys.length;
  rangeEl.innerHTML =
    `<div class="fx-range-item">` +
      `<div class="fx-range-top">` +
        `<span class="fx-range-label">${p.rangeLabel} 최고</span>` +
        `<span class="fx-range-date">${stamp(series[highIdx].x)}</span>` +
      `</div>` +
      `<span class="fx-range-val high">${wonFmt(ys[highIdx])}${u}</span>` +
    `</div>` +
    `<div class="fx-range-item">` +
      `<div class="fx-range-top">` +
        `<span class="fx-range-label">${p.rangeLabel} 평균</span>` +
        `<span class="fx-range-date"></span>` +
      `</div>` +
      `<span class="fx-range-val">${wonFmt(avg)}${u}</span>` +
    `</div>` +
    `<div class="fx-range-item">` +
      `<div class="fx-range-top">` +
        `<span class="fx-range-label">${p.rangeLabel} 최저</span>` +
        `<span class="fx-range-date">${stamp(series[lowIdx].x)}</span>` +
      `</div>` +
      `<span class="fx-range-val low">${wonFmt(ys[lowIdx])}${u}</span>` +
    `</div>`;
}

/* 카드별 기간 로드 (통화·기간별 캐시). */
async function loadCurrency(cur) {
  const period = cur.period;
  const cacheKey = `fx_${cur.code}_${period}`;

  /* 캐시 확인 */
  try {
    const cached = JSON.parse(localStorage.getItem(cacheKey) || 'null');
    if (cached && Date.now() - cached.ts < FX_CACHE_TTL) {
      if (cur.period === period) renderCurrency(cur, cached.data);
      return;
    }
  } catch (e) {}

  let data = null;
  try {
    data = await fetchFxData(cur.symbol, period);
  } catch (e) {} // 모든 프록시 실패 → data=null 로 '조회 실패' 표시
  if (cur.period !== period) return; // 그 사이 다른 기간이 선택됨 → 최신 요청만 반영

  if (!data) {
    const rateEl = document.getElementById(cur.rateEl);
    if (rateEl && rateEl.classList.contains('loading')) rateEl.textContent = '조회 실패';
    return;
  }

  renderCurrency(cur, data);
  localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), data }));
}

/* 카드별 기간 토글 버튼 생성 + 이벤트 연결. */
function buildPeriodButtons(cur) {
  const container = document.getElementById(cur.periodsEl);
  if (!container) return;
  container.innerHTML = Object.keys(PERIODS)
    .map((k) => `<button class="card-period-btn${k === cur.period ? ' active' : ''}" data-period="${k}">${PERIODS[k].label}</button>`)
    .join('');
  container.addEventListener('click', (e) => {
    const btn = e.target.closest('.card-period-btn');
    if (!btn) return;
    const p = btn.dataset.period;
    if (p === cur.period || !PERIODS[p]) return;
    cur.period = p;
    container.querySelectorAll('.card-period-btn').forEach((b) => b.classList.toggle('active', b.dataset.period === p));
    loadCurrency(cur);
  });
}

/* ===================== 국기 탭 전환 ===================== */
function activateTab(code) {
  const cur = CURRENCIES.find((c) => c.code === code);
  if (!cur) return;
  CURRENCIES.forEach((c) => {
    document.getElementById(c.cardEl)?.classList.toggle('active', c.code === code);
  });
  document.querySelectorAll('#fxTabs .fx-tab-btn').forEach((b) =>
    b.classList.toggle('active', b.dataset.code === code));
  loadCurrency(cur); // 선택된 통화만 로드 (5분 캐시 히트 시 즉시 표시)
}

document.getElementById('fxTabs').addEventListener('click', (e) => {
  const btn = e.target.closest('.fx-tab-btn');
  if (btn) activateTab(btn.dataset.code);
});

/* ===================== 초기화 ===================== */
CURRENCIES.forEach(buildPeriodButtons);
activateTab('USD');
