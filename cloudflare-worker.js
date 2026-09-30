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

   https://<워커 URL>/ecos?series=<지표>&cycle=<M|D>&start=&end=
   한국은행 ECOS 조회 (series 생략 시 m2, cycle 생략 시 지표 기본 주기).
   지표: m2 · bok_base(한은 기준금리) · us_base(미 정책금리) ·
   mortgage_new(주담대 신규취급액) · mortgage_bal(주담대 잔액) ·
   fx_usd · fx_eur · fx_jpy · fx_cny(원/달러·유로·100엔·위안 일별 매매기준율)
   인증키는 Worker Secret(ECOS_KEY)에만 존재하므로 정적 페이지에 노출되지 않는다.

   https://<워커 URL>/fss/mortgage
   금융감독원 '금융상품 한눈에' 은행 권역 주택담보대출 상품·금리 공시 조회.
   인증키는 Worker Secret(FSS_KEY)에만 존재한다.

   ── ECOS_KEY Secret 등록 (배포 후 1회) ─────────────────────────────────────
   1. https://ecos.bok.or.kr/api 회원가입 → 인증키 발급 (무료)
   2. Cloudflare 대시보드 → 해당 Worker → Settings → Variables and Secrets
      → "Add" → Type: Secret / Name: ECOS_KEY / Value: 발급받은 키 → Deploy

   ── FSS_KEY Secret 등록 (배포 후 1회) ──────────────────────────────────────
   1. https://finlife.fss.or.kr → 오픈API → 인증키 신청 → 이용형태 "개인" 선택
      (즉시 발급, 일 10,000건. "단체"는 IP 제한이 있어 Worker 에서 쓸 수 없음)
   2. ECOS_KEY 와 같은 방법으로 Type: Secret / Name: FSS_KEY 등록 → Deploy

   ── 보안 ────────────────────────────────────────────────────────────────────
   ALLOWED_HOSTS 화이트리스트에 있는 호스트만 프록시하므로
   URL 이 공개되어도 오픈 프록시로 악용될 수 없다.
   /ecos 는 ECOS_SERIES 화이트리스트에 있는 지표만 조회를 허용해 키 남용을 차단한다.
   /fss/mortgage 는 요청 파라미터를 받지 않고 은행 주담대 공시만 고정 조회한다.
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

/* ECOS 지표 화이트리스트 — series 이름으로만 조회할 수 있어 키가 다른 용도로 쓰일 수 없다.
   cycles 첫 항목이 기본 주기. (m2 가 기본 series — /ecos?start=&end= 기존 호출 호환) */
const ECOS_SERIES = {
  m2:           { stat: '161Y005', item: 'BBHS00',       cycles: ['M'] },      // M2(평잔, 계절조정)
  bok_base:     { stat: '722Y001', item: '0101000',      cycles: ['D', 'M'] }, // 한국은행 기준금리
  us_base:      { stat: '902Y006', item: 'US',           cycles: ['M'] },      // 미국 정책금리
  mortgage_new: { stat: '121Y006', item: 'BECBLA0302',   cycles: ['M'] },      // 주담대(신규취급액)
  mortgage_bal: { stat: '121Y015', item: 'BECBLB020202', cycles: ['M'] },      // 주담대(잔액)
  fx_usd:       { stat: '731Y001', item: '0000001',      cycles: ['D'] },      // 원/미국달러(매매기준율)
  fx_eur:       { stat: '731Y001', item: '0000003',      cycles: ['D'] },      // 원/유로
  fx_jpy:       { stat: '731Y001', item: '0000002',      cycles: ['D'] },      // 원/일본엔(100엔)
  fx_cny:       { stat: '731Y001', item: '0000053',      cycles: ['D'] },      // 원/위안(매매기준율)
};

/* /ecos?series=&cycle=&start=&end= — 한국은행 ECOS 조회.
   인증키(env.ECOS_KEY)는 Worker Secret 에만 존재해 정적 페이지에 노출되지 않는다.
   기간 형식: 월별(M)=YYYYMM, 일별(D)=YYYYMMDD. */
async function handleEcos(request, env) {
  if (!env.ECOS_KEY) return jsonError('ECOS_KEY not configured', 500);
  const params = new URL(request.url).searchParams;
  const series = ECOS_SERIES[params.get('series') || 'm2'];
  if (!series) return jsonError('unknown series', 400);
  const cycle = params.get('cycle') || series.cycles[0];
  if (!series.cycles.includes(cycle)) return jsonError('cycle not allowed for series', 400);

  const fmt = cycle === 'D' ? /^\d{8}$/ : /^\d{6}$/;
  const start = params.get('start');
  const end = params.get('end');
  if (!fmt.test(start || '') || !fmt.test(end || '')) {
    return jsonError(`start/end must be ${cycle === 'D' ? 'YYYYMMDD' : 'YYYYMM'}`, 400);
  }

  const upstream = await fetch(
    `https://ecos.bok.or.kr/api/StatisticSearch/${env.ECOS_KEY}/json/kr/1/5000/${series.stat}/${cycle}/${start}/${end}/${series.item}`,
    {
      headers: { 'Accept': 'application/json' },
      cf: { cacheTtl: 3600, cacheEverything: true }, // 월·일 단위 통계 — 엣지 캐시 1시간
    }
  );

  const headers = new Headers(CORS_HEADERS);
  headers.set('Content-Type', 'application/json');
  headers.set('Cache-Control', 'public, max-age=3600');
  return new Response(upstream.body, { status: upstream.status, headers });
}

/* /fss/mortgage — 금감원 금융상품 한눈에: 은행(020000) 주택담보대출 상품·금리 공시.
   인증키(env.FSS_KEY)는 Worker Secret 에만 존재. 전체 페이지를 모아 화면에 필요한
   필드만 돌려준다 (부대비용·중도상환수수료 등 긴 설명문 제외). 월 단위 공시 — 캐시 6시간. */
const FSS_CACHE_TTL = 6 * 60 * 60;
const FSS_MAX_PAGES = 5;

async function handleFssMortgage(env) {
  if (!env.FSS_KEY) return jsonError('FSS_KEY not configured', 500);

  const fetchPage = async (pageNo) => {
    const res = await fetch(
      `https://finlife.fss.or.kr/finlifeapi/mortgageLoanProductsSearch.json?auth=${env.FSS_KEY}&topFinGrpNo=020000&pageNo=${pageNo}`,
      {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (compatible; retire-wisher-proxy)', // curl 계열 UA 는 빈 응답
        },
        cf: { cacheTtl: FSS_CACHE_TTL, cacheEverything: true },
      }
    );
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return (await res.json()).result;
  };

  let pages;
  try {
    const first = await fetchPage(1);
    if (!first || first.err_cd !== '000') {
      return jsonError(`fss ${first?.err_cd || '?'} ${first?.err_msg || ''}`.trim(), 502);
    }
    const last = Math.min(Number(first.max_page_no) || 1, FSS_MAX_PAGES);
    const rest = await Promise.all(
      Array.from({ length: last - 1 }, (_, i) => fetchPage(i + 2))
    );
    pages = [first, ...rest];
  } catch (e) {
    return jsonError('fss upstream error', 502);
  }

  const base = pages.flatMap((p) => p?.baseList || []).map((b) => ({
    dcls_month: b.dcls_month, fin_co_no: b.fin_co_no, kor_co_nm: b.kor_co_nm,
    fin_prdt_cd: b.fin_prdt_cd, fin_prdt_nm: b.fin_prdt_nm,
  }));
  const options = pages.flatMap((p) => p?.optionList || []).map((o) => ({
    fin_co_no: o.fin_co_no, fin_prdt_cd: o.fin_prdt_cd,
    mrtg_type: o.mrtg_type, rpay_type: o.rpay_type, lend_rate_type: o.lend_rate_type,
    lend_rate_min: o.lend_rate_min, lend_rate_max: o.lend_rate_max, lend_rate_avg: o.lend_rate_avg,
  }));

  return new Response(JSON.stringify({ base, options }), {
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json',
      'Cache-Control': `public, max-age=${FSS_CACHE_TTL}`,
    },
  });
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
    if (new URL(request.url).pathname === '/fss/mortgage') {
      return handleFssMortgage(env);
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
