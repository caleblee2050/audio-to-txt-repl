import { useEffect, useRef, useState } from 'react'
import { Mic, Square, Brain, MessageSquare, Folder, CheckCircle2, AlertCircle } from 'lucide-react'
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
  const isRecordingRef = useRef(false)
  const [transcript, setTranscript] = useState('')
  const [formatId, setFormatId] = useState<FormatId>('summary')
  const [composedText, setComposedText] = useState('')
  const [phoneNumber, setPhoneNumber] = useState('')
  const [savedDocs, setSavedDocs] = useState<SavedDoc[]>([])
  const [twilioEnabled, setTwilioEnabled] = useState<boolean | null>(null)
  const [geminiEnabled, setGeminiEnabled] = useState<boolean | null>(null)
  const [instruction, setInstruction] = useState('')
  const [activeTab, setActiveTab] = useState<'record' | 'compose' | 'sms' | 'saved'>('record')
  const recognitionRef = useRef<any>(null)
  const recordRef = useRef<HTMLDivElement | null>(null)
  const composeRef = useRef<HTMLDivElement | null>(null)
  const smsRef = useRef<HTMLDivElement | null>(null)
  const savedRef = useRef<HTMLDivElement | null>(null)
  const API_BASE = (import.meta.env.VITE_API_BASE as string) || window.location.origin

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
        const resp = await fetch(`${API_BASE}/api/health`)
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

  // 라이트 모드 제거: 기본 다크 모드 고정
  useEffect(() => {
    document.documentElement.dataset.theme = ''
  }, [])

  const scrollTo = (ref: React.RefObject<HTMLDivElement>, tab: 'record' | 'compose' | 'sms' | 'saved') => {
    try {
      ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      setActiveTab(tab)
    } catch {}
  }

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
    isRecordingRef.current = true

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
      if (isRecordingRef.current) {
        try {
          recognition.start()
        } catch {
          setTimeout(() => {
            if (isRecordingRef.current) {
              try { recognition.start() } catch {}
            }
          }, 500)
        }
      } else {
        setIsRecording(false)
        recognitionRef.current = null
      }
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
    isRecordingRef.current = false
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
      const resp = await fetch(`${API_BASE}/api/compose`, {
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
      const resp = await fetch(`${API_BASE}/api/sms/send`, {
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
    <>
      <header className="topbar">
        <div className="topbar-inner container">
          <div className="brand" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Mic size={18} />
            Audio → Text Composer
          </div>
          <span className="subtitle">스마트폰 최적화 · 실시간 음성 정리</span>
          <span className="grow" />
          {geminiEnabled === true && (
            <span className="badge success" aria-label="Gemini 준비 완료">
              <CheckCircle2 size={14} /> Gemini OK
            </span>
          )}
          {geminiEnabled === false && (
            <span className="badge danger" aria-label="Gemini 설정 필요">
              <AlertCircle size={14} /> Gemini 설정 필요
            </span>
          )}
          {twilioEnabled === true && (
            <span className="badge success" aria-label="Twilio 준비 완료">
              <CheckCircle2 size={14} /> Twilio OK
            </span>
          )}
          {twilioEnabled === false && (
            <span className="badge danger" aria-label="Twilio 설정 필요">
              <AlertCircle size={14} /> Twilio 설정 필요
            </span>
          )}
        </div>
      </header>

      <main className="container main">
        <h1 className="app-title">음성→텍스트 정리 및 문자 발송</h1>

        <section ref={recordRef} className="section" id="record">
          <h2 className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Mic size={18} /> 1) 음성 인식 (정지까지 연속 기록)
          </h2>
          <div className="controls">
            <button
              aria-label="녹음 토글"
              title={isRecording ? '정지' : '녹음 시작'}
              onClick={() => (isRecording ? stopRecording() : startRecording())}
              className={`icon-btn ${isRecording ? 'recording' : ''}`}
            >
              {isRecording ? <Square size={28} /> : <Mic size={28} />}
            </button>
            <button className="btn" onClick={clearTranscript}>초기화</button>
          </div>
          <textarea
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            placeholder="여기에 음성 인식 결과가 실시간으로 누적됩니다."
            className="textarea-md mt-8"
          />
        </section>

        <section ref={composeRef} className="section" id="compose">
          <h2 className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Brain size={18} /> 2) 문서 형식 선택 및 작성
          </h2>
          <div className="controls">
            <label className="grow">
              형식
              <select value={formatId} onChange={(e) => setFormatId(e.target.value as FormatId)} className="mt-8">
                {formatOptions.map(f => (
                  <option key={f.id} value={f.id}>{f.label}</option>
                ))}
              </select>
            </label>
            <button className="btn btn-primary" onClick={composeWithGemini} disabled={geminiEnabled === false}>지침대로 문서 작성</button>
          </div>
          <p className="help">
            {geminiEnabled === null && (<><AlertCircle size={14} /> 서버 연결 상태를 확인 중입니다.</>)}
            {geminiEnabled === false && (<><AlertCircle size={14} /> 서버에 Gemini 설정이 없습니다(.env에 GOOGLE_API_KEY 설정).</>)}
            {geminiEnabled === true && (<><CheckCircle2 size={14} /> Gemini 설정이 감지되었습니다. 문서 작성이 가능합니다.</>)}
          </p>
          <textarea
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder="수정 요청/추가 지침을 입력하세요 (예: 300자 이내 요약, 공손한 어조로 재작성 등)"
            className="textarea-sm mt-8"
          />
          <textarea
            value={composedText}
            onChange={(e) => setComposedText(e.target.value)}
            placeholder="선택한 형식과 숨은 프롬프트에 따라 생성된 문서를 편집할 수 있습니다."
            className="textarea-lg mt-8"
          />
          <div className="controls mt-8">
            <button className="btn" onClick={saveDocument}>저장</button>
            <button className="btn btn-outline" onClick={() => setComposedText('')}>삭제(편집중인 문서)</button>
          </div>
        </section>

        <section ref={smsRef} className="section" id="sms">
          <h2 className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <MessageSquare size={18} /> 3) 문자(SMS) 발송
          </h2>
          <div className="controls">
            <input
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              placeholder="수신자 번호(+82...)"
              type="tel"
              inputMode="tel"
              pattern="[0-9+\-() ]*"
              className="grow"
            />
            <button className="btn btn-primary" onClick={sendSMS} disabled={twilioEnabled === false}>문자 발송(Twilio)</button>
            <button className="btn" onClick={openSmsApp}>휴대폰 문자앱으로 열기</button>
          </div>
          <p className="help">
            {twilioEnabled === null && (<><AlertCircle size={14} /> 서버 연결 상태를 확인 중입니다.</>)}
            {twilioEnabled === false && (<><AlertCircle size={14} /> 서버에 Twilio 설정이 없습니다(.env 설정 필요).</>)}
            {twilioEnabled === true && (<><CheckCircle2 size={14} /> Twilio 설정이 감지되었습니다. 문자 발송이 가능합니다.</>)}
          </p>
        </section>

        <section ref={savedRef} className="section" id="saved">
          <h2 className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Folder size={18} /> 저장된 문서
          </h2>
          {savedDocs.length === 0 ? (
            <div className="empty-state">
              <Folder size={16} /> 저장된 문서가 없습니다. 문서를 작성 후 저장해 보세요.
            </div>
          ) : (
            <ul className="list">
              {savedDocs.map(doc => (
                <li key={doc.id} className="list-item">
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <strong>[{formatOptions.find(f => f.id === doc.formatId)?.label}]</strong>
                    <span className="help">{new Date(doc.createdAt).toLocaleString()} — {doc.title}</span>
                  </div>
                  <div className="list-actions">
                    <button className="btn" onClick={() => loadDocument(doc.id)}>불러와 편집</button>
                    <button className="btn btn-outline" onClick={() => deleteDocument(doc.id)}>삭제</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
      <nav className="bottom-nav">
        <div className="nav-inner container">
          <button
            className={`tab-btn ${activeTab === 'record' ? 'active' : ''}`}
            onClick={() => scrollTo(recordRef, 'record')}
            aria-label="녹음 섹션으로 이동"
          >
            <Mic size={18} />
            <span className="tab-label">녹음</span>
          </button>
          <button
            className={`tab-btn ${activeTab === 'compose' ? 'active' : ''}`}
            onClick={() => scrollTo(composeRef, 'compose')}
            aria-label="문서 섹션으로 이동"
          >
            <Brain size={18} />
            <span className="tab-label">문서</span>
          </button>
          <button
            className={`tab-btn ${activeTab === 'sms' ? 'active' : ''}`}
            onClick={() => scrollTo(smsRef, 'sms')}
            aria-label="문자 섹션으로 이동"
          >
            <MessageSquare size={18} />
            <span className="tab-label">문자</span>
          </button>
          <button
            className={`tab-btn ${activeTab === 'saved' ? 'active' : ''}`}
            onClick={() => scrollTo(savedRef, 'saved')}
            aria-label="저장 문서 섹션으로 이동"
          >
            <Folder size={18} />
            <span className="tab-label">저장</span>
          </button>
        </div>
      </nav>
    </>
  )
}

export default App
