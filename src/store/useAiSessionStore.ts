/**
 * AI 会话状态 —— **只在内存里活着**。
 *
 * ── 为什么必须搬家 ────────────────────────────────────────────────
 * 原来这些状态是 `Ai.tsx` 里的 `useState`。组件一卸载（去别的页面转一圈
 * 再回来）就全部归零：聊了半天的对话没了，AI 提取出来还**没采纳**的草稿
 * 也没了 —— 去设置页看一眼数据体检，回来就得重新让 AI 整理一遍，
 * 白烧一整轮 token。
 *
 * 所以搬到一个模块级的 store：**跨页面活着，但不落盘**。
 *
 * ── 为什么不落盘（这是刻意的，不是偷懒） ───────────────────────────
 * 用户明确选的是「只在页面之间活着，刷新就清空」。这跟省 token 是一件事：
 * 历史会一轮轮累积进 prompt，存下来就意味着下次打开还在为它付费。
 * 「新对话」按钮才是那个真正的重置开关。
 *
 * 所以：**不要**把这些字段塞进 IndexedDB / localStorage / 导出文件。
 * 有测试盯着这条（刷新后必须什么都不剩）。
 *
 * ── 「采纳」不再等于「清空」（这条是后加的，很容易被改回去）──────────
 * 早期版本里「采纳」直接调 clearAiSession()：刚谈妥的所有东西一次性落库，
 * 对话、草稿、上下文全部归零。用户报的是「AI 采纳后聊天记录会消失，
 * 应该一直保留着，直到我自己手动选择新建」—— 这是对的：
 *   · 一轮整理常常分几次采纳（先采纳前三条，再让 AI 调后面几条）
 *   · 采纳完还想接着问「刚才那批里 XX 那件我改主意了」
 * 所以采纳走 settleApplied()：**只移走这一次真的落库的那些草稿**，
 * 对话、剩下的草稿、累计 token 全部留着。清空只由「新对话」触发。
 *
 * ── 一个必须跟着处理的后果 ────────────────────────────────────────
 * 会话活得比页面久了，就出现一个以前不存在的问题：
 * **草稿是「针对某一份数据」的计划**，不是一份独立的东西。
 * 里面每一条的 `sourceItemId`、`locationId`、`matchedCategoryIds`
 * 都是**当时那份数据**里的 id。
 *
 * 如果这中间数据被**整体替换**过（清空 / 导入覆盖 / 回退快照 / 恢复脚手架），
 * 那些 id 就指不到任何东西了。而 `draftsToApply` 对
 * 「有 sourceItemId 但找不到」的处理是**静默跳过**（`continue`）——
 * 于是用户点「采纳」会得到一个**悄悄少了几条**的结果，
 * 界面上也不会说哪一条为什么不见了。
 *
 * 「默默少做一部分、还不说」正是这个项目一直在避免的事。
 * 所以整体替换数据的几个操作会作废会话，见 `useAppStore` 里的
 * `invalidateAiSession`。普通编辑（改一件物品）不受影响 ——
 * 那种情况下草稿仍然有效，清掉反而是白丢一段对话。
 */

import { create } from 'zustand'
import type { ChatTurn, ChatBubble } from '../ai/chat'
import type { ItemDraft } from '../ai/convert'
import type { CategoryPlanEntry } from '../ai/categoryEdit'
import type { AiUsage } from '../ai/deepseek'
import { uid } from '../lib/id'

export const EMPTY_USAGE: AiUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }

export function addUsage(a: AiUsage, b: AiUsage): AiUsage {
  return {
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens,
    totalTokens: a.totalTokens + b.totalTokens,
  }
}

export interface AiSessionState {
  /** 界面上显示的气泡 */
  bubbles: ChatBubble[]
  /** 发给 AI 的历史（跟气泡不是一回事：气泡有 meta，历史只有内容） */
  history: ChatTurn[]
  /** AI 提取出来、**还没采纳**的草稿 */
  drafts: ItemDraft[]
  /** 这一轮改动过的草稿 key，用来高亮 */
  changedKeys: string[]
  /**
   * 这一轮**真的被动过**的草稿 key（AI 改过、或者你就是把它拉进来看了一眼）。
   *
   * 和 changedKeys 的分工：changedKeys 是「这一轮刚改的」，用户点一下
   * 「清除高亮」就没了；这一份是**整个会话累计**的，用来回答预览区那个问题 ——
   * 「哪些条目需要我过目」。user 的原话：拉进来 189 条只改了 3 条，
   * 别把没动的 186 条也铺在预览底下。
   *
   * 记的是「动过」，不是「AI 改过」：用户自己手改过的条目也在这里，
   * 否则他刚改的那条会被自己的过滤器藏起来。
   */
  touchedKeys: string[]
  /**
   * 会被移进回收站的那些**已有物品 id**。
   *
   * 它和「草稿上的 `removed` 标记」是同一件事的两份记录，而且
   * `draftsToApply` 认的是这个列表（见那边的注释）。名字不在这里存 ——
   * 带待删标记的草稿本身就在 `drafts` 里，界面上直接从它取名字，
   * 免得两处状态漂。
   */
  removedKeys: string[]
  /**
   * 上一批已采纳的条目名字，用来在下一轮开头告诉 AI「这些已经真的生效了」。
   * 空字符串 = 这个会话里还没采纳过任何东西。
   */
  appliedSummary: string
  /**
   * 有多少条草稿「对应的物品已经不在了」（被删了、或者已经被采纳过）。
   *
   * 这些草稿会被**就地降级成新建**（见 `reconcileDrafts`）—— 那是为了不让
   * 采纳时静默少做几条。但这个降级本身得让用户知道，所以界面上会挂一条提示。
   * 0 = 一切正常，不显示。
   */
  staleSourceCount: number
  /**
   * AI 想对**分类**做的改动（**已经算好的计划**，还没采纳）。
   *
   * 用户要的能力：「我希望 ai 可以编辑分类，我可以让它帮我整理已有的分类。」
   *
   * 存的是算好的计划（`CategoryPlanEntry[]`）而不是 AI 的原始意图：
   *   · 每条都已经指向具体的分类 id（或者如实标成 missing）
   *   · 每条都说清了能不能做（ok / noop / duplicate / cycle）
   * 于是界面只需要照着渲染、采纳只需要照做，不用再解析一遍。
   *
   * ⚠️ 和物品草稿一样，它也是「**针对某一份数据**的计划」——
   * 里面的 id 都是当时那份数据的。所以 `invalidateAiSession` 也要清它。
   */
  categoryPlan: CategoryPlanEntry[]
  error: string | null
  running: boolean
  /** 本次会话累计消耗 */
  usage: AiUsage
  /** 上一轮消耗 —— 用来判断「是不是该开新对话了」 */
  lastTurnUsage: AiUsage
}

function emptySession(): AiSessionState {
  return {
    bubbles: [],
    history: [],
    drafts: [],
    changedKeys: [],
    touchedKeys: [],
    removedKeys: [],
    appliedSummary: '',
    staleSourceCount: 0,
    categoryPlan: [],
    error: null,
    running: false,
    usage: EMPTY_USAGE,
    lastTurnUsage: EMPTY_USAGE,
  }
}

export const useAiSessionStore = create<AiSessionState>()(() => emptySession())

/** 开一段新对话：清掉全部会话状态。刷新页面也会回到这个状态（因为根本不落盘）。 */
export function clearAiSession(): void {
  useAiSessionStore.setState(emptySession())
}

/** 往对话里加一条气泡 */
export function appendBubble(bubble: ChatBubble): void {
  useAiSessionStore.setState((state) => ({ bubbles: [...state.bubbles, bubble] }))
}

/* ------------------------------------------------------------------ */
/* 采纳之后：保住会话，只结算这一次真的落库的那些                        */
/* ------------------------------------------------------------------ */

export interface SettleAppliedInput {
  /** 这一次真的落库的草稿 key（更新的 + 新建的） */
  appliedKeys: readonly string[]  /**
   * 草稿 key → 落库后物品的真实 id。
   *
   * 为什么非要传进来：新建的那几条落库后才有 id，而草稿原来那个 key 是
   * 编出来的（`new-1` 之类）。不把它绑回真实 id，AI 下一轮再碰这一条时，
   * 草稿仍然是一张「要新建」的，于是库里立刻多出第二件一模一样的东西 ——
   * 用户报的「采纳完又多了一件」就是这个。
   */
  bindings: ReadonlyMap<string, string>
  /** 这一次真的移进回收站的物品 id */
  removedIds: readonly string[]
  /** 往对话里补的一条系统说明（采纳这件事本身也要留在聊天记录里） */
  note: string
  /**
   * 这一批已生效的条目名称，形如「棉签、碘伏棉签」。
   *
   * 它**不进 history**（history 只放真实的对话轮次，塞进假的 user 消息会让
   * 模型以为用户又说了那句话）。它的去处是下一轮指令开头的一句提示 ——
   * 否则用户接着说「刚才那批再改一下」，AI 手里已经没有那几条草稿了，
   * 只会一脸茫然地重新新建一遍。
   */
  appliedSummary: string
}

/**
 * 采纳之后的收尾。
 *
 * 四件事，一件都不能少：
 *   1. 把这次落库的草稿从草稿区**移走**（它们已经是数据库里的事实了，
 *      留在预览里只会让人以为「还没采纳」）
 *   2. 清掉它们对应的 removedKeys / changedKeys —— 否则下一次采纳会把
 *      同一批物品**再进一次回收站**
 *   3. 在聊天记录里留一条说明 —— 「采纳了」是这段对话里发生过的事，
 *      抹掉它，下次回来就不知道刚才那步做没做
 *   4. 把落库后的真实 id 绑回那些**没被采纳**的草稿（见 bindings 的注释）
 *
 * 对话（bubbles）和**没被采纳的**草稿一律不动。
 */
export function settleApplied(input: SettleAppliedInput): void {
  const applied = new Set(input.appliedKeys)
  const removed = new Set(input.removedIds)

  useAiSessionStore.setState((state) => ({
    drafts: state.drafts
      .filter((draft) => !applied.has(draft.key))
      .map((draft) => {
        const bound = input.bindings.get(draft.key)
        if (bound === undefined || draft.sourceItemId === bound) return draft
        /*
         * 绑上真实 id 之后，这条草稿从「要新建」变成了「改这一条」——
         * 这是防止「采纳完又多出一件」的关键一步。
         */
        return { ...draft, sourceItemId: bound }
      }),
    changedKeys: state.changedKeys.filter((key) => !applied.has(key)),
    touchedKeys: state.touchedKeys.filter((key) => !applied.has(key)),
    removedKeys: state.removedKeys.filter((id) => !removed.has(id)),
    bubbles: [...state.bubbles, { id: uid(), role: 'note', text: input.note }],
    appliedSummary: input.appliedSummary,
  }))
}

/* ------------------------------------------------------------------ */
/* 取消当前请求                                                        */
/* ------------------------------------------------------------------ */

/**
 * 取消回调放在模块级，不进 store。
 *
 * 理由：它不需要触发任何重渲染（界面上「取消」这个按钮的显隐由 `running` 决定），
 * 而且**必须能跨组件卸载存活** —— 用户点了发送马上切走，之前那个组件已经卸载了，
 * 回来之后「取消」还得管用。放在 store 里也行，但没必要的响应式状态
 * 只会让订阅变复杂。
 */
let cancelCurrent: (() => void) | null = null

export function setAiCancel(fn: (() => void) | null): void {
  cancelCurrent = fn
}

export function cancelAiRequest(): void {
  cancelCurrent?.()
}
