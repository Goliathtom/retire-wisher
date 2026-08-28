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

   ── 보안 ────────────────────────────────────────────────────────────────────
   ALLOWED_HOSTS 화이트리스트에 있는 호스트만 프록시하므로
   URL 이 공개되어도 오픈 프록시로 악용될 수 없다.
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

export default {
  async fetch(request) {
    /* CORS preflight */
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    if (request.method !== 'GET') {
      return jsonError('method not allowed', 405);
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
