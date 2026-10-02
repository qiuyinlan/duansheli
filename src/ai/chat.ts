/**
 * 对话整理。
 *
 * 和「批量录入」的区别：草稿会**跨轮次保留**，你可以用自然语言让 AI 反复修改，
 * 每一轮都告诉你改了什么，最后再决定采纳哪些。
 *
 * 安全底线：
 *   · AI 每轮必须返回**完整**的物品列表，漏掉的条目会被我们**保留**而不是删掉
 *   · 删除只能由 AI 显式标 removed 触发
 *   · 无论如何都不会自动写进数据库，必须用户点「采纳」
 */

import type { RawRevisedItem } from './parse'
import type { ChatMessage } from './deepseek'
import type { AiContext } from './prompts'
import { renderContextBlock } from './prompts'
import type { ItemDraft, MatchContext } from './convert'
import { toItemDraft } from './convert'
import type { DerivedContext } from '../store/selectors'
import { uid } from '../lib/id'

/* ------------------------------------------------------------------ */
/* 草稿 ⇄ 发给 AI 的形状                                               */
/* ------------------------------------------------------------------ */

/** 发给 AI 的草稿形状：全部用人话（名称路径），不用 id */
export interface DraftForAi {
  id: string
  name: string
  quantity: number
  categoryPaths: string[][]
  location: string[] | null
  tags: string[]
  attributes: Record<string, string>
  note: string
}

type DraftContent = Omit<DraftForAi, 'id'>

/**
 * 草稿的「当前有效状态」。
 *
 * 用**已匹配到的**分类/位置，加上用户**已经采纳**的新建议 ——
 * 也就是「现在点采纳会得到什么」。没采纳的待定建议不发给 AI，
 * 免得它以为那些已经生效了。
 */
export function effectiveContent(draft: ItemDraft, derived: DerivedContext): DraftContent {
  return {
    name: draft.name.trim(),
    quantity: draft.quantity,
    categoryPaths: [
      ...draft.matchedCategoryIds.map((id) => derived.categoryIndex.pathNames(id)),
      ...(draft.adoptNewCategories ? draft.newCategoryPaths : []),
    ].filter((path) => path.length > 0),
    location: draft.locationId
      ? derived.index.pathNames(draft.locationId)
      : draft.adoptNewLocation && draft.newLocationPath
        ? draft.newLocationPath
        : null,
    tags: [...draft.tags],
    attributes: { ...draft.attrs },
    note: draft.note.trim(),
  }
}

export function serializeDrafts(drafts: ItemDraft[], derived: DerivedContext): DraftForAi[] {
  return drafts.map((draft) => ({ id: draft.key, ...effectiveContent(draft, derived) }))
}

/** 内容指纹：用来判断这一条到底有没有被改动 */
function signature(content: DraftContent): string {
  return [
    content.name,
    String(content.quantity),
    content.categoryPaths
      .map((path) => path.join('/'))
      .sort()
      .join('|'),
    content.location ? content.location.join('/') : '',
    [...content.tags].sort().join('|'),
    Object.entries(content.attributes)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join('|'),
    content.note,
  ].join('\u0000')
}

/* ------------------------------------------------------------------ */
/* Prompt                                                              */
/* ------------------------------------------------------------------ */

const CHAT_SYSTEM = `你是「断舍离」这款个人物品整理工具里的助手。
用户正在和你来回沟通，一起把一批待录入的物品整理好。

每条用户消息里你会看到：
【已有分类】【已有位置】【已有属性】【已有标签】—— 用户目前的体系
【当前的物品草稿】—— 一个 json，每条带 id
【用户的指令】—— 用户这一轮想让你做什么

你要输出一个 json 对象：
{
  "reply": "用中文简短说明你这一轮改了什么",
  "items": [ ...完整的物品列表... ]
}

每条物品长这样：
{
  "id": "草稿里原来的 id，必须原样保留",
  "name": "长管油口红",
  "quantity": 1,
  "categories": [["化妆品", "唇妆"]],
  "location": ["家", "卧室", "梳妆台"],
  "tags": [],
  "attributes": { "品牌": "某品牌" },
  "note": ""
}

硬性规则：
1. **items 必须是完整的列表**，包含你没有改动的那些，id 原样保留。
   漏掉某条等于告诉程序「这条不要了」，所以除非用户让你删，否则一条都不能省。
2. 用户让你新增物品时，给它一个你自己起的新 id，例如 "new-1"。
3. 用户让你删掉某条时，不要直接省略它，而是在那一项上加 "removed": true。
   这样程序才分得清「你是要删它」还是「你忘了写它」。
4. 如果【当前的物品草稿】是空的，说明这是第一轮 —— 用户的指令里通常是一段
   自然语言描述，你要把它拆成一件件物品。
5. categories 的优先级：
   a) 用户明确说了某个分类名 → 就用它，**即使不在【已有分类】里**
   b) 否则找【已有分类】里语义相符的
   c) 都没有才新建
   **绝对不要把物品塞进不相干的已有分类。** 把「口红」归到「日用品」是错的，
   正确做法是新建「化妆品」。清单里的名字只是"可以复用的选项"。
   分类是多级的，物品可以挂在任意一级，所以 [["化妆品"]] 也是合法的。
6. location 只能从【已有位置】里挑，输出名称路径。拿不准就填 null，不要猜。
7. attributes 的 key 只能用【已有属性】里的名字，没有的不要写。
8. reply 里要说清楚**你改动了哪几条、怎么改的**，用户才知道该检查哪里。
   简短一点，不要客套话，不要 Markdown 标题。
9. 如果用户的指令跟物品整理无关，就在 reply 里说明，并保持 items 原样返回。`

/** 只保留最近若干轮，免得历史无限膨胀把上下文撑爆 */
const MAX_HISTORY_MESSAGES = 12

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

export function buildChatMessages(
  context: AiContext,
  history: ChatTurn[],
  drafts: DraftForAi[],
  instruction: string,
): ChatMessage[] {
  const messages: ChatMessage[] = [{ role: 'system', content: CHAT_SYSTEM }]

  // 历史只放「用户说了什么 + AI 回了什么」，不放历史草稿快照 ——
  // 草稿永远用最新的一份附在最后那条用户消息里，避免旧快照造成混乱。
  for (const turn of history.slice(-MAX_HISTORY_MESSAGES)) {
    messages.push({ role: turn.role, content: turn.content })
  }

  const draftText =
    drafts.length > 0
      ? JSON.stringify({ items: drafts })
      : '（空的，还没有任何物品）'

  messages.push({
    role: 'user',
    content: [
      renderContextBlock(context),
      '',
      '【当前的物品草稿】',
      draftText,
      '',
      '【用户的指令】',
      instruction,
    ].join('\n'),
  })

  return messages
}

/* ------------------------------------------------------------------ */
/* 合并 AI 返回的草稿                                                  */
/* ------------------------------------------------------------------ */

export interface MergeOutcome {
  drafts: ItemDraft[]
  /** AI 新加的 */
  added: number
  /** 内容真的变了 */
  updated: number
  /** AI 返回了但内容没变 */
  unchanged: number
  /** AI 明确标了 removed */
  removed: number
  /** AI 漏掉、被我们保留下来的 —— 绝不静默丢东西 */
  kept: number
  /** 内容有变化的草稿 key，用于在预览里高亮 */
  changedKeys: string[]
}

/**
 * 把 AI 返回的完整草稿合并进当前草稿。
 *
 * 合并规则（保守优先）：
 *   · id 命中 → 更新内容，但**保留用户之前勾选的采纳/包含状态**
 *   · id 没命中 → 当作新增
 *   · removed: true → 删掉
 *   · 当前有、但 AI 没返回的 → **保留**，并计入 kept（大概率是 AI 漏写了）
 */
export function mergeRevisedDrafts(
  revised: RawRevisedItem[],
  current: ItemDraft[],
  matchCtx: MatchContext,
  derived: DerivedContext,
): MergeOutcome {
  const byKey = new Map(current.map((draft) => [draft.key, draft]))
  const usedKeys = new Set<string>()
  const seenIds = new Set<string>()

  const drafts: ItemDraft[] = []
  const changedKeys: string[] = []
  let added = 0
  let updated = 0
  let unchanged = 0
  let removed = 0

  for (const item of revised) {
    // AI 可能重复返回同一个 id，只认第一条
    if (seenIds.has(item.id)) continue
    seenIds.add(item.id)

    const existing = byKey.get(item.id)

    if (item.removed) {
      if (existing) removed++
      continue
    }

    const fresh = toItemDraft(item, matchCtx, derived)

    if (existing) {
      const before = signature(effectiveContent(existing, derived))
      const after = signature(effectiveContent(fresh, derived))
      if (before === after) unchanged++
      else {
        updated++
        changedKeys.push(existing.key)
      }

      drafts.push({
        ...fresh,
        key: existing.key,
        // 用户手动做过的选择要保留 —— AI 改内容不该把他勾的东西清掉
        include: existing.include,
        adoptNewCategories: existing.adoptNewCategories,
        adoptNewLocation: existing.adoptNewLocation,
      })
      usedKeys.add(existing.key)
      continue
    }

    // 新增：优先沿用 AI 给的 id（下一轮才能对上），冲突了才另起一个
    const key = !usedKeys.has(item.id) && !byKey.has(item.id) ? item.id : uid()
    usedKeys.add(key)
    drafts.push({ ...fresh, key })
    added++
    changedKeys.push(key)
  }

  // AI 漏掉的条目一律保留，绝不静默丢
  const keptDrafts = current.filter((draft) => !seenIds.has(draft.key))
  for (const draft of keptDrafts) drafts.push(draft)

  return {
    drafts,
    added,
    updated,
    unchanged,
    removed,
    kept: keptDrafts.length,
    changedKeys,
  }
}
