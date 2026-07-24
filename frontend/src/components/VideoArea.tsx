import React, { useRef, useState, useEffect, useCallback } from 'react'
import type { AppPhase, Sentence } from '../App'

const API = 'http://127.0.0.1:8765'

export interface VideoHandle {
  playSegment: (start: number, end: number) => void
  playSegmentOriginal: (start: number, end: number) => void
  playSegmentNoVocals: (start: number, end: number) => void
  playSegmentNoVocalsUnmuted: (start: number, end: number) => void
  seek: (time: number) => void
  getCurrentTime: () => number
}

interface Props {
  phase: AppPhase
  sourcePath: string
  videoInfo: any
  clipStart: number
  clipEnd: number
  clipPath: string
  noVocalsPath: string
  onImport: (path: string) => void
  onClipStartChange: (v: number) => void
  onClipEndChange: (v: number) => void
  onExtract: () => void
  onSeparate: () => void
  onTranscribe: () => void
  onQuickResume: () => void
  onPreview: (recVol: number, origVol: number) => void
  progress: { task: string; percent: number; message: string }
  sentences: Sentence[]
  selectedSentence: number | null
  onSentenceClick: (s: Sentence) => void
  videoApiRef: React.MutableRefObject<VideoHandle | null>
}

// Canvas 时间轴组件（纯 JS 绘制，零 React 开销）
function TimelineCanvas({
  duration, clipStart, clipEnd, dragging,
  onCommit, onDraggingChange, onSeek,
}: {
  duration: number
  clipStart: number; clipEnd: number
  dragging: 'start' | 'end' | null
  onCommit: (start: number, end: number) => void
  onDraggingChange: (v: 'start' | 'end' | null) => void
  onSeek: (time: number) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stateRef = useRef({ clipStart, clipEnd, dragging, duration })
  stateRef.current = { clipStart, clipEnd, dragging, duration }

  const draw = useCallback(() => {
    const c = canvasRef.current
    if (!c) return
    const ctx = c.getContext('2d')!
    const { clipStart: s, clipEnd: e, duration: d } = stateRef.current
    const W = c.width, H = c.height

    ctx.clearRect(0, 0, W, H)

    // 背景
    ctx.fillStyle = '#2C2C2C'
    ctx.beginPath(); ctx.roundRect(0, 0, W, H, 6); ctx.fill()

    const startX = (s / d) * W
    const endX = (e / d) * W

    // 选中区域
    ctx.fillStyle = 'rgba(255,159,67,0.25)'
    ctx.fillRect(startX, 0, endX - startX, H)

    // 手柄
    const drawHandle = (x: number, active: boolean) => {
      ctx.fillStyle = active ? '#FF6B6B' : '#F4A460'
      ctx.fillRect(x - 6, -2, 12, H + 4)
    }
    drawHandle(startX, stateRef.current.dragging === 'start')
    drawHandle(endX, stateRef.current.dragging === 'end')
  }, [])

  // 初始绘制 & resize
  useEffect(() => {
    const c = canvasRef.current
    if (!c) return
    const resize = () => { c.width = c.clientWidth * 2; c.height = 32 * 2; c.style.width = '100%'; c.style.height = '32px'; draw() }
    resize()
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [draw])

  // 状态变化时重绘
  useEffect(() => { draw() }, [clipStart, clipEnd, dragging, duration, draw])

  const getPos = (e: React.MouseEvent | MouseEvent) => {
    const c = canvasRef.current
    if (!c) return 0
    const rect = c.getBoundingClientRect()
    return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * stateRef.current.duration
  }

  // 拖拽时用 ref 存位置，不更新父组件，保证丝滑
  const dragStartRef = useRef(clipStart)
  const dragEndRef = useRef(clipEnd)
  useEffect(() => { dragStartRef.current = clipStart; dragEndRef.current = clipEnd }, [clipStart, clipEnd])

  const handleDown = (e: React.MouseEvent) => {
    const pos = getPos(e)
    const s = stateRef.current
    const distS = Math.abs(pos - s.clipStart)
    const distE = Math.abs(pos - s.clipEnd)
    if (distS < distE && distS < s.duration * 0.05) {
      onDraggingChange('start')
    } else if (distE < s.duration * 0.05) {
      onDraggingChange('end')
    } else {
      if (pos < (s.clipStart + s.clipEnd) / 2) {
        dragStartRef.current = Math.max(0, pos)
        onCommit(Math.max(0, pos), s.clipEnd)
      } else {
        dragEndRef.current = Math.min(s.duration, pos)
        onCommit(s.clipStart, Math.min(s.duration, pos))
      }
      onSeek(pos)
    }
  }

  useEffect(() => {
    if (!dragging) return
    let lastSeek = 0
    const handleMove = (e: MouseEvent) => {
      const pos = getPos(e)
      const s = stateRef.current
      if (dragging === 'start' && pos < s.clipEnd - 0.5) {
        dragStartRef.current = Math.max(0, pos)
        onCommit(Math.max(0, pos), s.clipEnd)
        const now = Date.now()
        if (now - lastSeek > 120) { lastSeek = now; onSeek(pos) }
      } else if (dragging === 'end' && pos > s.clipStart + 0.5) {
        dragEndRef.current = Math.min(s.duration, pos)
        onCommit(s.clipStart, Math.min(s.duration, pos))
        const now = Date.now()
        if (now - lastSeek > 120) { lastSeek = now; onSeek(pos) }
      }
    }
    const handleUp = () => onDraggingChange(null)
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
  }, [dragging, clipStart, clipEnd, duration, onCommit, onDraggingChange, onSeek])

  return <canvas ref={canvasRef} onMouseDown={handleDown}
    style={{ width: '100%', height: 32, cursor: 'pointer', borderRadius: 8 }} />
}

const VideoArea = React.memo(function VideoArea({
  phase, sourcePath, videoInfo, clipStart, clipEnd,
  clipPath, noVocalsPath,
  onImport, onClipStartChange, onClipEndChange,
  onExtract, onSeparate, onTranscribe, onQuickResume, onPreview, progress,
  sentences, selectedSentence, onSentenceClick,
  videoApiRef,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [pathInput, setPathInput] = useState('')
  const [dragging, setDragging] = useState<'start' | 'end' | null>(null)
  const [originalAudio, setOriginalAudio] = useState(true)
  const savedTimeRef = useRef<number>(0)
  const [recVol, setRecVol] = useState(1.0)
  const [origVol, setOrigVol] = useState(1.0)
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 统一的视频播放方法
  const playUrl = (url: string, start: number, end: number, muted: boolean) => {
    const v = videoRef.current
    if (!v) return
    const doPlay = () => {
      v.muted = muted
      v.currentTime = start
      v.play().catch(() => {})
      const c = setInterval(() => {
        if (!v || v.currentTime >= end || v.paused) { v?.pause(); clearInterval(c) }
      }, 50)
    }
    if (v.src !== url) {
      v.oncanplay = () => { v.oncanplay = null; doPlay() }
      v.src = url
      v.load()
    } else {
      doPlay()
    }
  }

  useEffect(() => {
    videoApiRef.current = {
      playSegment(start: number, end: number) {
        const v = videoRef.current
        if (!v) return
        v.currentTime = start
        v.play()
        const check = setInterval(() => {
          if (v.currentTime >= end || v.paused) { v.pause(); clearInterval(check) }
        }, 50)
      },
      playSegmentOriginal(start: number, end: number) {
        if (!clipPath) return
        playUrl(`${API}/api/file?path=${encodeURIComponent(clipPath)}`, start, end, false)
      },
      playSegmentNoVocals(start: number, end: number) {
        if (!noVocalsPath) return
        playUrl(`${API}/api/file?path=${encodeURIComponent(noVocalsPath)}`, start, end, true)
      },
      playSegmentNoVocalsUnmuted(start: number, end: number) {
        if (!noVocalsPath) return
        playUrl(`${API}/api/file?path=${encodeURIComponent(noVocalsPath)}`, start, end, false)
      },
      seek(time: number) { if (videoRef.current) videoRef.current.currentTime = time },
      getCurrentTime() { return videoRef.current?.currentTime || 0 },
    }
  }, [videoApiRef, clipPath, noVocalsPath])

  const handlePathSubmit = () => {
    const trimmed = pathInput.trim()
    if (trimmed) onImport(trimmed)
  }

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60)
    const sec = Math.floor(s % 60)
    return `${m}:${String(sec).padStart(2, '0')}`
  }

  useEffect(() => {
    if (phase === 'separated') setOriginalAudio(false)
  }, [phase])

  // 点句子 → 跳视频
  useEffect(() => {
    if (selectedSentence == null || !videoRef.current) return
    const s = sentences.find(x => x.id === selectedSentence)
    if (s) videoRef.current.currentTime = s.start
  }, [selectedSentence, sentences])

  // 切换原声时保持播放位置
  const handleToggleAudio = () => {
    if (videoRef.current) savedTimeRef.current = videoRef.current.currentTime
    setOriginalAudio(!originalAudio)
  }

  const handleVideoLoaded = () => {
    if (videoRef.current && savedTimeRef.current > 0) {
      videoRef.current.currentTime = savedTimeRef.current
      savedTimeRef.current = 0
    }
  }

  const getVideoSrc = () => {
    if ((phase === 'separated' || phase === 'separating') && (clipPath || noVocalsPath)) {
      const p = originalAudio ? (clipPath || noVocalsPath) : (noVocalsPath || clipPath)
      return `${API}/api/file?path=${encodeURIComponent(p)}`
    }
    if ((phase === 'clipped' || phase === 'extracting') && clipPath) return `${API}/api/file?path=${encodeURIComponent(clipPath)}`
    if (sourcePath && phase !== 'separated') return `${API}/api/file?path=${encodeURIComponent(sourcePath)}`
    return ''
  }

  if (phase === 'empty') {
    return (
      <div style={styles.container}>
        <div style={styles.dropZone}
          onDragOver={e => e.preventDefault()}
          onDrop={async e => {
            e.preventDefault()
            const file = e.dataTransfer.files[0]
            if (!file) return
            const p = (file as any).path
            if (p) { onImport(p); return }
            // 浏览器不给路径，上传到后端
            setPathInput('正在导入: ' + file.name + ' ...')
            const form = new FormData()
            form.append('file', file)
            const res = await fetch(`${API}/api/upload`, { method: 'POST', body: form })
            const data = await res.json()
            if (data.path) onImport(data.path)
            else setPathInput('导入失败，请点击空白区域选择文件')
          }}
          onClick={async () => {
            try {
              const res = await fetch(`${API}/api/pick-file`)
              const data = await res.json()
              if (data.path) onImport(data.path)
            } catch {}
          }}>
          <div style={styles.bigIcon}>📁</div>
          <div style={styles.text}>点击选择视频文件</div>
          <div style={styles.subText}>或把视频拖到这里</div>
          <div style={styles.orText}>也可以粘贴路径</div>
          <div style={styles.inputRow} onClick={e => e.stopPropagation()}>
            <input type="text" value={pathInput}
              onChange={e => setPathInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handlePathSubmit()}
              placeholder="粘贴视频文件路径..."
              style={styles.pathInput} />
            <button style={styles.btn} onClick={handlePathSubmit}>确认</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={styles.container}>
      <div style={styles.videoWrapper}>
        <video ref={videoRef} src={getVideoSrc()} style={styles.video} controls
          onLoadedData={handleVideoLoaded} />
      </div>

      {videoInfo && (phase === 'imported' || phase === 'extracting' || phase === 'clipped') && (
        <div style={styles.timelineWrap}>
          <div style={styles.timelineLabels}>
            <span>{formatTime(clipStart)}</span>
            <span style={styles.timelineDur}>{formatTime(clipEnd - clipStart)}</span>
            <span>{formatTime(clipEnd)}</span>
          </div>
          <TimelineCanvas
            duration={videoInfo.duration}
            clipStart={clipStart}
            clipEnd={clipEnd}
            dragging={dragging}
            onCommit={(s, e) => { onClipStartChange(s); onClipEndChange(e) }}
            onDraggingChange={setDragging}
            onSeek={(t) => { if (videoRef.current) videoRef.current.currentTime = t }}
          />
        </div>
      )}

      <div style={styles.actions}>
        {phase === 'imported' && (
          <>
            <span style={styles.hint}>在时间轴上拖动或点击设置起止点</span>
            <button style={styles.btn} onClick={onQuickResume}>📂 复用数据</button>
            <button style={{ ...styles.btn, ...styles.primaryBtn }} onClick={onExtract}>✂️ 截取片段</button>
          </>
        )}
        {phase === 'extracting' && (
          <div style={styles.progressRow}>
            <div style={styles.progressBar}>
              <div style={{ ...styles.progressFill, width: '100%', animation: 'pulse 1s infinite' }} />
            </div>
            <span style={styles.progressText}>截取中...</span>
          </div>
        )}
        {phase === 'clipped' && (
          <>
            <span style={styles.hint}>截取完成，共 {formatTime(clipEnd - clipStart)}</span>
            <button style={styles.btn} onClick={onQuickResume}>📂 复用数据</button>
            <button style={styles.btn} onClick={onTranscribe}>📝 识别对白</button>
            <button style={{ ...styles.btn, ...styles.primaryBtn }} onClick={onSeparate}>🎵 分离人声</button>
          </>
        )}
        {phase === 'separating' && (
          <div style={styles.progressRow}>
            <div style={styles.progressBar}>
              <div style={{ ...styles.progressFill, width: `${progress.percent}%` }} />
            </div>
            <span style={styles.progressText}>{progress.message}</span>
          </div>
        )}
        {phase === 'separated' && (
          <div style={styles.toggleRow}>
            <button style={originalAudio ? styles.toggleOn : styles.toggleOff} onClick={handleToggleAudio}>
              {originalAudio ? '🔊 原声开' : '🔇 原声关'}
            </button>
            <span style={styles.volLabel}>原声:{origVol.toFixed(1)}</span>
            <input type="range" min={0.5} max={2.0} step={0.1} value={origVol}
              onChange={e => { const v = Number(e.target.value); setOrigVol(v); if (previewTimerRef.current) clearTimeout(previewTimerRef.current); previewTimerRef.current = setTimeout(() => onPreview(recVol, v), 500) }} style={styles.volSlider} />
            <span style={styles.volLabel}>录音:{recVol.toFixed(1)}</span>
            <input type="range" min={0.5} max={2.0} step={0.1} value={recVol}
              onChange={e => { const v = Number(e.target.value); setRecVol(v); if (previewTimerRef.current) clearTimeout(previewTimerRef.current); previewTimerRef.current = setTimeout(() => onPreview(v, origVol), 500) }} style={styles.volSlider} />
            <button style={styles.btn} onClick={() => onPreview(recVol, origVol)}>👁 预览</button>
          </div>
        )}
      </div>
    </div>
  )
})

const styles: Record<string, React.CSSProperties> = {
  container: { flex: 1, background: '#1E1E1E', borderRadius: 'var(--border-radius)', display: 'flex', flexDirection: 'column', overflow: 'hidden', border: '2px solid #3A3A3A' },
  emptyState: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, border: '2px dashed #4A4A4A', margin: 8, borderRadius: 8 },
  dropZone: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, border: '2px dashed #4A4A4A', margin: 8, borderRadius: 8, cursor: 'pointer' },
  orText: { fontSize: 12, color: '#555' },
  bigIcon: { fontSize: 52, opacity: 0.6 },
  text: { fontSize: 16, color: 'var(--text-secondary)', fontWeight: 500 },
  subText: { fontSize: 13, color: '#6A6A6A', textAlign: 'center', lineHeight: 1.6 },
  pathExample: { background: '#1E1E1E', padding: '2px 6px', borderRadius: 4, fontSize: 12, color: 'var(--accent)' },
  inputRow: { display: 'flex', gap: 8, width: '100%', maxWidth: 500 },
  pathInput: { flex: 1, padding: '8px 12px', borderRadius: 8, border: '1px solid #4A4A4A', background: '#1E1E1E', color: 'var(--text-primary)', fontSize: 13, outline: 'none' },
  btn: { padding: '8px 18px', background: '#4A4A4A', color: 'var(--text-primary)', fontSize: 14, borderRadius: 8 },
  primaryBtn: { background: 'var(--accent)', color: '#2C2C2C', fontWeight: 600 },
  videoWrapper: { flex: 1, position: 'relative', background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 0 },
  video: { maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' },
  timelineWrap: { padding: '10px 16px 6px', background: 'var(--panel-bg)', borderTop: '1px solid #4A4A4A' },
  timelineLabels: { display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-secondary)', marginBottom: 6 },
  timelineDur: { color: 'var(--accent)', fontWeight: 600, fontSize: 12 },
  actions: { padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 10, background: 'var(--panel-bg)', borderTop: '1px solid #4A4A4A', minHeight: 44, flexWrap: 'wrap' },
  hint: { fontSize: 12, color: 'var(--text-secondary)' },
  progressRow: { flex: 1, display: 'flex', alignItems: 'center', gap: 10 },
  progressBar: { flex: 1, height: 8, background: '#2C2C2C', borderRadius: 4, overflow: 'hidden' },
  progressFill: { height: '100%', background: 'var(--accent)', borderRadius: 4, transition: 'width 0.3s' },
  progressText: { fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap' },
  toggleRow: { flex: 1, display: 'flex', alignItems: 'center', gap: 10 },
  toggleOn: { padding: '8px 20px', background: '#7BC67E', color: '#1E1E1E', fontWeight: 600, fontSize: 14, borderRadius: 8 },
  toggleOff: { padding: '8px 20px', background: '#E07B7B', color: '#fff', fontWeight: 600, fontSize: 14, borderRadius: 8 },
  toggleHint: { fontSize: 11, color: 'var(--text-secondary)' },
  volSlider: { width: 60, accentColor: 'var(--accent)' },
  volLabel: { fontSize: 10, color: 'var(--text-secondary)', whiteSpace: 'nowrap' },
}

export default VideoArea
