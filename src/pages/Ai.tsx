import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { buildAiContext, buildInventoryDigest } from '../ai/prompts'
import {
  createMatchContext,
  draftsFromItems,
  draftsToApply,
  itemsForLoadScope,
  type ItemDraft,
} from '../ai/convert'
import {
  buildChatMessages,
  mergeChatResponse,
  serializeDrafts,
  type ChatTurn,
} from '../ai/chat'
import { AiError, chat, createRequestController, type AiUsage } from '../ai/deepseek'
import { extractJson, parseChatResponse, type LoadScopeRequest } from '../ai/parse'
import { AiChatPanel, type ChatBubble } from '../components/AiChatPanel'
import { AiExtractPreview } from '../components/AiExtractPreview'
import { AiKeyPanel } from '../components/AiKeyPanel'
import { Button, EmptyState } from '../components/ui/primitives'
import { uid } from '../lib/id'
import { useT } from '../i18n'
import { useAppStore } from '../store/useAppStore'

/** AI 连续要了几轮数据还没动手，就停下来 —— 免得无限循环烧 token */
const MAX_AUTO_TURNS = 3

const EMPTY_USAGE: AiUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }

function addUsage(a: AiUsage, b: AiUsage): AiUsage {
  return {
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens,
    totalTokens: a.totalTokens + b.totalTokens,
  }
}

function errorText(err: unknown): string {
  if (err instanceof AiError) return err.message
  return err instanceof Error ? err.message : String(err)
}

/**
 * AI 助手。
 *
 * **只有一个对话框。** 早期版本拆成了「一次性录入 / 对话整理 / 整理已有物品」
 * 三个模式 —— 那是实现上的边界（新建 vs 更新）漏到了界面上，
 * 用户脑子里其实只有一件事：跟 AI 说一句，它帮我改。
 *
 * 具体怎么工作：
 *   · 草稿里可能混着「已经录入的物品」和「这次新加的」，
 *     采纳时自动分流（带 sourceItemId 的更新，不带的创建）
 *   · 用户现有的物品**不预先塞进 prompt**（500 件就是一万多 token），
 *     system 里只放一份「目录」（哪个分类有多少件）
 *   · AI 真需要具体条目时，用 loadScope 要，程序自动拉进草稿并再问它一轮
 */
export function Ai() {
  const navigate = useNavigate()

  const data = useAppStore((s) => s.data)
  const derived = useAppStore((s) => s.derived)
  const aiApiKey = useAppStore((s) => s.aiApiKey)
  const applyDraftItems = useAppStore((s) => s.applyDraftItems)
  const notify = useAppStore((s) => s.notify)

  // send/apply 里要拼提示文案，所以 t 从这里拿；
  // 顺便这一句也让整个页面订阅语言变化。
  const { t, tc } = useT()

  const [bubbles, setBubbles] = useState<ChatBubble[]>([])
  const [history, setHistory] = useState<ChatTurn[]>([])
  const [drafts, setDrafts] = useState<ItemDraft[]>([])
  const [changedKeys, setChangedKeys] = useState<string[]>([])
  /** 被移出草稿的 key —— 已有物品会在采纳时移入回收站 */
  const [removedKeys, setRemovedKeys] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  const [running, setRunning] = useState(false)
  const [usage, setUsage] = useState<AiUsage>(EMPTY_USAGE)
  const [lastTurnUsage, setLastTurnUsage] = useState<AiUsage>(EMPTY_USAGE)
  const cancelRef = useRef<(() => void) | null>(null)

  /** 采纳时会发生什么 —— 实时显示，让人心里有数 */
  const applyPlan = useMemo(
    () => draftsToApply(drafts, data.items, derived, removedKeys),
    [drafts, data.items, derived, removedKeys],
  )

  const existingCount = drafts.filter((d) => d.sourceItemId).length
  const newCount = drafts.filter((d) => !d.sourceItemId).length
  const selectedCount = drafts.filter((d) => d.include).length

  const reset = () => {
    setBubbles([])
    setHistory([])
    setDrafts([])
    setChangedKeys([])
    setRemovedKeys([])
    setError(null)
    setLastTurnUsage(EMPTY_USAGE)
  }

  const send = async (instruction: string) => {
    if (aiApiKey.trim() === '') {
      notify(t('ai.needKey'), 'error')
      return
    }

    setBubbles((prev) => [...prev, { id: uid(), role: 'user', text: instruction }])
    setRunning(true)
    setError(null)

    const controller = createRequestController()
    cancelRef.current = controller.cancel

    try {
      let historyNow = history
      let draftsNow = drafts
      let removedNow = removedKeys
      let pending = instruction

      for (let turn = 0; turn < MAX_AUTO_TURNS; turn++) {
        const fresh = useAppStore.getState()
        const matchCtx = createMatchContext(fresh.data, fresh.derived)
        const context = buildAiContext(fresh.data, fresh.derived)
        const digest = buildInventoryDigest(fresh.data, fresh.derived)

        const result = await chat({
          apiKey: aiApiKey,
          messages: buildChatMessages(
            context,
            digest,
            historyNow,
            serializeDrafts(draftsNow, fresh.derived),
            pending,
          ),
          signal: controller.signal,
        })

        setUsage((prev) => addUsage(prev, result.usage))
        setLastTurnUsage(result.usage)

        const parsed = parseChatResponse(extractJson(result.content))
        historyNow = [
          ...historyNow,
          { role: 'user', content: pending },
          { role: 'assistant', content: parsed.reply || t('ai.noReplyNote') },
        ]

        // ---- AI 说要先看现有物品：拉进草稿，然后自动再问一轮 ----
        if (parsed.loadScope) {
          const loaded = scopeToDrafts(parsed.loadScope, fresh, matchCtx)
          const known = new Set(draftsNow.map((d) => d.key))
          const added = loaded.filter((d) => !known.has(d.key))

          if (added.length > 0) draftsNow = [...draftsNow, ...added]
          setDrafts(draftsNow)

          setBubbles((prev) => [
            ...prev,
            {
              id: uid(),
              role: 'assistant',
              text: parsed.reply || t('ai.needToSeeItems'),
              meta:
                added.length > 0
                  ? tc(added.length, 'ai.loadedIntoDrafts')
                  : t('ai.noMatchingItems'),
            },
          ])

          if (added.length === 0) break

          pending = t('ai.continueAfterLoad')
          continue
        }

        // ---- 纯问答 ----
        if (parsed.noChanges) {
          setBubbles((prev) => [
            ...prev,
            { id: uid(), role: 'assistant', text: parsed.reply, meta: t('ai.noDraftChangesMeta') },
          ])
          break
        }

        // ---- 正常改动 ----
        const outcome = mergeChatResponse(parsed, draftsNow, matchCtx, fresh.derived)
        draftsNow = outcome.drafts
        removedNow = [...new Set([...removedNow, ...outcome.removedKeys])]

        setDrafts(draftsNow)
        setRemovedKeys(removedNow)
        setChangedKeys(outcome.changedKeys)

        const parts: string[] = []
        if (outcome.added > 0) parts.push(t('ai.metaAdded', { count: outcome.added }))
        if (outcome.updated > 0) parts.push(t('ai.metaUpdated', { count: outcome.updated }))
        if (outcome.removed > 0) parts.push(t('ai.metaDiscarded', { count: outcome.removed }))
        if (parts.length === 0) parts.push(t('ai.metaNoChanges'))
        else if (outcome.unchanged > 0) parts.push(t('ai.metaUnchanged', { count: outcome.unchanged }))
        if (outcome.unknownIds > 0) parts.push(t('ai.metaUnknownIds', { count: outcome.unknownIds }))

        setBubbles((prev) => [
          ...prev,
          {
            id: uid(),
            role: 'assistant',
            text: parsed.reply || t('ai.noReplyNote'),
            meta: parts.join(' · '),
          },
        ])
        break
      }

      setHistory(historyNow)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setRunning(false)
      controller.dispose()
      cancelRef.current = null
    }
  }

  /** 把 AI 要的那批现有物品转成草稿 */
  const scopeToDrafts = (
    scope: LoadScopeRequest,
    fresh: ReturnType<typeof useAppStore.getState>,
    matchCtx: ReturnType<typeof createMatchContext>,
  ): ItemDraft[] => {
    const loaded = itemsForLoadScope(scope, fresh.data, fresh.derived)
    return draftsFromItems(loaded, matchCtx, fresh.derived)
  }

  const apply = () => {
    if (applyPlan.plan.length === 0 && applyPlan.discardIds.length === 0) {
      notify(t('ai.nothingToApply'), 'error')
      return
    }

    const result = applyDraftItems({ items: applyPlan.plan, discardIds: applyPlan.discardIds })

    const parts: string[] = []
    if (result.updated > 0) parts.push(t('ai.resultUpdated', { count: result.updated }))
    if (result.added > 0) parts.push(t('ai.resultAdded', { count: result.added }))
    if (result.discarded > 0) parts.push(t('ai.resultDiscarded', { count: result.discarded }))
    if (result.createdCategories > 0)
      parts.push(t('ai.resultNewCategories', { count: result.createdCategories }))
    if (result.createdLocations > 0)
      parts.push(t('ai.resultNewLocations', { count: result.createdLocations }))

    notify(
      parts.length > 0
        ? t('ai.appliedPrefix') + parts.join(t('ai.listSeparator'))
        : t('ai.noChangesToast'),
      'success',
    )
    reset()
    if (result.added > 0 && result.updated === 0) navigate('/items')
  }

  const cancel = () => cancelRef.current?.()

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-header__title">{t('nav.titleAi')}</div>
          <div className="page-header__sub">{t('ai.subtitle')}</div>
        </div>
      </div>

      <AiKeyPanel />

      <div className="chat-layout">
        <AiChatPanel
          bubbles={bubbles}
          running={running}
          error={error}
          usage={usage}
          lastTurnUsage={lastTurnUsage}
          draftCount={drafts.length}
          onSend={(text) => void send(text)}
          onCancel={cancel}
          onReset={reset}
        />

        <div className="chat-layout__draft">
          {drafts.length === 0 ? (
            <EmptyState
              title={t('ai.draftEmptyTitle')}
              hint={
                <>
                  {t('ai.draftEmptyLead')}
                  <br />
                  · <strong>{t('ai.draftEmptyNewBold')}</strong>
                  {t('ai.draftEmptyNewTail')}
                  <br />
                  · <strong>{t('ai.draftEmptyEditBold')}</strong>
                  {t('ai.draftEmptyEditTail')}
                  <br />
                  <br />
                  {t('ai.draftEmptyFoot')}
                </>
              }
            />
          ) : (
            <div className="stack">
              <div className="row-between wrap">
                <div className="small muted">
                  {t('ai.summaryLead')}
                  <strong className="numeric">{drafts.length}</strong>
                  {t('ai.summaryMid')}
                  {existingCount > 0 ? (
                    <>
                      {t('ai.summaryExistingLead')}
                      <strong className="numeric">{existingCount}</strong>
                      {t('ai.summaryExistingMid')}
                      <strong>{t('ai.summaryExistingBold')}</strong>
                      {t('ai.summaryExistingTail')}
                    </>
                  ) : null}
                  {newCount > 0 ? (
                    <>
                      {existingCount > 0 ? t('ai.summaryJoinExisting') : t('ai.summaryJoinFresh')}
                      <strong className="numeric">{newCount}</strong>
                      {t('ai.summaryNewTail')}
                      {existingCount > 0 ? '' : t('ai.summaryCloseParen')}
                    </>
                  ) : null}
                  {changedKeys.length > 0 ? (
                    <span className="dim">{t('ai.summaryChangedHint')}</span>
                  ) : null}
                </div>
                {changedKeys.length > 0 ? (
                  <Button size="sm" variant="ghost" onClick={() => setChangedKeys([])}>
                    {t('ai.clearHighlight')}
                  </Button>
                ) : null}
              </div>

              <AiExtractPreview
                drafts={drafts}
                onChange={setDrafts}
                highlightKeys={changedKeys}
              />

              <div className="row wrap" style={{ paddingTop: 'var(--gap-3)' }}>
                <Button variant="primary" size="lg" onClick={apply} disabled={running}>
                  {t('ai.accept')}
                  {applyPlan.updating > 0 ? t('ai.acceptUpdating', { count: applyPlan.updating }) : ''}
                  {applyPlan.creating > 0 ? t('ai.acceptCreating', { count: applyPlan.creating }) : ''}
                  {applyPlan.discarding > 0
                    ? t('ai.acceptDiscarding', { count: applyPlan.discarding })
                    : ''}
                  {applyPlan.plan.length === 0 && applyPlan.discardIds.length === 0
                    ? t('ai.acceptNothing')
                    : ''}
                </Button>
                <Button size="lg" onClick={reset} disabled={running}>
                  {t('ai.discardAll')}
                </Button>
              </div>

              <div className="dim small">
                {t('ai.footerSelectedLead')}
                <strong className="numeric">{selectedCount}</strong>
                {t('ai.footerSelectedTail')}
                {applyPlan.untouched > 0 ? (
                  <>
                    {' '}
                    {t('ai.footerUntouchedLead')}
                    <span className="numeric">{applyPlan.untouched}</span>
                    {t('ai.footerUntouchedTail')}
                  </>
                ) : null}
                <br />
                {t('ai.footerSubmitLead')}
                <strong>{t('ai.footerTrashBold')}</strong>
                {t('ai.footerSubmitTail')}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
