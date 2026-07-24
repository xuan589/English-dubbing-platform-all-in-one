import { useState } from 'react'

interface Props {
  onExport: (opts: { intro: string; outro: string; introDur: number; outroDur: number; subtitleStyle: string }) => void
  exporting: boolean
  progress: { task: string; percent: number; message: string }
  onReset: () => void
}

function TopBar({ onExport, exporting, progress, onReset }: Props) {
  const [showExport, setShowExport] = useState(false)
  const [intro, setIntro] = useState('')
  const [outro, setOutro] = useState('')
  const [introDur, setIntroDur] = useState(3)
  const [outroDur, setOutroDur] = useState(3)
  const [subtitleStyle, setSubtitleStyle] = useState('classic')
  const [addSubtitle, setAddSubtitle] = useState(false)

  const handleExport = () => {
    onExport({ intro, outro, introDur, outroDur, subtitleStyle: addSubtitle ? subtitleStyle : '' })
    setShowExport(false)
  }

  return (
    <>
      <div style={styles.bar}>
        <div style={styles.left}>
          <span style={styles.icon}>🐱</span>
          <span style={styles.title}>英语配音工具</span>
        </div>
        <div style={styles.right}>
          <button style={styles.btn} onClick={onReset}>🏠 首页</button>
          <button style={styles.btn} onClick={() => setShowExport(!showExport)}>🎬 片头</button>
          <button style={styles.btn} onClick={() => setShowExport(!showExport)}>🎞 片尾</button>
          {exporting ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={styles.progressBar}>
                <div style={{ ...styles.progressFill, width: `${progress.percent}%` }} />
              </div>
              <span style={styles.progressText}>{progress.message}</span>
            </div>
          ) : (
            <button style={{ ...styles.btn, ...styles.exportBtn }} onClick={() => setShowExport(!showExport)}>
              📦 导出
            </button>
          )}
        </div>
      </div>

      {showExport && (
        <div style={styles.overlay} onClick={() => setShowExport(false)}>
          <div style={styles.dialog} onClick={e => e.stopPropagation()}>
            <h3 style={styles.dialogTitle}>导出设置</h3>

            <div style={styles.field}>
              <label>🎬 片头文件：</label>
              <input value={intro} onChange={e => setIntro(e.target.value)}
                placeholder="粘贴片头视频路径（可选）" style={styles.input} />
              <span style={styles.hint}>时长：</span>
              <input type="number" value={introDur} onChange={e => setIntroDur(Number(e.target.value))}
                min={0} max={30} style={styles.numInput} /> 秒
            </div>

            <div style={styles.field}>
              <label>🎞 片尾文件：</label>
              <input value={outro} onChange={e => setOutro(e.target.value)}
                placeholder="粘贴片尾视频路径（可选）" style={styles.input} />
              <span style={styles.hint}>时长：</span>
              <input type="number" value={outroDur} onChange={e => setOutroDur(Number(e.target.value))}
                min={0} max={30} style={styles.numInput} /> 秒
            </div>

            <div style={styles.field}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input type="checkbox" checked={addSubtitle} onChange={e => setAddSubtitle(e.target.checked)} />
                添加字幕
              </label>
              {addSubtitle && (
                <select value={subtitleStyle} onChange={e => setSubtitleStyle(e.target.value)} style={styles.select}>
                  <option value="classic">经典影视风（黑边白字）</option>
                  <option value="modern">现代极简风（描边无底）</option>
                </select>
              )}
            </div>

            <div style={styles.buttons}>
              <button style={styles.cancelBtn} onClick={() => setShowExport(false)}>取消</button>
              <button style={styles.exportBtn} onClick={handleExport}>📦 开始导出</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

const styles: Record<string, React.CSSProperties> = {
  bar: { height: 44, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', background: 'var(--panel-bg)', borderBottom: '1px solid #4A4A4A', flexShrink: 0 },
  left: { display: 'flex', alignItems: 'center', gap: 10 },
  icon: { fontSize: 20 },
  title: { fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' },
  right: { display: 'flex', alignItems: 'center', gap: 8 },
  btn: { padding: '6px 14px', background: '#4A4A4A', color: 'var(--text-primary)', fontSize: 13, borderRadius: 8 },
  exportBtn: { padding: '6px 14px', background: 'var(--accent)', color: '#2C2C2C', fontWeight: 600, fontSize: 13, borderRadius: 8 },
  progressBar: { width: 100, height: 6, background: '#2C2C2C', borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: '100%', background: 'var(--accent)', borderRadius: 3, transition: 'width 0.3s' },
  progressText: { fontSize: 11, color: 'var(--text-secondary)' },
  overlay: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  dialog: { background: 'var(--panel-bg)', borderRadius: 12, padding: 24, width: 500, maxWidth: '90vw' },
  dialogTitle: { marginBottom: 16, fontSize: 16 },
  field: { marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  input: { flex: 1, minWidth: 200, padding: '6px 10px', borderRadius: 6, border: '1px solid #4A4A4A', background: '#1E1E1E', color: 'var(--text-primary)', fontSize: 13 },
  numInput: { width: 50, padding: '6px', borderRadius: 6, border: '1px solid #4A4A4A', background: '#1E1E1E', color: 'var(--text-primary)', fontSize: 13, textAlign: 'center' },
  hint: { fontSize: 12, color: 'var(--text-secondary)' },
  select: { padding: '6px 10px', borderRadius: 6, border: '1px solid #4A4A4A', background: '#1E1E1E', color: 'var(--text-primary)', fontSize: 13 },
  buttons: { display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 },
  cancelBtn: { padding: '8px 20px', background: '#4A4A4A', color: 'var(--text-primary)', fontSize: 14, borderRadius: 8 },
}

export default TopBar
