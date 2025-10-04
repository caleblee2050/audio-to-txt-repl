import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import twilio from 'twilio';
// GoogleGenerativeAI SDK 사용 시 버전/모델 불일치로 오류가 발생하여
// 안정적인 REST 호출로 변경합니다.

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_FROM, GOOGLE_API_KEY } = process.env;

let twilioClient = null;
if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN) {
  twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, twilioConfigured: !!twilioClient, geminiConfigured: !!GOOGLE_API_KEY });
});

app.post('/api/sms/send', async (req, res) => {
  try {
    if (!twilioClient) {
      return res.status(500).json({ error: 'Twilio is not configured' });
    }

    const { to, message } = req.body;
    if (!to || !message) {
      return res.status(400).json({ error: 'Missing "to" or "message"' });
    }

    const resp = await twilioClient.messages.create({
      from: TWILIO_PHONE_FROM,
      to,
      body: message,
    });

    res.json({ sid: resp.sid, status: resp.status });
  } catch (err) {
    console.error('SMS send error:', err);
    res.status(500).json({ error: 'Failed to send SMS', details: String(err?.message || err) });
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
app.listen(PORT, () => {
  console.log(`API server running at http://localhost:${PORT}`);
});