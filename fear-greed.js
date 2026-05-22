/* ===================== CNN Fear & Greed Index ===================== */
const CNN_URL = 'https://production.dataviz.cnn.io/index/fearandgreed/graphdata';
const PROXY_URL = (url) => `https://corsproxy.io/?url=${encodeURIComponent(url)}`;
const CACHE_KEY = 'fear_greed_cache';
const CACHE_TTL = 60 * 60 * 1000; // 1시간

function ratingClass(rating) {
  if (!rating) return '';
  const r = rating.toLowerCase();
  if (r.includes('extreme fear')) return 'rating-extreme-fear';
  if (r.includes('fear'))         return 'rating-fear';
  if (r.includes('neutral'))      return 'rating-neutral';
  if (r.includes('extreme greed'))return 'rating-extreme-greed';
  if (r.includes('greed'))        return 'rating-greed';
  return '';
}

function ratingLabelKR(rating) {
  if (!rating) return '—';
  const r = rating.toLowerCase();
  if (r.includes('extreme fear'))  return 'Extreme Fear · 극도의 공포';
  if (r.includes('fear'))          return 'Fear · 공포';
  if (r.includes('neutral'))       return 'Neutral · 중립';
  if (r.includes('extreme greed')) return 'Extreme Greed · 극도의 탐욕';
  if (r.includes('greed'))         return 'Greed · 탐욕';
  return rating;
}

function scoreToRating(score) {
  if (score < 25) return 'extreme fear';
  if (score < 45) return 'fear';
  if (score <= 55) return 'neutral';
  if (score <= 75) return 'greed';
  return 'extreme greed';
}

function setNeedle(score) {
  /* 0~100 → -90도 ~ +90도 매핑 */
  const angle = -90 + (score / 100) * 180;
  const needle = document.getElementById('gaugeNeedle');
  needle.setAttribute('transform', `rotate(${angle} 160 160)`);
}

function renderCurrent(score, rating, timestamp) {
  const scoreEl  = document.getElementById('gaugeScore');
  const ratingEl = document.getElementById('gaugeRating');
  const tsEl     = document.getElementById('gaugeTimestamp');

  const rounded = Math.round(score);
  scoreEl.textContent = rounded;
  scoreEl.className = 'gauge-score ' + ratingClass(rating);
  ratingEl.textContent = ratingLabelKR(rating);
  ratingEl.className = 'gauge-rating ' + ratingClass(rating);

  if (timestamp) {
    const d = new Date(timestamp);
    tsEl.textContent = `${d.toLocaleDateString('ko-KR')} ${d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} 기준`;
  }

  setNeedle(score);
}

function renderCompare(data) {
  const items = [
    { score: data.previous_close,   ratingId: 'prevClose',  ratingTextId: 'prevCloseRating' },
    { score: data.previous_1_week,  ratingId: 'prev1Week',  ratingTextId: 'prev1WeekRating' },
    { score: data.previous_1_month, ratingId: 'prev1Month', ratingTextId: 'prev1MonthRating' },
    { score: data.previous_1_year,  ratingId: 'prev1Year',  ratingTextId: 'prev1YearRating' },
  ];

  items.forEach(item => {
    const el  = document.getElementById(item.ratingId);
    const txt = document.getElementById(item.ratingTextId);
    if (item.score == null) {
      el.textContent = '—';
      txt.textContent = '';
      return;
    }
    const r = scoreToRating(item.score);
    el.textContent = Math.round(item.score);
    el.className = 'compare-value ' + ratingClass(r);
    txt.textContent = ratingLabelKR(r).split(' · ')[1] || ratingLabelKR(r);
  });
}

function showError(msg) {
  const banner = document.getElementById('infoBanner');
  banner.classList.add('error');
  banner.innerHTML = `❌ <strong>${msg}</strong>`;
}

function showInfo(msg) {
  const banner = document.getElementById('infoBanner');
  banner.classList.remove('error');
  banner.innerHTML = msg;
}

async function tryFetch(url) {
  const res = await fetch(url, {
    headers: { 'Accept': 'application/json' },
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

async function fetchFearGreed(force = false) {
  /* 캐시 확인 */
  if (!force) {
    try {
      const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      if (cached && Date.now() - cached.ts < CACHE_TTL) {
        apply(cached.data);
        showInfo(`💾 1시간 이내 캐시 사용 중 (${new Date(cached.ts).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })})`);
        return;
      }
    } catch (e) {}
  }

  let data;
  try {
    data = await tryFetch(CNN_URL);
  } catch (e1) {
    try {
      data = await tryFetch(PROXY_URL(CNN_URL));
      showInfo('🔁 CORS 프록시 경유로 데이터를 가져왔습니다.');
    } catch (e2) {
      showError('데이터 로딩 실패 — CNN API 및 프록시 모두 응답하지 않습니다.');
      return;
    }
  }

  apply(data);
  localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data }));
}

let historicalData = []; // { x: timestamp, y: score }
let currentRangeDays = 30;

/* 세부 지표 정의 */
const SUB_INDICATORS = [
  {
    keys: ['market_momentum_sp500', 'market_momentum_sp125'],
    name: '시장 모멘텀',
    en:   'Market Momentum',
    what: 'S&P 500이 125일 이동평균선보다 얼마나 위/아래에 있는지',
    how:  '지수가 이평선 위에 있으면 강세(탐욕), 아래면 약세(공포). 격차가 클수록 극단적',
  },
  {
    keys: ['market_volatility_vix', 'market_volatility_vix_50'],
    name: '시장 변동성',
    en:   'Market Volatility (VIX)',
    what: 'VIX(공포지수)가 50일 이평선 대비 어떤 수준인지',
    how:  'VIX가 낮으면 시장이 안정(탐욕), 높으면 공포. 급등 시 단기 매수 신호로 해석되기도 함',
  },
  {
    keys: ['stock_price_strength'],
    name: '주가 강도',
    en:   'Stock Price Strength',
    what: 'NYSE에서 52주 신고가 종목 수와 신저가 종목 수의 비율',
    how:  '신고가 종목이 많으면 시장 폭이 넓고 강함(탐욕), 신저가 많으면 매도세 확산(공포)',
  },
  {
    keys: ['put_call_options'],
    name: '풋콜 비율',
    en:   'Put/Call Options',
    what: '옵션 시장의 5일 풋/콜 거래량 비율',
    how:  '풋이 많으면 하락 헤지/베팅 우세(공포), 콜이 많으면 상승 기대(탐욕)',
  },
  {
    keys: ['safe_haven_demand'],
    name: '안전자산 수요',
    en:   'Safe Haven Demand',
    what: '최근 20일 주식 수익률 − 채권 수익률',
    how:  '주식이 우위면 자금이 위험자산으로(탐욕), 채권이 우위면 안전자산 선호(공포)',
  },
];

function apply(data) {
  const fg = data?.fear_and_greed;
  if (!fg) {
    showError('응답 형식이 예상과 다릅니다.');
    return;
  }
  renderCurrent(fg.score, fg.rating, fg.timestamp);
  renderCompare(fg);

  /* 시계열 데이터 저장 */
  const hist = data?.fear_and_greed_historical?.data ?? [];
  historicalData = hist
    .map(p => ({ x: p.x, y: p.y }))
    .filter(p => typeof p.x === 'number' && typeof p.y === 'number')
    .sort((a, b) => a.x - b.x);
  renderChart(currentRangeDays);

  /* 세부 지표 */
  renderSubIndicators(data);
}

/* ===================== 세부 지표 렌더 ===================== */
function findIndicator(data, keys) {
  for (const k of keys) {
    if (data[k]) return { current: data[k], historical: data[k + '_historical']?.data ?? [] };
  }
  return null;
}

function ratingHex(rating) {
  const r = (rating || '').toLowerCase();
  if (r.includes('extreme fear'))  return '#f87171';
  if (r.includes('fear'))          return '#fb923c';
  if (r.includes('neutral'))       return '#fbbf24';
  if (r.includes('extreme greed')) return '#34d399';
  if (r.includes('greed'))         return '#84cc16';
  return '#94a3b8';
}

function renderSparkline(hist, color) {
  if (!hist || hist.length < 2) return '<svg class="indicator-spark"></svg>';
  /* 최근 30일분만 */
  const recent = hist.slice(-30);
  const W = 200, H = 44, PAD = 2;
  const xs = recent.map(p => p.x);
  const ys = recent.map(p => p.y);
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const xScale = v => PAD + ((v - xMin) / (xMax - xMin || 1)) * (W - PAD * 2);
  const yScale = v => PAD + (1 - v / 100) * (H - PAD * 2);

  const line = recent.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xScale(p.x).toFixed(1)} ${yScale(p.y).toFixed(1)}`).join(' ');
  const area = line + ` L ${xScale(xMax).toFixed(1)} ${H - PAD} L ${PAD} ${H - PAD} Z`;

  return `
    <svg class="indicator-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      <path class="spark-area" d="${area}" fill="${color}" />
      <path class="spark-line" d="${line}" stroke="${color}" />
    </svg>
  `;
}

function renderSubIndicators(data) {
  const grid = document.getElementById('indicatorsGrid');
  if (!grid) return;
  grid.innerHTML = '';

  SUB_INDICATORS.forEach(ind => {
    const found = findIndicator(data, ind.keys);
    let scoreHTML = '—', ratingHTML = '데이터 없음', sparkHTML = '<svg class="indicator-spark"></svg>';
    let ratingCls = '';

    if (found) {
      const c = found.current;
      const rating = c.rating || scoreToRating(c.score);
      scoreHTML = Math.round(c.score);
      ratingHTML = ratingLabelKR(rating);
      ratingCls = ratingClass(rating);
      sparkHTML = renderSparkline(found.historical, ratingHex(rating));
    }

    const card = document.createElement('div');
    card.className = 'indicator-card';
    card.innerHTML = `
      <div class="indicator-head">
        <div class="indicator-name">${ind.name}</div>
        <div class="indicator-en">${ind.en}</div>
      </div>
      <div class="indicator-score-row">
        <span class="indicator-score ${ratingCls}">${scoreHTML}</span>
        <span class="indicator-rating ${ratingCls}">${ratingHTML}</span>
      </div>
      ${sparkHTML}
      <div class="indicator-desc">
        <div class="desc-row"><span class="desc-label">📊 무엇</span><span>${ind.what}</span></div>
        <div class="desc-row"><span class="desc-label">💡 해석</span><span>${ind.how}</span></div>
      </div>
    `;
    grid.appendChild(card);
  });
}

/* ===================== 시계열 차트 ===================== */
function renderChart(rangeDays) {
  currentRangeDays = rangeDays;

  /* 버튼 활성화 */
  document.querySelectorAll('#rangeToggle .range-btn').forEach(b => {
    b.classList.toggle('active', parseInt(b.dataset.range) === rangeDays);
  });

  if (!historicalData.length) return;

  const now = historicalData[historicalData.length - 1].x;
  const cutoff = rangeDays === 0 ? 0 : now - rangeDays * 24 * 60 * 60 * 1000;
  const series = historicalData.filter(p => p.x >= cutoff);
  if (series.length < 2) return;

  /* SVG 좌표계 */
  const W = 800, H = 320;
  const PAD_L = 36, PAD_R = 12, PAD_T = 12, PAD_B = 28;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;

  const xMin = series[0].x;
  const xMax = series[series.length - 1].x;
  const xScale = v => PAD_L + ((v - xMin) / (xMax - xMin || 1)) * plotW;
  const yScale = v => PAD_T + (1 - v / 100) * plotH;

  /* 5단계 색상 밴드 (Extreme Fear→Extreme Greed) */
  const bands = [
    { from:  0, to: 25,  color: '#f87171' },
    { from: 25, to: 45,  color: '#fb923c' },
    { from: 45, to: 55,  color: '#fbbf24' },
    { from: 55, to: 75,  color: '#84cc16' },
    { from: 75, to: 100, color: '#34d399' },
  ];

  const bandRects = bands.map(b => {
    const y1 = yScale(b.to);
    const y2 = yScale(b.from);
    return `<rect class="chart-band" x="${PAD_L}" y="${y1}" width="${plotW}" height="${y2 - y1}" fill="${b.color}" />`;
  }).join('');

  /* Y축 가이드선 + 라벨 */
  const yTicks = [0, 25, 50, 75, 100];
  const yGrid = yTicks.map(t => `
    <line class="chart-grid-line" x1="${PAD_L}" y1="${yScale(t)}" x2="${W - PAD_R}" y2="${yScale(t)}" />
    <text class="chart-axis-label" x="${PAD_L - 6}" y="${yScale(t) + 3}" text-anchor="end">${t}</text>
  `).join('');

  /* X축 날짜 라벨 (4~6개) */
  const xTickCount = 5;
  let xTicks = '';
  for (let i = 0; i < xTickCount; i++) {
    const t = xMin + ((xMax - xMin) * i) / (xTickCount - 1);
    const d = new Date(t);
    const label = rangeDays >= 365 || rangeDays === 0
      ? `${d.getFullYear()}.${(d.getMonth() + 1).toString().padStart(2, '0')}`
      : `${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getDate().toString().padStart(2, '0')}`;
    xTicks += `<text class="chart-axis-label" x="${xScale(t)}" y="${H - 10}" text-anchor="middle">${label}</text>`;
  }

  /* 라인 + 영역 path */
  const linePath = series.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xScale(p.x).toFixed(2)} ${yScale(p.y).toFixed(2)}`).join(' ');
  const areaPath = linePath + ` L ${xScale(xMax).toFixed(2)} ${PAD_T + plotH} L ${PAD_L} ${PAD_T + plotH} Z`;

  /* 호버 영역 (보이지 않지만 마우스 이벤트 받음) */
  const hoverRect = `<rect id="chartHoverArea" x="${PAD_L}" y="${PAD_T}" width="${plotW}" height="${plotH}" fill="transparent" />`;

  document.getElementById('chartContent').innerHTML = `
    ${bandRects}
    ${yGrid}
    ${xTicks}
    <path class="chart-area" d="${areaPath}" />
    <path class="chart-line" d="${linePath}" />
    <circle id="chartHoverDot" class="chart-hover-dot" r="5" style="display:none" />
    ${hoverRect}
  `;

  /* 통계 */
  const values = series.map(p => p.y);
  const avg = values.reduce((s, v) => s + v, 0) / values.length;
  const min = Math.min(...values);
  const max = Math.max(...values);
  document.getElementById('statAvg').textContent = Math.round(avg);
  document.getElementById('statMin').textContent = Math.round(min);
  document.getElementById('statMax').textContent = Math.round(max);

  /* 호버 이벤트 */
  setupChartHover(series, xScale, yScale, PAD_L, plotW);
}

function setupChartHover(series, xScale, yScale, padL, plotW) {
  const svg     = document.getElementById('historyChart');
  const hoverEl = document.getElementById('chartHoverArea');
  const dot     = document.getElementById('chartHoverDot');
  const tip     = document.getElementById('chartTooltip');
  const ttScore = document.getElementById('ttScore');
  const ttDate  = document.getElementById('ttDate');
  if (!hoverEl) return;

  const xMin = series[0].x;
  const xMax = series[series.length - 1].x;

  function onMove(evt) {
    const rect = svg.getBoundingClientRect();
    const ratioX = (evt.clientX - rect.left) / rect.width;
    const svgX = ratioX * 800;
    if (svgX < padL || svgX > padL + plotW) { onLeave(); return; }

    const t = xMin + ((svgX - padL) / plotW) * (xMax - xMin);
    /* 가장 가까운 데이터 포인트 찾기 (이분 탐색) */
    let lo = 0, hi = series.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (series[mid].x < t) lo = mid + 1; else hi = mid;
    }
    const pt = series[lo];
    const cx = xScale(pt.x), cy = yScale(pt.y);

    dot.setAttribute('cx', cx);
    dot.setAttribute('cy', cy);
    dot.style.display = '';

    const ratingClassName = ratingClass(scoreToRating(pt.y));
    ttScore.textContent = Math.round(pt.y);
    ttScore.className   = 'tt-score ' + ratingClassName;
    const d = new Date(pt.x);
    ttDate.textContent  = `${d.getFullYear()}.${(d.getMonth() + 1).toString().padStart(2, '0')}.${d.getDate().toString().padStart(2, '0')}`;

    /* 화면 좌표로 변환 */
    const px = rect.left + (cx / 800) * rect.width;
    const py = rect.top  + (cy / 320) * rect.height;
    const wrapRect = svg.parentElement.getBoundingClientRect();
    tip.style.left = (px - wrapRect.left) + 'px';
    tip.style.top  = (py - wrapRect.top  - 8) + 'px';
    tip.style.display = 'block';
  }

  function onLeave() {
    dot.style.display = 'none';
    tip.style.display = 'none';
  }

  svg.onmousemove = onMove;
  svg.onmouseleave = onLeave;
  svg.ontouchmove = (e) => { if (e.touches[0]) onMove(e.touches[0]); };
  svg.ontouchend  = onLeave;
}

/* 범위 버튼 핸들러 */
document.getElementById('rangeToggle').addEventListener('click', (e) => {
  const btn = e.target.closest('.range-btn');
  if (!btn) return;
  renderChart(parseInt(btn.dataset.range));
});

async function refreshIndex() {
  const btn = document.getElementById('refreshBtn');
  btn.disabled = true;
  btn.textContent = '⏳ 조회 중...';
  await fetchFearGreed(true);
  btn.disabled = false;
  btn.textContent = '🔄 새로고침';
}

/* ===================== 초기화 ===================== */
fetchFearGreed();
