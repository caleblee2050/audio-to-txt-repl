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
  const isRecordingRef = useRef(false)
  const [transcript, setTranscript] = useState('')
  const [formatId, setFormatId] = useState<FormatId>('summary')
  const [composedText, setComposedText] = useState('')
  const [savedDocs, setSavedDocs] = useState<SavedDoc[]>([])
  const [geminiEnabled, setGeminiEnabled] = useState<boolean | null>(null)
  const [instruction, setInstruction] = useState('')
  const [activeTab, setActiveTab] = useState<'record' | 'compose' | 'saved'>('record')
  const [isComposing, setIsComposing] = useState(false)
  const recognitionRef = useRef<any>(null)
  const recordRef = useRef<HTMLDivElement | null>(null)
  const composeRef = useRef<HTMLDivElement | null>(null)
  const savedRef = useRef<HTMLDivElement | null>(null)
  const wakeLockRef = useRef<any>(null)
  // 음성 인식 재시작 루프를 방지하기 위한 재시도 정보
  const restartInfoRef = useRef<{ count: number; last: number }>({ count: 0, last: 0 })
  // 중복 재시작 예약을 방지하기 위한 타이머 핸들
  const restartTimeoutRef = useRef<number | null>(null)
  // 말이 멈춘 이후 자동 종료 임계시간(무음 지속 시간)
  const SILENCE_RESTART_DELAY_MS = 20000 // 20초 (긴 무음 후 자동 종료)
  const silenceTimeoutRef = useRef<number | null>(null)
  const silenceWatcherRef = useRef<number | null>(null)
  const lastSpeechTsRef = useRef<number>(Date.now())
  // 마이크 스트림을 유지하고 에너지를 감지하여 무음 판단을 보완
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const gainNodeRef = useRef<GainNode | null>(null)
  const energyWatcherRef = useRef<number | null>(null)
  const recWatchRef = useRef<number | null>(null)
  const ENERGY_CHECK_INTERVAL_MS = 400
  const ENERGY_RMS_THRESHOLD = 0.008 // 말소리 존재 추정 임계값(모바일 마이크 감도 고려하여 낮춤)
  const API_BASE = (import.meta.env.VITE_API_BASE as string) || window.location.origin

  // 하이브리드 녹음: Android는 MediaRecorder, iOS는 Web Speech API
  const [useMediaRecorder, setUseMediaRecorder] = useState(false)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const CHUNK_INTERVAL_MS = 8000 // 8초마다 청크 전송 (STT 인식률 향상)
  const [debugInfo, setDebugInfo] = useState<string>('')

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

  // 플랫폼 감지: Android는 MediaRecorder, iOS는 Web Speech API
  useEffect(() => {
    const isAndroid = /Android/.test(navigator.userAgent)

    // Android Chrome에서만 MediaRecorder 사용 (끊김 없음)
    // iOS Safari는 Web Speech API 유지 (끊김 있지만 작동)
    if (isAndroid && typeof MediaRecorder !== 'undefined') {
      setUseMediaRecorder(true)
      console.log('Android 감지: MediaRecorder 모드 활성화')
    } else {
      setUseMediaRecorder(false)
      console.log('iOS 또는 기타 플랫폼: Web Speech API 모드')
    }
  }, [])

  const scrollTo = (ref: React.RefObject<HTMLDivElement | null>, tab: 'record' | 'compose' | 'saved') => {
    try {
      ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      setActiveTab(tab)
    } catch {}
  }

  // AudioContext/MediaStream 시작: 마이크 경로를 유지하고 에너지(RMS)로 발화 감지
  const startMicStream = async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) return
      if (mediaStreamRef.current) {
        try { await audioCtxRef.current?.resume?.() } catch {}
        return
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { noiseSuppression: false, echoCancellation: false, autoGainControl: false },
      })
      mediaStreamRef.current = stream
      const AC: any = (window as any).AudioContext || (window as any).webkitAudioContext
      if (!AC) return
      const ctx: AudioContext = new AC()
      audioCtxRef.current = ctx
      const src = ctx.createMediaStreamSource(stream)
      sourceNodeRef.current = src
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 2048
      analyserRef.current = analyser
      src.connect(analyser)
      // 무출력(무음) 라우팅으로 오디오 경로 유지 (일부 iOS 장치에서 필요)
      const gain = ctx.createGain()
      gain.gain.value = 0
      gainNodeRef.current = gain
      src.connect(gain)
      gain.connect(ctx.destination)

      if (energyWatcherRef.current) {
        clearInterval(energyWatcherRef.current)
        energyWatcherRef.current = null
      }
      energyWatcherRef.current = window.setInterval(() => {
        try {
          const a = analyserRef.current
          if (!a) return
          const buf = new Float32Array(a.fftSize)
          a.getFloatTimeDomainData(buf)
          let sum = 0
          for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
          const rms = Math.sqrt(sum / buf.length)
          if (rms > ENERGY_RMS_THRESHOLD) {
            lastSpeechTsRef.current = Date.now()
          }
        } catch {}
      }, ENERGY_CHECK_INTERVAL_MS)
    } catch (e) {
      console.warn('startMicStream failed:', e)
    }
  }

  const stopMicStream = () => {
    try {
      if (energyWatcherRef.current) {
        clearInterval(energyWatcherRef.current)
        energyWatcherRef.current = null
      }
      try { gainNodeRef.current?.disconnect?.() } catch {}
      try { sourceNodeRef.current?.disconnect?.() } catch {}
      try { audioCtxRef.current?.close?.() } catch {}
      audioCtxRef.current = null
      analyserRef.current = null
      gainNodeRef.current = null
      sourceNodeRef.current = null
      if (mediaStreamRef.current) {
        try { mediaStreamRef.current.getTracks().forEach(t => t.stop()) } catch {}
        mediaStreamRef.current = null
      }
    } catch (e) {
      console.warn('stopMicStream failed:', e)
    }
  }

  const startRecWatchdog = () => {
    if (recWatchRef.current) {
      clearInterval(recWatchRef.current)
      recWatchRef.current = null
    }
    recWatchRef.current = window.setInterval(() => {
      try {
        if (!isRecordingRef.current) return
        const rec = recognitionRef.current
        // 인식 객체가 사라졌고, 무음 타임아웃에 도달하지 않았다면 복구 시도
        const silenceFor = Date.now() - lastSpeechTsRef.current
        if (!rec && silenceFor < SILENCE_RESTART_DELAY_MS) {
          console.warn('Recognition missing; respawning...')
          // 간단 복구: 플래그를 내렸다가 재시작 호출
          isRecordingRef.current = false
          setIsRecording(false)
          startRecording()
        }
      } catch {}
    }, 7000)
  }

  const stopRecWatchdog = () => {
    if (recWatchRef.current) {
      clearInterval(recWatchRef.current)
      recWatchRef.current = null
    }
  }

  // 컴포넌트 언마운트 시 녹음 강제 종료(잔여 이벤트로 재시작되는 문제 예방)
  useEffect(() => {
    return () => {
      try {
        const rec = recognitionRef.current
        if (rec) rec.stop()
        recognitionRef.current = null
        try { awaitWakeRelease() } catch {}
        try { stopMicStream() } catch {}
        try { stopRecWatchdog() } catch {}
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

  // 재시작 카운터 초기화
  const resetRestartInfo = () => {
    restartInfoRef.current.count = 0
    restartInfoRef.current.last = Date.now()
    // 재시작 예약이 남아있으면 즉시 해제
    if (restartTimeoutRef.current) {
      clearTimeout(restartTimeoutRef.current)
      restartTimeoutRef.current = null
    }
    // 침묵 타이머도 클리어
    if (silenceTimeoutRef.current) {
      clearTimeout(silenceTimeoutRef.current)
      silenceTimeoutRef.current = null
    }
  }

  const clearSilenceTimeout = () => {
    if (silenceTimeoutRef.current) {
      clearTimeout(silenceTimeoutRef.current)
      silenceTimeoutRef.current = null
    }
  }

  const startSilenceWatcher = () => {
    // 주기적으로 마지막 발화 시점과 현재 시간을 비교하여 무음 20초 초과 시 자동 종료
    if (silenceWatcherRef.current) {
      clearInterval(silenceWatcherRef.current)
      silenceWatcherRef.current = null
    }
    silenceWatcherRef.current = window.setInterval(() => {
      if (!isRecordingRef.current) {
        clearInterval(silenceWatcherRef.current!)
        silenceWatcherRef.current = null
        return
      }
      const silenceFor = Date.now() - lastSpeechTsRef.current
      // 20초 무음 시 자동 종료 (모바일에서 긴 대기 시간 확보)
      if (silenceFor >= 20000) {
        console.log('20초 무음 감지, 녹음 종료')
        stopRecording()
      }
    }, 1000)
  }

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible' && isRecordingRef.current) {
        acquireWakeLock()
        try { audioCtxRef.current?.resume?.() } catch {}
      }
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  // MediaRecorder 방식: 끊김 없는 녹음 (Android)
  const startMediaRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      mediaStreamRef.current = stream

      // MIME 타입 감지 (Android: webm, iOS: mp4)
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/mp4'

      const recorder = new MediaRecorder(stream, { mimeType })
      mediaRecorderRef.current = recorder

      recorder.ondataavailable = async (event) => {
        if (event.data.size > 0) {
          const timestamp = new Date().toLocaleTimeString()
          setDebugInfo(`[${timestamp}] 청크: ${event.data.size} bytes`)
          console.log(`[MediaRecorder] 청크 생성: ${event.data.size} bytes`)

          // 즉시 서버로 전송하여 STT 처리
          try {
            const reader = new FileReader()
            reader.onloadend = async () => {
              const base64 = (reader.result as string).split(',')[1]
              setDebugInfo(prev => `${prev}\n[${timestamp}] STT 전송 중...`)
              console.log(`[STT] 전송 시작: ${base64?.length || 0} chars`)

              try {
                const resp = await fetch(`${API_BASE}/api/stt/recognize-chunk`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ audioData: base64, mimeType }),
                })
                const data = await resp.json()

                console.log('[STT] 응답:', data)

                if (data.text) {
                  setDebugInfo(prev => `${prev}\n[${timestamp}] ✅ "${data.text}"`)
                  // 함수형 업데이트로 최신 상태 참조
                  setTranscript(prev => {
                    const updated = prev ? prev + '\n' + data.text : data.text
                    console.log(`[텍스트] 업데이트 완료 (총 ${updated.length} chars)`)
                    return updated
                  })
                } else {
                  setDebugInfo(prev => `${prev}\n[${timestamp}] ⚠️ 무음/인식실패`)
                  console.warn('[STT] 결과 없음 (무음 또는 인식 실패)')
                }
              } catch (err) {
                setDebugInfo(prev => `${prev}\n[${timestamp}] ❌ 오류: ${err}`)
                console.error('[STT] 전송 실패:', err)
              }
            }
            reader.readAsDataURL(event.data)
          } catch (err) {
            console.error('[FileReader] 실패:', err)
          }
        } else {
          console.warn('[MediaRecorder] 빈 청크 수신')
        }
      }

      recorder.onerror = (event) => {
        console.error('[MediaRecorder] 오류:', event)
      }

      recorder.onstop = () => {
        console.log('[MediaRecorder] 정지됨')
      }

      // 5초마다 자동으로 ondataavailable 호출 (timeslice)
      recorder.start(CHUNK_INTERVAL_MS)
      console.log(`[MediaRecorder] 시작: ${mimeType}, ${CHUNK_INTERVAL_MS}ms 청크`)

      setIsRecording(true)
      isRecordingRef.current = true
      acquireWakeLock()
    } catch (err) {
      console.error('[MediaRecorder] 시작 실패:', err)
      alert('마이크 권한을 허용해 주세요.')
    }
  }

  const stopMediaRecording = () => {
    console.log('[MediaRecorder] 정지 요청')

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        mediaRecorderRef.current.stop()
      } catch (err) {
        console.error('[MediaRecorder] 정지 실패:', err)
      }
      mediaRecorderRef.current = null
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop())
      mediaStreamRef.current = null
    }

    setIsRecording(false)
    isRecordingRef.current = false
    awaitWakeRelease()
  }

  const startRecording = async () => {
    // Android: MediaRecorder 사용 (끊김 없음)
    if (useMediaRecorder) {
      return startMediaRecording()
    }

    // iOS: Web Speech API 사용 (끊김 있지만 작동)
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
    // 일부 기기에서 대안 결과가 많으면 지연이 늘어나는 문제가 있어 1로 제한
    try { (recognition as any).maxAlternatives = 1 } catch {}
    isRecordingRef.current = true

    // 마이크 스트림 및 에너지 감시 시작(인식 엔진과 별개로 오디오 경로 유지)
    try { await startMicStream() } catch {}

    const attachHandlers = (rec: any) => {
      let finalText = transcript
      rec.onresult = (event: any) => {
        // 모든 onresult 호출 시 타임스탬프 갱신하여 연속성 유지
        lastSpeechTsRef.current = Date.now()
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
      }
      rec.onerror = (e: any) => {
        console.error('Recognition error:', e)
        const restartable = ['no-speech', 'network', 'aborted', 'audio-capture']
        if (isRecordingRef.current && restartable.includes(e?.error)) {
          attemptRestart('error')
        }
        if (e?.error === 'not-allowed') {
          alert('마이크 권한이 허용되지 않았습니다. 브라우저/OS 권한을 확인해 주세요.')
          stopRecording()
        }
      }
      ;(rec as any).onspeechstart = () => { lastSpeechTsRef.current = Date.now(); clearSilenceTimeout() }
      // onspeechend 재시작 로직 제거: 모바일에서 짧은 무음에도 빈번히 발생하여 끊김 현상 유발
      ;(rec as any).onspeechend = () => { /* 재시작 로직 제거 - 에너지 감지와 silenceWatcher만 활용 */ }
      rec.onend = () => {
        if (!isRecordingRef.current) {
          setIsRecording(false)
          recognitionRef.current = null
          return
        }
        // 갤럭시 등 모바일에서 onend가 빈번히 발생하여 끊김 유발
        // 마지막 발화 이후 20초 이상 경과했을 때만 재시작 시도
        const silenceFor = Date.now() - lastSpeechTsRef.current
        if (silenceFor < 20000) {
          // 20초 미만이면 즉시 재시작하여 끊김 없이 유지
          setIsRecording(true)
          attemptRestart('silence')
        } else {
          // 20초 이상 무음이면 자연스럽게 종료 대기
          setIsRecording(true)
        }
      }
      ;(rec as any).onstart = () => {
        try { acquireWakeLock() } catch {}
        resetRestartInfo()
        try {
          ;(rec as any).continuous = true
          ;(rec as any).interimResults = true
        } catch {}
      }
    }

    const attemptRestart = (cause: 'error' | 'silence' = 'error') => {
      if (!isRecordingRef.current) return
      const now = Date.now()
      const isBurst = now - restartInfoRef.current.last < 300
      restartInfoRef.current.last = now
      // 오류에 의한 재시작만 루프 카운트에 포함하고, 침묵에 의한 재시작은 카운트를 리셋합니다.
      if (cause === 'error') {
        restartInfoRef.current.count = isBurst ? restartInfoRef.current.count + 1 : 0
      } else {
        restartInfoRef.current.count = 0
      }

      // 오류로 인한 재시작이 과도하게 반복되면 재시도만 중단하고, 20초 자동 종료를 기다립니다.
      if (cause === 'error' && restartInfoRef.current.count >= 5) {
        console.warn('음성 인식 오류가 반복되어 재시작을 중단합니다. 20초 후 자동 종료됩니다.')
        alert('마이크 입력이 불안정합니다. 재시도는 중단하고 20초 무음 후 자동 종료됩니다.')
        return
      }

      const rec = recognitionRef.current
      if (cause === 'silence') {
        // 즉시 재시작으로 끊김 완전 제거
        if (restartTimeoutRef.current) return
        restartTimeoutRef.current = window.setTimeout(() => {
          restartTimeoutRef.current = null
          if (!isRecordingRef.current) return
          try {
            try { rec?.stop?.() } catch {}
            rec?.start()
          } catch (e) {
            console.warn('Silence restart failed:', e)
            // 실패 시 새 인식 객체 생성
            const SR: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
            if (SR) {
              const newRec = new SR()
              newRec.continuous = true
              newRec.interimResults = true
              newRec.lang = 'ko-KR'
              try { (newRec as any).maxAlternatives = 1 } catch {}
              recognitionRef.current = newRec
              attachHandlers(newRec)
              try { newRec.start() } catch {}
            }
          }
        }, 100)  // 100ms로 최소화하여 끊김 없이 즉시 재시작
        return
      }

      // 오류로 인한 재시작은 점진적 백오프(최대 3초)
      if (restartTimeoutRef.current) return
      const delay = Math.min(200 + restartInfoRef.current.count * 400, 3000)
      restartTimeoutRef.current = window.setTimeout(() => {
        restartTimeoutRef.current = null
        if (!isRecordingRef.current) return
        try {
          try { rec?.stop?.() } catch {}
          rec?.start()
        } catch {
          // 재시작 실패 시 소폭 지연 후 1회 추가 시도
          const retryDelay = 400
          restartTimeoutRef.current = window.setTimeout(() => {
            restartTimeoutRef.current = null
            if (isRecordingRef.current) {
              try {
                try { rec?.stop?.() } catch {}
                rec?.start()
              } catch {
                const SR: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
                if (SR) {
                  const newRec = new SR()
                  newRec.continuous = true
                  newRec.interimResults = true
                  newRec.lang = 'ko-KR'
                  try { (newRec as any).maxAlternatives = 1 } catch {}
                  recognitionRef.current = newRec
                  attachHandlers(newRec)
                  try { newRec.start() } catch {}
                }
              }
            }
          }, retryDelay)
        }
      }, delay)
    }

    attachHandlers(recognition)

    recognitionRef.current = recognition
    recognition.start()
    setIsRecording(true)
    lastSpeechTsRef.current = Date.now()
    startSilenceWatcher()
    acquireWakeLock()
    startRecWatchdog()
  }

  const stopRecording = () => {
    // Android: MediaRecorder 정지
    if (useMediaRecorder) {
      return stopMediaRecording()
    }

    // iOS: Web Speech API 정지
    const rec = recognitionRef.current
    // 재시작 루프를 방지하기 위해 먼저 플래그를 내리고 이벤트를 해제합니다.
    isRecordingRef.current = false
    setIsRecording(false)
    if (rec) {
      try {
        rec.onend = null
        rec.onerror = null
        ;(rec as any).onspeechend = null
        ;(rec as any).onsoundend = null
        ;(rec as any).onaudioend = null
      } catch {}
      try { (rec as any).abort?.() } catch {}
      try { rec.stop() } catch {}
      recognitionRef.current = null
    }
    awaitWakeRelease()
    // 오디오 리소스 정리
    stopMicStream()
    stopRecWatchdog()
    // 예약된 재시작 작업이 있으면 취소
    if (restartTimeoutRef.current) {
      clearTimeout(restartTimeoutRef.current)
      restartTimeoutRef.current = null
    }
    if (silenceTimeoutRef.current) {
      clearTimeout(silenceTimeoutRef.current)
      silenceTimeoutRef.current = null
    }
    if (silenceWatcherRef.current) {
      clearInterval(silenceWatcherRef.current)
      silenceWatcherRef.current = null
    }
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
      setIsComposing(true)
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
        {isRecording && (navigator as any)?.wakeLock && (
          <p className="help"><AlertCircle size={14} /> 녹음 중 화면 꺼짐 방지 활성(지원 기기). 화면을 켠 상태에서 사용하세요.</p>
        )}
          <p className="help">
            <Mic size={14} /> 마이크 버튼을 눌러 녹음을 시작하고, 정지 버튼으로 종료합니다. 녹음 중에는 텍스트가 실시간으로 누적됩니다.
            {useMediaRecorder && (
              <><br/><CheckCircle2 size={14} /> Android 감지: 끊김 없는 MediaRecorder 모드 활성화</>
            )}
            {!useMediaRecorder && (
              <><br/><AlertCircle size={14} /> iOS/기타: Web Speech API 모드 (말을 멈추면 일시적으로 끊길 수 있음)</>
            )}
          </p>
          <textarea
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            placeholder="여기에 음성 인식 결과가 실시간으로 누적됩니다."
            className="textarea-md mt-8"
          />
          {useMediaRecorder && debugInfo && (
            <div style={{ marginTop: 8, padding: 8, background: '#1a1a1a', border: '1px solid #333', borderRadius: 4, fontSize: 12, fontFamily: 'monospace', whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto' }}>
              <strong>🔍 디버그 로그:</strong>
              <br/>
              {debugInfo}
            </div>
          )}
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
            <button className="btn btn-primary" onClick={composeWithGemini} disabled={geminiEnabled === false || isComposing} aria-busy={isComposing}>
              {isComposing ? (<><Loader2 size={16} /> 작성 중...</>) : '지침대로 문서 작성'}
            </button>
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
