import { useEffect, useRef, useState } from 'react'
import { Mic, Square, Brain, Folder, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react'
import './App.css'

type FormatId = 'official' | 'minutes' | 'summary' | 'blog'

const formatOptions: { id: FormatId; label: string }[] = [
  { id: 'official', label: '공문 작성' },
  { id: 'minutes', label: '회의록' },
  { id: 'summary', label: '요약문' },
  { id: 'blog', label: '블로그 글' },
]

type SavedDoc = { id: string; title: string; content: string; createdAt: number; formatId: FormatId }

function App() {
  const [isRecording, setIsRecording] = useState(false)
  const [transcript, setTranscript] = useState('') // 통합: 녹음 내용 및 수정된 내용
  const [formatId, setFormatId] = useState<FormatId>('summary')
  const [composedText, setComposedText] = useState('') // 최종 문서
  const [savedDocs, setSavedDocs] = useState<SavedDoc[]>([])
  const [geminiEnabled, setGeminiEnabled] = useState<boolean | null>(null)
  const [instruction, setInstruction] = useState('')
  const [activeTab, setActiveTab] = useState<'record' | 'compose' | 'saved'>('record')
  const [isComposing, setIsComposing] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)

  // 음성 지시 녹음 상태
  const [isRecordingInstruction, setIsRecordingInstruction] = useState(false)
  const [isProcessingInstruction, setIsProcessingInstruction] = useState(false)
  const [isEditingTranscript, setIsEditingTranscript] = useState(false) // 내용 수정 중

  // 녹음 시간 및 오디오 정보
  const [recordingDuration, setRecordingDuration] = useState(0)
  const [lastAudioSize, setLastAudioSize] = useState(0)
  const recordingStartTimeRef = useRef<number>(0)
  const recordingTimerRef = useRef<number | null>(null)
  const chunkIntervalRef = useRef<number | null>(null) // 1분마다 청크 전송용
  const lastProcessedChunkIndexRef = useRef<number>(0) // 마지막으로 처리한 청크 인덱스

  const recordRef = useRef<HTMLDivElement | null>(null)
  const composeRef = useRef<HTMLDivElement | null>(null)
  const savedRef = useRef<HTMLDivElement | null>(null)
  const wakeLockRef = useRef<any>(null)

  // 메인 녹음용 MediaRecorder
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const audioChunksRef = useRef<Blob[]>([])

  // 음성 지시용 MediaRecorder
  const instructionRecorderRef = useRef<MediaRecorder | null>(null)
  const instructionStreamRef = useRef<MediaStream | null>(null)
  const instructionChunksRef = useRef<Blob[]>([])

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
        setGeminiEnabled(!!data?.geminiConfigured)
      } catch {
        setGeminiEnabled(null)
      }
    }
    checkHealth()
  }, [])

  // 라이트 모드 제거: 기본 다크 모드 고정
  useEffect(() => {
    document.documentElement.dataset.theme = ''
  }, [])

  const scrollTo = (ref: React.RefObject<HTMLDivElement | null>, tab: 'record' | 'compose' | 'saved') => {
    try {
      ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      setActiveTab(tab)
    } catch {}
  }

  // 컴포넌트 언마운트 시 녹음 강제 종료
  useEffect(() => {
    return () => {
      try {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
          mediaRecorderRef.current.stop()
        }
        if (mediaStreamRef.current) {
          mediaStreamRef.current.getTracks().forEach(t => t.stop())
        }
        awaitWakeRelease()
      } catch {}
    }
  }, [])

  const acquireWakeLock = async () => {
    try {
      const navAny = navigator as any
      if (navAny?.wakeLock && !wakeLockRef.current) {
        const sentinel = await navAny.wakeLock.request('screen')
        wakeLockRef.current = sentinel
        sentinel.addEventListener?.('release', () => { wakeLockRef.current = null })
      }
    } catch (e) {
      console.warn('wakeLock request failed:', e)
    }
  }

  const awaitWakeRelease = async () => {
    try { await wakeLockRef.current?.release?.() } catch {}
    wakeLockRef.current = null
  }

  // 통합 녹음: 로컬에 전체 녹음 후 종료 시 STT 처리
  const startRecording = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      alert('브라우저가 오디오 녹음을 지원하지 않습니다.')
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      mediaStreamRef.current = stream

      // MIME 타입 감지
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/mp4')
        ? 'audio/mp4'
        : 'audio/webm'

      const recorder = new MediaRecorder(stream, { mimeType })
      mediaRecorderRef.current = recorder
      audioChunksRef.current = []
      lastProcessedChunkIndexRef.current = 0 // 초기화

      // 녹음 시간 타이머 시작
      recordingStartTimeRef.current = Date.now()
      setRecordingDuration(0)
      recordingTimerRef.current = window.setInterval(() => {
        const elapsed = Math.floor((Date.now() - recordingStartTimeRef.current) / 1000)
        setRecordingDuration(elapsed)
      }, 1000)

      recorder.ondataavailable = async (event) => {
        if (event.data.size > 0) {
          // 모든 청크를 누적 저장
          audioChunksRef.current.push(event.data)
          const currentIndex = audioChunksRef.current.length
          console.log(`[녹음] 청크 저장: ${event.data.size} bytes (총 ${currentIndex}개)`)

          // 녹음 중일 때만 새로운 청크들을 STT 처리
          if (recorder.state === 'recording') {
            // 아직 처리하지 않은 새 청크들만 추출
            const newChunks = audioChunksRef.current.slice(lastProcessedChunkIndexRef.current)
            const newAudioBlob = new Blob(newChunks, { type: mimeType })
            const newSizeKB = newAudioBlob.size / 1024
            const newSizeMB = (newAudioBlob.size / 1024 / 1024).toFixed(2)

            console.log(`[청크 STT] 새 청크 ${lastProcessedChunkIndexRef.current + 1}~${currentIndex}: ${newSizeMB} MB`)

            // 무음 감지: 새 청크가 너무 작으면 건너뜀
            if (newSizeKB < 5) {
              console.log(`[청크 STT] 무음 감지로 건너뜀`)
              lastProcessedChunkIndexRef.current = currentIndex // 다음번을 위해 업데이트
              return
            }

            // 마지막 처리 위치 업데이트
            lastProcessedChunkIndexRef.current = currentIndex

            // 백그라운드로 STT 처리 (녹음 방해 안 함)
            processAudioToText(newAudioBlob, mimeType, 30, true).catch(err => {
              console.error('[청크 STT] 처리 실패:', err)
            })
          }
        }
      }

      recorder.onstop = async () => {
        // 청크 인터벌 정지
        if (chunkIntervalRef.current) {
          clearInterval(chunkIntervalRef.current)
          chunkIntervalRef.current = null
        }

        // 타이머 정지
        if (recordingTimerRef.current) {
          clearInterval(recordingTimerRef.current)
          recordingTimerRef.current = null
        }

        console.log('[녹음] 완료, 마지막 청크 STT 처리...')

        // 마지막 남은 청크 처리
        if (audioChunksRef.current.length > 0) {
          const finalChunk = new Blob(audioChunksRef.current, { type: mimeType })
          const finalSizeMB = (finalChunk.size / 1024 / 1024).toFixed(2)
          const finalDuration = Math.floor((Date.now() - recordingStartTimeRef.current) / 1000) % 30 || 30
          console.log(`[마지막 청크] 크기: ${finalSizeMB} MB, ${finalDuration}초`)

          setLastAudioSize(finalChunk.size)
          // 마지막 청크도 자동 청크처럼 처리 (빈 결과 시 alert 안 띄움)
          await processAudioToText(finalChunk, mimeType, finalDuration, true)
        }

        // 리소스 정리
        if (mediaStreamRef.current) {
          mediaStreamRef.current.getTracks().forEach(track => track.stop())
          mediaStreamRef.current = null
        }
        audioChunksRef.current = []
      }

      // 녹음 시작 (30초마다 ondataavailable 호출)
      recorder.start(30000) // 30초 (파일 크기 제한 안전 마진)
      setIsRecording(true)
      acquireWakeLock()
      console.log(`[녹음] 시작: ${mimeType}, 30초마다 자동 STT 처리`)
    } catch (err) {
      console.error('[녹음] 시작 실패:', err)
      alert('마이크 권한을 허용해 주세요.')
    }
  }

  const stopRecording = () => {
    console.log('[녹음] 정지 요청')

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        mediaRecorderRef.current.stop()
      } catch (err) {
        console.error('[녹음] 정지 실패:', err)
      }
    }

    setIsRecording(false)
    awaitWakeRelease()
  }

  const processAudioToText = async (audioBlob: Blob, mimeType: string, durationSeconds: number, isAutoChunk = false) => {
    if (!isAutoChunk) {
      setIsProcessing(true)
    }
    try {
      const audioSizeMB = (audioBlob.size / 1024 / 1024).toFixed(2)
      console.log(`[STT] 오디오 크기: ${audioSizeMB} MB, 실제 길이: ${durationSeconds}초`)

      const reader = new FileReader()
      reader.onloadend = async () => {
        const base64 = (reader.result as string).split(',')[1]
        console.log(`[STT] 전송 시작: ${base64?.length || 0} chars (${audioSizeMB} MB, ${durationSeconds}초)`)

        try {
          const resp = await fetch(`${API_BASE}/api/stt/recognize-chunk`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ audioData: base64, mimeType, durationSeconds }),
          })
          const data = await resp.json()

          console.log('[STT] 응답:', data)

          if (!resp.ok) {
            // 서버 에러 처리
            console.error('[STT] 서버 에러:', data)
            if (!isAutoChunk) {
              if (resp.status === 413) {
                alert(data.details || '오디오 파일이 너무 큽니다. 10분 이내로 녹음해 주세요.')
              } else {
                alert(data.details || '음성 변환 중 오류가 발생했습니다.')
              }
            }
            return
          }

          if (data.text) {
            setTranscript(prev => prev ? prev + '\n' + data.text : data.text)
            console.log(`[STT] 성공: ${data.text.length} chars`)
          } else {
            console.warn('[STT] 빈 응답 (오디오 크기:', audioSizeMB, 'MB,', durationSeconds, '초)')
            // 자동 청크 처리일 때는 alert 안 띄움 (녹음 중 방해하지 않음)
            if (!isAutoChunk) {
              alert('음성이 인식되지 않았습니다. 명확하게 말씀해 주시거나, 녹음 시간을 줄여 주세요.')
            }
          }
        } catch (err) {
          console.error('[STT] 전송 실패:', err)
          if (!isAutoChunk) {
            alert('음성 변환 중 네트워크 오류가 발생했습니다.')
          }
        } finally {
          if (!isAutoChunk) {
            setIsProcessing(false)
          }
        }
      }
      reader.readAsDataURL(audioBlob)
    } catch (err) {
      console.error('[STT] 처리 실패:', err)
      setIsProcessing(false)
      alert('음성 처리 중 오류가 발생했습니다.')
    }
  }


  const clearTranscript = () => {
    setTranscript('')
  }

  // 음성 지시 녹음 시작
  const startRecordingInstruction = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      alert('브라우저가 오디오 녹음을 지원하지 않습니다.')
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      instructionStreamRef.current = stream

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/mp4')
        ? 'audio/mp4'
        : 'audio/webm'

      const recorder = new MediaRecorder(stream, { mimeType })
      instructionRecorderRef.current = recorder
      instructionChunksRef.current = []

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          instructionChunksRef.current.push(event.data)
          console.log(`[음성지시] 청크 저장: ${event.data.size} bytes`)
        }
      }

      recorder.onstop = async () => {
        console.log('[음성지시] 완료, STT 처리 시작...')
        const audioBlob = new Blob(instructionChunksRef.current, { type: mimeType })
        console.log(`[음성지시] 총 크기: ${audioBlob.size} bytes`)

        // STT 처리 후 instruction 필드에 추가
        await processInstructionToText(audioBlob, mimeType)

        // 리소스 정리
        if (instructionStreamRef.current) {
          instructionStreamRef.current.getTracks().forEach(track => track.stop())
          instructionStreamRef.current = null
        }
        instructionChunksRef.current = []
      }

      recorder.start()
      setIsRecordingInstruction(true)
      console.log(`[음성지시] 녹음 시작: ${mimeType}`)
    } catch (err) {
      console.error('[음성지시] 시작 실패:', err)
      alert('마이크 권한을 허용해 주세요.')
    }
  }

  // 음성 지시 녹음 정지
  const stopRecordingInstruction = () => {
    console.log('[음성지시] 정지 요청')

    if (instructionRecorderRef.current && instructionRecorderRef.current.state !== 'inactive') {
      try {
        instructionRecorderRef.current.stop()
      } catch (err) {
        console.error('[음성지시] 정지 실패:', err)
      }
    }

    setIsRecordingInstruction(false)
  }

  // 음성 지시 → 텍스트 변환 후 instruction 필드에 추가
  const processInstructionToText = async (audioBlob: Blob, mimeType: string) => {
    setIsProcessingInstruction(true)
    try {
      const reader = new FileReader()
      reader.onloadend = async () => {
        const base64 = (reader.result as string).split(',')[1]
        console.log(`[음성지시 STT] 전송 시작: ${base64?.length || 0} chars`)

        try {
          const resp = await fetch(`${API_BASE}/api/stt/recognize-chunk`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ audioData: base64, mimeType }),
          })
          const data = await resp.json()

          console.log('[음성지시 STT] 응답:', data)

          if (!resp.ok) {
            console.error('[음성지시 STT] 서버 에러:', data)
            alert(data.details || '음성 변환 중 오류가 발생했습니다.')
            return
          }

          if (data.text) {
            // instruction 필드에 추가 (기존 내용 유지)
            setInstruction(prev => prev ? prev + ' ' + data.text : data.text)
            console.log(`[음성지시 STT] 성공: ${data.text.length} chars`)
          } else {
            alert('음성이 인식되지 않았습니다. 명확하게 말씀해 주세요.')
          }
        } catch (err) {
          console.error('[음성지시 STT] 전송 실패:', err)
          alert('음성 변환 중 네트워크 오류가 발생했습니다.')
        } finally {
          setIsProcessingInstruction(false)
        }
      }
      reader.readAsDataURL(audioBlob)
    } catch (err) {
      console.error('[음성지시 STT] 처리 실패:', err)
      setIsProcessingInstruction(false)
      alert('음성 처리 중 오류가 발생했습니다.')
    }
  }

  // 내용 수정 (음성/텍스트 지시 반영) → 같은 창에 업데이트
  const editTranscriptWithAI = async () => {
    if (geminiEnabled === false) {
      alert('서버에 Gemini 설정이 없습니다(.env에 GOOGLE_API_KEY 설정 필요).')
      return
    }
    if (!transcript.trim()) {
      alert('먼저 음성을 녹음하여 텍스트를 생성해 주세요.')
      return
    }
    if (!instruction.trim()) {
      alert('수정 지시사항을 입력해 주세요.')
      return
    }

    try {
      setIsEditingTranscript(true)
      const resp = await fetch(`${API_BASE}/api/compose`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transcript,
          formatId: 'summary', // 수정은 요약 모드 사용
          instruction: instruction.trim()
        }),
      })
      const data = await resp.json()
      if (!resp.ok) throw new Error(data?.error || 'Edit failed')
      // 수정된 내용을 같은 창에 업데이트
      setTranscript(data.text || '')
      setInstruction('') // 지시사항 초기화
    } catch (err: any) {
      alert('수정 중 오류: ' + (err?.message || String(err)))
    } finally {
      setIsEditingTranscript(false)
    }
  }

  // 최종 문서 작성
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
      setIsComposing(true)
      const resp = await fetch(`${API_BASE}/api/compose`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transcript,
          formatId,
          instruction: '' // 최종 문서는 형식만 적용
        }),
      })
      const data = await resp.json()
      if (!resp.ok) throw new Error(data?.error || 'Compose failed')
      setComposedText(data.text || '')
    } catch (err: any) {
      alert('문서 생성 중 오류: ' + (err?.message || String(err)))
    } finally {
      setIsComposing(false)
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

  const copyDocument = async (id: string) => {
    const doc = savedDocs.find(d => d.id === id)
    if (!doc) return
    try {
      await navigator.clipboard.writeText(doc.content)
      alert('문서 내용이 클립보드에 복사되었습니다.')
    } catch (e: any) {
      alert('복사 실패: ' + (e?.message || String(e)))
    }
  }

  // (문자 발송 기능 제거됨)

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner container">
          <div className="brand" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Mic size={18} />
            Audio → Text Composer
            <span style={{ fontSize: 11, opacity: 0.6, marginLeft: 4 }}>v1.4.1</span>
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
        </div>
      </header>

      <main className="container main">
        <h1 className="app-title">음성→텍스트 정리 및 문서화</h1>

        <section ref={recordRef} className="section" id="record">
          <h2 className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Mic size={18} /> 1) 음성 녹음 및 내용 수정
          </h2>

          {/* 녹음 컨트롤 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <button
                aria-label="녹음 토글"
                title={isRecording ? '정지' : '녹음 시작'}
                onClick={() => (isRecording ? stopRecording() : startRecording())}
                className={`icon-btn ${isRecording ? 'recording' : ''}`}
                style={{ flexShrink: 0 }}
              >
                {isRecording ? <Square size={28} /> : <Mic size={28} />}
              </button>
              <button className="btn" onClick={clearTranscript} style={{ flexShrink: 0 }}>초기화</button>
            </div>

            {isRecording && (
              <p className="help" style={{ margin: 0, fontSize: 15, fontWeight: 600, color: '#d32f2f' }}>
                <CheckCircle2 size={16} /> 녹음 중: {Math.floor(recordingDuration / 60)}:{(recordingDuration % 60).toString().padStart(2, '0')}
              </p>
            )}
            {isProcessing && (
              <p className="help" style={{ margin: 0 }}>
                <Loader2 size={16} /> 음성을 텍스트로 변환 중입니다. 긴 오디오는 처리에 시간이 걸릴 수 있습니다...
              </p>
            )}
            {!isRecording && !isProcessing && (
              <p className="help" style={{ margin: 0 }}>
                <Mic size={16} /> 녹음 버튼을 눌러 녹음을 시작하고, 정지 버튼으로 종료합니다. 종료 후 자동으로 아래에 텍스트로 변환됩니다.
              </p>
            )}
          </div>

          {/* 통합 편집창: 녹음 내용 + 직접 수정 */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
              <label style={{ fontWeight: 600, fontSize: 15, margin: 0 }}>
                녹음 내용 (직접 수정 가능)
              </label>
              <div style={{ fontSize: 13, color: '#666', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                {transcript && (
                  <span>
                    📝 {transcript.length}자
                    {transcript.length >= 2000 && ' (2000자 이상)'}
                    {transcript.length >= 1000 && transcript.length < 2000 && ' (1000자 이상)'}
                    {transcript.length >= 500 && transcript.length < 1000 && ' (500자 이상)'}
                    {transcript.length >= 300 && transcript.length < 500 && ' (300자 이상)'}
                  </span>
                )}
                {lastAudioSize > 0 && (
                  <span>
                    🎤 {lastAudioSize >= 1024 * 1024
                      ? `${(lastAudioSize / 1024 / 1024).toFixed(2)} MB`
                      : `${(lastAudioSize / 1024).toFixed(1)} KB`}
                  </span>
                )}
              </div>
            </div>
            <textarea
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              placeholder="녹음한 내용이 여기에 표시됩니다. 직접 수정하거나 아래 AI 수정 기능을 사용하세요."
              className="textarea-lg"
              disabled={isProcessing}
              style={{
                fontSize: 16,
                lineHeight: 1.6,
                color: '#000',
                backgroundColor: '#fff'
              }}
            />
          </div>

          {/* AI 수정 지시 (음성/텍스트) */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', marginBottom: 8, fontWeight: 600, fontSize: 15 }}>
              AI 수정 지시
              <button
                aria-label="음성으로 지시"
                title={isRecordingInstruction ? '음성 지시 정지' : '음성으로 지시'}
                onClick={() => (isRecordingInstruction ? stopRecordingInstruction() : startRecordingInstruction())}
                className={`icon-btn ${isRecordingInstruction ? 'recording' : ''}`}
                disabled={isProcessingInstruction}
                style={{
                  marginLeft: 12,
                  width: 44,
                  height: 44,
                  minWidth: 44,
                  verticalAlign: 'middle',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                {isRecordingInstruction ? <Square size={24} /> : <Mic size={24} />}
              </button>
            </label>
            <textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder="수정 지시를 입력하거나 위 🎤 버튼을 눌러 음성으로 지시하세요. 예: '오타 수정해줘', '300자로 요약해줘'"
              className="textarea-sm"
              disabled={isProcessingInstruction}
              style={{ fontSize: 15 }}
            />
            {isRecordingInstruction && (
              <p className="help" style={{ marginTop: 8 }}>
                <CheckCircle2 size={16} /> 음성 지시를 녹음 중입니다. 정지 버튼을 눌러 녹음을 종료하세요.
              </p>
            )}
            {isProcessingInstruction && (
              <p className="help" style={{ marginTop: 8 }}>
                <Loader2 size={16} /> 음성을 텍스트로 변환 중입니다...
              </p>
            )}
            {isEditingTranscript && (
              <p className="help" style={{ marginTop: 8 }}>
                <Loader2 size={16} /> AI가 내용을 수정하고 있습니다...
              </p>
            )}
          </div>

          {/* AI 수정 실행 버튼 */}
          {instruction.trim() && (
            <div className="controls" style={{ marginBottom: 24 }}>
              <button
                className="btn btn-primary"
                onClick={editTranscriptWithAI}
                disabled={geminiEnabled === false || isEditingTranscript || !transcript.trim()}
                aria-busy={isEditingTranscript}
                style={{ fontSize: 15, padding: '12px 24px' }}
              >
                {isEditingTranscript ? (<><Loader2 size={18} /> 수정 중...</>) : '✨ AI로 수정 적용'}
              </button>
            </div>
          )}

        </section>

        <section ref={composeRef} className="section" id="compose">
          <h2 className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Brain size={18} /> 2) 최종 문서 작성
          </h2>
          <p className="help" style={{ marginBottom: 16, fontSize: 14 }}>
            {geminiEnabled === null && (<><AlertCircle size={16} /> 서버 연결 상태를 확인 중입니다.</>)}
            {geminiEnabled === false && (<><AlertCircle size={16} /> 서버에 Gemini 설정이 없습니다(.env에 GOOGLE_API_KEY 설정).</>)}
            {geminiEnabled === true && (<><CheckCircle2 size={16} /> 위 내용을 기반으로 선택한 형식의 문서를 작성합니다.</>)}
          </p>

          <div className="controls" style={{ marginBottom: 16 }}>
            <label className="grow">
              <span style={{ fontSize: 15, fontWeight: 600 }}>문서 형식</span>
              <select value={formatId} onChange={(e) => setFormatId(e.target.value as FormatId)} className="mt-8" style={{ fontSize: 15 }}>
                {formatOptions.map(f => (
                  <option key={f.id} value={f.id}>{f.label}</option>
                ))}
              </select>
            </label>
            <button
              className="btn btn-primary"
              onClick={composeWithGemini}
              disabled={geminiEnabled === false || isComposing || !transcript.trim()}
              aria-busy={isComposing}
              style={{ fontSize: 15, padding: '12px 24px' }}
            >
              {isComposing ? (<><Loader2 size={18} /> 작성 중...</>) : '📄 문서 작성'}
            </button>
          </div>

          <textarea
            value={composedText}
            onChange={(e) => setComposedText(e.target.value)}
            placeholder="선택한 형식에 맞춰 생성된 최종 문서가 여기에 표시됩니다."
            className="textarea-lg"
            style={{
              fontSize: 16,
              lineHeight: 1.6,
              color: '#000'
            }}
          />
          <div className="controls mt-8">
            <button className="btn" onClick={saveDocument} style={{ fontSize: 15 }}>저장</button>
            <button className="btn btn-outline" onClick={() => setComposedText('')} style={{ fontSize: 15 }}>삭제</button>
          </div>
        </section>

        {/* STT/퍼지 교정 섹션 제거됨 */}

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
                    <button className="btn" onClick={() => copyDocument(doc.id)}>복사</button>
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
          {/* STT 탭 제거됨 */}
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
