/**
 * 对话整理。
 *
 * 和「一次性录入」的区别：草稿会**跨轮次保留**，你可以用自然语言让 AI 反复修改，
 * 每一轮都告诉你改了什么，最后再决定采纳哪些。
 *
 * ── 省 token 的三个设计（都很重要） ──────────────────────────────
 *
 * 1. **AI 只返回改动过的条目**，不是每轮把整份草稿吐回来。
 *    33 条物品时这一项就能把每轮的输出 token 从 ~2500 降到几十。
 *    顺带还有个好处：语义更清楚了 ——「没提到」=「不用动」，
 *    不再有「AI 是忘了写还是想删掉」的歧义。
 *
 * 2. **已有的分类 / 位置 / 属性清单放进 system 消息**，而不是放在每轮的用户消息里。
 *    DeepSeek 有前缀缓存：请求开头那段如果和上一轮完全一样，命中的部分会便宜很多。
 *    system + 历史 构成稳定的前缀，只有草稿和指令在变。用户的数据不变，前缀就不变。
 *
 * 3. **草稿里的空字段直接不发**（空数组、空对象、空字符串、数量为 1）。
 *    一整批里大部分条目没有标签、没有属性、没有备注，省下来很可观。
 *
 * ── 安全底线 ─────────────────────────────────────────────────
 *   · AI 没提到的条目**一律保持原样**，绝不因为「没提到」就删掉
 *   · 删除只能由 AI 显式放进 removedIds 触发
 *   · 无论如何都不会自动写进数据库，必须用户点「采纳」
 */

import type { ParsedChatResponse, RawRevisedItem, AiStatus } from './parse'
import type { ChatMessage } from './deepseek'
import type { AiContext, InventoryDigest } from './prompts'
import { renderContextBlock, renderInventoryDigest } from './prompts'
import { promptText } from './promptText'
import type { ItemDraft, MatchContext } from './convert'
import { toItemDraft } from './convert'
import type { DerivedContext } from '../store/selectors'
import { uid } from '../lib/id'

/* ------------------------------------------------------------------ */
/* 对话气泡                                                            */
/* ------------------------------------------------------------------ */

/**
 * 界面上一条聊天气泡。
 *
 * 放在这里而不是放在 AiChatPanel 里：它是**会话状态的一部分**，
 * 而会话状态现在住在 store 里（`useAiSessionStore`）——
 * store 不该反过来去 import 一个组件模块的类型。
 */
export interface ChatBubble {
  id: string
  role: 'user' | 'assistant' | 'note'
  text: string
  /** 气泡下方的小字，例如「新增 3 · 修改 5 · 删除 1」 */
  meta?: string
}

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
  /** 有效期至（YYYY-MM-DD）；没设置就是 null */
  expiresAt: string | null
  /**
   * 状态。
   *
   * **必须发给 AI**，否则它看不到「这件现在是闲置」，也就无从判断
   * 用户说的「改成备用」是从哪改到哪 —— 而且它改别的字段时，
   * 也无法把状态原样写回来。
   * null = 这条草稿还没定状态（新建的、AI 也没说）。
   */
  status: AiStatus | null
  /** 所属活动的名字 —— AI 那边只认名字，不认 id */
  collections: string[]
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
    expiresAt: draft.expiresAt,
    status: draft.status,
    collections: draft.matchedCollectionIds
      .map((id) => derived.collectionById.get(id)?.name)
      .filter((name): name is string => name !== undefined),
  }
}

export function serializeDrafts(drafts: ItemDraft[], derived: DerivedContext): DraftForAi[] {
  return drafts.map((draft) => ({ id: draft.key, ...effectiveContent(draft, derived) }))
}

/**
 * 压掉空字段再发。
 * 一整批里大多数条目没有标签、属性、备注，这些字段全发一遍很浪费。
 * 缺省值由解析层负责补回来（数量默认 1、其余默认空），所以不会丢信息。
 */
function compactDraft(item: DraftForAi): Record<string, unknown> {
  const out: Record<string, unknown> = { id: item.id, name: item.name }
  if (item.quantity !== 1) out.quantity = item.quantity
  if (item.categoryPaths.length > 0) out.categories = item.categoryPaths
  if (item.location && item.location.length > 0) out.location = item.location
  if (item.tags.length > 0) out.tags = item.tags
  if (Object.keys(item.attributes).length > 0) out.attributes = item.attributes
  if (item.note !== '') out.note = item.note
  // 有效期跟别的字段不一样：它有值就要发（AI 得知道现状才判断得出要不要改），
  // 没值也不发（跟其他空字段一样省 token）。
  if (item.expiresAt) out.expiresAt = item.expiresAt
  // 状态也一样：有值就发，AI 才知道现在是闲置还是在用。
  // 「没值」= 这条还没定状态，发了纯属浪费。
  if (item.status) out.status = item.status
  if (item.collections.length > 0) out.collections = item.collections
  return out
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
    content.expiresAt ?? '',
    /*
     * 状态和活动也进指纹。
     *
     * 漏掉状态会出这种事：用户说「这件改成闲置」，AI 乖乖把 status 填成 idle，
     * 但别的字段一个没动 → 指纹一致 → 判定「没改动」→ 这一条被跳过 →
     * 界面上什么都没发生。用户只会觉得「AI 又没听懂」，
     * 而实际上是程序把它的回答丢了。
     * （变异验证过：删掉下面两行，这条用例立刻变红。）
     */
    content.status ?? '',
    [...content.collections].sort().join('|'),
  ].join('\u0000')
}

/* ------------------------------------------------------------------ */
/* Prompt                                                              */
/* ------------------------------------------------------------------ */

/**
 * 只保留最近若干轮。
 * 草稿本身就是完整状态，历史主要是用来理解「刚才那个」「上面说的」这类指代，
 * 不需要留太长 —— 留太长每轮都要重发，纯粹烧 token。
 */
const MAX_HISTORY_MESSAGES = 8

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

/**
 * 对话用的 messages。
 *
 * 提示词本身按语言分两份放在 src/ai/promptText/ 下。注意一个副作用：
 * 切语言会让 system 前缀变化、DeepSeek 的前缀缓存失效一次 ——
 * 这个代价可以接受，没人会一轮一轮地切语言。
 */
export function buildChatMessages(
  context: AiContext,
  digest: InventoryDigest,
  history: ChatTurn[],
  drafts: DraftForAi[],
  instruction: string,
): ChatMessage[] {
  const p = promptText()

  const messages: ChatMessage[] = [
    {
      role: 'system',
      // 用户体系 + 现有物品的目录放在 system 里，是为了让 system + 历史
      // 构成稳定的前缀，好命中 DeepSeek 的前缀缓存。
      // 放进每轮的用户消息就没有这个好处了。
      //
      // 目录只放「哪个分类有多少件」，不放具体条目 ——
      // 具体条目等 AI 用 loadScope 要的时候再拉，不然 500 件就是一万多 token。
      content: [
        p.chatSystem,
        '',
        '---',
        '',
        renderContextBlock(context),
        '',
        renderInventoryDigest(digest),
      ].join('\n'),
    },
  ]

  // 历史只放「用户说了什么 + AI 回了什么」，不放历史草稿快照 ——
  // 草稿永远用最新的一份附在最后那条用户消息里，避免旧快照造成混乱。
  for (const turn of history.slice(-MAX_HISTORY_MESSAGES)) {
    messages.push({ role: turn.role, content: turn.content })
  }

  messages.push({
    role: 'user',
    content: [
      p.chatDraftLabel,
      drafts.length > 0
        ? JSON.stringify({ items: drafts.map(compactDraft) })
        : p.chatEmptyDraft,
      '',
      p.chatInstructionLabel,
      instruction,
    ].join('\n'),
  })

  return messages
}

/* ------------------------------------------------------------------ */
/* 合并 AI 返回的改动                                                  */
/* ------------------------------------------------------------------ */

export interface MergeOutcome {
  drafts: ItemDraft[]
  /** 新增的 */
  added: number
  /** 内容真的变了的 */
  updated: number
  /** 没被提到、原样保留的 */
  unchanged: number
  /** 被删掉的 */
  removed: number
  /** 内容有变化的草稿 key，用于在预览里高亮 */
  changedKeys: string[]
  /** 被移出草稿的 key。若是已有物品，采纳时会软删除（进回收站），不是硬删 */
  removedKeys: string[]
  /** AI 报了个本地不存在的 id 要删（大概率是它自己编的） */
  unknownIds: number
}

/**
 * 把 AI 这一轮的改动合并进当前草稿。
 *
 * 合并规则（保守优先）：
 *   · items 里 id 命中 → 更新内容，但**保留用户之前勾选的采纳/包含状态**
 *   · items 里 id 没命中 → 当作新增
 *   · removedIds 命中 → 删掉
 *   · **其余一律原样保留** —— AI 没提到 ≠ 要删，这是最要紧的一条
 *
 * 顺序也保持不变：被改过的条目就地更新，新增的追加到末尾。
 * 否则每改一次整个列表就重排一次，根本没法看。
 */
export function mergeChatResponse(
  response: ParsedChatResponse,
  current: ItemDraft[],
  matchCtx: MatchContext,
  derived: DerivedContext,
): MergeOutcome {
  const byKey = new Map(current.map((draft) => [draft.key, draft]))
  const removedSet = new Set(response.removedIds)
  const seenIds = new Set<string>()
  const usedKeys = new Set<string>()

  /** 改动后的条目，按 key 暂存，最后按原顺序拼回去 */
  const replaced = new Map<string, ItemDraft>()
  const appended: ItemDraft[] = []
  const changedKeys: string[] = []
  let added = 0
  let updated = 0

  for (const item of response.items) {
    // AI 可能重复返回同一个 id，只认第一条
    if (seenIds.has(item.id)) continue
    seenIds.add(item.id)

    // 单条上的 removed 标记也认（AI 有时会这么写）
    if (item.removed) {
      if (byKey.has(item.id)) removedSet.add(item.id)
      continue
    }

    /*
     * AI 用 status 说了「已舍弃」→ 当成一次删除请求。
     *
     * 为什么不让它直接写进 status：那条路是**改字段**，而这个动作是
     * 「把东西扔掉」，两者走的机制不同（删除会进回收站，可恢复）。
     * 为什么也不能忽略：用户说「这个扔了吧」，AI 也听懂了，界面上却
     * 什么都不发生 —— 那看起来就是 AI 又没听懂。这里把它接到
     * removedIds 那条正规路径上，效果一样，而且可恢复。
     */
    if (item.status === 'discarded') {
      if (byKey.has(item.id)) removedSet.add(item.id)
      continue
    }

    const existing = byKey.get(item.id)
    const fresh = toItemDraft(item, matchCtx, derived)

    if (existing) {
      const before = signature(effectiveContent(existing, derived))
      const after = signature(effectiveContent(fresh, derived))
      if (before !== after) {
        updated++
        changedKeys.push(existing.key)
      }
      replaced.set(existing.key, {
        ...fresh,
        key: existing.key,
        /*
         * 状态：AI 没提到就**保留原来的**。
         *
         * 这条是必须的，因为「没提到」在模型那边的含义就是「不用动」——
         * 直接取 fresh 的 null 会让「只改了个名字」把一件闲置的东西
         * 变回「在用」。有测试守着（tests/ai.ts 的「更新不该把它的闲置状态改掉」）。
         */
        status: fresh.status ?? existing.status,
        // 用户手动做过的选择要保留 —— AI 改内容不该把他勾的东西清掉
        include: existing.include,
        adoptNewCategories: existing.adoptNewCategories,
        adoptNewLocation: existing.adoptNewLocation,
        // 最要紧的一条：保住「这是已有物品」的标记，
        // 否则采纳时会把它当新条目又创建一遍
        sourceItemId: existing.sourceItemId,
      })
      usedKeys.add(existing.key)
      continue
    }

    // 新增：优先沿用 AI 给的 id（下一轮才能对上），冲突了才另起一个
    const key = !usedKeys.has(item.id) && !byKey.has(item.id) ? item.id : uid()
    usedKeys.add(key)
    appended.push({ ...fresh, key })
    added++
    changedKeys.push(key)
  }

  // 按原顺序拼：改过的就地替换，没提到的原样保留，被删的丢掉
  const drafts: ItemDraft[] = []
  const removedKeys: string[] = []
  let removed = 0
  for (const draft of current) {
    if (removedSet.has(draft.key)) {
      removed++
      removedKeys.push(draft.key)
      continue
    }
    drafts.push(replaced.get(draft.key) ?? draft)
  }
  drafts.push(...appended)

  // AI 报了个本地根本没有的 id
  let unknownIds = 0
  for (const id of removedSet) {
    if (!byKey.has(id)) unknownIds++
  }

  const unchanged = drafts.length - added - updated

  return { drafts, added, updated, unchanged, removed, changedKeys, removedKeys, unknownIds }
}

/** 供测试与调试用：看看一条草稿发出去大概长什么样 */
export function previewDraftPayload(drafts: DraftForAi[]): string {
  return JSON.stringify({ items: drafts.map(compactDraft) })
}

export type { RawRevisedItem }
