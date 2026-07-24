import type { Sentence } from '../App'

interface Props {
  statusMsg: string
  sentences: Sentence[]
}

function StatusBar({ statusMsg, sentences }: Props) {
  return (
    <div style={styles.bar}>
      <div style={styles.left}><span style={styles.text}>{statusMsg}</span></div>
      <div style={styles.right}>
        <span style={styles.progress}>{sentences.length > 0 ? `共 ${sentences.length} 句` : ''}</span>
        <button style={styles.muteBtn} title="静音音效">🔊</button>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  bar: { height: 32, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 14px', background: 'var(--panel-bg)', borderTop: '1px solid #4A4A4A', flexShrink: 0 },
  left: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-secondary)' },
  text: {},
  right: { display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: 'var(--text-secondary)' },
  progress: {},
  muteBtn: { padding: '2px 6px', background: 'transparent', color: 'var(--text-secondary)', fontSize: 14 },
}

export default StatusBar
