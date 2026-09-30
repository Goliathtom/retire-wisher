/* ===================== 환율 + 통화별 기간 선택 (한국은행 ECOS) ===================== */
/* 한국은행 ECOS '주요국 통화의 대원화환율'(731Y001, 일별 매매기준율)을 자체 Cloudflare
   Worker(/ecos, series 화이트리스트) 경유로 조회한다. 원/달러·원/유로·원/엔(100엔)·원/위안.
   각 통화 카드마다 기간(1일·1주·1개월·3개월·1년·3년·5년)을 독립적으로 선택하며, 변동 기준은
   기간 시작 시점(또는 그 이전 마지막 영업일) 값. 1일은 최근 영업일 마감값의 전일(전 영업일) 대비. 인증키가 Worker Secret 에만 있어 공개 프록시
   fallback 은 없다. 일별 데이터라 localStorage 1시간 캐시(통화·기간별). */

const FX_ENDPOINT = 'https://retire-wisher.goliathtom11.workers.dev/ecos';
const FX_CACHE_TTL = 60 * 60 * 1000; // 일별 고시 — 1시간 캐시
const FX_STAT = '731Y001';           // 주요국 통화의 대원화환율
const FX_FETCH_BUFFER_DAYS = 14;     // 연휴를 감안해 기간 시작 전 값을 찾도록 여유 조회

/* 선택 가능한 기간. days/months 는 표시 기간, lastN 은 최근 N개 영업일(1일 = 최근 영업일 마감값과
   그 전 영업일 비교), changeLabel 은 변동 표시 접미사, rangeLabel 은 최고/최저 칩 접두어,
   longDate 는 칩 날짜에 연도를 표기할지 여부. */
const PERIODS = {
  '1D': { label: '1일',  lastN: 2,    changeLabel: '전일 대비',   rangeLabel: '1일' },
  '1W': { label: '1주',  days: 7,    changeLabel: '1주 전 대비',  rangeLabel: '1주' },
  '1M': { label: '1개월', months: 1,  changeLabel: '1개월 전 대비', rangeLabel: '1개월' },
  '3M': { label: '3개월', months: 3,  changeLabel: '3개월 전 대비', rangeLabel: '3개월' },
  '1Y': { label: '1년',  months: 12, changeLabel: '1년 전 대비',  rangeLabel: '1년' },
  '3Y': { label: '3년',  months: 36, changeLabel: '3년 전 대비',  rangeLabel: '3년', longDate: true },
  '5Y': { label: '5년',  months: 60, changeLabel: '5년 전 대비',  rangeLabel: '5년', longDate: true },
};
const DEFAULT_PERIOD = '1D';

/* 지표 정의: series 는 Worker 화이트리스트 이름, item 은 기대하는 ECOS 항목 코드(응답 검증),
   multiplier 는 표시 배수(ECOS 원/엔은 이미 100엔 기준), period 는 카드별 현재 선택 기간. */
const CURRENCIES = [
  { code: 'USD', series: 'fx_usd', item: '0000001', multiplier: 1, unit: '원', period: DEFAULT_PERIOD, cardEl: 'cardUSD',
    rateEl: 'rateUSD', changeEl: 'changeUSD', chartEl: 'chartUSD', rangeEl: 'rangeUSD', periodsEl: 'periodsUSD',
    chartW: 820, chartH: 240 },
  { code: 'EUR', series: 'fx_eur', item: '0000003', multiplier: 1, unit: '원', period: DEFAULT_PERIOD, cardEl: 'cardEUR',
    rateEl: 'rateEUR', changeEl: 'changeEUR', chartEl: 'chartEUR', rangeEl: 'rangeEUR', periodsEl: 'periodsEUR',
    chartW: 820, chartH: 240 },
  { code: 'JPY', series: 'fx_jpy', item: '0000002', multiplier: 1, unit: '원', period: DEFAULT_PERIOD, cardEl: 'cardJPY',
    rateEl: 'rateJPY', changeEl: 'changeJPY', chartEl: 'chartJPY', rangeEl: 'rangeJPY', periodsEl: 'periodsJPY',
    chartW: 820, chartH: 240 },
  { code: 'CNY', series: 'fx_cny', item: '0000053', multiplier: 1, unit: '원', period: DEFAULT_PERIOD, cardEl: 'cardCNY',
    rateEl: 'rateCNY', changeEl: 'changeCNY', chartEl: 'chartCNY', rangeEl: 'rangeCNY', periodsEl: 'periodsCNY',
    chartW: 820, chartH: 240 },
];

async function fxTryFetch(url) {
  const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

/* 기간 시작 기준 시각 — 마지막 영업일에서 days 일 또는 months 개월 전 (UTC 자정 기준). */
function periodCutoff(lastX, p) {
  if (p.days) return lastX - p.days * 86_400_000;
  const d = new Date(lastX);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - p.months, d.getUTCDate());
}

/* ECOS 응답 -> { series: [{x,y}...], prevClose }. 실패 시 null.
   series 는 기준 시각 이후 값, prevClose 는 기준 시각 이전 마지막 값(없으면 첫 값).
   lastN 기간(1일)은 최근 N개 영업일 값이며 prevClose 는 그 중 첫 값(전 영업일 마감). */
function fxDataFromEcos(json, cur, periodKey) {
  const rows = json?.StatisticSearch?.row;
  if (!Array.isArray(rows) || !rows.length) return null;
  if (rows[0].STAT_CODE !== FX_STAT || rows[0].ITEM_CODE1 !== cur.item) return null; // Worker 버전 불일치 방어

  const all = [];
  for (const r of rows) {
    const t = String(r.TIME || '');
    const v = parseFloat(r.DATA_VALUE);
    if (/^\d{8}$/.test(t) && isFinite(v) && v > 0) {
      all.push({ x: Date.UTC(+t.slice(0, 4), +t.slice(4, 6) - 1, +t.slice(6)), y: v });
    }
  }
  all.sort((a, b) => a.x - b.x);
  if (all.length < 2) return null;

  const p = PERIODS[periodKey];
  if (p.lastN) {
    const series = all.slice(-p.lastN);
    return { series, prevClose: series[0].y };
  }
  const cutoff = periodCutoff(all[all.length - 1].x, p);
  const series = all.filter((pt) => pt.x > cutoff);
  if (series.length < 2) return null;
  const before = all.filter((pt) => pt.x <= cutoff);
  const prevClose = before.length ? before[before.length - 1].y : series[0].y;
  return { series, prevClose };
}

async function fetchFxData(cur, periodKey) {
  const p = PERIODS[periodKey];
  const now = new Date();
  const s = p.lastN
    ? new Date(now.getFullYear(), now.getMonth(), now.getDate() - FX_FETCH_BUFFER_DAYS)
    : p.days
    ? new Date(now.getFullYear(), now.getMonth(), now.getDate() - p.days - FX_FETCH_BUFFER_DAYS)
    : new Date(now.getFullYear(), now.getMonth() - p.months, now.getDate() - FX_FETCH_BUFFER_DAYS);
  const ymd = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const json = await fxTryFetch(`${FX_ENDPOINT}?series=${cur.series}&cycle=D&start=${ymd(s)}&end=${ymd(now)}`);
  return fxDataFromEcos(json, cur, periodKey);
}

const wonFmt = (n) => n.toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateFmt = (ms) => new Date(ms).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const ymdFmt = (ms) => { const d = new Date(ms); return `${String(d.getUTCFullYear()).slice(2)}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`; };

/* 상승하락 방향별 그래프 색상: 상승=빨강 · 하락=파랑 · 보합=회색 (.fx-change 색과 통일) */
const DIR_COLORS = { up: '#f87171', down: '#6c8cff', flat: '#94a3b8' };

const CHART_MARGIN = { L: 46, R: 10, T: 10, B: 22 };

/* 차트 축(y축 값 그리드 + x축 라벨) SVG. 눈금 간격이 1 미만이면 소수 2자리로 표기(좁은 범위 대응). */
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

  /* x축 눈금 4개. 점이 4개 이하(1일·연휴 낀 1주)면 날짜가 겹치지 않게 실제 영업일에만 표시 */
  const xN = Math.min(4, series.length);
  const tickAt = series.length <= 4 ? (i) => xs[i] : (i) => xMin + ((xMax - xMin) * i) / (xN - 1);
  const xTicks = Array.from({ length: xN }, (_, i) => {
    const t = tickAt(i);
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
  const stamp = p.longDate ? ymdFmt : dateFmt; // 1년 초과 기간은 연도 포함
  const m = cur.multiplier;
  const u = cur.unit;
  const { series, prevClose } = data;
  const cur_ = series[series.length - 1].y * m;
  const base = prevClose * m;

  /* 현재값 */
  rateEl.classList.remove('loading');
  rateEl.innerHTML = `${wonFmt(cur_)}${u ? `<span class="won">${u}</span>` : ''}`;

  /* 기간 대비 변동 (기간 시작 시점 값 기준) */
  const diff = cur_ - base;
  const pct = base !== 0 ? (diff / base) * 100 : 0;
  const dir = diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat';
  const arrow = diff > 0 ? '▲' : diff < 0 ? '▼' : '−';
  const sign = diff > 0 ? '+' : diff < 0 ? '-' : '';
  changeEl.className = `fx-change ${dir}`;
  changeEl.textContent = `${arrow} ${sign}${wonFmt(Math.abs(diff))}${u} (${sign}${Math.abs(pct).toFixed(2)}%) · ${p.changeLabel}`;

  /* 기간 차트 (y축은 표시 단위로 환산한 값, x축은 날짜) */
  const xFmt = ymdFmt;
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
  const cacheKey = `fxe_${cur.code}_${period}`; // ECOS 전환 — Yahoo 시절 캐시(fx_)와 분리

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
    data = await fetchFxData(cur, period);
  } catch (e) {} // Worker 실패 → data=null 로 '조회 실패' 표시
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
  loadCurrency(cur); // 선택된 통화만 로드 (1시간 캐시 히트 시 즉시 표시)
}

document.getElementById('fxTabs').addEventListener('click', (e) => {
  const btn = e.target.closest('.fx-tab-btn');
  if (btn) activateTab(btn.dataset.code);
});

/* ===================== 초기화 ===================== */
CURRENCIES.forEach(buildPeriodButtons);
activateTab('USD');
