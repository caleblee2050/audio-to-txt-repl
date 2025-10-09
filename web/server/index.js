import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { SpeechClient } from '@google-cloud/speech';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' })); // 오디오 데이터 전송을 위해 제한 증가

const { GOOGLE_API_KEY } = process.env;
const speechClient = new SpeechClient();

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, geminiConfigured: !!GOOGLE_API_KEY });
});

// MediaRecorder 오디오 청크를 받아서 Google Cloud STT로 변환
// 요청: { audioData: base64, mimeType: 'audio/webm;codecs=opus' }
// 응답: { text: string }
app.post('/api/stt/recognize-chunk', async (req, res) => {
  try {
    const { audioData, mimeType } = req.body;
    if (!audioData) {
      return res.status(400).json({ error: 'Missing audioData' });
    }

    // Base64 디코딩
    const audioBytes = Buffer.from(audioData, 'base64');
    const audioSizeMB = (audioBytes.length / 1024 / 1024).toFixed(2);
    const audioSizeBytes = audioBytes.length;
    console.log(`[STT] 청크 수신: ${audioSizeBytes} bytes (${audioSizeMB} MB), ${mimeType}`);

    // 포맷 감지
    let encoding = 'WEBM_OPUS';
    if (mimeType?.includes('mp4')) {
      encoding = 'LINEAR16';
    }

    // 오디오 길이 추정 (대략적)
    // WEBM_OPUS: 비트레이트가 다양함 (6-20KB/sec), 보수적으로 추정
    // 평균 ~8KB/sec로 가정 (낮은 비트레이트)
    const estimatedDurationSec = encoding === 'WEBM_OPUS' ? audioSizeBytes / 8000 : audioSizeBytes / 32000;
    console.log(`[STT] 예상 길이: ${estimatedDurationSec.toFixed(1)}초 (파일 크기 ${audioSizeMB} MB)`);

    const config = {
      encoding,
      languageCode: 'ko-KR',
      audioChannelCount: 1,
      enableAutomaticPunctuation: true,
      enableWordTimeOffsets: false,
      enableWordConfidence: false,
    };

    let transcription = '';

    // 1분 이하: recognize API (빠름)
    if (estimatedDurationSec <= 60) {
      console.log(`[STT] recognize API 사용 (짧은 오디오)`);
      const request = {
        audio: { content: audioBytes },
        config: {
          ...config,
          model: 'default',  // 짧은 오디오는 default 모델
        },
      };

      const [response] = await speechClient.recognize(request);
      transcription = response.results
        ?.map(result => result.alternatives?.[0]?.transcript || '')
        .join('\n')
        .trim();
    } else {
      // 1분 초과: longRunningRecognize API (느리지만 긴 오디오 지원)
      console.log(`[STT] longRunningRecognize API 사용 (긴 오디오)`);

      // 최대 10분 제한 (비용 및 처리 시간 고려)
      if (estimatedDurationSec > 600) {
        return res.status(413).json({
          error: 'Audio too long',
          details: `오디오가 너무 깁니다 (약 ${(estimatedDurationSec / 60).toFixed(1)}분). 10분 이내로 녹음해 주세요.`
        });
      }

      const request = {
        audio: { content: audioBytes },
        config: {
          ...config,
          model: 'latest_long',  // 긴 오디오는 latest_long 모델
        },
      };

      const [operation] = await speechClient.longRunningRecognize(request);
      console.log(`[STT] 장기 작업 시작... (예상 ${estimatedDurationSec.toFixed(1)}초 오디오)`);

      // 작업 완료 대기 (최대 5분)
      const [response] = await operation.promise();

      transcription = response.results
        ?.map(result => result.alternatives?.[0]?.transcript || '')
        .join('\n')
        .trim();
    }

    if (!transcription) {
      console.warn(`[STT] 빈 결과 반환 (오디오 크기: ${audioSizeMB} MB, 예상 ${estimatedDurationSec.toFixed(1)}초)`);
    } else {
      console.log(`[STT] 결과: "${transcription.substring(0, 100)}..." (${transcription.length} chars)`);
    }

    res.json({ text: transcription || '' });
  } catch (err) {
    console.error('[STT] 오류:', err);
    const errorMsg = err?.message || String(err);
    console.error('[STT] 상세 오류:', errorMsg);
    res.status(500).json({
      error: 'STT failed',
      details: errorMsg.includes('exceeds') || errorMsg.includes('too long')
        ? '오디오가 너무 깁니다. 10분 이내로 녹음해 주세요.'
        : errorMsg
    });
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