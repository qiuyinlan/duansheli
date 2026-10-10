/**
 * 输入框旁边那套「按钮 + 补全」的**纯逻辑**（没有一行 React）。
 *
 * 为什么单独一个文件、而且一行 UI 都不碰：
 *   1. 补全的规则是这一整件事里唯一会出错还不容易被发现的地方
 *      （匹配范围错了 = 用户选了一条不存在的路径 = AI 那边多一个「新位置」），
 *      必须能直接拿数据喂它、断言结果。
 *   2. jsdom 里**没法模拟打字**（见 tests/dom.ts），补全这条路靠点击测不全。
 *   3. 匹配规则必须和别处**同一套**：`searchTreeIds` 是搜索框和 AI 共用的那条，
 *      这里直接复用它；「这段路径到底在不在库里」也用 convert.ts 的 `matchPath`，
 *      而不是另写一个「看起来差不多」的判断。
 *
 * 三层，从下往上：
 *   · detectSlot   —— 光标前那句话现在是「哪个槽位、要补的是哪几个字」
 *   · suggestSlot  —— 那串字对应库里哪几条路径（含逐级下钻、最近的排前面）
 *   · inspectDraft —— 整段话本地过一遍：几件东西、位置/分类对不对得上库里
 *
 * 插进去的路径一律用 ` / ` 连接 —— 那是提示词里给模型看【已有位置】时的写法
 * （src/ai/prompts.ts 里 path.join(' / ')）。写法一致，模型就是**照抄**，
 * 而不是把「桌子/桌子下」重新拆一遍再猜。
 */

import { compareTreeNodes, searchTreeIds } from '../lib/tree'
import type { TreeIndex, TreeItem } from '../lib/tree'
import { levelNames, levelsFromName } from '../lib/levels'
import { pinRank } from '../lib/pins'
import { commandVocab } from './commandVocab'
import type { CommandVocab } from './commandVocab'
import { matchPath } from './convert'
import type { MatchContext } from './convert'
import type { Category, Location } from '../types'

/* ------------------------------------------------------------------ */
/* 一、按钮                                                            */
/* ------------------------------------------------------------------ */

export type SlotKind = 'location' | 'category' | 'quantity' | 'expiry'

export interface CommandChip {
  id: string
  /** 按钮上的字 */
  label: string
  /** 点一下插进输入框的片段（不含前后补的分隔符和空格） */
  phrase: string
  leadingSeparator: boolean
  trailingSpace: boolean
  /** 插之前先起一行（「再加一件」用） */
  newLineBefore: boolean
  /** 插完立刻弹出哪个槽位的候选 */
  openSlot: SlotKind | null
}

/**
 * 这排按钮本身。
 *
 * 顺序是有讲究的：前五个是**一句话的骨架**（新建物品 / 放在 / 分类 / 数量 / 过期），
 * 后面才是状态和备注那几个偶尔用到的。用户按着从左到右点，就是在写一句话。
 */
export function commandChips(v: CommandVocab = commandVocab()): CommandChip[] {
  const plain = (id: string, label: string, phrase: string): CommandChip => ({
    id,
    label,
    phrase,
    leadingSeparator: false,
    trailingSpace: true,
    newLineBefore: false,
    openSlot: null,
  })
  const after = (
    id: string,
    label: string,
    phrase: string,
    openSlot: SlotKind | null,
    trailingSpace = true,
  ): CommandChip => ({
    id,
    label,
    phrase,
    leadingSeparator: true,
    trailingSpace,
    newLineBefore: false,
    openSlot,
  })

  return [
    plain('item', v.item, v.item),
    after('place', v.place, v.place, 'location'),
    after('categorize', v.categorize, v.categorize, 'category'),
    after('quantity', v.quantity, v.quantity, 'quantity'),
    after('expiry', v.expiry, v.expiry, 'expiry'),
    after('note', v.note, v.note, null),
    /* 这三个本身就是一句完整的话，后面不该补空格 —— 补了会留下一个悬空的空格 */
    after('idle', v.markIdle, v.markIdle, null, false),
    after('spare', v.markSpare, v.markSpare, null, false),
    after('active', v.markActive, v.markActive, null, false),
    {
      id: 'more',
      label: v.more,
      /* 插的是「新建物品」而不是「再加一件」——按钮上那句话是给人看的 */
      phrase: v.item,
      leadingSeparator: false,
      trailingSpace: true,
      newLineBefore: true,
      openSlot: null,
    },
  ]
}

/* ------------------------------------------------------------------ */
/* 二、把短语插到光标处                                                */
/* ------------------------------------------------------------------ */

export interface InsertResult {
  text: string
  /** 插完之后光标该在的位置 */
  caret: number
}

/** 这些字符出现时，说明前面那句话已经结束了，不用再补连接符 */
export const CLAUSE_END = ['\n', ',', '.', ';', ':', '!', '?', '，', '。', '；', '：', '！', '？']

export function applyInsert(
  text: string,
  caret: number,
  phrase: string,
  opts: {
    leadingSeparator?: boolean
    trailingSpace?: boolean
    newLineBefore?: boolean
    separator: string
  },
): InsertResult {
  const at = Math.max(0, Math.min(caret, text.length))
  const after = text.slice(at)
  let head = text.slice(0, at)

  if (opts.newLineBefore === true) {
    if (head !== '' && !head.endsWith('\n')) head += '\n'
  } else if (opts.leadingSeparator === true && head.trim() !== '') {
    const trimmed = head.replace(/[ \t]+$/, '')
    if (!CLAUSE_END.some((punc) => trimmed.endsWith(punc))) head = trimmed + opts.separator
  }

  const tail = phrase + (opts.trailingSpace === true ? ' ' : '')
  return { text: head + tail + after, caret: head.length + tail.length }
}

/* ------------------------------------------------------------------ */
/* 三、现在是哪个槽位                                                  */
/* ------------------------------------------------------------------ */

export interface SlotHit {
  kind: SlotKind
  /** 要补的那段字在整段文本里的起止（[from, to) 就是接受候选时被替换掉的区间） */
  from: number
  to: number
  /** 用户已经打出来的那几个字 */
  query: string
}

/** 句子边界：换行和各种句末标点。触发词只在自己那一句里算 */
function isBoundary(ch: string): boolean {
  return ch === '\n' || CLAUSE_END.includes(ch)
}

function clauseStartOf(text: string, upto: number): number {
  for (let i = upto - 1; i >= 0; i--) {
    if (isBoundary(text.charAt(i))) return i + 1
  }
  return 0
}

/** 去掉句子尾巴上的标点和空格 —— 「放在蓝柜。」里那个句号不算内容 */
function trimClauseQuery(value: string): string {
  let end = value.length
  while (end > 0) {
    const ch = value.charAt(end - 1)
    if (ch === ' ' || ch === '\t' || isBoundary(ch)) end--
    else break
  }
  return value.slice(0, end)
}

/** 这一句里**最后**出现的那个触发词（返回词本身和它的下标） */
function lastTrigger(
  clause: string,
  triggers: string[],
): { trigger: string; at: number } | null {
  const lower = clause.toLowerCase()
  let best: { trigger: string; at: number } | null = null
  for (const trigger of triggers) {
    const needle = trigger.toLowerCase()
    if (needle === '') continue
    const at = lower.lastIndexOf(needle)
    if (at < 0) continue
    if (best === null || at + needle.length > best.at + best.trigger.length) best = { trigger, at }
  }
  return best
}

/**
 * 剥掉触发词和它的值之间的连接词。
 *
 * 用户真实打的句子是「分类**改成**生活用品/游泳」——「改成」不是值的一部分。
 * 不剥掉的话会同时坏两处：补全拿着「改成生活用品/游」去库里找（一条都对不上），
 * 预检说「分类「改成生活用品/游泳」库里没有」（**明明写对了却说没对上**）。
 *
 * 单字连接词（成 / 是 / 为）只在后面跟着空格时才剥：不然「分类 成品架」
 * 会被剥成「品架」—— 那是在改用户的名字，比不剥更糟。
 */
function stripConnector(value: string, v: CommandVocab): string {
  let rest = value.replace(/^[ \t]+/, '')
  /* 冒号是纯粹的标点，没有歧义 */
  if (rest.startsWith('：') || rest.startsWith(':')) rest = rest.slice(1).replace(/^[ \t]+/, '')

  const candidates = [...v.connectors].sort((a, b) => b.length - a.length)
  let changed = true
  while (changed) {
    changed = false
    for (const word of candidates) {
      if (word === '' || !rest.toLowerCase().startsWith(word.toLowerCase())) continue
      const after = rest.slice(word.length)
      if (word.length === 1 && !/^[ \t]/.test(after)) continue
      rest = after.replace(/^[ \t]+/, '')
      changed = true
      break
    }
  }
  return rest
}

/** 触发词后面那一段（剥掉连接词、去掉开头的空格和尾巴上的标点） */
function queryAfter(clause: string, trigger: { trigger: string; at: number }, v: CommandVocab): string {
  return trimClauseQuery(stripConnector(clause.slice(trigger.at + trigger.trigger.length), v))
}

/**
 * 在一个句子片段里算槽位。`offset` 是这段片段在整段文本里的起点，
 * 用来把下标换算回整段文本。
 *
 * 取**最后**一个触发词（而不是第一个）：一句话里可能写了「放在…分类…」，
 * 光标在哪儿就该补哪儿。
 */
function slotInClause(clause: string, offset: number, v: CommandVocab): SlotHit | null {
  let best: { kind: SlotKind; trigger: { trigger: string; at: number } } | null = null

  const consider = (kind: SlotKind, triggers: string[]) => {
    const found = lastTrigger(clause, triggers)
    if (found === null) return
    if (best === null || found.at + found.trigger.length > best.trigger.at + best.trigger.trigger.length) {
      best = { kind, trigger: found }
    }
  }

  consider('location', v.placeTriggers)
  consider('category', v.categoryTriggers)
  consider('quantity', v.quantityTriggers)
  consider('expiry', v.expiryTriggers)
  if (best === null) return null

  const chosen = best as { kind: SlotKind; trigger: { trigger: string; at: number } }
  const tail = clause.slice(chosen.trigger.at + chosen.trigger.trigger.length)
  /* 被剥掉的那一段（空格 + 连接词）也要算进替换区间，否则接受候选时会留下一截 */
  const stripped = stripConnector(tail, v)
  const start = chosen.trigger.at + chosen.trigger.trigger.length + (tail.length - stripped.length)

  return {
    kind: chosen.kind,
    from: offset + start,
    to: offset + start + stripped.length,
    query: trimClauseQuery(stripped),
  }
}

/**
 * 光标现在落在哪个槽位上；不在任何槽位上就返回 null。
 *
 * 只看**光标之前**的文字：用户完全可能回头去改前半句，
 * 那时候该补的是他改的那一处，不是句子末尾。
 */
export function detectSlot(
  text: string,
  caret: number,
  v: CommandVocab = commandVocab(),
): SlotHit | null {
  const at = Math.max(0, Math.min(caret, text.length))
  const start = clauseStartOf(text, at)
  return slotInClause(text.slice(start, at), start, v)
}

/**
 * 数量 / 日期这种「填一个值就说完了」的槽位，光标后面已经在打字了就别再弹。
 *
 * 位置和分类不一样：它们是**越打越准**的（打「白色」再打「2」都是在收窄），
 * 所以全程都该有候选。
 */
export function shouldSuggest(hit: SlotHit): boolean {
  if (hit.kind === 'quantity' || hit.kind === 'expiry') return hit.query === ''
  return true
}

/* ------------------------------------------------------------------ */
/* 四、那串字对应库里哪几条路径                                        */
/* ------------------------------------------------------------------ */

/** 和 tree.ts 的 searchTreeIds、AI 那边的 norm 同一套归一化 */
function normName(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase()
}

/** 用户写的路径拆成一段一段：`桌子/桌子下` 和 `桌子 / 桌子下` 都认 */
export function splitPathQuery(query: string): string[] {
  return query
    .split(/[/／>]/)
    .map((part) => part.trim())
    .filter((part) => part !== '')
}

/** `A/B` 这种路径的归一化写法，用来比「说的是不是同一个地方」 */
export function normPathText(query: string): string {
  return splitPathQuery(query).map(normName).join('/')
}

export interface SlotCandidate {
  /** null = 库里没有这个名字，插进去会被当成**新的**（采纳时要勾一下） */
  id: string | null
  /**
   * 这一条的来路。
   *
   *   · `node`  库里已有的一级
   *   · `new`   库里没有，这么写会被当成新位置/新分类（**警告色**）
   *   · `level` 名字里写着「几层」时顺手给出的子层 —— 也不是现成的，
   *             但含义不一样（选中它是「就往这一层放」），提示语也不该一样
   */
  kind: 'node' | 'new' | 'level'
  /** 末级名字 */
  name: string
  /** 完整路径，从顶层到这里 */
  path: string[]
  /** 完整路径的可读写法（` / ` 连接）—— 插进输入框的就是它 */
  pathText: string
  /** 底下还有层级（选中之后可以继续往下钻） */
  isBranch: boolean
  /** 末级名字和用户打的字**完全一样**（不是碰巧含这几个字） */
  exact: boolean
  /**
   * 用户点过星星把它**置顶**了。这种候选永远排在列表最前面 ——
   * 见 `compareRows`：置顶压过一切推断（包括「最近用过」和「用得最多」），
   * 因为那是用户**明确说过的**偏好，而其余几条都是程序猜的。
   */
  pinned: boolean
}

export interface SlotSuggestion {
  candidates: SlotCandidate[]
  /** 用户打的这一串正好对上库里某一条 —— 界面上可以显示「已对上」 */
  resolvedId: string | null
  /** 路径前半段对不上：界面要说一句，否则用户以为是自己打错了 */
  prefixUnknown: boolean
  /**
   * 现在列的是**哪一级的子级**（用户已经打到某一级、正在往里钻）。
   * 界面据此说一句「底下这几层可以直接选」，而不是让他自己打「/」。
   */
  drillingInto: string | null
}

export interface SlotSuggestionOptions<T extends TreeItem> {
  /** 树里的全部节点（顺序不重要 —— 排序按树上的显示顺序自己算） */
  nodes: readonly T[]
  index: TreeIndex<T>
  /** 最近用过的 id，越靠前越优先 */
  recentIds?: readonly string[]
  /** id → 用过多少次，越多越优先 */
  usage?: ReadonlyMap<string, number>
  /** 用户点星星置顶过的 id（顺序即置顶顺序）—— 这些排在最前面 */
  pinnedIds?: readonly string[]
  limit?: number
  vocab?: CommandVocab
}

/** 一个节点的直接子级（buildTree 的口径：父级不存在时当顶层） */
function parentOfId<T extends TreeItem>(index: TreeIndex<T>, node: T): string | null {
  return node.parentId !== null && index.has(node.parentId) ? node.parentId : null
}

/** 逐级往下走：每一段都要在上一段的直接子级里同名才行。对不上返回 null */
function resolveChain<T extends TreeItem>(index: TreeIndex<T>, parts: string[]): string | null {
  let parentId: string | null = null
  let currentId: string | null = null
  for (const part of parts) {
    const key = normName(part)
    let found: string | null = null
    for (const node of index.byId.values()) {
      if (normName(node.name) !== key) continue
      if (parentOfId(index, node) !== parentId) continue
      found = node.id
      break
    }
    if (found === null) return null
    currentId = found
    parentId = found
  }
  return currentId
}

/**
 * 名字正好等于这几个字的节点。
 *
 * 只有**唯一命中**才算「对上了」：两个地方都叫「柜子」时不该替用户挑一个。
 */
function exactNameMatches<T extends TreeItem>(index: TreeIndex<T>, name: string): string[] {
  const key = normName(name)
  const out: string[] = []
  for (const node of index.byId.values()) {
    if (normName(node.name) === key) out.push(node.id)
  }
  return out
}

interface Row {
  candidate: SlotCandidate
  /** 树上的显示顺序（编号兄弟按数字排），不是数组下标 */
  order: number
  recent: number
  usage: number
  depth: number
  /** 置顶排第几；-1 = 没被置顶 */
  pin: number
}

/**
 * 排序：**置顶的** → 完全同名的 → 最近用过的 → 名字开头的 → 用得多的 →
 * 层级浅的 → 树序。
 *
 * 置顶压过后面全部：那是用户自己用手点的，其余几条都是程序照着
 * 「你最近选过什么 / 哪个位置东西多」猜的。猜错了还能忍，
 * 「我点了置顶它却没排第一」会让人直接不再用这个功能。
 *
 * 为什么「最近用过」排在「名字开头」前面：这个 App 的用法是**一阵子集中整理
 * 一处地方**（今天整蓝柜、明天整书桌）。候选又是先按关键词筛过的 ——
 * 一个刚用过、又正好含你打的那几个字的路径，几乎就是他这次要的那条。
 */
function compareRows(a: Row, b: Row, query: string): number {
  if (a.pin !== b.pin) {
    if (a.pin < 0) return 1
    if (b.pin < 0) return -1
    /* 都是置顶的：按他点星星的先后（先钉的排前面） */
    return a.pin - b.pin
  }
  const q = normName(query)
  if (a.candidate.exact !== b.candidate.exact) return a.candidate.exact ? -1 : 1
  const aRecent = a.recent < 0 ? Number.MAX_SAFE_INTEGER : a.recent
  const bRecent = b.recent < 0 ? Number.MAX_SAFE_INTEGER : b.recent
  if (aRecent !== bRecent) return aRecent - bRecent
  const aStarts = normName(a.candidate.name).startsWith(q) ? 0 : 1
  const bStarts = normName(b.candidate.name).startsWith(q) ? 0 : 1
  if (aStarts !== bStarts) return aStarts - bStarts
  if (a.usage !== b.usage) return b.usage - a.usage
  if (a.depth !== b.depth) return a.depth - b.depth
  return a.order - b.order
}

const DEFAULT_LIMIT = 8

/**
 * 给一个槽位算候选。
 *
 * 三种输入各对应一种行为：
 *   · 空的          → 列这一级的全部（下钻时看到的就是它）
 *   · 单个词        → 全树按名字子串找（打「白色」列出所有带白色的位置）
 *   · 带 `/` 的路径 → 前面几段必须逐级对上，最后一段再按名字找
 *                     （对不上就把 prefixUnknown 立起来，界面照实说）
 */
export function suggestSlot<T extends TreeItem>(
  hit: SlotHit,
  opts: SlotSuggestionOptions<T>,
): SlotSuggestion {
  const v = opts.vocab ?? commandVocab()
  const query = hit.query.trim()
  const limit = opts.limit ?? DEFAULT_LIMIT
  const recentIds = opts.recentIds ?? []
  const usage = opts.usage ?? new Map<string, number>()
  const pinnedIds = opts.pinnedIds ?? []

  /*
   * 节点先按**树上的显示顺序**摆开，再拿这个下标当「树序」。
   *
   * ⚠️ 不能直接用数组下标：`opts.nodes` 是数据文件里的原始数组，
   * 它的顺序是**创建顺序**。用户先点了「3层」、后来才补「2层」，
   * 数组里就是 1层、3层、2层 —— 于是补全列表也长成 1、3、2
   * （用户报的正是这个）。`compareTreeNodes` 里那条「编号兄弟按数字排」
   * 就在这里生效。
   */
  const nodes = [...opts.nodes].sort(compareTreeNodes)

  const parts = splitPathQuery(query)
  /*
   * 以分隔符结尾（`桌子/桌子下/`）和「最后一段刚好叫桌子下」是**两件事**：
   * 前者是「站到这一级，把下面的铺出来」（下钻），后者是在找那一级本身。
   * splitPathQuery 会把结尾那个空段丢掉，所以这个信息只能从头到尾自己看一遍。
   */
  const trailingSeparator = /[/／>]\s*$/.test(query)
  const last = trailingSeparator ? '' : parts.length > 0 ? parts[parts.length - 1] : query

  const prefixParts = trailingSeparator ? parts : parts.slice(0, Math.max(0, parts.length - 1))
  const prefixId = prefixParts.length > 0 ? resolveChain(opts.index, prefixParts) : null
  const prefixUnknown = prefixParts.length > 0 && prefixId === null

  const inScope = (node: T): boolean => {
    if (prefixId === null) return true
    return node.id === prefixId || opts.index.descendantIds(prefixId).has(node.id)
  }

  /** 下钻：前缀对上了、最后一段还空着 —— 这时候要的是它的**直接子级** */
  const drilling = trailingSeparator && prefixId !== null
  const scope: T[] = []
  for (const node of nodes) {
    if (!inScope(node)) continue
    if (drilling && parentOfId(opts.index, node) !== prefixId) continue
    scope.push(node)
  }
  /* 下面每渲染一行都要问一次「在不在这个范围里」，所以先做成集合再查 */
  const scopeIds = new Set(scope.map((node) => node.id))
  const matchedIds = last !== '' ? searchTreeIds(scope, last) : null

  const childCount = new Map<string, number>()
  for (const node of nodes) {
    const parent = parentOfId(opts.index, node)
    if (parent === null) continue
    childCount.set(parent, (childCount.get(parent) ?? 0) + 1)
  }

  const rows: Row[] = []
  nodes.forEach((node, order) => {
    if (!scopeIds.has(node.id)) return
    if (matchedIds !== null && !matchedIds.has(node.id)) return
    const path = opts.index.pathNames(node.id)
    if (path.length === 0) return
    const pin = pinRank(pinnedIds, node.id)
    rows.push({
      candidate: {
        id: node.id,
        kind: 'node',
        name: node.name,
        path,
        pathText: path.join(v.pathSeparator),
        isBranch: (childCount.get(node.id) ?? 0) > 0,
        exact: normName(node.name) === normName(last),
        pinned: pin >= 0,
      },
      order,
      recent: recentIds.indexOf(node.id),
      usage: usage.get(node.id) ?? 0,
      depth: path.length - 1,
      pin,
    })
  })

  rows.sort((a, b) => compareRows(a, b, last))
  const sorted = rows.map((row) => row.candidate)

  /*
   * ── 打完之后接着往下钻 ────────────────────────────────────────
   *
   * 用户的原话：「我选择了独立白色四层收纳架，他没有再跳出 2 层这样的，
   * 我打 / 他才跳出来，按道理点击他会继续往下跳。」
   *
   * 他说得对。原来只有「以 / 结尾」才算下钻，于是点完一条分支就停在原地 ——
   * 而他点它的意思往往正是「我要往里放」。所以：**这一串已经完整对上某一级时，
   * 直接把它的子级铺出来**（本身那一条不列了：它已经在输入框里了，
   * 再点一次是空操作）。
   *
   * 回车仍然是发送 —— 认得出完整路径的时候不该抢那一下（见 AiChatPanel 的 enterPicks）。
   */
  const resolvedFromQuery =
    parts.length > 0
      ? resolveChain(opts.index, parts) ??
        (parts.length === 1 ? unique(exactNameMatches(opts.index, parts[0])) : null)
      : null

  /**
   * 某一级的**直接子级**。
   *
   * 顺序走两遍，和上面那张长列表同一个规矩：
   *   1. 先按树上的显示顺序（1层、2层、3层…，编号兄弟按数字排）
   *   2. 再把你点过星星的那几条提到前面
   * 「置顶」在下钻列表里也照办 —— 否则同一个位置出现了两套顺序，
   * 用户会以为置顶时灵时不灵。
   */
  const children = (parentId: string): SlotCandidate[] => {
    const kids = nodes
      .filter((node) => parentOfId(opts.index, node) === parentId)
      .map((node) => {
        const path = opts.index.pathNames(node.id)
        return {
          id: node.id,
          kind: 'node' as const,
          name: node.name,
          path,
          pathText: path.join(v.pathSeparator),
          isBranch: (childCount.get(node.id) ?? 0) > 0,
          exact: false,
          pinned: pinRank(pinnedIds, node.id) >= 0,
        }
      })
      .filter((candidate) => candidate.path.length > 0)

    const on = kids
      .filter((candidate) => pinRank(pinnedIds, candidate.id) >= 0)
      .sort((a, b) => pinRank(pinnedIds, a.id) - pinRank(pinnedIds, b.id))
    const off = kids.filter((candidate) => pinRank(pinnedIds, candidate.id) < 0)
    return [...on, ...off]
  }

  /**
   * 现在列的是**哪一级的子级**。
   *
   * 两条路都要立这个旗，而且必须立成同一个意思：
   *   · 以「/」结尾（用户自己打的分隔符）
   *   · 名字完整对上了某一级（点完候选接着往下钻 —— 用户实测要的那条）
   * 第一版只算了第二条路，于是「打 /」那种情况下界面拿不到这个信息，
   * 说不出一句「已经到这一级了」。
   */
  const drillingInto = drilling
    ? prefixId
    : last !== '' && resolvedFromQuery !== null && (childCount.get(resolvedFromQuery) ?? 0) > 0
      ? resolvedFromQuery
      : null

  const candidates =
    drillingInto !== null ? children(drillingInto) : sorted.slice(0, limit)
  const resolvedId = resolvedFromQuery

  /*
   * ── 名字里写了「几层」时，把那几层直接列出来 ────────────────────
   *
   * 用户的原话：「我输入 xxx4层xxx 这个新位置，那么就可以自动建立子位置，
   * 自动有对应的 1-4 层位置，这个逻辑，方便我后续存东西。」
   *
   * 界面这一层能做的、且不越界的是：**把他要的那几层写成候选**。
   * 他点哪一层就是往哪一层放，收下并采纳时程序会把缺的那级建出来
   * （`resolveLocation` 逐级创建）—— 他因此一次就能归位，不用先跑去位置页。
   *
   * 界面**不**替他把 1-4 层凭空建好。理由是「改动要能被看见」：
   * 凭空多出来的几个位置，在草稿预览里是**看不见**的（预览显示的是这条物品
   * 的位置，不是多出来的空位置）—— 那正是这个项目一直在防的那种静默写入。
   * 想先把空位置建好，去「位置」页新建，那边建出来的东西看得见、也删得掉。
   */
  const levelCandidates = (basePathText: string, baseName: string): SlotCandidate[] => {
    const count = levelsFromName(baseName)
    if (count === null) return []
    return levelNames(count, v.levelLabel).map((level) => ({
      id: null,
      kind: 'level' as const,
      name: level,
      path: [...splitPathQuery(basePathText), level],
      pathText: `${basePathText}${v.pathSeparator}${level}`,
      isBranch: false,
      exact: false,
      /* 库里还没有这一层，没有 id 也就无从置顶（星星不给它画） */
      pinned: false,
    }))
  }

  /*
   * 库里没有这一条时的兜底项。
   *
   * 只在**一条都没对上**的时候给 —— 不是「没有完全同名」的时候给。
   * 差别很重要：用户打「白色」时底下已经列着「白色三层收纳」了，
   * 这时候再挂一条「白色（会被当成新位置）」既碍眼、又可能被误点，
   * 而那一点就凭空多出一个叫「白色」的位置。想建新名字的话，
   * 把名字打完自然就一条都对不上，兜底项那时才出现。
   *
   * 插进去的还是用户打的那串字 —— 不加工、不改写：路径对不上时程序会把它
   * 标成「新位置」让他自己勾（见 convert.ts 的三级降级），界面这一层
   * 绝不自作聪明把它改成「最接近的那条」。
   */
  if (last !== '' && candidates.length === 0 && drillingInto === null) {
    const basePathText = parts.length > 0 ? parts.join(v.pathSeparator) : query
    candidates.push({
      id: null,
      kind: 'new',
      name: query,
      path: parts.length > 0 ? parts : [query],
      pathText: basePathText,
      isBranch: false,
      exact: false,
      /* 库里没有这一条，没有 id 也就无从置顶 */
      pinned: false,
    })
    candidates.push(...levelCandidates(basePathText, parts.length > 0 ? parts[parts.length - 1] : query))
  } else if (drillingInto === null && last !== '' && candidates.length > 0) {
    /*
     * 库里有一条**名字写着几层、但底下还空着**的（用户那种「小型白色四层收纳」
     * 建好了但里面一层都没建）。这时把他要的那几层补出来最有用 ——
     * 他现在唯一能做的就是打「/」再打「2层」，那还得知道名字叫什么。
     */
    for (const candidate of candidates) {
      if (candidate.id === null || candidate.isBranch || !candidate.exact) continue
      candidates.push(...levelCandidates(candidate.pathText, candidate.name).slice(0, limit))
    }
  }

  return { candidates, resolvedId, prefixUnknown, drillingInto }
}

function unique(ids: string[]): string | null {
  return ids.length === 1 ? ids[0] : null
}

/* ------------------------------------------------------------------ */
/* 六、速录面板：几行 → 一段话                                          */
/* ------------------------------------------------------------------ */

export interface QuickEntryRow {
  name: string
  location: string
  category: string
  expiry: string
  /** 只有三种：在用 / 闲置 / 备用（「已舍弃」是流程出口，不是能随手选的状态） */
  status: 'active' | 'idle' | 'spare'
}

/**
 * 把速录面板里填的几行拼成一段话。
 *
 * 为什么是「拼成一段话」而不是直接写进数据库：
 * 这段文字还是要走原来那条路 —— 发给模型 → 草稿 → 用户点采纳。
 * 面板只是替他把打字的活干了，**不绕过任何一道确认**。
 * 一旦这里直接落库，用户就失去了「看一眼再决定」的机会，而这个项目
 * 从头到尾守着的就是那一眼。
 *
 * 「在用」不写出来：没提状态默认就是在用（和提示词里的规则一致）。
 */
export function composeQuickText(
  rows: readonly QuickEntryRow[],
  v: CommandVocab = commandVocab(),
): string {
  const lines: string[] = []
  for (const row of rows) {
    const name = row.name.trim()
    if (name === '') continue
    const parts = [`${v.item} ${name}`]

    const location = row.location.trim()
    if (location !== '') {
      parts.push(`${v.place} ${splitPathQuery(location).join(v.pathSeparator) || location}`)
    }
    const category = row.category.trim()
    if (category !== '') {
      parts.push(`${v.categorize} ${splitPathQuery(category).join(v.pathSeparator) || category}`)
    }
    const expiry = row.expiry.trim()
    if (expiry !== '') parts.push(`${v.expiry} ${expiry}`)
    if (row.status === 'idle') parts.push(`${v.status} ${v.idle}`)
    if (row.status === 'spare') parts.push(`${v.status} ${v.spare}`)

    lines.push(parts.join(v.clauseSeparator))
  }
  return lines.join('\n')
}

/* ------------------------------------------------------------------ */
/* 五、发出前体检                                                      */
/* ------------------------------------------------------------------ */

export interface PathCheck {
  /** 用户写的那串字 */
  query: string
  /** 落到库里哪一条；null = 库里没有，会被当成新的（默认不勾选） */
  id: string | null
  /** 对上时它的完整路径（给人看） */
  pathText: string | null
  /**
   * 没完全对上时，库里**最接近**的那一条（纯粹给人看的一句提示）。
   *
   * ── 为什么要有这个 ──────────────────────────────────────────
   * 用户实测报回来的：「我直接打好的时候，预检没检测出来，不过回复和处理是对的」。
   * 他打「蓝柜」，库里那条叫「蓝色柜」；程序的三级降级（`matchPath`）**确实**
   * 对不上，可**模型**会拿它当「蓝色柜」处理并给出正确结果 ——
   * 于是那一行黄字成了假警报。假警报比不提示更糟：用户会开始不信这一行。
   *
   * 所以这里退一步：对不上、但库里有明显相近的一条时，**照实说两边**，
   * 并提醒他去看草稿。注意它**只是提示** —— 匹配、判定、插值全都不用它，
   * 程序依然绝不替他改写路径（那是 convert.ts 的铁律）。
   */
  near: { id: string; pathText: string } | null
}

export interface DraftCheck {
  /** 说了几件新东西 */
  newItemCount: number
  places: PathCheck[]
  categories: PathCheck[]
  /**
   * 说了「新建位置 X」但**没有任何一件东西放在 X 里**的那些。
   *
   * 这一条是本文件里最值钱的一行：位置只能挂在一件物品的「放在」上一起建，
   * 光说「新建位置」这条链路上什么都不会发生。用户这么写的时候必须有人告诉他，
   * 否则他会以为建好了 —— 那正是这个项目最不能接受的失败方式（静默什么也没做）。
   */
  orphanNewPlaces: string[]
}

export interface InspectOptions {
  vocab?: CommandVocab
  /** id → 完整路径（给人看） */
  locationPath: (id: string) => string
  categoryPath: (id: string) => string
  /** 两棵树本身 —— 只在算「库里最接近的是哪条」时用得上 */
  locationIndex: TreeIndex<Location>
  categoryIndex: TreeIndex<Category>
}

/** 整段话切成一句一句（按换行和句末标点） */
function clausesOf(text: string): string[] {
  const out: string[] = []
  let current = ''
  for (const ch of text) {
    if (isBoundary(ch)) {
      if (current.trim() !== '') out.push(current)
      current = ''
      continue
    }
    current += ch
  }
  if (current.trim() !== '') out.push(current)
  return out
}

function countOccurrences(text: string, needle: string): number {
  if (needle === '') return 0
  let count = 0
  let at = text.indexOf(needle)
  while (at >= 0) {
    count++
    at = text.indexOf(needle, at + needle.length)
  }
  return count
}

/**
 * 编辑距离（只算长度差以内的那几条，名字都很短，够用）。
 *
 * 写它不是为了「模糊匹配」——匹配必须和 AI、和搜索框同一套（见文件顶部的说明）。
 * 它只服务于**一句提示**：「库里最接近的是 X」。
 */
function editDistance(a: string, b: string): number {
  if (a === b) return 0
  if (a === '' || b === '') return a.length + b.length
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const current = [i]
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1
      current[j] = Math.min(current[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost)
    }
    prev = current
  }
  return prev[b.length]
}

/**
 * 「最接近」的分数：越小越像，`MAX` = 不像。
 *
 * 档位是有讲究的：
 *   · 包含关系（「白色三层收纳」⊂「桌子下白色三层收纳」）→ 1，最有把握
 *   · 差一个字（「蓝柜」↔「蓝色柜」，少打一个「色」）→ 2
 *   · 差两个字且名字够长 → 3，只当弱提示（短名字差两个字基本就是两条不同的东西）
 */
function nearScore(query: string, name: string): number {
  const q = normName(query)
  const n = normName(name)
  if (q === '' || n === '') return Number.MAX_SAFE_INTEGER
  if (q === n) return 0
  if (n.includes(q) || q.includes(n)) return 1
  const distance = editDistance(q, n)
  if (distance === 1) return 2
  if (distance === 2 && Math.min(q.length, n.length) >= 4) return 3
  return Number.MAX_SAFE_INTEGER
}

/**
 * 在树里找和用户写的这一串最像的一条。
 *
 * 比的是**末级名字**（这个 App 里位置可以挂在任意一级，末级才是他在说的东西），
 * 但拿「包含」关系兜住了「他少打了前缀」的情况（打「白色三层收纳」，
 * 库里那条叫「桌子下白色三层收纳」）。
 *
 * `scope` 是「路径前半段已经对上了」时收窄过的范围：只在那一棵子树里找。
 * 不收窄的话会出现这种误导：写「客厅 / 柜子 / 2层」而「客厅」根本不存在时，
 * 末级「2层」会匹配到另一个分支下的「2层」，于是提示指向一个他没在说的地方。
 * 反过来说：**前缀对不上时不收窄**，因为那正是「少打了前缀」的常见情形。
 */
function closestMatch<T extends TreeItem>(
  query: string,
  index: TreeIndex<T>,
  v: CommandVocab,
  scope?: ReadonlySet<string>,
): { id: string; pathText: string; score: number } | null {
  const parts = splitPathQuery(query)
  const last = parts.length > 0 ? parts[parts.length - 1] : query
  if (last.trim() === '') return null

  let best: { id: string; pathText: string; score: number; depth: number } | null = null
  for (const node of index.byId.values()) {
    if (scope !== undefined && !scope.has(node.id)) continue
    const score = nearScore(last, node.name)
    if (score === Number.MAX_SAFE_INTEGER) continue
    const path = index.pathNames(node.id)
    if (path.length === 0) continue
    if (best === null || score < best.score || (score === best.score && path.length < best.depth)) {
      best = { id: node.id, pathText: path.join(v.pathSeparator), score, depth: path.length }
    }
  }
  return best === null ? null : { id: best.id, pathText: best.pathText, score: best.score }
}

/**
 * 给一句话里的那个路径配一条「库里最接近的是谁」。
 *
 * 规矩是从「不许误导」倒推出来的：
 *   · 单个词（「蓝柜」）→ 全树比名字：这正是用户实测那个「蓝柜 ↔ 蓝色柜」
 *   · 带 `/` → 从左边一段一段往下走，能走多深算多深，然后在**那一棵子树**里
 *     比末级名字。用户那句「桌子/桌子下/白色三层收纳/2层」就是这样：
 *     前两段对得上（第三段在库里叫「桌子下白色三层收纳」），
 *     于是范围收窄到「桌子下」，末级「2层」正好指到他要的那一层。
 *   · 连**第一段**都对不上（写「客厅/柜子/2层」而「客厅」根本不存在）→
 *     **不给提示**：这时候全树乱比出来的「最接近」多半落在别的分支上，
 *     指错地方比不说更糟。这时老老实实说「会被当成新位置」才对。
 */
function nearMatchFor<T extends TreeItem>(
  query: string,
  index: TreeIndex<T>,
  v: CommandVocab,
): { id: string; pathText: string; score: number } | null {
  const parts = splitPathQuery(query)
  if (parts.length <= 1) return closestMatch(query, index, v)

  let scopeId: string | null = null
  for (let depth = 1; depth <= parts.length - 1; depth++) {
    const resolved = resolveChain(index, parts.slice(0, depth))
    if (resolved === null) break
    scopeId = resolved
  }
  if (scopeId === null) return null
  return closestMatch(query, index, v, index.descendantIds(scopeId))
}

/**
 * 把整段话本地过一遍。
 *
 * ⚠️ 这里**不是**在替模型理解这句话：它只做一件事 —— 把「位置/分类到底对不对得上
 * 你库里的东西」提前告诉用户。而这件事程序本来就说了算（convert.ts 里那套
 * 三级降级匹配），所以这里用的是同一把尺子（`matchPath`），不是另写一套猜的。
 */
export function inspectDraft(text: string, ctx: MatchContext, opts: InspectOptions): DraftCheck {
  const v = opts.vocab ?? commandVocab()
  const places: PathCheck[] = []
  const categories: PathCheck[] = []
  const declaredNew: string[] = []

  for (const clause of clausesOf(text)) {
    const place = lastTrigger(clause, v.placeTriggers)
    const category = lastTrigger(clause, v.categoryTriggers)
    const declaresNew = clause.includes(v.newPlace)

    if (place !== null) {
      const raw = queryAfter(clause, place, v)
      const pathText = raw.replace(v.newPlace, '').trim()
      if (pathText !== '') {
        const id = matchPath(splitPathQuery(pathText), ctx.locations)
        places.push({
          query: pathText,
          id,
          pathText: id !== null ? opts.locationPath(id) : null,
          near: id !== null ? null : nearMatchFor(pathText, opts.locationIndex, v),
        })
      }
      /* 「放在新建位置 A/B」= 这一件就落在那个（新）位置上，所以不算孤儿 */
      if (declaresNew) declaredNew.push(pathText === '' ? '' : normPathText(pathText))
    } else if (declaresNew) {
      /* 光说「新建位置 A/B」：先把路径记下来，最后再算它有没有被谁用上 */
      const at = clause.lastIndexOf(v.newPlace)
      const rest = trimClauseQuery(clause.slice(at + v.newPlace.length).trim())
      declaredNew.push(rest === '' ? '' : normPathText(rest))
    }

    if (category !== null) {
      const query = queryAfter(clause, category, v)
      if (query !== '') {
        const id = matchPath(splitPathQuery(query), ctx.categories)
        categories.push({
          query,
          id,
          pathText: id !== null ? opts.categoryPath(id) : null,
          near: id !== null ? null : nearMatchFor(query, opts.categoryIndex, v),
        })
      }
    }
  }

  const used = places.map((place) => normPathText(place.query))
  const orphanNewPlaces = [
    ...new Set(
      declaredNew.filter((path) => {
        if (path === '') return true
        return !used.some((place) => place === path || place.startsWith(`${path}/`))
      }),
    ),
  ]

  return {
    newItemCount: countOccurrences(text, v.item),
    places,
    categories,
    orphanNewPlaces,
  }
}
