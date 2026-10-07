import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { buildAiContext, buildInventoryDigest } from '../ai/prompts'
import {
  createMatchContext,
  draftsFromItems,
  draftsToApply,
  findNameCollisions,
  itemsForLoadScope,
  reconcileDrafts,
  type ItemDraft,
} from '../ai/convert'
import {
  buildChatMessages,
  mergeChatResponse,
  serializeDrafts,
} from '../ai/chat'
import { AiError, chat, createRequestController } from '../ai/deepseek'
import { extractJson, parseChatResponse, type LoadScopeRequest } from '../ai/parse'
import {
  countEffectiveCategoryChanges,
  planCategoryChanges,
  type CategoryChange,
} from '../ai/categoryEdit'
import { AiChatPanel } from '../components/AiChatPanel'
import { AiExtractPreview } from '../components/AiExtractPreview'
import { AiKeyPanel } from '../components/AiKeyPanel'
import { CategoryChangePreview } from '../components/CategoryChangePreview'
import { Button, EmptyState } from '../components/ui/primitives'
import { IconAlert } from '../components/ui/icons'
import { uid } from '../lib/id'
import { useT } from '../i18n'
import { useAppStore } from '../store/useAppStore'
import {
  addUsage,
  appendBubble,
  cancelAiRequest,
  clearAiSession,
  setAiCancel,
  settleApplied,
  useAiSessionStore,
} from '../store/useAiSessionStore'

/** AI 连续要了几轮数据还没动手，就停下来 —— 免得无限循环烧 token */
const MAX_AUTO_TURNS = 3

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
 *
 * ── 采纳不清空会话 ──────────────────────────────────────────────
 * 采纳走 settleApplied()，对话和没采纳的草稿都留着，直到用户自己点
 * 「新对话」。详见 useAiSessionStore.ts 顶部的说明。
 */
export function Ai() {
  const navigate = useNavigate()

  const data = useAppStore((s) => s.data)
  const derived = useAppStore((s) => s.derived)
  const aiApiKey = useAppStore((s) => s.aiApiKey)
  const applyDraftItems = useAppStore((s) => s.applyDraftItems)
  const applyCategoryPlan = useAppStore((s) => s.applyCategoryPlan)
  const notify = useAppStore((s) => s.notify)

  // send/apply 里要拼提示文案，所以 t 从这里拿；
  // 顺便这一句也让整个页面订阅语言变化。
  const { t, tc } = useT()

  /*
   * 会话状态全部来自 useAiSessionStore（内存级），不是 useState ——
   * 这样切到别的页面再回来，对话和没采纳的草稿都还在。
   * 刷新就清空：那个 store 不落盘，是刻意的。
   */
  const bubbles = useAiSessionStore((s) => s.bubbles)
  /* history 不订阅：界面上不显示它，send() 里是从 getState() 现取的 */
  const drafts = useAiSessionStore((s) => s.drafts)
  const changedKeys = useAiSessionStore((s) => s.changedKeys)
  const touchedKeys = useAiSessionStore((s) => s.touchedKeys)
  const removedKeys = useAiSessionStore((s) => s.removedKeys)
  const staleSourceCount = useAiSessionStore((s) => s.staleSourceCount)
  const categoryPlan = useAiSessionStore((s) => s.categoryPlan)
  const error = useAiSessionStore((s) => s.error)
  const running = useAiSessionStore((s) => s.running)
  const usage = useAiSessionStore((s) => s.usage)
  const lastTurnUsage = useAiSessionStore((s) => s.lastTurnUsage)

  /*
   * 「名字撞上了库里已有的东西」的那几条（issue 2 的正脸）。
   *
   * 程序**绝不替用户猜**：
   *   · 猜成「新建」→ 用户报的那个 bug：「我明明有，它又建了一个」
   *   · 猜成「更新」→ 更糟：「我没让它动那一条，它给我改了」
   * 所以默认那几条**不进采纳计划**，界面上必须先让他点一下：
   * 「就是这条」（更新）还是「另建一条新的」（他可能真有两根一样的数据线）。
   */
  const collisions = useMemo(
    () => findNameCollisions(drafts, data.items, derived),
    [drafts, data.items, derived],
  )

  /** 用户逐条确认过的选择：物品 id = 「就是它」；'new' = 「另建一条」 */
  const [duplicatePicks, setDuplicatePicks] = useState<Record<string, string | 'new'>>({})

  /** 还没做过选择的撞名条目 —— 它们会挡住采纳，按钮上要说清楚 */
  const unresolvedCollisions = useMemo(
    () => collisions.filter((c) => duplicatePicks[c.draftKey] === undefined),
    [collisions, duplicatePicks],
  )

  /**
   * 采纳计划。
   *
   * 撞名的处理**按条目**分流，所以这里传 'ask'（还没确认的那些会被排除在外），
   * 已经确认过的逐条通过 `duplicates`（下标 → 已有物品 id）注入。
   */
  const duplicatePlan = useMemo(() => {
    const map = new Map<number, string>()
    drafts.forEach((draft, index) => {
      const pick = duplicatePicks[draft.key]
      if (pick !== undefined && pick !== 'new' && !draft.sourceItemId) map.set(index, pick)
    })
    return map
  }, [drafts, duplicatePicks])

  const applyPlan = useMemo(
    () => draftsToApply(drafts, data.items, derived, removedKeys, 'ask', duplicatePlan),
    [drafts, data.items, derived, removedKeys, duplicatePlan],
  )

  /*
   * 预览区只显示**动过**的条目（issue 6）。
   *
   * 用户的场景：让 AI 把 189 件现有物品拉进来核对，它只改了 3 件。
   * 那 186 件没动的铺在预览底下，会把真正要看的东西全淹掉。
   *
   * 判定按 touchedKeys（整个会话累计的「动过」），而不是这一轮的 changedKeys ——
   * 上一轮改过的这一轮仍然要看得到，否则它会随着「清除高亮」消失。
   */
  const touchedSet = useMemo(() => new Set(touchedKeys), [touchedKeys])
  const touchedDrafts = useMemo(
    () => drafts.filter((d) => touchedSet.has(d.key)),
    [drafts, touchedSet],
  )
  const [showAllDrafts, setShowAllDrafts] = useState(false)
  const visibleDrafts = showAllDrafts ? drafts : touchedDrafts
  /** 拉进来当上下文、但一个字没改的那些 */
  const untouchedDraftCount = drafts.length - touchedDrafts.length

  /**
   * 会被删掉的那些。
   *
   * 名字直接**从草稿上取** —— 待删标记就在草稿对象上（`draft.removed`），
   * 那是唯一真源。以前这里还要去会话里另一个列表（`removedItems`）对名字，
   * 两处状态很容易漂；现在条目既然按标记留在草稿里，名字就顺手有了。
   *
   * 用 `applyPlan.discardIds`（而不是自己过滤 `draft.removed`）是为了和
   * 「真正会被落库的那批」严格一致：`applyPlan` 已经剔掉了指不到数据库的。
   */
  const willDiscard = useMemo(() => {
    const byId = new Map(drafts.map((draft) => [draft.sourceItemId ?? draft.key, draft]))
    const itemById = new Map(data.items.map((item) => [item.id, item]))
    return applyPlan.discardIds.map((id) => ({
      id,
      name: byId.get(id)?.name ?? itemById.get(id)?.name ?? id,
    }))
  }, [applyPlan.discardIds, drafts, data.items])

  const existingCount = drafts.filter((d) => d.sourceItemId).length
  const newCount = drafts.filter((d) => !d.sourceItemId).length
  const selectedCount = drafts.filter((d) => d.include).length

  const reset = () => {
    clearAiSession()
    setDuplicatePicks({})
  }

  const send = async (instruction: string) => {
    if (aiApiKey.trim() === '') {
      notify(t('ai.needKey'), 'error')
      return
    }

    // 会话状态现在跨页面存活，`running` 也跟着活 —— 所以这里要自己挡一道。
    // 不然「点了发送立刻切走、回来再点一次」就能发出两个并发请求。
    if (useAiSessionStore.getState().running) return

    appendBubble({ id: uid(), role: 'user', text: instruction })
    useAiSessionStore.setState({ running: true, error: null })

    const controller = createRequestController()
    setAiCancel(controller.cancel)

    try {
      // 每次发送都从 store 现取一次 —— 组件重挂过之后闭包里的旧值已经过期了
      const session = useAiSessionStore.getState()
      let historyNow = session.history
      /*
       * 先跟当前数据对一遍再发。
       *
       * 草稿是「针对某一份数据」的计划 —— 用户完全可能在聊天的同时自己删掉
       * 几件东西。指不到任何东西的那些会被**就地降级成新建**，
       * 而不是在采纳时被静默跳过（那会得到一个悄悄少了几条的结果）。
       */
      const freshState = useAppStore.getState()
      const reconciled = reconcileDrafts(session.drafts, freshState.data.items, freshState.derived)
      let draftsNow = reconciled.drafts
      useAiSessionStore.setState({
        drafts: draftsNow,
        // 界面上要如实说一句「有几条对应的东西已经不在了」
        staleSourceCount: reconciled.droppedSources,
      })
      let removedNow = session.removedKeys
      /*
       * 上一批已经采纳落库的那些条目，这一轮开头先告诉 AI 一声。
       *
       * 不说的话会出现这种事：用户说「把刚才那两条改成闲置」，而 AI 手里
       * 已经没有那两条草稿了（采纳完就移走了），于是它要么新建两条，
       * 要么反问「哪两条」。这句提示就是补上那个上下文。
       */
      let pending =
        session.appliedSummary === ''
          ? instruction
          : t('ai.appliedContext', { names: session.appliedSummary }) + instruction
      let touchedNow = new Set(session.touchedKeys)
      /** 会话里已有的分类计划 —— 这一轮新提的追加在后面 */
      let categoryPlanNow = session.categoryPlan

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

        useAiSessionStore.setState((state) => ({
          usage: addUsage(state.usage, result.usage),
          lastTurnUsage: result.usage,
        }))

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

          if (added.length > 0) {
            draftsNow = [...draftsNow, ...added]
            /*
             * ⚠️ **不要**因为「拉进来了」就把它们记成「动过」。
             *
             * 这是我踩过的坑，用户原话：「它还是把所有东西都放到草稿箱显示出来，
             * 但是让我采纳，只需要给我看更改的，还有删除的即可，不需要所有都展示。」
             *
             * 我原来的想法是「AI 要它们进来，正是因为它打算改它们」——
             * 但删除这个场景正好把这个理由推翻了：用户说「把不用的删掉」，
             * AI 只能要求「先全都拉进来我看看」，于是 189 条全被标成「动过」，
             * 而它真正动手的可能只有 5 条。剩下 184 条把要看的东西全淹了。
             *
             * 所以「拉进来」只是**上下文**，不是改动。谁真的被动过，
             * 由下面 mergeChatResponse 的 changedKeys 说了算
             * （AI 改了的在那里面、删了的进 removedKeys）。
             */
          }
          useAiSessionStore.setState({ drafts: draftsNow })

          appendBubble({
            id: uid(),
            role: 'assistant',
            text: parsed.reply || t('ai.needToSeeItems'),
            meta:
              added.length > 0
                ? tc(added.length, 'ai.loadedIntoDrafts')
                : t('ai.noMatchingItems'),
          })

          if (added.length === 0) break

          pending = t('ai.continueAfterLoad')
          continue
        }

        // ---- 纯问答 ----
        if (parsed.noChanges) {
          appendBubble({
            id: uid(),
            role: 'assistant',
            text: parsed.reply,
            meta: t('ai.noDraftChangesMeta'),
          })
          break
        }

        /*
         * ---- 分类改动 ----
         *
         * 照着**当前那份数据**算一份计划（一行都不改数据）。
         * 已经算好的条目会原样留着（AI 这一轮没提分类就说明它没想再动），
         * 新提的追加在后面 —— 和物品那边「没提到 = 不用动」是同一个规矩。
         */
        if (parsed.categoryChanges.length > 0) {
          const plan = planCategoryChanges(fresh.data, parsed.categoryChanges as CategoryChange[])
          const merged = [...categoryPlanNow, ...plan.entries]
          categoryPlanNow = merged
          useAiSessionStore.setState({ categoryPlan: merged })
        }

        // ---- 正常改动 ----
        const outcome = mergeChatResponse(parsed, draftsNow, matchCtx, fresh.derived)
        draftsNow = outcome.drafts
        removedNow = [...new Set([...removedNow, ...outcome.removedKeys])]
        for (const key of outcome.changedKeys) touchedNow.add(key)

        useAiSessionStore.setState({
          drafts: draftsNow,
          removedKeys: removedNow,
          changedKeys: outcome.changedKeys,
          touchedKeys: [...touchedNow],
        })

        const parts: string[] = []
        if (outcome.added > 0) parts.push(t('ai.metaAdded', { count: outcome.added }))
        if (outcome.updated > 0) parts.push(t('ai.metaUpdated', { count: outcome.updated }))
        if (outcome.removed > 0) parts.push(t('ai.metaDiscarded', { count: outcome.removed }))
        if (parts.length === 0) parts.push(t('ai.metaNoChanges'))
        else if (outcome.unchanged > 0) parts.push(t('ai.metaUnchanged', { count: outcome.unchanged }))
        if (outcome.unknownIds > 0) parts.push(t('ai.metaUnknownIds', { count: outcome.unknownIds }))

        appendBubble({
          id: uid(),
          role: 'assistant',
          text: parsed.reply || t('ai.noReplyNote'),
          meta: parts.join(' · '),
        })
        break
      }

      useAiSessionStore.setState({ history: historyNow })
    } catch (err) {
      useAiSessionStore.setState({ error: errorText(err) })
    } finally {
      useAiSessionStore.setState({ running: false })
      controller.dispose()
      setAiCancel(null)
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
    /*
     * 还没确认的撞名条目会挡住这一条路。
     *
     * 为什么是「挡住」而不是「先跳过它、把别的落了」：那些条目是用户想改的东西，
     * 静默跳过就是他报的那个 bug 的另一半 —— 「它没做，还不说」。
     * 所以宁可什么都不落，先把该点的点了。
     */
    if (unresolvedCollisions.length > 0) {
      notify(t('ai.needDedupeChoice', { count: unresolvedCollisions.length }), 'error')
      return
    }

    if (applyPlan.plan.length === 0 && applyPlan.discardIds.length === 0) {
      notify(t('ai.nothingToApply'), 'error')
      return
    }

    /*
     * 计划里的下标 → 原本那条草稿的 key，用来报「这次改了哪几条」。
     *
     * 注意：`appliedIds` 是按**计划**下标对齐的（applyDraftItems 里就是
     * `plan.map(() => null)`），所以两处都用计划下标，别混进 drafts 的下标。
     */
    const appliedDrafts = applyPlan.planKeys
      .map((key) => drafts.find((d) => d.key === key))
      .filter((d): d is ItemDraft => d !== undefined)

    const result = applyDraftItems({
      items: applyPlan.plan,
      discardIds: applyPlan.discardIds,
      /*
       * 撞名的逐条确认在这里生效。
       *
       * ⚠️ 用**计划里的下标**当键，不能用草稿的下标：
       * 计划会跳过「没用被勾选」和「还在等确认」的那些条目，
       * 两套下标一旦混用，确认就会落到别的条目上（把一件东西改错，
       * 或者该更新的又新建了一条）。
       */
      duplicates: applyPlan.duplicates,
    })

    /*
     * 落库之后才有真实 id，这里再把「草稿 key → 物品 id」绑回去 ——
     * 下一轮 AI 再碰这条草稿才是「更新」，而不是「又新建一条」。
     *
     * ⚠️ 必须在 applyDraftItems **之后**算：`result.appliedIds` 是它的返回值。
     * （这里原先写成在它之前算，结果一进 apply() 就抛
     * `Cannot access 'result' before initialization` —— 采纳直接整个崩掉，
     * 界面看上去就是「点了没反应」。补测试时抓出来的。）
     */
    const bindings = new Map<string, string>()
    applyPlan.planKeys.forEach((key, index) => {
      const id = result.appliedIds[index]
      if (id) bindings.set(key, id)
    })

    /*
     * 汇报用的是 `result`（**真的写了什么**），不是 `applyPlan`（打算写什么）。
     *
     * 这个区分是用户报的那个「他说删了、其实什么都没删」的另一半：
     * 以前这里报的是「打算删几条」，所以哪怕一件都没落库，
     * 提示和聊天气泡照样说「移入回收站 13」—— 用户看到的就是一句谎话。
     */
    const parts: string[] = []
    if (result.updated > 0) parts.push(t('ai.resultUpdated', { count: result.updated }))
    if (result.added > 0) parts.push(t('ai.resultAdded', { count: result.added }))
    if (result.discarded > 0) parts.push(t('ai.resultDiscarded', { count: result.discarded }))
    if (result.createdCategories > 0)
      parts.push(t('ai.resultNewCategories', { count: result.createdCategories }))
    if (result.createdLocations > 0)
      parts.push(t('ai.resultNewLocations', { count: result.createdLocations }))
    /*
     * 要求删、但数据库里已经找不到的那些 —— 必须说出来。
     * 不说的话，用户会得到「提示说删了 3 条、实际一条没动」这种最坏的组合。
     */
    if (result.missingDiscards > 0) {
      parts.push(tc(result.missingDiscards, 'ai.resultMissingDiscards'))
    }

    const summary = parts.join(t('ai.listSeparator'))
    const appliedNames = appliedDrafts
      .map((draft) => draft.name.trim())
      .filter((name) => name !== '')
      .slice(0, 12)
      .join(t('ai.listSeparator'))

    /*
     * 结算 —— **不是** reset。
     *
     * 用户的原话：「AI 采纳后聊天记录会消失，应该一直保留着，直到我自己
     * 手动选择新建。」所以这里只移走这次真的落库的草稿，对话和剩下的草稿
     * 全部留着；清空只由「新对话」按钮触发。
     */
    settleApplied({
      appliedKeys: applyPlan.planKeys,
      bindings,
      removedIds: applyPlan.discardIds,
      note:
        parts.length > 0 ? t('ai.appliedPrefix') + summary : t('ai.noChangesToast'),
      appliedSummary: appliedNames,
    })

    setDuplicatePicks({})

    notify(
      parts.length > 0 ? t('ai.appliedPrefix') + summary : t('ai.noChangesToast'),
      'success',
    )
    if (result.added > 0 && result.updated === 0) navigate('/items')
  }

  /**
   * 采纳**分类改动**。
   *
   * 和物品分开一个按钮，理由是这里的后果不一样：物品改错了你看得见那一件，
   * 分类改错了你只会看到「树变了样子」。所以别让它在同一个按钮里
   * 顺带发生 —— 用户得有机会单独过一眼。
   *
   * 采纳的是**计划**（每条的 id 和可行性都已经算好），落库那一头
   * 只负责搬运（`applyCategoryPlan`，纯函数、有 24 条用例钉着）。
   */
  const acceptCategoryPlan = () => {
    const parts: string[] = []
    const result = applyCategoryPlan(categoryPlan)

    if (result.created > 0) parts.push(tc(result.created, 'ai.catResultCreated'))
    if (result.renamed > 0) parts.push(tc(result.renamed, 'ai.catResultRenamed'))
    if (result.moved > 0) parts.push(tc(result.moved, 'ai.catResultMoved'))
    if (result.deleted > 0) parts.push(tc(result.deleted, 'ai.catResultDeleted'))

    const summary = parts.join(t('ai.listSeparator'))
    /*
     * 有连带影响时要补一句：删分类会让子分类和物品失去归属 ——
     * 物品一件不少，但用户得知道会发生这件事。
     */
    const extra: string[] = []
    if (result.reparentedChildren > 0) {
      extra.push(tc(result.reparentedChildren, 'ai.catDeleteChildren'))
    }
    if (result.affectedItems > 0) {
      extra.push(
        tc(result.affectedItems, 'ai.catDeleteItems') + t('ai.catDeleteNothingLost'),
      )
    }

    // 只把这一批移走；对话留着（和物品那边同一个规矩）
    useAiSessionStore.setState({ categoryPlan: [] })

    const text =
      parts.length > 0
        ? t('ai.catDone') + summary + (extra.length > 0 ? '；' + extra.join('；') : '')
        : t('ai.catResultNothing')

    appendBubble({ id: uid(), role: 'note', text })
    notify(text, 'success')
  }

  const cancel = () => cancelAiRequest()

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
          {/*
            分类改动**单独摆在最上面**，有自己的采纳按钮。
            不并进下面那块物品草稿里：分类是结构，改错了你只会看到
            「树变了样子」—— 得让它单独过一眼，而不是跟物品挤在一个按钮里
            顺带发生。
          */}
          {categoryPlan.length > 0 ? (
            <div className="stack" style={{ marginBottom: 'var(--gap-5)' }}>
              <CategoryChangePreview
                entries={categoryPlan}
                onChange={(next) => useAiSessionStore.setState({ categoryPlan: next })}
              />
              <div className="row wrap">
                <Button
                  variant="primary"
                  size="lg"
                  onClick={acceptCategoryPlan}
                  disabled={running || countEffectiveCategoryChanges(categoryPlan) === 0}
                >
                  {t('ai.catAccept')}
                  {countEffectiveCategoryChanges(categoryPlan) > 0
                    ? ` （${countEffectiveCategoryChanges(categoryPlan)}）`
                    : ''}
                </Button>
                <Button
                  size="lg"
                  onClick={() => useAiSessionStore.setState({ categoryPlan: [] })}
                  disabled={running}
                >
                  {t('ai.discardAll')}
                </Button>
              </div>
            </div>
          ) : null}

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
                <div className="row wrap">
                  {/*
                    「只显示改动过的」这个开关。
                    默认**只看改动过的** —— 189 条拉进来只改了 3 条的时候，
                    没动的那 186 条铺在下面只会把要看的淹掉（用户原话）。
                    但入口必须留在手边：有人就是想翻一眼拉进来的全貌。
                  */}
                  {untouchedDraftCount > 0 ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setShowAllDrafts((v) => !v)}
                    >
                      {showAllDrafts
                        ? t('ai.showOnlyChanged')
                        : t('ai.showUnchanged', { count: untouchedDraftCount })}
                    </Button>
                  ) : null}
                  {changedKeys.length > 0 ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => useAiSessionStore.setState({ changedKeys: [] })}
                    >
                      {t('ai.clearHighlight')}
                    </Button>
                  ) : null}
                </div>
              </div>

              {/*
                名字撞上库里已有物品的那几条 —— **必须让用户点一下**。
                默认什么都不做，见 Ai.tsx 顶部 collisions 的注释。
              */}
              {collisions.length > 0 ? (
                <div className="notice notice--alert">
                  <span className="notice__icon">
                    <IconAlert />
                  </span>
                  <span className="notice__body">
                    {t('ai.dedupeLead')}
                    <strong>{collisions.length}</strong>
                    {t('ai.dedupeTail')}
                    <div className="stack-sm" style={{ marginTop: 'var(--gap-2)' }}>
                      {collisions.map((collision) => {
                        const pick = duplicatePicks[collision.draftKey]
                        return (
                          <div key={collision.draftKey} className="row wrap">
                            <span className="grow">
                              <strong>{collision.draftName}</strong>
                              <span className="dim small">
                                {' '}
                                {t('ai.dedupeExisting', {
                                  location: collision.existingLocationLabel,
                                })}
                              </span>
                            </span>
                            <Button
                              size="sm"
                              variant={pick === collision.existingId ? 'primary' : undefined}
                              onClick={() =>
                                setDuplicatePicks((prev) => ({
                                  ...prev,
                                  [collision.draftKey]: collision.existingId,
                                }))
                              }
                            >
                              {t('ai.dedupeUpdate')}
                            </Button>
                            <Button
                              size="sm"
                              variant={pick === 'new' ? 'primary' : undefined}
                              onClick={() =>
                                setDuplicatePicks((prev) => ({
                                  ...prev,
                                  [collision.draftKey]: 'new',
                                }))
                              }
                            >
                              {t('ai.dedupeCreate')}
                            </Button>
                          </div>
                        )
                      })}
                    </div>
                  </span>
                </div>
              ) : null}

              {/*
                会被删掉的那几件。
                **必须单独列出来**：它们已经从草稿里被移走了，不会出现在
                上面那个列表里 —— 不列的话，用户在点「采纳」之前根本看不到
                自己将要失去哪几件东西（只能在按钮上看到一个数字）。
                用户原话：「只需要给我看更改的，还有删除的即可。」
              */}
              {willDiscard.length > 0 ? (
                <div className="notice notice--alert">
                  <span className="notice__icon">
                    <IconAlert />
                  </span>
                  <span className="notice__body small">
                    {tc(willDiscard.length, 'ai.willDiscardLead')}
                    <ul className="diff-list" style={{ marginTop: 'var(--gap-2)' }}>
                      {willDiscard.map((entry) => (
                        <li key={entry.id} className="diff-list__row">
                          <span className="diff-list__name">{entry.name}</span>
                        </li>
                      ))}
                    </ul>
                    {t('ai.willDiscardTail')}
                  </span>
                </div>
              ) : null}

              {visibleDrafts.length === 0 ? (
                /*
                 * 拉进来一堆、一条都没改、也没删。这时候**不铺列表**，
                 * 只说明「什么都没有改动」—— 一片空白会让人以为界面坏了。
                 *
                 * 注意这里不把 willDiscard 算进来：删了东西的话上面那块
                 * 已经把结果摆出来了，这一块只管「改动」。
                 */
                willDiscard.length > 0 ? null : (
                  <EmptyState
                    title={t('ai.noChangesInDraftsTitle')}
                    hint={
                      <>
                        {tc(drafts.length, 'ai.noChangesInDraftsHint')}
                        <br />
                        <Button size="sm" onClick={() => setShowAllDrafts(true)}>
                          {t('ai.showUnchanged', { count: untouchedDraftCount })}
                        </Button>
                      </>
                    }
                  />
                )
              ) : (
                <AiExtractPreview
                  drafts={visibleDrafts}
                  onChange={(next) => {
                    /*
                     * 预览只显示一部分，所以改了之后要**合并回完整草稿**里，
                     * 不能把整份草稿替换成可见的这一小段 —— 那会把没显示的
                     * 那些条目直接删掉（正是「偷偷弄丢数据」那类事故）。
                     */
                    const byKey = new Map(next.map((d) => [d.key, d]))
                    useAiSessionStore.setState((state) => {
                      /*
                       * 顺手把用户亲手改过的记进 touchedKeys。
                       * 不记的话：他刚改完的那条如果本来没被 AI 碰过，
                       * 立刻就会被「只显示改动过的」这个过滤器藏起来 ——
                       * 自己的改动在自己眼前消失，那是最吓人的一种。
                       */
                      const touched = new Set(state.touchedKeys)
                      for (const draft of next) touched.add(draft.key)
                      return {
                        drafts: state.drafts.map((d) => byKey.get(d.key) ?? d),
                        touchedKeys: [...touched],
                      }
                    })
                  }}
                  highlightKeys={changedKeys}
                />
              )}

              {/*
                有草稿对应的物品已经不在了（被删了 / 已被采纳过）。
                这些已经被就地降级成「新建」—— 不是静默跳过，所以必须说出来。
              */}
              {staleSourceCount > 0 ? (
                <div className="notice">
                  <span className="notice__body small">
                    {tc(staleSourceCount, 'ai.sourceMissing')}
                  </span>
                </div>
              ) : null}

              <div className="row wrap" style={{ paddingTop: 'var(--gap-3)' }}>
                <Button variant="primary" size="lg" onClick={apply} disabled={running}>
                  {t('ai.accept')}
                  {applyPlan.updating > 0 ? t('ai.acceptUpdating', { count: applyPlan.updating }) : ''}
                  {applyPlan.creating > 0 ? t('ai.acceptCreating', { count: applyPlan.creating }) : ''}
                  {applyPlan.discarding > 0
                    ? t('ai.acceptDiscarding', { count: applyPlan.discarding })
                    : ''}
                  {unresolvedCollisions.length > 0
                    ? t('ai.acceptWaitingDedupe', { count: unresolvedCollisions.length })
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
