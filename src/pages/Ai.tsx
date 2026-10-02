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
      notify('请先填入 DeepSeek API Key', 'error')
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
          { role: 'assistant', content: parsed.reply || '（这一轮没有说明）' },
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
              text: parsed.reply || '需要先看一下你现有的物品',
              meta:
                added.length > 0
                  ? `已把 ${added.length} 条现有物品拉进草稿（采纳时是更新，不会新建）`
                  : '没有找到符合条件的物品',
            },
          ])

          if (added.length === 0) break

          pending = '（上面那些物品已经拉进来了，请继续完成我刚才的指令）'
          continue
        }

        // ---- 纯问答 ----
        if (parsed.noChanges) {
          setBubbles((prev) => [
            ...prev,
            { id: uid(), role: 'assistant', text: parsed.reply, meta: '这条没有改动草稿' },
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
        if (outcome.added > 0) parts.push(`新增 ${outcome.added}`)
        if (outcome.updated > 0) parts.push(`修改 ${outcome.updated}`)
        if (outcome.removed > 0) parts.push(`移入回收站 ${outcome.removed}`)
        if (parts.length === 0) parts.push('没有改动')
        else if (outcome.unchanged > 0) parts.push(`其余 ${outcome.unchanged} 条未动`)
        if (outcome.unknownIds > 0) parts.push(`忽略 ${outcome.unknownIds} 个不存在的 id`)

        setBubbles((prev) => [
          ...prev,
          {
            id: uid(),
            role: 'assistant',
            text: parsed.reply || '（这一轮没有说明）',
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
      notify('没有需要写入的改动', 'error')
      return
    }

    const result = applyDraftItems({ items: applyPlan.plan, discardIds: applyPlan.discardIds })

    const parts: string[] = []
    if (result.updated > 0) parts.push(`更新 ${result.updated} 条`)
    if (result.added > 0) parts.push(`新增 ${result.added} 条`)
    if (result.discarded > 0) parts.push(`移入回收站 ${result.discarded} 条`)
    if (result.createdCategories > 0) parts.push(`新建 ${result.createdCategories} 个分类`)
    if (result.createdLocations > 0) parts.push(`新建 ${result.createdLocations} 个位置`)

    notify(parts.length > 0 ? `已${parts.join('、')}` : '没有变化', 'success')
    reset()
    if (result.added > 0 && result.updated === 0) navigate('/items')
  }

  const cancel = () => cancelRef.current?.()

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-header__title">AI 助手</div>
          <div className="page-header__sub">
            写要录的东西，或者说要改什么 —— 它会自己去找相关的物品，改完给你过目
          </div>
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
              title="这里会显示要改的东西"
              hint={
                <>
                  在左边告诉 AI 你想做什么。两种都行：
                  <br />
                  · <strong>录新的</strong>：把一段文字写在聊天框里，它拆成一条条物品
                  <br />
                  · <strong>改现有的</strong>：直接说「把药品改成 药品/补剂」，
                  它会自己把你现有的物品找出来、拉到这里
                  <br />
                  <br />
                  不管哪种，都要你点「采纳」才会写进数据库。
                </>
              }
            />
          ) : (
            <div className="stack">
              <div className="row-between wrap">
                <div className="small muted">
                  草稿共 <strong className="numeric">{drafts.length}</strong> 条
                  {existingCount > 0 ? (
                    <>
                      （其中 <strong className="numeric">{existingCount}</strong> 条是已有物品，
                      采纳时<strong>更新</strong>而不是新建）
                    </>
                  ) : null}
                  {newCount > 0 ? (
                    <>
                      {existingCount > 0 ? '，' : '（'}
                      <strong className="numeric">{newCount}</strong> 条是新录入的，采纳时创建
                      {existingCount > 0 ? '' : '）'}
                    </>
                  ) : null}
                  {changedKeys.length > 0 ? (
                    <span className="dim">· 加粗的是这一轮改过的</span>
                  ) : null}
                </div>
                {changedKeys.length > 0 ? (
                  <Button size="sm" variant="ghost" onClick={() => setChangedKeys([])}>
                    取消高亮
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
                  采纳
                  {applyPlan.updating > 0 ? ` · 更新 ${applyPlan.updating}` : ''}
                  {applyPlan.creating > 0 ? ` · 新建 ${applyPlan.creating}` : ''}
                  {applyPlan.discarding > 0 ? ` · 删除 ${applyPlan.discarding}` : ''}
                  {applyPlan.plan.length === 0 && applyPlan.discardIds.length === 0
                    ? '（没有改动）'
                    : ''}
                </Button>
                <Button size="lg" onClick={reset} disabled={running}>
                  全部放弃
                </Button>
              </div>

              <div className="dim small">
                已勾选 <strong className="numeric">{selectedCount}</strong> 条。
                {applyPlan.untouched > 0 ? (
                  <>
                    {' '}
                    另有 <span className="numeric">{applyPlan.untouched}</span> 条没被你改动过，
                    采纳时会跳过 —— 不会白刷它们的修改时间。
                  </>
                ) : null}
                <br />
                只有点了「采纳」才会写进数据库。删掉的已有物品是进<strong>回收站</strong>，
                可以恢复。
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
