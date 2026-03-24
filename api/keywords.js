import crypto from 'crypto';

// ─── 환경변수 ───
const CUSTOMER_ID = process.env.NAVER_ADS_CUSTOMER_ID;
const API_KEY     = process.env.NAVER_ADS_API_KEY;
const SECRET_KEY  = process.env.NAVER_ADS_SECRET_KEY;
const API_TOKEN   = process.env.API_ACCESS_TOKEN; // 외부 호출 보호용 (선택)

const BASE_URL = 'https://api.naver.com';

// ─── HMAC-SHA256 서명 생성 ───
function generateSignature(timestamp, method, uri) {
  const message = `${timestamp}.${method}.${uri}`;
  const hmac = crypto.createHmac('sha256', SECRET_KEY);
  hmac.update(message);
  return hmac.digest('base64');
}

// ─── 네이버 검색광고 API 호출 ───
async function callNaverAdsAPI(uri, params = {}) {
  const timestamp = String(Date.now());
  const method = 'GET';
  const signature = generateSignature(timestamp, method, uri);

  const queryString = new URLSearchParams(params).toString();
  const url = `${BASE_URL}${uri}${queryString ? '?' + queryString : ''}`;

  const response = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Timestamp': timestamp,
      'X-API-KEY': API_KEY,
      'X-Customer': CUSTOMER_ID,
      'X-Signature': signature,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Naver Ads API error: ${response.status} - ${errorText}`);
  }

  return response.json();
}

// ─── 키워드 계층 분류 ───
function classifyKeywords(seedKeyword, keywordList) {
  // 1차(Head) 추출: 시드에서 공백 기준 첫 단어 (또는 가장 짧은 형태)
  const headCandidates = seedKeyword.split(' ');
  const headKeyword = headCandidates[0]; // 예: "학점은행제"

  const results = {
    head: null,
    body: [],  // 2차
    longtail: [], // 3차
  };

  for (const kw of keywordList) {
    const totalSearch = (kw.monthlyPcQcCnt || 0) + (kw.monthlyMobileQcCnt || 0);

    // "< 10" 등 문자열로 오는 경우 처리
    const pcCount = typeof kw.monthlyPcQcCnt === 'number' ? kw.monthlyPcQcCnt : 10;
    const moCount = typeof kw.monthlyMobileQcCnt === 'number' ? kw.monthlyMobileQcCnt : 10;
    const total = pcCount + moCount;

    const kwData = {
      keyword: kw.relKeyword,
      pc: pcCount,
      mo: moCount,
      total: total,
      competition: kw.compIdx || '낮음',
      monthlyPcClkCnt: kw.monthlyPcClkCnt || 0,
      monthlyMobileClkCnt: kw.monthlyMobileClkCnt || 0,
    };

    // 1차(Head) 식별: 시드의 루트 키워드와 동일
    if (kw.relKeyword === headKeyword && !results.head) {
      results.head = kwData;
      continue;
    }

    // 형태소 개수로 2차/3차 분류
    const wordCount = kw.relKeyword.split(' ').length;

    if (wordCount <= 2 && total >= 50) {
      // 2차(Body): 형태소 2개 이하 + 월 합계 50 이상
      kwData.isGolden = total >= 50 && total <= 100;
      results.body.push(kwData);
    } else if (wordCount >= 3 && total >= 30) {
      // 3차(Long-tail): 형태소 3개 이상 + 월 합계 30 이상
      results.longtail.push(kwData);
    }
  }

  // 2차: 검색량 내림차순 정렬, 상위 10개
  results.body.sort((a, b) => b.total - a.total);
  results.body = results.body.slice(0, 10);

  // 3차: 검색량 내림차순 정렬, 상위 15개
  results.longtail.sort((a, b) => b.total - a.total);
  results.longtail = results.longtail.slice(0, 15);

  return results;
}

// ─── API 핸들러 ───
export default async function handler(req, res) {
  // CORS 헤더
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // 접근 토큰 검증 (설정한 경우)
  if (API_TOKEN) {
    const authHeader = req.headers.authorization;
    if (!authHeader || authHeader !== `Bearer ${API_TOKEN}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  // 필수 환경변수 체크
  if (!CUSTOMER_ID || !API_KEY || !SECRET_KEY) {
    return res.status(500).json({ error: 'Naver Ads API credentials not configured' });
  }

  const { q } = req.query;
  if (!q) {
    return res.status(400).json({ error: 'Missing query parameter: q (키워드를 입력하세요)' });
  }

  try {
    // 네이버 검색광고 키워드 도구 API 호출
    const data = await callNaverAdsAPI('/keywordstool', {
      hintKeywords: q,
      showDetail: '1',
    });

    const keywordList = data.keywordList || [];

    // 키워드 계층 분류
    const classified = classifyKeywords(q, keywordList);

    return res.status(200).json({
      success: true,
      query: q,
      totalResults: keywordList.length,
      classified: classified,
      // 원본 데이터도 포함 (필요 시 참조)
      raw: keywordList.slice(0, 30),
    });

  } catch (error) {
    console.error('Keywords API error:', error);
    return res.status(500).json({
      error: 'Failed to fetch keyword data',
      message: error.message,
    });
  }
}
