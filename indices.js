/* ===================== 주요 주가지수 + 3개월 추이 (Yahoo Finance) ===================== */
/* 코스피·다우존스·나스닥·S&P 500 지수를 조회한다.
   range=3mo 응답 하나로 현재값·전일 대비 변동·3개월 일별 종가 시계열을 모두 얻는다.
   fx.js 와 동일한 CORS 프록시 fallback + localStorage 캐시 패턴(TTL 5분). */

const IDX_PROXY_URL = (url) => `https://corsproxy.io/?url=${encodeURIComponent(url)}`;
const IDX_CACHE_KEY = 'indices_cache_v1';
const IDX_CACHE_TTL = 5 * 60 * 1000; // 5분
const IDX_CHART_URL = (sym) =>
  `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=3mo&interval=1d`;

/* 지수 정의: color 는 차트 색상. 코스피는 넓은 카드용으로 차트 크기(chartW/chartH)를 별도 지정. */
const ASSETS = [
  { code: 'KOSPI', symbol: '^KS11', color: '#f87171',
    rateEl: 'rateKOSPI', changeEl: 'changeKOSPI', chartEl: 'chartKOSPI', rangeEl: 'rangeKOSPI',
    chartW: 820, chartH: 130 },
  { code: 'DJI',  symbol: '^DJI',  color: '#6c8cff',
    rateEl: 'rateDJI',  changeEl: 'changeDJI',  chartEl: 'chartDJI',  rangeEl: 'rangeDJI',
    chartW: 820, chartH: 130 },
  { code: 'IXIC', symbol: '^IXIC', color: '#a78bfa',
    rateEl: 'rateIXIC', changeEl: 'changeIXIC', chartEl: 'chartIXIC', rangeEl: 'rangeIXIC',
    chartW: 820, chartH: 130 },
  { code: 'GSPC', symbol: '^GSPC', color: '#34d399',
    rateEl: 'rateGSPC', changeEl: 'changeGSPC', chartEl: 'chartGSPC', rangeEl: 'rangeGSPC',
    chartW: 820, chartH: 130 },
];

async function idxTryFetch(url) {
  const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

/* Yahoo chart 응답 -> [{x,y}...] (종가 시계열). 실패 시 null. */
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

async function fetchIdxSeries(symbol) {
  const url = IDX_CHART_URL(symbol);
  let json;
  try {
    json = await idxTryFetch(url);
  } catch (e1) {
    json = await idxTryFetch(IDX_PROXY_URL(url)); // CORS 프록시 fallback
  }
  return seriesFromChart(json);
}

const numFmt = (n) => n.toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="최근 3개월 지수 추이">
      <path class="fx-chart-area" d="${area}" fill="${color}" />
      <path class="fx-chart-line" d="${line}" stroke="${color}" />
      <circle cx="${xScale(last.x).toFixed(1)}" cy="${yScale(last.y).toFixed(1)}" r="2.5" fill="${color}" />
    </svg>`;
}

function renderAsset(asset, series) {
  const rateEl = document.getElementById(asset.rateEl);
  const changeEl = document.getElementById(asset.changeEl);
  const chartEl = document.getElementById(asset.chartEl);
  const rangeEl = document.getElementById(asset.rangeEl);
  if (!rateEl || !series || series.length < 2) return;

  const cur = series[series.length - 1].y;
  const prev = series[series.length - 2].y;

  /* 현재값 */
  rateEl.classList.remove('loading');
  rateEl.textContent = numFmt(cur);

  /* 전일 대비 변동 */
  const diff = cur - prev;
  const pct = prev !== 0 ? (diff / prev) * 100 : 0;
  const dir = diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat';
  const arrow = diff > 0 ? '▲' : diff < 0 ? '▼' : '−';
  const sign = diff > 0 ? '+' : diff < 0 ? '-' : '';
  changeEl.className = `fx-change ${dir}`;
  changeEl.textContent = `${arrow} ${sign}${numFmt(Math.abs(diff))} (${sign}${Math.abs(pct).toFixed(2)}%) · 전일 대비`;

  /* 3개월 차트 */
  chartEl.innerHTML = buildChartSVG(series, asset.color, asset.chartW, asset.chartH);

  /* 3개월 최저·최고 */
  const ys = series.map((p) => p.y);
  const lowIdx = ys.indexOf(Math.min(...ys));
  const highIdx = ys.indexOf(Math.max(...ys));
  rangeEl.innerHTML =
    `<div class="fx-range-item">` +
      `<div class="fx-range-top">` +
        `<span class="fx-range-label">3개월 최고</span>` +
        `<span class="fx-range-date">${dateFmt(series[highIdx].x)}</span>` +
      `</div>` +
      `<span class="fx-range-val high">${numFmt(ys[highIdx])}</span>` +
    `</div>` +
    `<div class="fx-range-item">` +
      `<div class="fx-range-top">` +
        `<span class="fx-range-label">3개월 최저</span>` +
        `<span class="fx-range-date">${dateFmt(series[lowIdx].x)}</span>` +
      `</div>` +
      `<span class="fx-range-val low">${numFmt(ys[lowIdx])}</span>` +
    `</div>`;
}

function setIdxStatus(msg) {
  const el = document.getElementById('idxStatus');
  if (el) el.textContent = msg;
}

async function loadIndices() {
  /* 캐시 확인 */
  try {
    const cached = JSON.parse(localStorage.getItem(IDX_CACHE_KEY) || 'null');
    if (cached && Date.now() - cached.ts < IDX_CACHE_TTL) {
      ASSETS.forEach((asset) => renderAsset(asset, cached.series[asset.code]));
      const t = new Date(cached.ts).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
      setIdxStatus(`💾 캐시 사용 중 (${t} 기준, 5분 유효)`);
      return;
    }
  } catch (e) {}

  setIdxStatus('⏳ 주요 지수(Yahoo Finance) 불러오는 중…');
  const seriesByCode = {};
  await Promise.allSettled(
    ASSETS.map(async (asset) => {
      const series = await fetchIdxSeries(asset.symbol);
      if (series) {
        seriesByCode[asset.code] = series;
        renderAsset(asset, series);
      }
    })
  );

  const ok = Object.keys(seriesByCode).length;
  if (ok === 0) {
    setIdxStatus('⚠️ 지수를 가져오지 못했습니다. 잠시 후 다시 시도해 주세요.');
    return;
  }

  localStorage.setItem(IDX_CACHE_KEY, JSON.stringify({ ts: Date.now(), series: seriesByCode }));
  const failed = ASSETS.filter((a) => !(a.code in seriesByCode)).map((a) => a.code);
  const suffix = failed.length ? ` (일부 실패: ${failed.join(', ')})` : '';
  const t = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  setIdxStatus(`✅ 주요 지수 적용 완료 (Yahoo Finance, ${t} 기준)${suffix}`);
}

/* ===================== 초기화 ===================== */
loadIndices();
