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
import type { AiUsage } from '../ai/deepseek'

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
  /** 被移出草稿的已有物品 id —— 采纳时移进回收站 */
  removedKeys: string[]
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
    removedKeys: [],
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
