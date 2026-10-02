import { useEffect, useRef, useState } from 'react'
import type { AiUsage } from '../ai/deepseek'
import { IconAlert, IconSparkle } from './ui/icons'
import { Button, ConfirmDialog } from './ui/primitives'

export interface ChatBubble {
  id: string
  role: 'user' | 'assistant' | 'note'
  text: string
  /** 气泡下方的小字，例如「新增 3 · 修改 5 · 删除 1」 */
  meta?: string
}

interface Props {
  bubbles: ChatBubble[]
  running: boolean
  error: string | null
  /** 本次对话累计消耗 */
  usage: AiUsage
  /** 上一轮消耗 —— 用来判断「是不是该开新对话了」 */
  lastTurnUsage: AiUsage
  draftCount: number
  onSend: (text: string) => void
  onCancel: () => void
  onReset: () => void
}

const STARTERS = [
  '先把这段录进去：\n\n衣柜里有一件灰色羊毛衫，两条牛仔裤，床头柜上有个旧手机。',
  '把没分类的那些都归一下类，该新建分类就新建',
  '把我所有的物品按分类和位置检查一遍，明显不合适的纠正过来',
]

/**
 * 对话整理面板。
 *
 * 这一块只负责「说话」，草稿的展示与采纳在旁边的预览面板里 ——
 * 两件事分开，用户才能一边聊一边盯着结果看。
 */
export function AiChatPanel({
  bubbles,
  running,
  error,
  usage,
  lastTurnUsage,
  draftCount,
  onSend,
  onCancel,
  onReset,
}: Props) {
  const [draft, setDraft] = useState('')
  const [confirmReset, setConfirmReset] = useState(false)
  const streamRef = useRef<HTMLDivElement>(null)

  // 新消息进来时滚到底部
  useEffect(() => {
    const node = streamRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [bubbles.length, running])

  const send = (text: string) => {
    const trimmed = text.trim()
    if (trimmed === '' || running) return
    onSend(trimmed)
    setDraft('')
  }

  const askReset = () => {
    if (draftCount > 0 || bubbles.length > 0) setConfirmReset(true)
    else onReset()
  }

  return (
    <div className="chat-panel">
      <div className="chat-panel__head">
        <span className="row" style={{ gap: 'var(--gap-2)' }}>
          <IconSparkle size={14} />
          <span className="small">和 AI 商量</span>
        </span>
        <span className="row" style={{ gap: 'var(--gap-3)' }}>
          {usage.totalTokens > 0 ? (
            <span className="tiny numeric" title="上一轮消耗 / 本次对话累计">
              上轮 {lastTurnUsage.totalTokens} · 共 {usage.totalTokens}
            </span>
          ) : null}
          <Button
            size="sm"
            onClick={askReset}
            disabled={running}
            title="清空对话和草稿，重新开始"
          >
            新对话
          </Button>
        </span>
      </div>

      <div className="chat-panel__stream" ref={streamRef}>
        {bubbles.length === 0 ? (
          <div className="chat-panel__empty">
            <div className="small" style={{ marginBottom: 'var(--gap-3)' }}>
              <strong>要录新的</strong>：把东西写在这里，它拆成一条条物品。
              <br />
              <strong>要改现有的</strong>：直接说 —— 比如「把药品改成 药品/补剂」，
              它会自己把你现有的物品找出来放到右边。
            </div>
            <div className="stack-sm">
              {STARTERS.map((starter) => (
                <button
                  key={starter}
                  type="button"
                  className="chat-starter"
                  onClick={() => setDraft(starter)}
                >
                  {starter.split('\n')[0]}
                </button>
              ))}
            </div>
          </div>
        ) : (
          bubbles.map((bubble) => (
            <div key={bubble.id} className={`chat-bubble chat-bubble--${bubble.role}`}>
              <div className="chat-bubble__text">{bubble.text}</div>
              {bubble.meta ? <div className="chat-bubble__meta">{bubble.meta}</div> : null}
            </div>
          ))
        )}

        {running ? (
          <div className="chat-bubble chat-bubble--assistant chat-bubble--pending">
            <span className="spinner" style={{ width: 12, height: 12, borderWidth: 2 }} />
            <span className="small dim">正在想…</span>
          </div>
        ) : null}
      </div>

      {error !== null ? (
        <div className="notice notice--alert" style={{ margin: '0 var(--gap-3)' }}>
          <span className="notice__icon">
            <IconAlert />
          </span>
          <span className="notice__body small">{error}</span>
        </div>
      ) : null}

      <div className="chat-panel__composer">
        <textarea
          className="textarea chat-panel__input"
          value={draft}
          disabled={running}
          placeholder={
            draftCount === 0
              ? '写下要录的东西，或者说要改什么…'
              : `继续说（右边草稿 ${draftCount} 条）。Enter 发送，Shift+Enter 换行`
          }
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              send(draft)
            }
          }}
        />
        <div className="row">
          {running ? (
            <Button size="sm" onClick={onCancel} block>
              取消
            </Button>
          ) : (
            <Button
              size="sm"
              variant="primary"
              block
              onClick={() => send(draft)}
              disabled={draft.trim() === ''}
            >
              发送
            </Button>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmReset}
        title="重新开一个对话？"
        confirmLabel="开始新对话"
        cancelLabel="继续当前对话"
        message={
          draftCount > 0 ? (
            <>
              当前草稿里的 <strong>{draftCount}</strong> 条会全部丢掉 ——
              它们<strong>还没有写进数据库</strong>，所以是真的没了。
              <br />
              <br />
              想保留就先点「采纳选中的」，再开新对话。
              <br />
              <br />
              <span className="dim">
                重新开一轮的好处：历史清空，每轮要重发的内容更少，也更省 tokens。
              </span>
            </>
          ) : (
            <>会清空当前的对话记录，重新开始。</>
          )
        }
        onConfirm={() => {
          setConfirmReset(false)
          onReset()
        }}
        onCancel={() => setConfirmReset(false)}
      />
    </div>
  )
}
