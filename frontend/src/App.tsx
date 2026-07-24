import { useState, useRef, useEffect } from 'react'
import TopBar from './components/TopBar'
import VideoArea, { type VideoHandle } from './components/VideoArea'
import SentenceList from './components/SentenceList'
import StatusBar from './components/StatusBar'
import RecordingPanel from './components/RecordingPanel'

const API = 'http://127.0.0.1:8765'

export type AppPhase = 'empty' | 'imported' | 'extracting' | 'clipped' | 'separating' | 'separated' | 'transcribing'

export interface Sentence {
  id: number
  start: number
  end: number
  text: string
}

function App() {
  const [phase, setPhase] = useState<AppPhase>('empty')
  const [sourcePath, setSourcePath] = useState('')
  const [videoInfo, setVideoInfo] = useState<any>(null)
  const [clipStart, setClipStart] = useState(0)
  const [clipEnd, setClipEnd] = useState(0)
  const [clipPath, setClipPath] = useState('')
  const [noVocalsPath, setNoVocalsPath] = useState('')
  const [progress, setProgress] = useState({ task: '', percent: 0, message: '' })
  const [statusMsg, setStatusMsg] = useState('就绪 — 等待导入视频')
  const [exporting, setExporting] = useState(false)
  const volRef = useRef({ rec: 1.0, orig: 1.0 })
  const previewAudioRef = useRef<HTMLAudioElement | null>(null)
  const [sentences, setSentences] = useState<Sentence[]>([])
  const recordedRef = useRef<Set<number>>(new Set())
  const [selectedSentence, setSelectedSentence] = useState<number | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const transcribingRef = useRef(false)
  const videoApiRef = useRef<VideoHandle>(null)

  // 启动时恢复上次项目
  useEffect(() => {
    const lastProj = localStorage.getItem('last_project')
    const lastSrc = localStorage.getItem('last_source')
    if (lastProj && lastSrc) {
      fetch(`${API}/api/video/info`, {
        method: 'POST',
        body: new URLSearchParams({ path: lastSrc }),
      }).then(r => r.json()).then(info => {
        if (info.error || !info.duration) {
          localStorage.removeItem('last_project')
          localStorage.removeItem('last_source')
          return
        }
        setStatusMsg('正在恢复上次项目...')
        return fetch(`${API}/api/project/resume`, {
          method: 'POST',
          body: new URLSearchParams({ path: lastProj }),
        }).then(() => handleImport(lastSrc))
      }).catch(() => {
        localStorage.removeItem('last_project')
        localStorage.removeItem('last_source')
      })
    }
  }, [])

  // WebSocket 连接
  useEffect(() => {
    const ws = new WebSocket('ws://127.0.0.1:8765/ws')
    wsRef.current = ws
    ws.onmessage = (e) => {
      const data = JSON.parse(e.data)
      if (data.type === 'progress') {
        setProgress(data)
      }
    }
    ws.onclose = () => { if (wsRef.current === ws) wsRef.current = null }
    return () => ws.close()
  }, [])

  // 句子变化时自动保存
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (sentences.length === 0 || phase !== 'separated') return
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      fetch(`${API}/api/sentences/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sentences }),
      }).catch(() => {})
    }, 500)
  }, [sentences, phase])

  // 分离完成后自动触发转写
  useEffect(() => {
    if (phase === 'separated' && !transcribingRef.current) {
      transcribingRef.current = true
      handleTranscribe()
    }
  }, [phase])

  // 导入视频
  const handleImport = async (path: string) => {
    setStatusMsg('正在加载视频信息...')
    transcribingRef.current = false
    setSentences([])
    setSelectedSentence(null)
    try {
      const form = new FormData()
      form.append('name', '新作品')
      const projRes = await fetch(`${API}/api/project/create`, { method: 'POST', body: form })
      if (!projRes.ok) { setStatusMsg('后端连接失败'); return }
      const projData = await projRes.json()
      localStorage.setItem('last_project', projData.path)
      localStorage.setItem('last_source', path)

      const infoForm = new FormData()
      infoForm.append('path', path)
      const infoRes = await fetch(`${API}/api/video/info`, { method: 'POST', body: infoForm })
      const info = await infoRes.json()
      if (info.error) { setStatusMsg('无法读取视频：' + info.error); return }

      setSourcePath(path)
      setVideoInfo(info)
      setClipStart(0)
      setClipEnd(Math.min(30, info.duration))
      setPhase('imported')
      setStatusMsg(`已加载视频 — 时长 ${Math.floor(info.duration / 60)}:${String(Math.floor(info.duration % 60)).padStart(2, '0')}`)
    } catch (err: any) {
      setStatusMsg('连接后端失败：' + (err.message || ''))
    }
  }

  // 截取片段
  const handleExtract = async () => {
    setPhase('extracting'); setStatusMsg('正在截取片段...')
    const form = new FormData()
    form.append('source_path', sourcePath)
    form.append('start_time', String(clipStart))
    form.append('end_time', String(clipEnd))
    const res = await fetch(`${API}/api/clip/extract`, { method: 'POST', body: form })
    const data = await res.json()
    if (data.error) { setStatusMsg('截取失败：' + data.error); setPhase('imported'); return }
    setClipPath(data.output)
    setPhase('clipped')
    setStatusMsg(`片段截取完成 — 时长 ${data.duration} 秒`)
  }

  // 分离人声
  const handleSeparate = async () => {
    setPhase('separating')
    setProgress({ task: 'separate', percent: 0, message: '准备中...' })
    setStatusMsg('正在分离人声...')
    try {
      const res = await fetch(`${API}/api/separate`, { method: 'POST' })
      const data = await res.json()
      if (data.error) { setStatusMsg('分离失败：' + data.error); setPhase('clipped'); return }
      setNoVocalsPath(data.clip_no_vocals)
      setPhase('separated')
      setStatusMsg('分离完成 — 正在自动识别对白...')
    } catch (err: any) {
      setStatusMsg('分离失败：' + (err.message || ''))
      setPhase('clipped')
    }
  }

  // 语音转写
  const handleTranscribe = async () => {
    setPhase('transcribing')
    setProgress({ task: 'transcribe', percent: 0, message: '准备转写...' })
    setStatusMsg('正在识别对白...')
    try {
      const res = await fetch(`${API}/api/transcribe`, { method: 'POST' })
      const data = await res.json()
      if (data.error) { setStatusMsg('转写失败：' + data.error); setPhase('separated'); transcribingRef.current = false; return }
      setSentences(data.sentences || [])
      setPhase('separated')
      setStatusMsg(`识别完成 — 共 ${data.sentences?.length || 0} 句，可编辑文本和时间`)
    } catch (err: any) {
      setStatusMsg('转写失败：' + (err.message || ''))
      setPhase('separated')
      transcribingRef.current = false
    }
  }

  // 点击句子 → 立即播放原声片段（不能 setTimeout，否则浏览器拦截 play）
  const handleSentenceClick = (s: Sentence) => {
    setSelectedSentence(s.id)
    videoApiRef.current?.playSegmentOriginal(s.start, s.end)
  }

  // 复用已有数据（跳分离+识别）
  const handleQuickResume = async () => {
    try {
      const res = await fetch(`${API}/api/quick-resume`, { method: 'POST' })
      const data = await res.json()
      if (data.error) { setStatusMsg(data.error); return }
      if (data.clip_path) setClipPath(data.clip_path)
      if (data.no_vocals_path) setNoVocalsPath(data.no_vocals_path)
      if (data.sentences?.length) {
        transcribingRef.current = true  // 阻止自动触发识别
        setSentences(data.sentences)
        setPhase('separated')
        setStatusMsg(`已加载 ${data.sentences.length} 句`)
      } else {
        setStatusMsg('没有已有数据，请先识别对白')
      }
    } catch {
      setStatusMsg('加载失败')
    }
  }

  // 全片预览（带音量参数）
  const handlePreview = async (recVol: number, origVol: number) => {
    try {
      setStatusMsg('正在生成预览...')
      const res = await fetch(`${API}/api/preview?rec_vol=${recVol}&orig_vol=${origVol}`, { method: 'POST' })
      const data = await res.json()
      if (data.error) { setStatusMsg(data.error); return }
      volRef.current = { rec: recVol, orig: origVol }
      if (data.audio_path && videoApiRef.current) {
        const v = document.querySelector('video') as HTMLVideoElement | null
        if (v) v.muted = true
        if (previewAudioRef.current) { previewAudioRef.current.pause(); previewAudioRef.current = null }

        const audio = new Audio(`${API}/api/file?path=${encodeURIComponent(data.audio_path)}&t=${Date.now()}`)
        previewAudioRef.current = audio

        videoApiRef.current.playSegment(0, 999)
        audio.play()
        audio.onended = () => { if (v) v.muted = false }
        setStatusMsg('预览播放中（调滑块实时生效）...')
      }
    } catch { setStatusMsg('预览失败') }
  }

  // 导出
  const handleExport = async (opts: { intro: string; outro: string; introDur: number; outroDur: number; subtitleStyle: string }) => {
    setExporting(true)
    setProgress({ task: 'export', percent: 0, message: '准备导出...' })
    try {
      const form = new FormData()
      form.append('intro_path', opts.intro)
      form.append('outro_path', opts.outro)
      form.append('intro_duration', String(opts.introDur))
      form.append('outro_duration', String(opts.outroDur))
      form.append('subtitle_style', opts.subtitleStyle)
      form.append('recording_volume', String(volRef.current.rec))
      form.append('orig_volume', String(volRef.current.orig))
      const res = await fetch(`${API}/api/export`, { method: 'POST', body: form })
      const data = await res.json()
      if (data.error) { setStatusMsg('导出失败：' + data.error) }
      else { setStatusMsg(`导出完成！文件：${data.output}`) }
    } catch (err: any) {
      setStatusMsg('导出失败：' + (err.message || ''))
    }
    setExporting(false)
  }

  // 编辑句子文本
  const handleSentenceEdit = (id: number, text: string) => {
    setSentences(prev => prev.map(s => s.id === id ? { ...s, text } : s))
  }

  // 编辑句子时间
  const handleSentenceTimeEdit = (id: number, start: number, end: number) => {
    setSentences(prev => prev.map(s => s.id === id ? { ...s, start, end } : s))
  }

  // 合并前存快照，支持撤销
  const [sentencesBackup, setSentencesBackup] = useState<Sentence[] | null>(null)

  // 合并句子（同时删旧录音）
  const handleMergeSentences = (ids: number[]) => {
    if (ids.length < 2) return
    setSentencesBackup([...sentences])
    const sorted = [...ids].sort((a, b) => a - b)
    // 删掉被合并句子的旧录音，后续文件夹重命名
    const mergeIndices = sorted.map(id => sentences.findIndex(s => s.id === id) + 1).sort((a: number, b: number) => a - b)
    // 1. 删被合并的
    mergeIndices.forEach((idx: number) => {
      fetch(`${API}/api/recordings/delete`, { method: 'POST',
        body: new URLSearchParams({ sentence_index: String(idx) }) }).catch(() => {})
    })
    // 2. 通知后端重排录音文件夹（后台静默）
    fetch(`${API}/api/recordings/reindex`, { method: 'POST',
      body: new URLSearchParams({ merge_start: String(mergeIndices[0]), merge_count: String(mergeIndices.length) })
    }).catch(() => {})
    setSentences(prev => {
      const merged = prev.filter(s => sorted.includes(s.id))
      const first = merged[0]
      const last = merged[merged.length - 1]
      const newSentence: Sentence = {
        id: first.id,
        start: first.start,
        end: last.end,
        text: merged.map(s => s.text).join(' '),
      }
      const keep = prev.filter(s => !sorted.includes(s.id) || s.id === first.id)
      const idx = keep.findIndex(s => s.id === first.id)
      keep[idx] = newSentence
      // 重新编号
      return keep.map((s, i) => ({ ...s, id: i + 1 }))
    })
  }

  return (
    <div style={styles.container}>
      <TopBar
        onExport={handleExport}
        exporting={exporting}
        progress={progress}
        onReset={() => {
          setPhase('empty')
          setSourcePath('')
          setVideoInfo(null)
          setSentences([])
          setSelectedSentence(null)
          setClipPath('')
          setNoVocalsPath('')
          setStatusMsg('就绪 — 等待导入视频')
          localStorage.removeItem('last_project')
          localStorage.removeItem('last_source')
          window.location.reload()
        }}
      />
      <div style={styles.main}>
        <div style={styles.leftPanel}>
          <VideoArea
            videoApiRef={videoApiRef}
            phase={phase}
            sourcePath={sourcePath}
            videoInfo={videoInfo}
            clipStart={clipStart}
            clipEnd={clipEnd}
            clipPath={clipPath}
            noVocalsPath={noVocalsPath}
            onImport={handleImport}
            onClipStartChange={setClipStart}
            onClipEndChange={setClipEnd}
            onExtract={handleExtract}
            onSeparate={handleSeparate}
            onTranscribe={handleTranscribe}
            onQuickResume={handleQuickResume}
            onPreview={handlePreview}
            progress={progress}
            sentences={sentences}
            selectedSentence={selectedSentence}
            onSentenceClick={handleSentenceClick}
          />
          <RecordingPanel phase={phase} progress={progress} sentences={sentences} selectedSentence={selectedSentence} videoRef={videoApiRef} />
        </div>
        <div style={styles.rightPanel}>
          <SentenceList
            phase={phase}
            progress={progress}
            sentences={sentences}
            selectedSentence={selectedSentence}
            onSentenceClick={handleSentenceClick}
            onSentenceEdit={handleSentenceEdit}
            onSentenceTimeEdit={handleSentenceTimeEdit}
            onMergeSentences={handleMergeSentences}
            sentencesBackup={sentencesBackup}
            onUndoMerge={() => { if (sentencesBackup) { setSentences(sentencesBackup); setSentencesBackup(null) } }}
          />
        </div>
      </div>
      <StatusBar statusMsg={statusMsg} sentences={sentences} />
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: { height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--dark-bg)', overflow: 'hidden' },
  main: { flex: 1, display: 'flex', overflow: 'hidden' },
  leftPanel: { flex: 1, display: 'flex', flexDirection: 'column', padding: '12px 8px 8px 12px', gap: '8px', minWidth: 0 },
  rightPanel: { width: 300, minWidth: 260, padding: '12px 12px 8px 4px', display: 'flex', flexDirection: 'column' },
}

export default App
