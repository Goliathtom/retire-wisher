/* ===================== 금리 (한국은행 ECOS) ===================== */
/* 기준금리(한국·미국)와 주택담보대출 금리(신규취급액·잔액)를 자체 Cloudflare
   Worker(/ecos, series 화이트리스트) 경유로 조회한다. 인증키가 Worker Secret 에만
   있어 공개 프록시 fallback 은 불가능 — 실패 시 '조회 실패' 표시.
   한국 기준금리는 1년·3년 일별(D), 그 외는 월별(M). 값 단위는 연 %. */

const RT_ENDPOINT = 'https://retire-wisher.goliathtom11.workers.dev/ecos';
const RT_CACHE_TTL = 60 * 60 * 1000; // 월·일 단위 통계 — 1시간 캐시

const RT_PERIODS = {
  '1Y':  { label: '1년',  months: 12 },
  '3Y':  { label: '3년',  months: 36 },
  '5Y':  { label: '5년',  months: 60 },
  '10Y': { label: '10년', months: 120 },
};
const RT_DEFAULT_PERIOD = '1Y';

/* 상승하락 방향별 색상: 상승=빨강 · 하락=파랑 · 보합=회색 (지수·환율과 통일) */
const DIR_COLORS = { up: '#f87171', down: '#6c8cff', flat: '#94a3b8' };

/* cycles: 기간별 조회 주기 (생략 시 월별). 한국 기준금리는 단기 구간을 일별로 조회.
   stat: 기대하는 ECOS 통계표 코드 — Worker 버전 불일치로 다른 지표가 오면 표시하지 않는다. */
const ASSETS = [
  { code: 'KRBASE',  series: 'bok_base',     stat: '722Y001', period: RT_DEFAULT_PERIOD, cardEl: 'cardKRBASE',
    cycles: { '1Y': 'D', '3Y': 'D' },
    rateEl: 'rateKRBASE', changeEl: 'changeKRBASE', chartEl: 'chartKRBASE', rangeEl: 'rangeKRBASE', periodsEl: 'periodsKRBASE',
    chartW: 820, chartH: 240 },
  { code: 'USBASE',  series: 'us_base',      stat: '902Y006', period: RT_DEFAULT_PERIOD, cardEl: 'cardUSBASE',
    rateEl: 'rateUSBASE', changeEl: 'changeUSBASE', chartEl: 'chartUSBASE', rangeEl: 'rangeUSBASE', periodsEl: 'periodsUSBASE',
    chartW: 820, chartH: 240 },
  { code: 'MORTNEW', series: 'mortgage_new', stat: '121Y006', period: RT_DEFAULT_PERIOD, cardEl: 'cardMORTNEW',
    rateEl: 'rateMORTNEW', changeEl: 'changeMORTNEW', chartEl: 'chartMORTNEW', rangeEl: 'rangeMORTNEW', periodsEl: 'periodsMORTNEW',
    chartW: 820, chartH: 240 },
  { code: 'MORTBAL', series: 'mortgage_bal', stat: '121Y015', period: RT_DEFAULT_PERIOD, cardEl: 'cardMORTBAL',
    rateEl: 'rateMORTBAL', changeEl: 'changeMORTBAL', chartEl: 'chartMORTBAL', rangeEl: 'rangeMORTBAL', periodsEl: 'periodsMORTBAL',
    chartW: 820, chartH: 240 },
];

async function rtTryFetch(url) {
  const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

const numFmt = (n, d = 2) => n.toLocaleString('ko-KR', { minimumFractionDigits: d, maximumFractionDigits: d });
const ymdFmt = (ms) => { const d = new Date(ms); return `${String(d.getUTCFullYear()).slice(2)}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`; };
const ymFmt = (ms) => { const d = new Date(ms); return `${String(d.getUTCFullYear()).slice(2)}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; };

/* ECOS 응답 -> { series: [{x,y}], cycle }. 실패 시 null.
   발표 지연을 감안해 여유 있게 조회한 뒤 표시 기간만 남긴다. */
async function fetchRateData(asset, periodKey) {
  const months = RT_PERIODS[periodKey].months;
  const cycle = asset.cycles?.[periodKey] || 'M';
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  let start, end;
  if (cycle === 'D') {
    const s = new Date(now.getFullYear(), now.getMonth() - months, now.getDate() - 7);
    start = `${s.getFullYear()}${pad(s.getMonth() + 1)}${pad(s.getDate())}`;
    end = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  } else {
    const s = new Date(now.getFullYear(), now.getMonth() - (months + 3), 1);
    start = `${s.getFullYear()}${pad(s.getMonth() + 1)}`;
    end = `${now.getFullYear()}${pad(now.getMonth() + 1)}`;
  }

  const json = await rtTryFetch(`${RT_ENDPOINT}?series=${asset.series}&cycle=${cycle}&start=${start}&end=${end}`);
  const rows = json?.StatisticSearch?.row;
  if (!Array.isArray(rows)) return null;
  if (rows[0]?.STAT_CODE && rows[0].STAT_CODE !== asset.stat) return null; // Worker 구버전 응답 방어

  const all = [];
  for (const r of rows) {
    const t = String(r.TIME || '');
    const v = parseFloat(r.DATA_VALUE);
    if (!isFinite(v)) continue;
    if (cycle === 'D' && /^\d{8}$/.test(t)) {
      all.push({ x: Date.UTC(+t.slice(0, 4), +t.slice(4, 6) - 1, +t.slice(6)), y: v });
    } else if (cycle === 'M' && /^\d{6}$/.test(t)) {
      all.push({ x: Date.UTC(+t.slice(0, 4), +t.slice(4) - 1, 1), y: v });
    }
  }
  if (all.length < 2) return null;
  all.sort((a, b) => a.x - b.x);

  /* 표시 기간: 마지막 시점 기준 months 개월 전부터 (발표 지연분 보정) */
  const last = new Date(all[all.length - 1].x);
  const cutoff = Date.UTC(last.getUTCFullYear(), last.getUTCMonth() - months, last.getUTCDate());
  const series = all.filter((p) => p.x >= cutoff);
  if (series.length < 2) return null;
  return { series, cycle };
}

/* 차트 축 — 금리 값은 범위가 좁아 눈금 간격에 따라 소수 자릿수 조정 (fx.js 와 동일) */
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

/* 종가 시계열 -> 인라인 SVG 라인+영역 차트 (지수·환율과 동일 스타일). */
const CHART_MARGIN = { L: 46, R: 10, T: 10, B: 22 };

function buildChartSVG(series, color, W = 820, H = 240, xFmt = ymdFmt) {
  const { L: PAD_L, R: PAD_R, T: PAD_T, B: PAD_B } = CHART_MARGIN;
  const plotW = W - PAD_L - PAD_R, plotH = H - PAD_T - PAD_B;
  const xs = series.map((p) => p.x);
  const ys = series.map((p) => p.y);
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const yMin = Math.min(...ys), yMax = Math.max(...ys);
  const yPad = (yMax - yMin) * 0.08 || 0.1;
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
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="기간 금리 추이">
      ${buildAxes(W, PAD_L, PAD_R, PAD_T, plotH, yMin, yMax, yScale, xTicks)}
      <path class="fx-chart-area" d="${area}" fill="${color}" />
      <path class="fx-chart-line" d="${line}" stroke="${color}" />
      <circle cx="${xScale(last.x).toFixed(1)}" cy="${yScale(last.y).toFixed(1)}" r="2.5" fill="${color}" />
    </svg>`;
}

/* 금리 카드 렌더 — 현재 금리(%) + 기간 시작 대비 %p + 라인 차트 + 최고·평균·최저. */
function renderRate(asset, data) {
  const rateEl = document.getElementById(asset.rateEl);
  const changeEl = document.getElementById(asset.changeEl);
  const chartEl = document.getElementById(asset.chartEl);
  const rangeEl = document.getElementById(asset.rangeEl);
  if (!rateEl || !data) return;

  const p = RT_PERIODS[asset.period];
  const { series, cycle } = data;
  const stamp = cycle === 'D' ? ymdFmt : ymFmt;
  const cur = series[series.length - 1].y;
  rateEl.classList.remove('loading');
  rateEl.textContent = `${numFmt(cur)}%`;

  /* 기간 시작 시점 대비 변동 (%p) */
  const base = series[0].y;
  const diff = cur - base;
  const dir = diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat';
  const arrow = diff > 0 ? '▲' : diff < 0 ? '▼' : '−';
  const sign = diff > 0 ? '+' : diff < 0 ? '-' : '';
  changeEl.className = `fx-change ${dir}`;
  changeEl.textContent = `${arrow} ${sign}${numFmt(Math.abs(diff))}%p · ${p.label} 전 대비`;

  const xFmt = cycle === 'D' ? ymdFmt : ymFmt;
  chartEl.innerHTML = buildChartSVG(series, DIR_COLORS[dir], asset.chartW, asset.chartH, xFmt);

  const ys = series.map((pt) => pt.y);
  const highIdx = ys.indexOf(Math.max(...ys));
  const lowIdx = ys.indexOf(Math.min(...ys));
  const avg = ys.reduce((s, v) => s + v, 0) / ys.length;
  rangeEl.innerHTML =
    `<div class="fx-range-item">` +
      `<div class="fx-range-top">` +
        `<span class="fx-range-label">${p.label} 최고</span>` +
        `<span class="fx-range-date">${stamp(series[highIdx].x)}</span>` +
      `</div>` +
      `<span class="fx-range-val high">${numFmt(ys[highIdx])}%</span>` +
    `</div>` +
    `<div class="fx-range-item">` +
      `<div class="fx-range-top">` +
        `<span class="fx-range-label">${p.label} 평균</span>` +
        `<span class="fx-range-date"></span>` +
      `</div>` +
      `<span class="fx-range-val">${numFmt(avg)}%</span>` +
    `</div>` +
    `<div class="fx-range-item">` +
      `<div class="fx-range-top">` +
        `<span class="fx-range-label">${p.label} 최저</span>` +
        `<span class="fx-range-date">${stamp(series[lowIdx].x)}</span>` +
      `</div>` +
      `<span class="fx-range-val low">${numFmt(ys[lowIdx])}%</span>` +
    `</div>`;
}

/* 카드별 기간 로드 (지표·기간별 캐시). */
async function loadAsset(asset) {
  const period = asset.period;
  const cacheKey = `rt_${asset.code}_${period}`;

  try {
    const cached = JSON.parse(localStorage.getItem(cacheKey) || 'null');
    if (cached && Date.now() - cached.ts < RT_CACHE_TTL) {
      if (asset.period === period) renderRate(asset, cached.data);
      return;
    }
  } catch (e) {}

  let data = null;
  try {
    data = await fetchRateData(asset, period);
  } catch (e) {} // Worker 실패 → data=null 로 '조회 실패' 표시
  if (asset.period !== period) return; // 그 사이 다른 기간이 선택됨 → 최신 요청만 반영

  if (!data) {
    const rateEl = document.getElementById(asset.rateEl);
    if (rateEl && rateEl.classList.contains('loading')) rateEl.textContent = '조회 실패';
    return;
  }

  renderRate(asset, data);
  localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), data }));
}

/* 카드별 기간 토글 버튼 생성 + 이벤트 연결. */
function buildPeriodButtons(asset) {
  const container = document.getElementById(asset.periodsEl);
  if (!container) return;
  container.innerHTML = Object.keys(RT_PERIODS)
    .map((k) => `<button class="card-period-btn${k === asset.period ? ' active' : ''}" data-period="${k}">${RT_PERIODS[k].label}</button>`)
    .join('');
  container.addEventListener('click', (e) => {
    const btn = e.target.closest('.card-period-btn');
    if (!btn) return;
    const p = btn.dataset.period;
    if (p === asset.period || !RT_PERIODS[p]) return;
    asset.period = p;
    container.querySelectorAll('.card-period-btn').forEach((b) => b.classList.toggle('active', b.dataset.period === p));
    loadAsset(asset);
  });
}

/* ===================== 섹션별 탭 전환 (기준금리 · 주담대) ===================== */
const TAB_GROUPS = [
  { tabsId: 'baseTabs', codes: ['KRBASE', 'USBASE'],   initial: 'KRBASE' },
  { tabsId: 'loanTabs', codes: ['MORTNEW', 'MORTBAL'], initial: 'MORTNEW' },
];

function activateTabIn(group, code) {
  const asset = ASSETS.find((a) => a.code === code);
  if (!asset) return;
  group.codes.forEach((c) => {
    document.getElementById(`card${c}`)?.classList.toggle('active', c === code);
  });
  document.querySelectorAll(`#${group.tabsId} .fx-tab-btn`).forEach((b) =>
    b.classList.toggle('active', b.dataset.code === code));
  loadAsset(asset); // 선택된 지표만 로드 (1시간 캐시 히트 시 즉시 표시)
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
