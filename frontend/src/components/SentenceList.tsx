import { useState } from 'react'
import type { AppPhase, Sentence } from '../App'

interface Props {
  phase: AppPhase
  progress: { task: string; percent: number; message: string }
  sentences: Sentence[]
  selectedSentence: number | null
  onSentenceClick: (s: Sentence) => void
  onSentenceEdit: (id: number, text: string) => void
  onSentenceTimeEdit: (id: number, start: number, end: number) => void
  onMergeSentences: (ids: number[]) => void
  sentencesBackup: Sentence[] | null
  onUndoMerge: () => void
}

function SentenceList({ phase, progress, sentences, selectedSentence, onSentenceClick, onSentenceEdit, onSentenceTimeEdit, onMergeSentences, sentencesBackup, onUndoMerge }: Props) {
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editingField, setEditingField] = useState<'text' | 'start' | 'end' | null>(null)
  const [editValue, setEditValue] = useState('')
  const [checked, setChecked] = useState<Set<number>>(new Set())

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60)
    const sec = Math.floor(s % 60)
    const ms = Math.floor((s % 1) * 100)
    return `${m}:${String(sec).padStart(2, '0')}.${String(ms).padStart(2, '0')}`
  }

  const startEdit = (s: Sentence, field: 'text' | 'start' | 'end') => {
    setEditingId(s.id)
    setEditingField(field)
    setEditValue(field === 'text' ? s.text : field === 'start' ? String(s.start) : String(s.end))
  }

  const commitEdit = (s: Sentence) => {
    if (editingField === 'text') onSentenceEdit(s.id, editValue)
    else if (editingField === 'start') {
      const v = parseFloat(editValue)
      if (!isNaN(v) && v < s.end) onSentenceTimeEdit(s.id, v, s.end)
    } else if (editingField === 'end') {
      const v = parseFloat(editValue)
      if (!isNaN(v) && v > s.start) onSentenceTimeEdit(s.id, s.start, v)
    }
    setEditingId(null); setEditingField(null)
  }

  const toggleCheck = (id: number) => {
    setChecked(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const handleMerge = () => {
    const ids = Array.from(checked).sort((a, b) => a - b)
    if (ids.length < 2) return
    // 检查是否连续
    const sentenceIds = sentences.map(s => s.id)
    const indices = ids.map(id => sentenceIds.indexOf(id)).sort((a, b) => a - b)
    const isConsecutive = indices.every((v, i, arr) => i === 0 || v === arr[i - 1] + 1)
    if (!isConsecutive) {
      alert('只能合并相邻的句子，请取消不相邻的勾选')
      return
    }
    onMergeSentences(ids)
    setChecked(new Set())
  }

  const checkAll = () => {
    if (checked.size === sentences.length) setChecked(new Set())
    else setChecked(new Set(sentences.map(s => s.id)))
  }

  // 空状态
  if (sentences.length === 0) {
    let icon = '🐱'; let msg = '还没导入片段哦~\n导入了我帮你把对话\n拆成一句一句的！'; let title = '等待导入'
    if (phase === 'imported' || phase === 'clipped') { icon = '✂️'; msg = '截取片段后\n点击"识别对白"\n我会帮你识别'; title = '等待识别' }
    else if (phase === 'extracting') { icon = '⏳'; msg = '正在截取片段...'; title = '截取中' }
    else if (phase === 'separating') { icon = '🎵'; msg = `分离人声中...`; title = '分离中' }
    else if (phase === 'transcribing') { icon = '📝'; msg = `识别对白中...\n${progress.message}`; title = '转写中' }
    else if (phase === 'separated') { icon = '🔍'; msg = '没有识别到对白\n请检查片段是否有语音'; title = '无对白' }

    return (
      <div style={styles.container}>
        <div style={styles.header}><span>📝 句子列表</span><span style={styles.count}>0 句</span></div>
        <div style={styles.empty}>
          <div style={styles.catIcon}>{icon}</div>
          <div style={styles.bubble}>
            <div style={styles.bubbleTail} />
            {msg.split('\n').map((l, i) => <span key={i}>{l}<br /></span>)}
          </div>
          <div style={styles.phase}>{title}</div>
        </div>
      </div>
    )
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <span>📝 句子列表</span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {sentencesBackup && (
            <button style={{ ...styles.mergeBtn, background: '#E07B7B' }} onClick={onUndoMerge}>
              ↩ 撤销合并
            </button>
          )}
          {checked.size >= 2 && (
            <button style={styles.mergeBtn} onClick={handleMerge}>
              🔗 合并 {checked.size} 句
            </button>
          )}
          <button style={styles.checkAllBtn} onClick={checkAll}>
            {checked.size === sentences.length ? '取消全选' : '全选'}
          </button>
          <span style={styles.count}>{sentences.length} 句</span>
        </div>
      </div>
      <div style={styles.list}>
        {sentences.map((s) => (
          <div key={s.id}
            style={{ ...styles.item, background: selectedSentence === s.id ? 'rgba(255,159,67,0.15)' : checked.has(s.id) ? 'rgba(255,159,67,0.08)' : 'transparent' }}
            onClick={() => onSentenceClick(s)}>

            <div style={styles.itemRow}>
              <input type="checkbox" checked={checked.has(s.id)}
                onChange={() => toggleCheck(s.id)}
                onClick={e => e.stopPropagation()}
                style={styles.checkbox} />

              <span style={styles.itemNum}>#{s.id}</span>

              <span style={styles.itemTime}>
                {editingId === s.id && editingField === 'start' ? (
                  <input value={editValue} onChange={e => setEditValue(e.target.value)}
                    onBlur={() => commitEdit(s)} onKeyDown={e => e.key === 'Enter' && commitEdit(s)}
                    style={styles.inlineInput} autoFocus />
                ) : (
                  <span onClick={(e) => { e.stopPropagation(); startEdit(s, 'start'); }}
                    style={styles.editable} title="点击编辑开始时间">
                    {formatTime(s.start)}
                  </span>
                )}
                {' → '}
                {editingId === s.id && editingField === 'end' ? (
                  <input value={editValue} onChange={e => setEditValue(e.target.value)}
                    onBlur={() => commitEdit(s)} onKeyDown={e => e.key === 'Enter' && commitEdit(s)}
                    style={styles.inlineInput} autoFocus />
                ) : (
                  <span onClick={(e) => { e.stopPropagation(); startEdit(s, 'end'); }}
                    style={styles.editable} title="点击编辑结束时间">
                    {formatTime(s.end)}
                  </span>
                )}
              </span>
            </div>

            <div style={styles.itemTextRow}>
              {editingId === s.id && editingField === 'text' ? (
                <input value={editValue} onChange={e => setEditValue(e.target.value)}
                  onBlur={() => commitEdit(s)} onKeyDown={e => e.key === 'Enter' && commitEdit(s)}
                  style={{ ...styles.inlineInput, width: '100%' }} autoFocus />
              ) : (
                <span style={styles.itemText}
                  onClick={(e) => { e.stopPropagation(); startEdit(s, 'text'); }}
                  title="双击编辑文本">
                  {s.text}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: { flex: 1, background: 'var(--panel-bg)', borderRadius: 'var(--border-radius)', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 14px', borderBottom: '1px solid #4A4A4A', fontSize: 14, fontWeight: 600, flexShrink: 0, flexWrap: 'wrap', gap: 6 },
  count: { fontSize: 12, color: 'var(--text-secondary)', background: '#4A4A4A', padding: '2px 8px', borderRadius: 10 },
  mergeBtn: { padding: '4px 10px', background: 'var(--accent)', color: '#2C2C2C', fontWeight: 600, fontSize: 12, borderRadius: 6 },
  checkAllBtn: { padding: '4px 8px', background: '#4A4A4A', color: 'var(--text-secondary)', fontSize: 11, borderRadius: 6 },
  empty: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 20 },
  catIcon: { fontSize: 40 },
  bubble: { position: 'relative' as const, background: '#4A4A4A', borderRadius: 14, padding: '14px 18px', fontSize: 13, color: 'var(--text-secondary)', textAlign: 'center' as const, lineHeight: 1.7, maxWidth: 220 },
  bubbleTail: { position: 'absolute' as const, top: -8, left: '50%', marginLeft: -6, width: 0, height: 0, borderLeft: '8px solid transparent', borderRight: '8px solid transparent', borderBottom: '8px solid #4A4A4A' },
  phase: { fontSize: 11, color: 'var(--accent)' },
  list: { flex: 1, overflowY: 'auto', padding: '4px 0' },
  item: { padding: '6px 10px', cursor: 'pointer', borderBottom: '1px solid #3A3A3A', transition: 'background 0.15s' },
  itemRow: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 },
  checkbox: { width: 14, height: 14, accentColor: 'var(--accent)', cursor: 'pointer', flexShrink: 0 },
  itemNum: { fontSize: 11, color: 'var(--accent)', fontWeight: 600, minWidth: 24 },
  itemTime: { fontSize: 10, color: 'var(--text-secondary)', fontFamily: 'monospace', flex: 1 },
  editable: { cursor: 'pointer', padding: '1px 3px', borderRadius: 3, borderBottom: '1px dashed #555' },
  inlineInput: { background: '#1E1E1E', color: 'var(--text-primary)', border: '1px solid var(--accent)', borderRadius: 4, padding: '2px 6px', fontSize: 12, fontFamily: 'monospace', outline: 'none', width: 80 },
  itemTextRow: { paddingLeft: 20 },
  itemText: { fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.4, cursor: 'pointer' },
}

export default SentenceList
