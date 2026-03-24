import crypto from 'crypto';

// ─── 환경변수 ───
const CUSTOMER_ID = process.env.NAVER_ADS_CUSTOMER_ID;
const API_KEY     = process.env.NAVER_ADS_API_KEY;
const SECRET_KEY  = process.env.NAVER_ADS_SECRET_KEY;
const API_TOKEN   = process.env.API_ACCESS_TOKEN;

const BASE_URL = 'https://api.naver.com';

// ─── HMAC-SHA256 서명 생성 ───
function generateSignature(timestamp, method, uri) {
  const message = `${timestamp}.${method}.${uri}`;
  const hmac = crypto.createHmac('sha256', SECRET_KEY);
  hmac.update(message);
  return hmac.digest('base64');
}

// ─── 키워드 전처리 ───
// 네이버 API는 hintKeywords에 공백을 허용하지 않음
// "학점은행제 비용" → "학점은행제,비용" (쉼표 구분으로 변환)
function preprocessKeyword(keyword) {
  return keyword.trim().replace(/\s+/g, '');
}

// ─── 네이버 검색광고 API 호출 ───
async function callNaverAdsAPI(hintKeywords) {
  const uri = '/keywordstool';
  const timestamp = String(Date.now());
  const method = 'GET';
  const signature = generateSignature(timestamp, method, uri);

  // URL 객체로 안전하게 인코딩
  const url = new URL(`${BASE_URL}${uri}`);
  url.searchParams.set('hintKeywords', hintKeywords);
  url.searchParams.set('showDetail', '1');

  const response = await fetch(url.toString(), {
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
  const headKeyword = seedKeyword.split(/[\s,]+/)[0];

  const results = {
    head: null,
    body: [],
    longtail: [],
  };

  for (const kw of keywordList) {
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

    if (kw.relKeyword === headKeyword && !results.head) {
      results.head = kwData;
      continue;
    }

    const wordCount = kw.relKeyword.split(' ').length;

    if (wordCount <= 2 && total >= 50) {
      kwData.isGolden = total >= 50 && total <= 100;
      results.body.push(kwData);
    } else if (wordCount >= 3 && total >= 30) {
      results.longtail.push(kwData);
    }
  }

  results.body.sort((a, b) => b.total - a.total);
  results.body = results.body.slice(0, 10);

  results.longtail.sort((a, b) => b.total - a.total);
  results.longtail = results.longtail.slice(0, 15);

  return results;
}

// ─── API 핸들러 ───
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (API_TOKEN) {
    const authHeader = req.headers.authorization;
    if (!authHeader || authHeader !== `Bearer ${API_TOKEN}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  if (!CUSTOMER_ID || !API_KEY || !SECRET_KEY) {
    return res.status(500).json({ error: 'Naver Ads API credentials not configured' });
  }

  const { q } = req.query;
  if (!q) {
    return res.status(400).json({ error: 'Missing query parameter: q (키워드를 입력하세요)' });
  }

  try {
    const processedKeyword = preprocessKeyword(q);

    const data = await callNaverAdsAPI(processedKeyword);
    const keywordList = data.keywordList || [];
    const classified = classifyKeywords(q, keywordList);

    return res.status(200).json({
      success: true,
      query: q,
      processedQuery: processedKeyword,
      totalResults: keywordList.length,
      classified: classified,
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
