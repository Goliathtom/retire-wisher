/* ============================================================================
   은퇴바라기 CORS 프록시 — Cloudflare Worker

   Yahoo Finance·CNN API 는 브라우저 CORS 를 허용하지 않아 프록시가 필요하다.
   기존에 쓰던 corsproxy.io 가 유료화되어(401) 자체 프록시로 대체한다.

   ── 배포 방법 (5분, 무료 플랜·카드 불필요) ─────────────────────────────────
   1. https://dash.cloudflare.com 가입/로그인
   2. 좌측 메뉴 "Workers & Pages" → "Create" → "Create Worker" → "Deploy"
      (기본 Hello World 로 일단 배포됨)
   3. "Edit code" 클릭 → 에디터 내용을 전부 지우고 이 파일 전체를 붙여넣기
   4. 우측 상단 "Deploy" 클릭
   5. 발급된 URL 확인 (예: https://retire-wisher-proxy.<계정명>.workers.dev)

   ── 사용법 ──────────────────────────────────────────────────────────────────
   https://<워커 URL>/?url=<encodeURIComponent 된 대상 URL>
   (corsproxy.io 와 동일한 인터페이스)

   https://<워커 URL>/ecos?start=YYYYMM&end=YYYYMM
   한국은행 ECOS M2 통화량(월간) 조회. 인증키는 Worker Secret(ECOS_KEY)에만
   존재하므로 정적 페이지에 노출되지 않는다.

   ── ECOS_KEY Secret 등록 (배포 후 1회) ─────────────────────────────────────
   1. https://ecos.bok.or.kr/api 회원가입 → 인증키 발급 (무료)
   2. Cloudflare 대시보드 → 해당 Worker → Settings → Variables and Secrets
      → "Add" → Type: Secret / Name: ECOS_KEY / Value: 발급받은 키 → Deploy

   ── 보안 ────────────────────────────────────────────────────────────────────
   ALLOWED_HOSTS 화이트리스트에 있는 호스트만 프록시하므로
   URL 이 공개되어도 오픈 프록시로 악용될 수 없다.
   /ecos 는 통계표(M2)·주기를 Worker 안에 고정해 키 남용을 차단한다.
   ========================================================================== */

const ALLOWED_HOSTS = new Set([
  'query1.finance.yahoo.com',
  'query2.finance.yahoo.com',
  'production.dataviz.cnn.io',
]);

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Accept, Content-Type',
};

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

/* ECOS M2 통화량: 통계표 161Y005(M2 상품별 구성내역, 평잔·계절조정) / 항목 BBHS00 / 월간.
   통계표·주기를 고정하고 조회 기간(YYYYMM)만 받으므로 키가 다른 용도로 쓰일 수 없다. */
async function handleEcos(request, env) {
  if (!env.ECOS_KEY) return jsonError('ECOS_KEY not configured', 500);
  const params = new URL(request.url).searchParams;
  const start = params.get('start');
  const end = params.get('end');
  if (!/^\d{6}$/.test(start || '') || !/^\d{6}$/.test(end || '')) {
    return jsonError('start/end must be YYYYMM', 400);
  }

  const upstream = await fetch(
    `https://ecos.bok.or.kr/api/StatisticSearch/${env.ECOS_KEY}/json/kr/1/400/161Y005/M/${start}/${end}/BBHS00`,
    {
      headers: { 'Accept': 'application/json' },
      cf: { cacheTtl: 3600, cacheEverything: true }, // 월간 데이터 — 엣지 캐시 1시간
    }
  );

  const headers = new Headers(CORS_HEADERS);
  headers.set('Content-Type', 'application/json');
  headers.set('Cache-Control', 'public, max-age=3600');
  return new Response(upstream.body, { status: upstream.status, headers });
}

export default {
  async fetch(request, env) {
    /* CORS preflight */
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    if (request.method !== 'GET') {
      return jsonError('method not allowed', 405);
    }

    if (new URL(request.url).pathname === '/ecos') {
      return handleEcos(request, env);
    }

    const target = new URL(request.url).searchParams.get('url');
    if (!target) return jsonError('missing url param', 400);

    let targetUrl;
    try {
      targetUrl = new URL(target);
    } catch (e) {
      return jsonError('invalid url', 400);
    }
    if (targetUrl.protocol !== 'https:' || !ALLOWED_HOSTS.has(targetUrl.hostname)) {
      return jsonError('host not allowed', 403);
    }

    const upstream = await fetch(targetUrl.toString(), {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; retire-wisher-proxy)',
      },
      cf: { cacheTtl: 60, cacheEverything: true }, // 엣지 캐시 60초 — 상류 부하·응답속도 개선
    });

    const headers = new Headers(CORS_HEADERS);
    headers.set('Content-Type', upstream.headers.get('Content-Type') || 'application/json');
    headers.set('Cache-Control', 'public, max-age=60');
    return new Response(upstream.body, { status: upstream.status, headers });
  },
};
