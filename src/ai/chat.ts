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

import type { ParsedChatResponse, RawRevisedItem } from './parse'
import type { ChatMessage } from './deepseek'
import type { AiContext, InventoryDigest } from './prompts'
import { renderContextBlock, renderInventoryDigest } from './prompts'
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
  ].join('\u0000')
}

/* ------------------------------------------------------------------ */
/* Prompt                                                              */
/* ------------------------------------------------------------------ */

const CHAT_SYSTEM = `你是「断舍离」这款个人物品整理工具里的助手。
用户正在和你来回沟通，一起把一批待录入的物品整理好。
下面【已有分类】【已有位置】【已有属性】【已有标签】列出了用户目前的体系。

每条用户消息里你会看到：
【当前的物品草稿】—— 一个 json，每条带 id。里面可能是两种情况混在一起：
    · 用户**已经录进数据库**的物品（用户要整理现有的东西时，会把它们拉进来）
    · 这次新录入的
    你不需要区分、也不用知道 —— 按 id 处理就行。
    程序自己知道哪些该更新、哪些该新建。
【用户的指令】—— 用户这一轮想让你做什么

你要输出一个 json 对象：
{
  "reply": "用中文简短说明你这一轮改了什么",
  "items": [ ...只需要给出**新增或改动过**的物品... ],
  "removedIds": [ "要删掉的物品 id" ]
}

每条物品长这样（值为空的字段可以省略）：
{
  "id": "改已有物品时原样填草稿里的 id；新增时自己起一个，例如 new-1",
  "name": "长管油口红",
  "quantity": 1,
  "categories": [["化妆品", "唇妆"]],
  "location": ["家", "卧室", "梳妆台"],
  "tags": [],
  "attributes": { "品牌": "某品牌" },
  "note": ""
}

**最重要的规则：只返回改动过的。**
- 没有改动的物品**不要**写进 items —— 程序会让它们保持原样。这样又快又省。
- 新增物品：id 自己起一个，例如 "new-1"
- 修改已有物品：id 必须原样填草稿里的那个
- 删除物品：把 id 放进 removedIds
  （已有物品会被**移入回收站**，可以恢复，不是真的删掉）

**改动某件物品时，要给出它的完整样子。**
省略的字段会被当成空值 —— 比如没写 location，就等于「把位置清空」。
所以别只写改动的那个字段，把这一条**现在完整的样子**写出来，包括没改的字段。

**要改现有的物品？先用 loadScope 把它们拉进来。**
【你现有的物品】那一块只有**统计**（哪个分类有多少件），你手里并没有具体条目。
所以当用户说「把药品改成…」「把没分类的归一下」这类话时，
你要先请求把这些物品拉进来：

  { "reply": "你「药品」下有 74 件，我先拉进来看看", "loadScope": { "categoryPaths": [["药品"]] } }

程序收到 loadScope 后会把这些物品放进草稿，并**自动再问你一次**。
那一轮你就能看到具体条目，按正常方式返回 items 去改它们。

loadScope 可以这么写（几种条件可以混用）：
  { "all": true }                         全部在用物品
  { "idle": true }                        只要标记为闲置的
  { "uncategorized": true }               只要未分类的
  { "unassigned": true }                  只要未归位的
  { "categoryPaths": [["药品"]] }          某个分类下的（含子分类）
  { "locationPaths": [["家","卧室"]] }      某个位置下的（含子位置）

**只在确实需要具体条目时才用它。** 用户只是问问题、或者要录新东西，就别用。
一次要太多（比如全库几千件）也没必要 —— 按用户说的范围取就行。

其他规则：
1. 如果【当前的物品草稿】是空的，说明这是第一轮 —— 用户的指令里通常是一段
   自然语言描述，你要把它拆成一件件物品，全部放进 items。
2. categories 的优先级：
   a) 用户明确说了某个分类名 → 就用它，**即使不在【已有分类】里**
   b) 否则找【已有分类】里语义相符的
   c) 都没有才新建
   **绝对不要把物品塞进不相干的已有分类。** 把「口红」归到「日用品」是错的，
   正确做法是新建「化妆品」。清单里的名字只是"可以复用的选项"。
   分类是多级的，物品可以挂在任意一级，所以 [["化妆品"]] 也是合法的。
   **把物品改成某条路径，是"换成"这条路径，不是"加在原来分类后面"。**
3. location 只能从【已有位置】里挑，输出名称路径。拿不准就填 null，不要猜。
4. attributes 的 key 只能用【已有属性】里的名字，没有的不要写。
5. reply 里说清楚你改动了哪几条、怎么改的，用户才知道该检查哪里。
   简短一点，不要客套话，不要 Markdown 标题。
6. 如果用户的指令跟物品整理无关，就在 reply 里说明，items 和 removedIds 都给空数组。`

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

export function buildChatMessages(
  context: AiContext,
  digest: InventoryDigest,
  history: ChatTurn[],
  drafts: DraftForAi[],
  instruction: string,
): ChatMessage[] {
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
        CHAT_SYSTEM,
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
      '【当前的物品草稿】',
      drafts.length > 0
        ? JSON.stringify({ items: drafts.map(compactDraft) })
        : '（空的，还没有任何物品）',
      '',
      '【用户的指令】',
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
