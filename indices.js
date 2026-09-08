/* ===================== 주요 주가지수 + 지수별 기간 선택 (Yahoo Finance) ===================== */
/* 코스피·다우존스·나스닥·S&P 500 지수를 조회한다.
   각 지수 카드마다 기간(1일·1주·1개월·3개월·1년)을 독립적으로 선택하며, 기간을 바꾸면
   해당 지수만 다시 로드한다. 변동 기준은 기간 시작 직전 종가(chartPreviousClose).
   fx.js 와 동일한 CORS 프록시 fallback + localStorage 캐시(TTL 5분, 지수·기간별로 분리).
   M2 통화량(월간)은 한국은행 ECOS 를 자체 Worker(/ecos) 경유로 조회한다 — 인증키가
   Worker Secret 에만 있어 공개 프록시 fallback 은 불가능. */

/* CORS 프록시 — 자체 Cloudflare Worker(cloudflare-worker.js) 우선, 실패 시 공개 프록시 순차 시도 */
const IDX_PROXIES = [
  (url) => `https://retire-wisher.goliathtom11.workers.dev/?url=${encodeURIComponent(url)}`,
  (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  (url) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
];
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
  'W':  { label: '주봉',  range: '2y',  interval: '1wk', type: 'candle', changeMode: 'bar',    changeLabel: '전주 대비',   rangeLabel: '2년',   intraday: false, longDate: true },
  'M':  { label: '월봉',  range: '5y',  interval: '1mo', type: 'candle', changeMode: 'bar',    changeLabel: '전월 대비',   rangeLabel: '5년',   intraday: false, longDate: true },
};
const DEFAULT_PERIOD = '1D';

/* M2 통화량(월간) 전용 — 캔들 없음, 기간은 표시할 개월 수. */
const M2_ENDPOINT = 'https://retire-wisher.goliathtom11.workers.dev/ecos';
const M2_CACHE_TTL = 60 * 60 * 1000; // 월간 데이터 — 1시간 캐시
const M2_PERIODS = {
  '1Y':  { label: '1년',  months: 12 },
  '3Y':  { label: '3년',  months: 36 },
  '5Y':  { label: '5년',  months: 60 },
  '10Y': { label: '10년', months: 120 },
};
/* 상승하락 방향별 선 그래프 색상: 상승=빨강 · 하락=파랑 · 보합=회색 (.fx-change 색과 통일) */
const DIR_COLORS = { up: '#f87171', down: '#6c8cff', flat: '#94a3b8' };
const CANDLE_UP = '#f87171';   // 양봉(상승) = 빨강
const CANDLE_DOWN = '#6c8cff'; // 음봉(하락) = 파랑

/* 지수 정의: color 는 차트 색상, period 는 카드별 현재 선택 기간(기본 3개월). */
const ASSETS = [
  { code: 'KOSPI', symbol: '^KS11', color: '#f87171', period: DEFAULT_PERIOD, cardEl: 'cardKOSPI',
    rateEl: 'rateKOSPI', changeEl: 'changeKOSPI', chartEl: 'chartKOSPI', rangeEl: 'rangeKOSPI', periodsEl: 'periodsKOSPI',
    chartW: 820, chartH: 240 },
  { code: 'KOSDAQ', symbol: '^KQ11', color: '#fb923c', period: DEFAULT_PERIOD, cardEl: 'cardKOSDAQ',
    rateEl: 'rateKOSDAQ', changeEl: 'changeKOSDAQ', chartEl: 'chartKOSDAQ', rangeEl: 'rangeKOSDAQ', periodsEl: 'periodsKOSDAQ',
    chartW: 820, chartH: 240 },
  { code: 'DJI',  symbol: '^DJI',  color: '#6c8cff', period: DEFAULT_PERIOD, cardEl: 'cardDJI',
    rateEl: 'rateDJI',  changeEl: 'changeDJI',  chartEl: 'chartDJI',  rangeEl: 'rangeDJI', periodsEl: 'periodsDJI',
    chartW: 820, chartH: 240 },
  { code: 'IXIC', symbol: '^IXIC', color: '#a78bfa', period: DEFAULT_PERIOD, cardEl: 'cardIXIC',
    rateEl: 'rateIXIC', changeEl: 'changeIXIC', chartEl: 'chartIXIC', rangeEl: 'rangeIXIC', periodsEl: 'periodsIXIC',
    chartW: 820, chartH: 240 },
  { code: 'GSPC', symbol: '^GSPC', color: '#34d399', period: DEFAULT_PERIOD, cardEl: 'cardGSPC',
    rateEl: 'rateGSPC', changeEl: 'changeGSPC', chartEl: 'chartGSPC', rangeEl: 'rangeGSPC', periodsEl: 'periodsGSPC',
    chartW: 820, chartH: 240 },
  { code: 'GOLD', symbol: 'GC=F', color: '#fbbf24', period: DEFAULT_PERIOD, cardEl: 'cardGOLD',
    rateEl: 'rateGOLD', changeEl: 'changeGOLD', chartEl: 'chartGOLD', rangeEl: 'rangeGOLD', periodsEl: 'periodsGOLD',
    chartW: 820, chartH: 240 },
  { code: 'WTI',  symbol: 'CL=F', color: '#f59e0b', period: DEFAULT_PERIOD, cardEl: 'cardWTI',
    rateEl: 'rateWTI', changeEl: 'changeWTI', chartEl: 'chartWTI', rangeEl: 'rangeWTI', periodsEl: 'periodsWTI',
    chartW: 820, chartH: 240 },
  { code: 'BRENT', symbol: 'BZ=F', color: '#38bdf8', period: DEFAULT_PERIOD, cardEl: 'cardBRENT',
    rateEl: 'rateBRENT', changeEl: 'changeBRENT', chartEl: 'chartBRENT', rangeEl: 'rangeBRENT', periodsEl: 'periodsBRENT',
    chartW: 820, chartH: 240 },
  { code: 'BTCUSD', symbol: 'BTC-USD', color: '#f7931a', period: DEFAULT_PERIOD, cardEl: 'cardBTCUSD',
    rateEl: 'rateBTCUSD', changeEl: 'changeBTCUSD', chartEl: 'chartBTCUSD', rangeEl: 'rangeBTCUSD', periodsEl: 'periodsBTCUSD',
    chartW: 820, chartH: 240 },
  { code: 'BTCKRW', symbol: 'BTC-KRW', color: '#f7931a', period: DEFAULT_PERIOD, cardEl: 'cardBTCKRW', decimals: 0,
    rateEl: 'rateBTCKRW', changeEl: 'changeBTCKRW', chartEl: 'chartBTCKRW', rangeEl: 'rangeBTCKRW', periodsEl: 'periodsBTCKRW',
    chartW: 820, chartH: 240 },
  { code: 'M2', type: 'ecos', period: '1Y', periods: M2_PERIODS, cacheTtl: M2_CACHE_TTL, cardEl: 'cardM2',
    rateEl: 'rateM2', changeEl: 'changeM2', chartEl: 'chartM2', rangeEl: 'rangeM2', periodsEl: 'periodsM2',
    chartW: 820, chartH: 240 },
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

/* 직접 호출(CORS 로 대부분 실패) 후 프록시 목록을 순차 시도. */
async function idxFetchJson(url) {
  try { return await idxTryFetch(url); } catch (e) {}
  let lastErr;
  for (const proxy of IDX_PROXIES) {
    try { return await idxTryFetch(proxy(url)); } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('all proxies failed');
}

async function fetchIdxData(symbol, period) {
  const p = PERIODS[period];
  const json = await idxFetchJson(IDX_CHART_URL(symbol, p.range, p.interval));
  return dataFromChart(json, p.interval);
}

/* ECOS M2(십억원, 월간) -> { series(조원), prev(전월값), yoyBase(전년동월값) }. 실패 시 null.
   전년동월 대비 계산을 위해 표시 개월 수보다 14개월 앞서 조회한 뒤 표시분만 자른다
   (통계 발표가 2~3개월 늦는 것까지 감안). */
async function fetchM2Data(periodKey) {
  const months = M2_PERIODS[periodKey].months;
  const yyyymm = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
  const now = new Date();
  const start = yyyymm(new Date(now.getFullYear(), now.getMonth() - (months + 14), 1));
  const end = yyyymm(now);

  const json = await idxTryFetch(`${M2_ENDPOINT}?start=${start}&end=${end}`);
  const rows = json?.StatisticSearch?.row;
  if (!Array.isArray(rows)) return null;

  const all = [];
  for (const r of rows) {
    const t = String(r.TIME || '');
    const v = parseFloat(r.DATA_VALUE);
    if (/^\d{6}$/.test(t) && isFinite(v) && v > 0) {
      all.push({ x: Date.UTC(+t.slice(0, 4), +t.slice(4) - 1, 1), y: v / 1000 }); // 십억원 -> 조원
    }
  }
  if (all.length < 2) return null;
  all.sort((a, b) => a.x - b.x);

  const series = all.slice(-months);
  const last = new Date(series[series.length - 1].x);
  const yoyX = Date.UTC(last.getUTCFullYear() - 1, last.getUTCMonth(), 1);
  const yoyBase = all.find((p) => p.x === yoyX)?.y ?? null;
  const prev = series.length >= 2 ? series[series.length - 2].y : null;
  return { series, prev, yoyBase };
}

const numFmt = (n, d = 2) => n.toLocaleString('ko-KR', { minimumFractionDigits: d, maximumFractionDigits: d });
const dateFmt = (ms) => new Date(ms).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
const timeFmt = (ms) => new Date(ms).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
const ymdFmt = (ms) => { const d = new Date(ms); return `${String(d.getFullYear()).slice(2)}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const ymFmt = (ms) => { const d = new Date(ms); return `${String(d.getUTCFullYear()).slice(2)}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; };
const axisValFmt = (v) => v.toLocaleString('ko-KR', { maximumFractionDigits: 0 });

/* 차트 축(y축 값 그리드 + x축 라벨) SVG. xTicks: [{x, label, anchor}...] */
function buildAxes(W, PAD_L, PAD_R, PAD_T, plotH, yMin, yMax, yScale, xTicks) {
  let g = '';
  const yN = 4;
  for (let i = 0; i < yN; i++) {
    const v = yMin + ((yMax - yMin) * i) / (yN - 1);
    const y = yScale(v);
    g += `<line class="fx-grid-line" x1="${PAD_L}" y1="${y.toFixed(1)}" x2="${(W - PAD_R).toFixed(1)}" y2="${y.toFixed(1)}" />`;
    g += `<text class="fx-axis-label" x="${PAD_L - 6}" y="${(y + 3).toFixed(1)}" text-anchor="end">${axisValFmt(v)}</text>`;
  }
  const yBase = PAD_T + plotH + 15;
  xTicks.forEach((t) => {
    g += `<text class="fx-axis-label" x="${t.x.toFixed(1)}" y="${yBase.toFixed(1)}" text-anchor="${t.anchor}">${t.label}</text>`;
  });
  return g;
}

/* 종가 시계열 -> 인라인 SVG 라인+영역 차트. */
const CHART_MARGIN = { L: 46, R: 10, T: 10, B: 22 };

function buildChartSVG(series, color, W = 260, H = 90, xFmt = ymdFmt) {
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
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="기간 지수 추이">
      ${buildAxes(W, PAD_L, PAD_R, PAD_T, plotH, yMin, yMax, yScale, xTicks)}
      <path class="fx-chart-area" d="${area}" fill="${color}" />
      <path class="fx-chart-line" d="${line}" stroke="${color}" />
      <circle cx="${xScale(last.x).toFixed(1)}" cy="${yScale(last.y).toFixed(1)}" r="2.5" fill="${color}" />
    </svg>`;
}

/* OHLC 시계열 -> 인라인 SVG 캔들 차트 (양봉=빨강, 음봉=파랑). */
function buildCandleSVG(series, W = 260, H = 90, xFmt = ymdFmt) {
  const { L: PAD_L, R: PAD_R, T: PAD_T, B: PAD_B } = CHART_MARGIN;
  const plotW = W - PAD_L - PAD_R, plotH = H - PAD_T - PAD_B;
  const n = series.length;
  const yMin = Math.min(...series.map((b) => b.l));
  const yMax = Math.max(...series.map((b) => b.h));
  const yPad = (yMax - yMin) * 0.08 || 1;
  const lo = yMin - yPad, hi = yMax + yPad;
  const yScale = (y) => PAD_T + (1 - (y - lo) / (hi - lo || 1)) * plotH;
  const slot = plotW / n;
  const bodyW = Math.max(1, slot * 0.62);
  const cx = (i) => PAD_L + slot * (i + 0.5);

  const bars = series.map((b, i) => {
    const x = cx(i);
    const color = b.c >= b.o ? CANDLE_UP : CANDLE_DOWN;
    const yHigh = yScale(b.h), yLow = yScale(b.l);
    const top = Math.min(yScale(b.o), yScale(b.c));
    const bodyH = Math.max(1, Math.abs(yScale(b.o) - yScale(b.c)));
    return (
      `<line x1="${x.toFixed(1)}" y1="${yHigh.toFixed(1)}" x2="${x.toFixed(1)}" y2="${yLow.toFixed(1)}" stroke="${color}" stroke-width="1" vector-effect="non-scaling-stroke" />` +
      `<rect x="${(x - bodyW / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${bodyW.toFixed(1)}" height="${bodyH.toFixed(1)}" fill="${color}" />`
    );
  }).join('');

  const xN = Math.min(4, n);
  const xTicks = Array.from({ length: xN }, (_, i) => {
    const idx = Math.round(((n - 1) * i) / (xN - 1 || 1));
    return { x: cx(idx), label: xFmt(series[idx].x), anchor: i === 0 ? 'start' : i === xN - 1 ? 'end' : 'middle' };
  });

  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="캔들 차트">${buildAxes(W, PAD_L, PAD_R, PAD_T, plotH, yMin, yMax, yScale, xTicks)}${bars}</svg>`;
}

function renderAsset(asset, data) {
  const rateEl = document.getElementById(asset.rateEl);
  const changeEl = document.getElementById(asset.changeEl);
  const chartEl = document.getElementById(asset.chartEl);
  const rangeEl = document.getElementById(asset.rangeEl);
  if (!rateEl || !data) return;

  const p = PERIODS[asset.period];
  const isCandle = p.type === 'candle';
  const stamp = p.intraday ? timeFmt : p.longDate ? ymdFmt : dateFmt; // 1년 초과 기간은 연도 포함
  const { series, prevClose } = data;
  const cur = series[series.length - 1].c;

  /* 현재값 (자산별 소수 자릿수 — 원화 환산 등 큰 값은 0자리) */
  const dec = asset.decimals ?? 2;
  rateEl.classList.remove('loading');
  rateEl.textContent = numFmt(cur, dec);

  /* 변동: 캔들(전일/전주/전월)은 직전 봉 종가 대비, 선 그래프는 기간 시작 직전 종가 대비 */
  const baseline = p.changeMode === 'bar' ? series[series.length - 2].c : prevClose;
  const diff = cur - baseline;
  const pct = baseline !== 0 ? (diff / baseline) * 100 : 0;
  const dir = diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat';
  const arrow = diff > 0 ? '▲' : diff < 0 ? '▼' : '−';
  const sign = diff > 0 ? '+' : diff < 0 ? '-' : '';
  changeEl.className = `fx-change ${dir}`;
  changeEl.textContent = `${arrow} ${sign}${numFmt(Math.abs(diff), dec)} (${sign}${Math.abs(pct).toFixed(2)}%) · ${p.changeLabel}`;

  /* 차트 (캔들 / 선) */
  const xFmt = p.intraday ? timeFmt : ymdFmt;
  chartEl.innerHTML = isCandle
    ? buildCandleSVG(series, asset.chartW, asset.chartH, xFmt)
    : buildChartSVG(series, DIR_COLORS[dir], asset.chartW, asset.chartH, xFmt);

  /* 기간 최고·평균·최저 (캔들은 봉의 고가/저가, 선은 종가 기준 — 평균은 항상 종가 평균) */
  const highVals = series.map((b) => (isCandle ? b.h : b.c));
  const lowVals = series.map((b) => (isCandle ? b.l : b.c));
  const highIdx = highVals.indexOf(Math.max(...highVals));
  const lowIdx = lowVals.indexOf(Math.min(...lowVals));
  const avg = series.reduce((s, b) => s + b.c, 0) / series.length;
  const rl = p.rangeLabel || p.label;
  rangeEl.innerHTML =
    `<div class="fx-range-item">` +
      `<div class="fx-range-top">` +
        `<span class="fx-range-label">${rl} 최고</span>` +
        `<span class="fx-range-date">${stamp(series[highIdx].x)}</span>` +
      `</div>` +
      `<span class="fx-range-val high">${numFmt(highVals[highIdx], dec)}</span>` +
    `</div>` +
    `<div class="fx-range-item">` +
      `<div class="fx-range-top">` +
        `<span class="fx-range-label">${rl} 평균</span>` +
        `<span class="fx-range-date"></span>` +
      `</div>` +
      `<span class="fx-range-val">${numFmt(avg, dec)}</span>` +
    `</div>` +
    `<div class="fx-range-item">` +
      `<div class="fx-range-top">` +
        `<span class="fx-range-label">${rl} 최저</span>` +
        `<span class="fx-range-date">${stamp(series[lowIdx].x)}</span>` +
      `</div>` +
      `<span class="fx-range-val low">${numFmt(lowVals[lowIdx], dec)}</span>` +
    `</div>`;
}

/* M2 통화량 렌더 — 현재 잔액(조원) + 전월/전년동월 대비 + 라인 차트 + 기간 최고·최저. */
function renderM2(asset, data) {
  const rateEl = document.getElementById(asset.rateEl);
  const changeEl = document.getElementById(asset.changeEl);
  const chartEl = document.getElementById(asset.chartEl);
  const rangeEl = document.getElementById(asset.rangeEl);
  if (!rateEl || !data) return;

  const { series, prev, yoyBase } = data;
  const cur = series[series.length - 1].y;
  rateEl.classList.remove('loading');
  rateEl.textContent = `${numFmt(cur, 0)}조원`;

  /* 전월 대비 (방향·색 기준) + 전년동월 대비 증가율 */
  const diff = prev != null ? cur - prev : 0;
  const pct = prev ? (diff / prev) * 100 : 0;
  const dir = diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat';
  const arrow = diff > 0 ? '▲' : diff < 0 ? '▼' : '−';
  const sign = diff > 0 ? '+' : diff < 0 ? '-' : '';
  let yoyTxt = '';
  if (yoyBase) {
    const yoy = ((cur - yoyBase) / yoyBase) * 100;
    yoyTxt = ` · 전년동월 대비 ${yoy >= 0 ? '+' : '-'}${Math.abs(yoy).toFixed(1)}%`;
  }
  changeEl.className = `fx-change ${dir}`;
  changeEl.textContent = `${arrow} ${sign}${numFmt(Math.abs(diff), 1)}조원 (${sign}${Math.abs(pct).toFixed(2)}%) · 전월 대비${yoyTxt}`;

  chartEl.innerHTML = buildChartSVG(series, DIR_COLORS[dir], asset.chartW, asset.chartH, ymFmt);

  const ys = series.map((p) => p.y);
  const highIdx = ys.indexOf(Math.max(...ys));
  const lowIdx = ys.indexOf(Math.min(...ys));
  const avg = ys.reduce((s, v) => s + v, 0) / ys.length;
  const rl = M2_PERIODS[asset.period].label;
  rangeEl.innerHTML =
    `<div class="fx-range-item">` +
      `<div class="fx-range-top">` +
        `<span class="fx-range-label">${rl} 최고</span>` +
        `<span class="fx-range-date">${ymFmt(series[highIdx].x)}</span>` +
      `</div>` +
      `<span class="fx-range-val high">${numFmt(ys[highIdx], 0)}조원</span>` +
    `</div>` +
    `<div class="fx-range-item">` +
      `<div class="fx-range-top">` +
        `<span class="fx-range-label">${rl} 평균</span>` +
        `<span class="fx-range-date"></span>` +
      `</div>` +
      `<span class="fx-range-val">${numFmt(avg, 0)}조원</span>` +
    `</div>` +
    `<div class="fx-range-item">` +
      `<div class="fx-range-top">` +
        `<span class="fx-range-label">${rl} 최저</span>` +
        `<span class="fx-range-date">${ymFmt(series[lowIdx].x)}</span>` +
      `</div>` +
      `<span class="fx-range-val low">${numFmt(ys[lowIdx], 0)}조원</span>` +
    `</div>`;
}

/* 카드별 기간 로드 (지수·기간별 캐시). */
async function loadAsset(asset) {
  const period = asset.period;
  const cacheKey = `idx_${asset.code}_${period}`;
  const ttl = asset.cacheTtl || IDX_CACHE_TTL;
  const render = asset.type === 'ecos' ? renderM2 : renderAsset;

  /* 캐시 확인 */
  try {
    const cached = JSON.parse(localStorage.getItem(cacheKey) || 'null');
    if (cached && Date.now() - cached.ts < ttl) {
      if (asset.period === period) render(asset, cached.data);
      return;
    }
  } catch (e) {}

  let data = null;
  try {
    data = asset.type === 'ecos' ? await fetchM2Data(period) : await fetchIdxData(asset.symbol, period);
  } catch (e) {} // 모든 프록시 실패 → data=null 로 '조회 실패' 표시
  if (asset.period !== period) return; // 그 사이 다른 기간이 선택됨 → 최신 요청만 반영

  if (!data) {
    const rateEl = document.getElementById(asset.rateEl);
    if (rateEl && rateEl.classList.contains('loading')) rateEl.textContent = '조회 실패';
    return;
  }

  render(asset, data);
  localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), data }));
}

/* 카드별 기간 토글 버튼 생성 + 이벤트 연결 (M2 는 자산별 기간 맵 사용). */
function buildPeriodButtons(asset) {
  const container = document.getElementById(asset.periodsEl);
  if (!container) return;
  const periods = asset.periods || PERIODS;
  container.innerHTML = Object.keys(periods)
    .map((k) => `<button class="card-period-btn${k === asset.period ? ' active' : ''}" data-period="${k}">${periods[k].label}</button>`)
    .join('');
  container.addEventListener('click', (e) => {
    const btn = e.target.closest('.card-period-btn');
    if (!btn) return;
    const p = btn.dataset.period;
    if (p === asset.period || !periods[p]) return;
    asset.period = p;
    container.querySelectorAll('.card-period-btn').forEach((b) => b.classList.toggle('active', b.dataset.period === p));
    loadAsset(asset);
  });
}

/* ===================== 섹션별 탭 전환 (미국 지수 · 원자재) ===================== */
const TAB_GROUPS = [
  { tabsId: 'krTabs',     codes: ['KOSPI', 'KOSDAQ'],       initial: 'KOSPI' },
  { tabsId: 'usTabs',     codes: ['DJI', 'IXIC', 'GSPC'],   initial: 'DJI' },
  { tabsId: 'cmdTabs',    codes: ['GOLD', 'WTI', 'BRENT'],  initial: 'GOLD' },
  { tabsId: 'cryptoTabs', codes: ['BTCUSD', 'BTCKRW'],      initial: 'BTCUSD' },
];

function activateTabIn(group, code) {
  const asset = ASSETS.find((a) => a.code === code);
  if (!asset) return;
  group.codes.forEach((c) => {
    document.getElementById(`card${c}`)?.classList.toggle('active', c === code);
  });
  document.querySelectorAll(`#${group.tabsId} .fx-tab-btn`).forEach((b) =>
    b.classList.toggle('active', b.dataset.code === code));
  loadAsset(asset); // 선택된 지표만 로드 (5분 캐시 히트 시 즉시 표시)
}

TAB_GROUPS.forEach((group) => {
  document.getElementById(group.tabsId).addEventListener('click', (e) => {
    const btn = e.target.closest('.fx-tab-btn');
    if (btn) activateTabIn(group, btn.dataset.code);
  });
});

/* ===================== 초기화 ===================== */
ASSETS.forEach(buildPeriodButtons);
TAB_GROUPS.forEach((g) => activateTabIn(g, g.initial));
loadAsset(ASSETS.find((a) => a.code === 'M2')); // 통화량 섹션 (탭 없는 단독 카드)
