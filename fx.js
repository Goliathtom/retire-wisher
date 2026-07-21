/* ===================== 실시간 환율 + 3개월 추이 (Yahoo Finance) ===================== */
/* Yahoo Finance chart 엔드포인트에서 원/달러·원/유로·원/엔 시세를 조회한다.
   range=3mo 응답 하나로 현재값·전일 대비 변동·3개월 일별 종가 시계열을 모두 얻는다.
   etf.js / fear-greed.js 와 동일한 CORS 프록시 fallback + localStorage 캐시 패턴(TTL 5분). */

const FX_PROXY_URL = (url) => `https://corsproxy.io/?url=${encodeURIComponent(url)}`;
const FX_CACHE_KEY = 'fx_rates_cache_v3';
const FX_CACHE_TTL = 5 * 60 * 1000; // 5분
const FX_CHART_URL = (sym) =>
  `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=3mo&interval=1d`;

/* 지표 정의: multiplier 는 표시 단위(엔은 100엔 기준), unit 은 값 뒤 단위(달러 인덱스는 없음),
   color 는 차트 색상. 달러 인덱스(DXY)는 넓은 카드용으로 차트 크기(chartW/chartH)를 별도 지정. */
const CURRENCIES = [
  { code: 'USD', symbol: 'KRW=X',    multiplier: 1,   unit: '원', color: '#6c8cff',
    rateEl: 'rateUSD', changeEl: 'changeUSD', chartEl: 'chartUSD', rangeEl: 'rangeUSD' },
  { code: 'EUR', symbol: 'EURKRW=X', multiplier: 1,   unit: '원', color: '#a78bfa',
    rateEl: 'rateEUR', changeEl: 'changeEUR', chartEl: 'chartEUR', rangeEl: 'rangeEUR' },
  { code: 'JPY', symbol: 'JPYKRW=X', multiplier: 100, unit: '원', color: '#34d399',
    rateEl: 'rateJPY', changeEl: 'changeJPY', chartEl: 'chartJPY', rangeEl: 'rangeJPY' },
  { code: 'DXY', symbol: 'DX-Y.NYB', multiplier: 1,   unit: '',   color: '#fbbf24',
    rateEl: 'rateDXY', changeEl: 'changeDXY', chartEl: 'chartDXY', rangeEl: 'rangeDXY',
    chartW: 820, chartH: 130 },
];

async function fxTryFetch(url) {
  const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

/* Yahoo chart 응답 -> { series: [{x,y}...] } (종가 시계열). 실패 시 null. */
function seriesFromChart(json) {
  const result = json?.chart?.result?.[0];
  const ts = result?.timestamp;
  const closes = result?.indicators?.quote?.[0]?.close;
  if (!Array.isArray(ts) || !Array.isArray(closes)) return null;

  const series = [];
  for (let i = 0; i < ts.length; i++) {
    const c = closes[i];
    if (typeof c === 'number' && c > 0) series.push({ x: ts[i] * 1000, y: c });
  }
  return series.length >= 2 ? series : null;
}

async function fetchFxSeries(symbol) {
  const url = FX_CHART_URL(symbol);
  let json;
  try {
    json = await fxTryFetch(url);
  } catch (e1) {
    json = await fxTryFetch(FX_PROXY_URL(url)); // CORS 프록시 fallback
  }
  return seriesFromChart(json);
}

const wonFmt = (n) => n.toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateFmt = (ms) => new Date(ms).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });

/* 3개월 종가 시계열 -> 인라인 SVG 라인+영역 차트. */
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
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="최근 3개월 환율 추이">
      <path class="fx-chart-area" d="${area}" fill="${color}" />
      <path class="fx-chart-line" d="${line}" stroke="${color}" />
      <circle cx="${xScale(last.x).toFixed(1)}" cy="${yScale(last.y).toFixed(1)}" r="2.5" fill="${color}" />
    </svg>`;
}

function renderCurrency(cur, series) {
  const rateEl = document.getElementById(cur.rateEl);
  const changeEl = document.getElementById(cur.changeEl);
  const chartEl = document.getElementById(cur.chartEl);
  const rangeEl = document.getElementById(cur.rangeEl);
  if (!rateEl || !series || series.length < 2) return;

  const m = cur.multiplier;
  const u = cur.unit; // '원' 또는 '' (달러 인덱스)
  const cur_ = series[series.length - 1].y * m;
  const prev = series[series.length - 2].y * m;

  /* 현재값 */
  rateEl.classList.remove('loading');
  rateEl.innerHTML = `${wonFmt(cur_)}${u ? `<span class="won">${u}</span>` : ''}`;

  /* 전일 대비 변동 */
  const diff = cur_ - prev;
  const pct = prev !== 0 ? (diff / prev) * 100 : 0;
  const dir = diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat';
  const arrow = diff > 0 ? '▲' : diff < 0 ? '▼' : '−';
  const sign = diff > 0 ? '+' : diff < 0 ? '-' : '';
  changeEl.className = `fx-change ${dir}`;
  changeEl.textContent = `${arrow} ${sign}${wonFmt(Math.abs(diff))}${u} (${sign}${Math.abs(pct).toFixed(2)}%) · 전일 대비`;

  /* 3개월 차트 */
  chartEl.innerHTML = buildChartSVG(series, cur.color, cur.chartW, cur.chartH);

  /* 3개월 최저·최고 */
  const ys = series.map((p) => p.y * m);
  const lowIdx = ys.indexOf(Math.min(...ys));
  const highIdx = ys.indexOf(Math.max(...ys));
  rangeEl.innerHTML =
    `<div class="fx-range-item">` +
      `<div class="fx-range-top">` +
        `<span class="fx-range-label">3개월 최고</span>` +
        `<span class="fx-range-date">${dateFmt(series[highIdx].x)}</span>` +
      `</div>` +
      `<span class="fx-range-val high">${wonFmt(ys[highIdx])}${u}</span>` +
    `</div>` +
    `<div class="fx-range-item">` +
      `<div class="fx-range-top">` +
        `<span class="fx-range-label">3개월 최저</span>` +
        `<span class="fx-range-date">${dateFmt(series[lowIdx].x)}</span>` +
      `</div>` +
      `<span class="fx-range-val low">${wonFmt(ys[lowIdx])}${u}</span>` +
    `</div>`;
}

function setFxStatus(msg) {
  const el = document.getElementById('fxStatus');
  if (el) el.textContent = msg;
}

async function loadFxRates() {
  /* 캐시 확인 */
  try {
    const cached = JSON.parse(localStorage.getItem(FX_CACHE_KEY) || 'null');
    if (cached && Date.now() - cached.ts < FX_CACHE_TTL) {
      CURRENCIES.forEach((cur) => renderCurrency(cur, cached.series[cur.code]));
      const t = new Date(cached.ts).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
      setFxStatus(`💾 캐시 사용 중 (${t} 기준, 5분 유효)`);
      return;
    }
  } catch (e) {}

  setFxStatus('⏳ 실시간 환율(Yahoo Finance) 불러오는 중…');
  const seriesByCode = {};
  await Promise.allSettled(
    CURRENCIES.map(async (cur) => {
      const series = await fetchFxSeries(cur.symbol);
      if (series) {
        seriesByCode[cur.code] = series;
        renderCurrency(cur, series);
      }
    })
  );

  const ok = Object.keys(seriesByCode).length;
  if (ok === 0) {
    setFxStatus('⚠️ 실시간 환율을 가져오지 못했습니다. 잠시 후 다시 시도해 주세요.');
    return;
  }

  localStorage.setItem(FX_CACHE_KEY, JSON.stringify({ ts: Date.now(), series: seriesByCode }));
  const failed = CURRENCIES.filter((c) => !(c.code in seriesByCode)).map((c) => c.code);
  const suffix = failed.length ? ` (일부 실패: ${failed.join(', ')})` : '';
  const t = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  setFxStatus(`✅ 실시간 환율 적용 완료 (Yahoo Finance, ${t} 기준)${suffix}`);
}

/* ===================== 초기화 ===================== */
loadFxRates();
