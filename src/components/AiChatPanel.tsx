import { useEffect, useRef, useState } from 'react'
import type { AiUsage } from '../ai/deepseek'
import type { ChatBubble } from '../ai/chat'
import { IconAlert, IconSparkle } from './ui/icons'
import { Button, ConfirmDialog } from './ui/primitives'
import { useT, type TFunction } from '../i18n'

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

/**
 * 起步示例：点一下就把整段填进输入框。
 *
 * 这里**存的是 key、不是文字** —— 模块级的常量要是在模块加载时就把 t() 的结果
 * 存下来，之后再切语言它不会变，按钮上会一直留着一开始那门语言。
 * 所以写成函数，渲染时再求值。
 *
 * 英文那三条不是逐字翻译：要读起来像英语使用者真会打进去的话，
 * 而且要对得上这个 App 的用法（一个输入框，既能录新的、也能改现有的）。
 */
function starters(t: TFunction): string[] {
  return [t('ai.starter1'), t('ai.starter2'), t('ai.starter3')]
}

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
  const { t } = useT()

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
          <span className="small">{t('ai.panelTitle')}</span>
        </span>
        <span className="row" style={{ gap: 'var(--gap-3)' }}>
          {usage.totalTokens > 0 ? (
            <span className="tiny numeric" title={t('ai.usageTitle')}>
              {t('ai.usageLine', {
                last: lastTurnUsage.totalTokens,
                total: usage.totalTokens,
              })}
            </span>
          ) : null}
          <Button size="sm" onClick={askReset} disabled={running} title={t('ai.newChatTitle')}>
            {t('ai.newChat')}
          </Button>
        </span>
      </div>

      <div className="chat-panel__stream" ref={streamRef}>
        {bubbles.length === 0 ? (
          <div className="chat-panel__empty">
            <div className="small" style={{ marginBottom: 'var(--gap-3)' }}>
              <strong>{t('ai.emptyNewBold')}</strong>
              {t('ai.emptyNewTail')}
              <br />
              <strong>{t('ai.emptyEditBold')}</strong>
              {t('ai.emptyEditTail')}
            </div>
            <div className="stack-sm">
              {starters(t).map((starter) => (
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
            <span className="small dim">{t('ai.thinking')}</span>
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
              ? t('ai.placeholderEmpty')
              : t('ai.placeholderWithDraft', { count: draftCount })
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
              {t('common.cancel')}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="primary"
              block
              onClick={() => send(draft)}
              disabled={draft.trim() === ''}
            >
              {t('ai.send')}
            </Button>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmReset}
        title={t('ai.resetTitle')}
        confirmLabel={t('ai.resetConfirm')}
        cancelLabel={t('ai.resetCancel')}
        message={
          draftCount > 0 ? (
            <>
              {t('ai.resetHasDraftsLead')}
              <strong>{draftCount}</strong>
              {t('ai.resetHasDraftsMid')}
              <strong>{t('ai.resetNotSavedBold')}</strong>
              {t('ai.resetHasDraftsTail')}
              <br />
              <br />
              {t('ai.resetKeepHint')}
              <br />
              <br />
              <span className="dim">{t('ai.resetBenefit')}</span>
            </>
          ) : (
            <>{t('ai.resetEmptyBody')}</>
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
