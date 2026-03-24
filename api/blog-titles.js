// ─── 환경변수 ───
const CLIENT_ID     = process.env.NAVER_CLIENT_ID;
const CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET;
const API_TOKEN     = process.env.API_ACCESS_TOKEN; // 외부 호출 보호용 (선택)

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
  if (!CLIENT_ID || !CLIENT_SECRET) {
    return res.status(500).json({ error: 'Naver Search API credentials not configured' });
  }

  const { q, count = '10' } = req.query;
  if (!q) {
    return res.status(400).json({ error: 'Missing query parameter: q (검색어를 입력하세요)' });
  }

  const displayCount = Math.min(Math.max(parseInt(count), 1), 10);

  try {
    // 네이버 블로그 검색 API 호출 (정확도순 = sim)
    const params = new URLSearchParams({
      query: q,
      display: String(displayCount),
      start: '1',
      sort: 'sim', // sim: 정확도순 (= 네이버 상위 노출 순서에 가까움)
    });

    const response = await fetch(
      `https://openapi.naver.com/v1/search/blog?${params.toString()}`,
      {
        method: 'GET',
        headers: {
          'X-Naver-Client-Id': CLIENT_ID,
          'X-Naver-Client-Secret': CLIENT_SECRET,
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Naver Blog API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();

    // HTML 태그 제거 함수
    const stripHtml = (str) => str.replace(/<[^>]*>/g, '').trim();

    // 상위 블로그 제목/설명 정리
    const titles = (data.items || []).map((item, index) => ({
      rank: index + 1,
      title: stripHtml(item.title),
      description: stripHtml(item.description).slice(0, 100),
      bloggerName: item.bloggername,
      postdate: item.postdate,
      link: item.link,
    }));

    return res.status(200).json({
      success: true,
      query: q,
      total: data.total,
      displayed: titles.length,
      titles: titles,
    });

  } catch (error) {
    console.error('Blog titles API error:', error);
    return res.status(500).json({
      error: 'Failed to fetch blog titles',
      message: error.message,
    });
  }
}
