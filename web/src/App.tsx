import { useEffect, useRef, useState } from 'react'
import './App.css'

type FormatId = 'official' | 'minutes' | 'summary' | 'blog' | 'smsNotice'

const formatOptions: { id: FormatId; label: string }[] = [
  { id: 'official', label: '공문 작성' },
  { id: 'minutes', label: '회의록' },
  { id: 'summary', label: '요약문' },
  { id: 'blog', label: '블로그 글' },
  { id: 'smsNotice', label: '문자 안내문' },
]

type SavedDoc = { id: string; title: string; content: string; createdAt: number; formatId: FormatId }

function App() {
  const [isRecording, setIsRecording] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [formatId, setFormatId] = useState<FormatId>('summary')
  const [composedText, setComposedText] = useState('')
  const [phoneNumber, setPhoneNumber] = useState('')
  const [savedDocs, setSavedDocs] = useState<SavedDoc[]>([])
  const [twilioEnabled, setTwilioEnabled] = useState<boolean | null>(null)
  const [geminiEnabled, setGeminiEnabled] = useState<boolean | null>(null)
  const [instruction, setInstruction] = useState('')
  const recognitionRef = useRef<any>(null)

  useEffect(() => {
    // 로컬 저장된 문서 불러오기
    const raw = localStorage.getItem('audioToTextDocs')
    if (raw) {
      try {
        setSavedDocs(JSON.parse(raw))
      } catch {}
    }
  }, [])

  useEffect(() => {
    localStorage.setItem('audioToTextDocs', JSON.stringify(savedDocs))
  }, [savedDocs])

  useEffect(() => {
    // 서버 헬스 체크로 Twilio 설정 여부 확인
    const checkHealth = async () => {
      try {
        const resp = await fetch('http://localhost:3001/api/health')
        const data = await resp.json()
        setTwilioEnabled(!!data?.twilioConfigured)
        setGeminiEnabled(!!data?.geminiConfigured)
      } catch {
        setTwilioEnabled(null)
        setGeminiEnabled(null)
      }
    }
    checkHealth()
  }, [])

  // 컴포넌트 언마운트 시 녹음 강제 종료(잔여 이벤트로 재시작되는 문제 예방)
  useEffect(() => {
    return () => {
      try {
        const rec = recognitionRef.current
        if (rec) rec.stop()
        recognitionRef.current = null
      } catch {}
    }
  }, [])

  const startRecording = async () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognition) {
      alert('브라우저가 음성 인식을 지원하지 않습니다. Chrome을 사용해 주세요.')
      return
    }
    if (isRecording || recognitionRef.current) return

    const recognition = new SpeechRecognition()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'ko-KR'

    let finalText = transcript
    recognition.onresult = (event: any) => {
      let interim = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        const text = result[0].transcript
        if (result.isFinal) {
          finalText += (finalText ? '\n' : '') + text.trim()
          setTranscript(finalText)
        } else {
          interim += text
        }
      }
      // 필요 시, 임시 텍스트를 화면에 표시하려면 상태로 관리 가능
    }

    recognition.onerror = (e: any) => {
      console.error('Recognition error:', e)
    }

    recognition.onend = () => {
      setIsRecording(false)
      recognitionRef.current = null
    }

    recognitionRef.current = recognition
    recognition.start()
    setIsRecording(true)
  }

  const stopRecording = () => {
    const rec = recognitionRef.current
    if (rec) {
      rec.stop()
      recognitionRef.current = null
    }
    setIsRecording(false)
  }

  const clearTranscript = () => {
    setTranscript('')
  }

  const composeWithGemini = async () => {
    if (geminiEnabled === false) {
      alert('서버에 Gemini 설정이 없습니다(.env에 GOOGLE_API_KEY 설정 필요).')
      return
    }
    if (!transcript.trim()) {
      alert('먼저 음성을 녹음하여 텍스트를 생성해 주세요.')
      return
    }
    try {
      const resp = await fetch('http://localhost:3001/api/compose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript, formatId, instruction: instruction.trim() }),
      })
      const data = await resp.json()
      if (!resp.ok) throw new Error(data?.error || 'Compose failed')
      setComposedText(data.text || '')
    } catch (err: any) {
      alert('문서 생성 중 오류: ' + (err?.message || String(err)))
    }
  }

  const saveDocument = () => {
    const content = (composedText || transcript).trim()
    if (!content) {
      alert('저장할 내용이 없습니다.')
      return
    }
    const title = formatOptions.find(f => f.id === formatId)?.label || '문서'
    const doc: SavedDoc = {
      id: Math.random().toString(36).slice(2),
      title,
      content,
      createdAt: Date.now(),
      formatId,
    }
    setSavedDocs(prev => [doc, ...prev])
  }

  const deleteDocument = (id: string) => {
    setSavedDocs(prev => prev.filter(d => d.id !== id))
  }

  const loadDocument = (id: string) => {
    const doc = savedDocs.find(d => d.id === id)
    if (doc) {
      setComposedText(doc.content)
      setFormatId(doc.formatId)
    }
  }

  const sendSMS = async () => {
    if (!twilioEnabled) {
      alert('서버에 Twilio 설정이 없습니다. .env를 설정해 주세요.')
      return
    }
    const body = (composedText || transcript).trim()
    if (!body) {
      alert('문자 내용이 없습니다. 먼저 내용을 작성해 주세요.')
      return
    }
    if (!phoneNumber.trim()) {
      alert('수신자 번호를 입력해 주세요.')
      return
    }
    try {
      const resp = await fetch('http://localhost:3001/api/sms/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: phoneNumber, message: body }),
      })
      const data = await resp.json()
      if (!resp.ok) throw new Error(data?.error || 'SMS failed')
      alert('문자 발송 완료: ' + data.sid)
    } catch (err: any) {
      alert('문자 발송 오류: ' + (err?.message || String(err)))
    }
  }

  // 휴대폰 문자앱으로 열기 (모바일에서 즉시 발송)
  const openSmsApp = () => {
    const body = (composedText || transcript).trim()
    if (!body) {
      alert('문자 내용이 없습니다. 먼저 내용을 작성해 주세요.')
      return
    }
    if (!phoneNumber.trim()) {
      alert('수신자 번호를 입력해 주세요.')
      return
    }
    const uri = `sms:${encodeURIComponent(phoneNumber)}?body=${encodeURIComponent(body)}`
    try {
      window.location.href = uri
    } catch {
      window.open(uri, '_blank')
    }
  }

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: 16 }}>
      <h1>음성→텍스트 정리 및 문자 발송</h1>

      <section style={{ marginBottom: 16, borderBottom: '1px solid #eee', paddingBottom: 12 }}>
        <h2>1) 음성 인식 (정지까지 연속 기록)</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            aria-label="녹음 토글"
            title={isRecording ? '정지' : '녹음 시작'}
            onClick={() => (isRecording ? stopRecording() : startRecording())}
            style={{
              width: 48,
              height: 48,
              borderRadius: '50%',
              fontSize: 24,
              lineHeight: '48px',
              textAlign: 'center',
              border: '1px solid #ccc',
              background: isRecording ? '#f55' : '#fff',
              color: isRecording ? '#fff' : '#333',
              cursor: 'pointer',
            }}
          >
            {isRecording ? '⏹️' : '🎙️'}
          </button>
          <button onClick={clearTranscript}>초기화</button>
        </div>
        <textarea
          value={transcript}
          onChange={(e) => setTranscript(e.target.value)}
          placeholder="여기에 음성 인식 결과가 실시간으로 누적됩니다."
          style={{ width: '100%', height: 160, marginTop: 8 }}
        />
      </section>

      <section style={{ marginBottom: 16, borderBottom: '1px solid #eee', paddingBottom: 12 }}>
        <h2>2) 문서 형식 선택 및 작성</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <label>
            형식:
            <select value={formatId} onChange={(e) => setFormatId(e.target.value as FormatId)} style={{ marginLeft: 8 }}>
              {formatOptions.map(f => (
                <option key={f.id} value={f.id}>{f.label}</option>
              ))}
            </select>
          </label>
          <button onClick={composeWithGemini} disabled={geminiEnabled === false}>지침대로 문서 작성</button>
        </div>
        <p style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
          {geminiEnabled === null && '서버 연결 상태를 확인 중입니다.'}
          {geminiEnabled === false && '서버에 Gemini 설정이 없습니다(.env에 GOOGLE_API_KEY 설정).'}
          {geminiEnabled === true && 'Gemini 설정이 감지되었습니다. 문서 작성이 가능합니다.'}
        </p>
        <textarea
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder="수정 요청/추가 지침을 입력하세요 (예: 300자 이내 요약, 공손한 어조로 재작성 등)"
          style={{ width: '100%', height: 80, marginTop: 8 }}
        />
        <textarea
          value={composedText}
          onChange={(e) => setComposedText(e.target.value)}
          placeholder="선택한 형식과 숨은 프롬프트에 따라 생성된 문서를 편집할 수 있습니다."
          style={{ width: '100%', height: 220, marginTop: 8 }}
        />
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button onClick={saveDocument}>저장</button>
          <button onClick={() => setComposedText('')}>삭제(편집중인 문서)</button>
        </div>
      </section>

      <section style={{ marginBottom: 16, borderBottom: '1px solid #eee', paddingBottom: 12 }}>
        <h2>3) 문자(SMS) 발송</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            value={phoneNumber}
            onChange={(e) => setPhoneNumber(e.target.value)}
            placeholder="수신자 번호(+82...)"
            style={{ flex: '1 1 220px' }}
          />
          <button onClick={sendSMS} disabled={twilioEnabled === false}>문자 발송(Twilio)</button>
          <button onClick={openSmsApp}>휴대폰 문자앱으로 열기</button>
        </div>
        <p style={{ fontSize: 12, color: '#666' }}>
          {twilioEnabled === null && '서버 연결 상태를 확인 중입니다.'}
          {twilioEnabled === false && '서버에 Twilio 설정이 없습니다(.env 설정 필요).'}
          {twilioEnabled === true && 'Twilio 설정이 감지되었습니다. 문자 발송이 가능합니다.'}
        </p>
      </section>

      <section>
        <h2>저장된 문서</h2>
        {savedDocs.length === 0 ? (
          <p style={{ color: '#666' }}>저장된 문서가 없습니다.</p>
        ) : (
          <ul>
            {savedDocs.map(doc => (
              <li key={doc.id} style={{ marginBottom: 8 }}>
                <strong>[{formatOptions.find(f => f.id === doc.formatId)?.label}]</strong> {new Date(doc.createdAt).toLocaleString()} — {doc.title}
                <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                  <button onClick={() => loadDocument(doc.id)}>불러와 편집</button>
                  <button onClick={() => deleteDocument(doc.id)}>삭제</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

export default App
