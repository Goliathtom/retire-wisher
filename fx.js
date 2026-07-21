/* ===================== 실시간 환율 (Yahoo Finance) ===================== */
/* Yahoo Finance chart 엔드포인트에서 원/달러·원/유로·원/엔 시세를 조회한다.
   etf.js / fear-greed.js 와 동일한 CORS 프록시 fallback + localStorage 1시간 캐시 패턴. */

const FX_PROXY_URL = (url) => `https://corsproxy.io/?url=${encodeURIComponent(url)}`;
const FX_CACHE_KEY = 'fx_rates_cache';
const FX_CACHE_TTL = 60 * 60 * 1000; // 1시간
const FX_CHART_URL = (sym) =>
  `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=5d&interval=1d`;

/* 통화 정의: multiplier 는 표시 단위(엔은 100엔 기준). */
const CURRENCIES = [
  { code: 'USD', symbol: 'KRW=X',    multiplier: 1,   rateEl: 'rateUSD', changeEl: 'changeUSD' },
  { code: 'EUR', symbol: 'EURKRW=X', multiplier: 1,   rateEl: 'rateEUR', changeEl: 'changeEUR' },
  { code: 'JPY', symbol: 'JPYKRW=X', multiplier: 100, rateEl: 'rateJPY', changeEl: 'changeJPY' },
];

async function fxTryFetch(url) {
  const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

/* Yahoo chart 응답 -> { price, prevClose }. 실패 시 null. */
function ratesFromChart(json) {
  const meta = json?.chart?.result?.[0]?.meta;
  const price = meta?.regularMarketPrice;
  const prevClose = meta?.previousClose ?? meta?.chartPreviousClose;
  if (typeof price !== 'number' || price <= 0) return null;
  return { price, prevClose: typeof prevClose === 'number' ? prevClose : null };
}

async function fetchFxRate(symbol) {
  const url = FX_CHART_URL(symbol);
  let json;
  try {
    json = await fxTryFetch(url);
  } catch (e1) {
    json = await fxTryFetch(FX_PROXY_URL(url)); // CORS 프록시 fallback
  }
  return ratesFromChart(json);
}

const wonFmt = (n) => n.toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function renderCurrency(cur, data) {
  const rateEl = document.getElementById(cur.rateEl);
  const changeEl = document.getElementById(cur.changeEl);
  if (!rateEl || !data) return;

  const rate = data.price * cur.multiplier;
  rateEl.classList.remove('loading');
  rateEl.innerHTML = `${wonFmt(rate)}<span class="won">원</span>`;

  if (data.prevClose == null) {
    changeEl.className = 'fx-change flat';
    changeEl.textContent = '';
    return;
  }
  const prev = data.prevClose * cur.multiplier;
  const diff = rate - prev;
  const pct = prev !== 0 ? (diff / prev) * 100 : 0;
  const dir = diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat';
  const arrow = diff > 0 ? '▲' : diff < 0 ? '▼' : '−';
  const sign = diff > 0 ? '+' : '';
  changeEl.className = `fx-change ${dir}`;
  changeEl.textContent = `${arrow} ${sign}${wonFmt(Math.abs(diff) * (diff < 0 ? -1 : 1))}원 (${sign}${pct.toFixed(2)}%) · 전일 대비`;
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
      CURRENCIES.forEach((cur) => renderCurrency(cur, cached.rates[cur.code]));
      const t = new Date(cached.ts).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
      setFxStatus(`💾 캐시 사용 중 (${t} 기준, 1시간 유효)`);
      return;
    }
  } catch (e) {}

  setFxStatus('⏳ 실시간 환율(Yahoo Finance) 불러오는 중…');
  const rates = {};
  await Promise.allSettled(
    CURRENCIES.map(async (cur) => {
      const data = await fetchFxRate(cur.symbol);
      if (data) {
        rates[cur.code] = data;
        renderCurrency(cur, data);
      }
    })
  );

  const ok = Object.keys(rates).length;
  if (ok === 0) {
    setFxStatus('⚠️ 실시간 환율을 가져오지 못했습니다. 잠시 후 다시 시도해 주세요.');
    return;
  }

  localStorage.setItem(FX_CACHE_KEY, JSON.stringify({ ts: Date.now(), rates }));
  const failed = CURRENCIES.filter((c) => !(c.code in rates)).map((c) => c.code);
  const suffix = failed.length ? ` (일부 실패: ${failed.join(', ')})` : '';
  const t = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  setFxStatus(`✅ 실시간 환율 적용 완료 (Yahoo Finance, ${t} 기준)${suffix}`);
}

/* ===================== 초기화 ===================== */
loadFxRates();
