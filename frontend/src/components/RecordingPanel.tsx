import { useState, useRef, useEffect } from 'react'
import type { AppPhase, Sentence } from '../App'
import type { VideoHandle } from './VideoArea'

const API = 'http://127.0.0.1:8765'

interface Props {
  phase: AppPhase
  progress: { task: string; percent: number; message: string }
  sentences: Sentence[]
  selectedSentence: number | null
  videoRef: React.MutableRefObject<VideoHandle | null>
}

function RecordingPanel({ phase, progress, sentences, selectedSentence, videoRef }: Props) {
  const [recording, setRecording] = useState(false)
  const [status, setStatus] = useState('')
  const [hasRecording, setHasRecording] = useState(false)
  const [recordingPath, setRecordingPath] = useState('')
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const audioRef = useRef<HTMLAudioElement>(null)

  const sel = sentences.find(s => s.id === selectedSentence)
  const selIdx = sentences.findIndex(s => s.id === selectedSentence)
  const selIdxRef = useRef(selIdx)
  selIdxRef.current = selIdx
  const isReady = !!sel && phase === 'separated'
  const duration = sel ? (sel.end - sel.start).toFixed(1) : ''

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    // 清理上次的定时器
    if (timerRef.current) clearTimeout(timerRef.current)
    checkRecording()
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [selIdx])

  const checkRecording = async () => {
    if (selIdx < 0) { setHasRecording(false); setRecordingPath(''); return }
    try {
      const res = await fetch(`${API}/api/recordings/get?sentence_index=${selIdx + 1}`)
      const data = await res.json()
      setHasRecording(data.exists)
      setRecordingPath(data.path || '')
      if (data.exists && data.path) {
        // 不自动播放了——用户点了句子已经有原声，录音回放等用户手动点播放
      }
    } catch { setHasRecording(false) }
  }

  const playWithRecording = (path?: string) => {
    if (!sel || !videoRef.current) return
    const p = path || recordingPath
    if (!p) return
    // 消音视频（不静音）+ 录音
    videoRef.current.playSegmentNoVocalsUnmuted(sel.start, sel.end)
    if (audioRef.current) {
      audioRef.current.src = `${API}/api/file?path=${encodeURIComponent(p)}&t=${Date.now()}`
      audioRef.current.play()
    }
  }

  const startRecording = async () => {
    if (!sel || !videoRef.current) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      })
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' })
      mediaRecorderRef.current = recorder
      audioChunksRef.current = []

      recorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data) }
      recorder.onstop = async () => {
        setRecording(false)
        stream.getTracks().forEach(t => t.stop())
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' })
        const form = new FormData()
        form.append('sentence_index', String(selIdxRef.current + 1))
        form.append('file', blob, 'recording.webm')
        const res = await fetch(`${API}/api/recordings/save`, { method: 'POST', body: form })
        const data = await res.json()
        if (data.ok) {
          setHasRecording(true)
          setRecordingPath(data.path)
          setStatus('')
          setTimeout(() => playWithRecording(data.path), 400)
        }
      }

      recorder.start()
      setRecording(true)
      setStatus('录音中...')

      // 录音时：消音视频静音播放（只看画面参考）
      videoRef.current.playSegmentNoVocals(sel.start, sel.end)

      setTimeout(() => {
        if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.stop()
      }, (sel.end - sel.start) * 1000 + 500)
    } catch {
      setStatus('麦克风权限被拒绝')
    }
  }

  return (
    <div style={styles.container}>
      <div style={styles.top}>
        <span style={styles.label}>🎤 录音区</span>
        {!isReady && <span style={styles.hint}>导入视频并完成识别后开始录音</span>}
        {isReady && <span style={styles.readyHint}>当前：# {sel!.id} "{sel!.text}"</span>}
      </div>
      <div style={styles.waveformArea}>
        {!isReady ? (
          <span style={styles.waveText}>{phase === 'transcribing' ? progress.message : '等待就绪...'}</span>
        ) : (
          <div style={styles.waveInfo}>
            <span style={styles.duration}>原句时长：{duration}s</span>
            {recording && <span style={styles.recDot}>🔴</span>}
            {hasRecording && !recording && <span>✅</span>}
            <span style={styles.statusText}>{status}</span>
          </div>
        )}
      </div>
      <div style={styles.controls}>
        <button
          style={recording ? styles.stopBtn : { ...styles.recordBtn, opacity: isReady ? 1 : 0.4 }}
          disabled={!isReady}
          onClick={recording
            ? () => { if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.stop() }
            : startRecording}
        >
          {recording ? '⏹ 停止' : '● 录音'}
        </button>
        {hasRecording && !recording && (
          <button style={styles.playBtn} onClick={() => playWithRecording()}>▶ 播放</button>
        )}
        <span style={styles.timeInfo}>{sel ? `原句 ${duration}s` : ''}</span>
      </div>
      <audio ref={audioRef} style={{ display: 'none' }} />
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: { height: 120, background: 'var(--panel-bg)', borderRadius: 'var(--border-radius)', display: 'flex', flexDirection: 'column', padding: '10px 14px', gap: 6, flexShrink: 0 },
  top: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  label: { fontSize: 13, fontWeight: 600 },
  hint: { fontSize: 11, color: 'var(--text-secondary)' },
  readyHint: { fontSize: 11, color: 'var(--accent)', maxWidth: 350, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  waveformArea: { flex: 1, background: '#1E1E1E', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  waveText: { fontSize: 12, color: '#555' },
  waveInfo: { display: 'flex', alignItems: 'center', gap: 10 },
  duration: { fontSize: 14, color: 'var(--text-secondary)', fontFamily: 'monospace' },
  recDot: { fontSize: 14, animation: 'pulse 1s infinite' },
  statusText: { fontSize: 12, color: 'var(--accent)' },
  controls: { display: 'flex', alignItems: 'center', gap: 10 },
  recordBtn: { padding: '8px 22px', background: '#E07B7B', color: '#fff', fontWeight: 600, fontSize: 14, borderRadius: 8 },
  stopBtn: { padding: '8px 22px', background: '#FF4444', color: '#fff', fontWeight: 600, fontSize: 14, borderRadius: 8 },
  playBtn: { padding: '8px 16px', background: '#4A4A4A', color: 'var(--text-primary)', fontSize: 14, borderRadius: 8 },
  timeInfo: { fontSize: 12, color: 'var(--text-secondary)' },
}

export default RecordingPanel
