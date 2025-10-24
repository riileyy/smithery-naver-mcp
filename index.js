// 간단한 Express 앱: /register, /mcp/:token, /health
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');
const { nanoid } = require('nanoid');

const app = express();
app.use(bodyParser.json());

// 환경변수: SUPABASE_URL, SUPABASE_ANON_KEY, SERVER_SECRET (암호화/추가검증용)
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SERVER_SECRET = process.env.SERVER_SECRET || 'change_me';

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.warn('Supabase not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY in environment.');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// 간단 헬스체크
app.get('/health', (req, res) => res.json({ ok: true }));

// 1) /register
// Body expected:
// { "displayName": "Riley", "naverClientId": "...", "naverClientSecret": "..." }
// Returns: { "mcpUrl": "https://your-vercel.app/mcp/<token>" }
app.post('/register', async (req, res) => {
  try {
    const { displayName, naverClientId, naverClientSecret } = req.body;
    if (!naverClientId || !naverClientSecret) {
      return res.status(400).json({ error: 'naverClientId and naverClientSecret required' });
    }

    // 발급 토큰 생성
    const token = nanoid(24);

    // Supabase에 저장
    const { data, error } = await supabase
      .from('users')
      .insert([{ token, display_name: displayName || null, naver_client_id: naverClientId, naver_client_secret: naverClientSecret }]);

    if (error) {
      console.error('Supabase insert error', error);
      return res.status(500).json({ error: 'db_error' });
    }

    const mcpUrl = `${req.protocol}://${req.get('host')}/mcp/${token}`;
    return res.json({ mcpUrl, token });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'server_error' });
  }
});

// 2) /mcp/:token
// 이 엔드포인트는 메신저/Smithery가 호출할 때 "질의"를 받아 네이버에 질의 후 결과를 리턴합니다.
// Query: ?q=검색어 또는 POST { q: '검색어' }
app.all('/mcp/:token', async (req, res) => {
  try {
    const token = req.params.token;
    const q = (req.method === 'GET') ? req.query.q : req.body.q;
    if (!q) return res.status(400).json({ error: 'query q is required' });

    // 토큰으로 사용자 키 조회
    const { data, error } = await supabase
      .from('users')
      .select('naver_client_id, naver_client_secret')
      .eq('token', token)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'token_not_found' });
    }

    const clientId = data.naver_client_id;
    const clientSecret = data.naver_client_secret;

    // 네이버 검색 API 예: 뉴스 검색 (원하시면 이미지/블로그 등으로 바꿀 수 있음)
    // 여기서는 Naver Search (news) 엔드포인트의 예시 사용
    const apiUrl = `https://openapi.naver.com/v1/search/news.json`;
    const resp = await axios.get(apiUrl, {
      params: { query: q, display: 5 },
      headers: {
        'X-Naver-Client-Id': clientId,
        'X-Naver-Client-Secret': clientSecret
      },
      timeout: 8000
    });

    // Smithery/메신저에 맞게 가공해서 리턴
    return res.json({ ok: true, source: 'naver', q, result: resp.data });
  } catch (err) {
    console.error('mcp error', err?.response?.data || err.message || err);
    return res.status(500).json({ error: 'mcp_server_error', detail: err?.message || err });
  }
});

// 로컬 포트용 (Vercel에서는 무시됨)
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// Export for serverless if needed
module.exports = app;
