import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
// Twilio 제거: 문자 발송 기능 삭제
// Google Cloud Speech-to-Text 클라이언트 추가
import { SpeechClient } from '@google-cloud/speech';
import stringSimilarity from 'string-similarity';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
// GoogleGenerativeAI SDK 사용 시 버전/모델 불일치로 오류가 발생하여
// 안정적인 REST 호출로 변경합니다.

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const { GOOGLE_API_KEY } = process.env;
const speechClient = new SpeechClient();

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, geminiConfigured: !!GOOGLE_API_KEY });
});

// 문자 발송 기능 삭제됨

// Google STT: Speech Adaptation을 활용한 동기 인식 엔드포인트
// 요청 형식: { gcsUri?: string, audioBase64?: string, languageCode?: string, sampleRateHertz?: number, phrases?: string[], boost?: number, encoding?: 'LINEAR16'|'WEBM_OPUS'|'FLAC' }
app.post('/api/stt/recognize', async (req, res) => {
  try {
    const {
      gcsUri,
      audioBase64,
      languageCode = 'ko-KR',
      sampleRateHertz = 16000,
      phrases = [],
      boost = 10,
      encoding = 'LINEAR16',
    } = req.body || {};

    if (!gcsUri && !audioBase64) {
      return res.status(400).json({ error: 'Provide either "gcsUri" or "audioBase64"' });
    }

    const audio = gcsUri ? { uri: gcsUri } : { content: audioBase64 };

    // Speech Adaptation 구성: phraseSets에 boost를 부여
    const adaptation = phrases.length > 0 ? {
      phraseSets: [
        {
          phrases: phrases.map(p => ({ value: p, boost })),
        },
      ],
    } : undefined;

    const config = {
      encoding,
      sampleRateHertz,
      languageCode,
      adaptation,
      // 한국어 인식 품질 향상을 위한 기본 옵션
      enableAutomaticPunctuation: true,
      model: 'latest_long',
    };

    const [response] = await speechClient.recognize({ config, audio });
    // response.results[].alternatives[0].transcript 를 합쳐 반환
    const transcripts = (response.results || []).map(r => r.alternatives?.[0]?.transcript || '').filter(Boolean);
    return res.json({ transcripts, raw: response });
  } catch (err) {
    console.error('STT recognize error:', err);
    return res.status(500).json({ error: 'Failed to recognize speech', details: String(err?.message || err) });
  }
});

// Fuzzy Matching: 이름 교정 엔드포인트
// 요청 형식: { text: string, nameList: string[], threshold?: number }
// 응답: { correctedText: string, matches: Array<{ original: string, replacement: string, rating: number }> }
app.post('/api/text/correct-names', async (req, res) => {
  try {
    const { text = '', nameList = [], threshold = 0.8 } = req.body || {};
    if (!text || !Array.isArray(nameList) || nameList.length === 0) {
      return res.status(400).json({ error: 'Missing "text" or empty "nameList"' });
    }

    const stripParticles = (word) => {
      // 간단한 조사 제거: 단어 끝의 한 글자 조사들을 최대 두 번까지 제거
      const particles = ['님', '께서', '과', '와', '은', '는', '이', '가', '을', '를'];
      let w = word;
      for (let i = 0; i < 2; i++) {
        let removed = false;
        for (const p of particles) {
          if (w.endsWith(p)) {
            w = w.slice(0, -p.length);
            removed = true;
            break;
          }
        }
        if (!removed) break;
      }
      return w;
    };

    const tokens = text.split(/\s+/);
    const matches = [];
    const corrected = tokens.map((word) => {
      const clean = stripParticles(word.replace(/[.,;:!?””"'()\[\]{}]/g, ''));
      if (!clean) return word;
      const resMatch = stringSimilarity.findBestMatch(clean, nameList);
      const best = resMatch.bestMatch;
      if (best.rating >= threshold) {
        matches.push({ original: clean, replacement: best.target, rating: best.rating });
        return word.replace(clean, best.target);
      }
      return word;
    });

    return res.json({ correctedText: corrected.join(' '), matches });
  } catch (err) {
    console.error('Fuzzy correction error:', err);
    return res.status(500).json({ error: 'Failed to correct names', details: String(err?.message || err) });
  }
});

// Gemini compose endpoint
app.post('/api/compose', async (req, res) => {
  try {
    if (!GOOGLE_API_KEY) {
      return res.status(500).json({ error: 'GOOGLE_API_KEY is not configured' });
    }

    const { transcript, formatId, instruction } = req.body || {};
    if (!transcript || !formatId) {
      return res.status(400).json({ error: 'Missing "transcript" or "formatId"' });
    }

    const prompts = {
      official: '너는 2000자 이내의 공적인 문서를 정중하게 작성하는데 탁월한 전문 작문가야. 사람들이 작성을 어려워 하는 공문서를 작성 해 주는데 탁월해.',
      minutes: '너는 회의 내용을 구조화하여 회의록을 명확하게 작성하는 전문가야. 안건, 논의 내용, 결정사항, 액션 아이템을 항목별로 정리해줘.',
      summary: '너는 긴 발화를 핵심만 간결히 요약하는 전문가야. 불필요한 중복을 제거하고 핵심 요지, 결정사항, 추후 할 일로 요약해줘.',
      blog: '너는 친근하고 이해하기 쉬운 블로그 글을 잘 쓰는 전문가야. 적절한 소제목과 리스트를 사용하고 1200자 이내로 작성해줘.',
      smsNotice: '너는 상대에게 예의 있고 간결한 문자 공지문을 작성하는 전문가야. 핵심 정보만 포함하고 300자 이내로 작성해줘.',
    };

    const titles = {
      official: '공문',
      minutes: '회의록',
      summary: '요약문',
      blog: '블로그 글',
      smsNotice: '문자 안내문',
    };

    const systemInstruction = prompts[formatId] || prompts.summary;
    const title = titles[formatId] || titles.summary;

    const userInput = `시스템 지침: ${systemInstruction}\n\n원문: \n${transcript}\n\n요청 형식: ${title}\n지침에 맞게 작성해줘.${instruction ? `\n\n추가 수정 요청: ${instruction}` : ''}`;

    // 여러 모델 후보를 순차로 시도해 버전/모델 불일치를 회피
    const candidates = [
      'gemini-2.5-flash',
      'gemini-2.5-pro',
      'gemini-1.0-pro',
    ];

    const payload = {
      contents: [
        {
          parts: [{ text: userInput }],
        },
      ],
    };

    let lastError = null;
    for (const modelName of candidates) {
      const url = `https://generativelanguage.googleapis.com/v1/models/${modelName}:generateContent?key=${GOOGLE_API_KEY}`;
      try {
        const resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await resp.json();
        if (!resp.ok) {
          lastError = data;
          console.error(`[Gemini error][${modelName}]`, data);
          continue;
        }
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        return res.json({ text, model: modelName });
      } catch (e) {
        lastError = String(e?.message || e);
        console.error(`[Gemini fetch error][${modelName}]`, e);
      }
    }

    return res.status(500).json({ error: 'Failed to compose text', details: lastError || 'Unknown error' });
  } catch (err) {
    console.error('Compose error:', err);
    res.status(500).json({ error: 'Failed to compose text', details: String(err?.message || err) });
  }
});

const PORT = process.env.PORT || 3001;

// Production: serve built frontend from /dist
try {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const distPath = path.join(__dirname, '../dist');
  app.use(express.static(distPath));
  // SPA fallback to index.html
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(distPath, 'index.html'));
  });
} catch (e) {
  // non-blocking; dist may not exist in dev
}

app.listen(PORT, () => {
  console.log(`API server running at http://localhost:${PORT}`);
});