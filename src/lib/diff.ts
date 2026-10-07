/**
 * 两份数据之间的差异（issue 15、16，以及合并前的预览）。
 *
 * ── 为什么需要它 ─────────────────────────────────────────────────
 * 用户的原话：「现在不是有很多快照吗？我希望可以就是我选择两个快照，
 * 然后帮我对比一下这两个快照的差别是什么，不然这样我不知道到底要恢复哪个快照。」
 *
 * 设置页里那一串快照，每一行只有一个时间、一个原因、一个物品数。三个数字
 * 完全不足以决定「回退到哪一份」—— 得知道**里面差了什么**：少的那 3 件是什么，
 * 多出来的 1 件又是什么。靠猜回退一次，可能又弄丢一批东西。
 *
 * ── 三条刻意的决定 ────────────────────────────────────────────────
 *
 * 1. **不读第三份数据**。所有比较都是「左 vs 右」，各自传进来一份即可。
 *    需要「和现在的数据比」时，就是把当前数据当左边传进来 —— 调用方清楚自己在比什么。
 *
 * 2. **物品按 id 配对**。id 是这个应用里唯一稳定的身份（名字会改、会有重名）。
 *    所以「这一件变了」是可靠的；把改名看成「删一件 + 加一件」也是刻意的 ——
 *    那正是数据层面发生的事，而且名字变化会如实显示出来。
 *
 * 3. **只报「事实」，不报「建议」**。它不会说「建议恢复左边那份」——
 *    哪一份是你要的，只有你自己知道。这里只把差别摆清楚。
 */

import type { AppData, Item } from '../types'

export interface SnapshotItemChange {
  id: string
  /** 名字（两边可能不同，取有值的那一边） */
  name: string
  /** 逐字段的变化说明，形如「数量 2 → 3」「位置 家/衣柜 → 未归位」 */
  fields: string[]
}

export interface SnapshotDiff {
  /** 左边有、右边没有 */
  removed: SnapshotItemChange[]
  /** 右边有、左边没有 */
  added: SnapshotItemChange[]
  /** 两边都有、但内容不同 */
  changed: SnapshotItemChange[]
  /** 完全一样、两边都有的数量 */
  unchanged: number
  /**
   * **名字一样、id 不一样**的那些 —— 「疑似同一件东西」。
   *
   * 这是合并时最要紧的一类冲突（issue 14 里用户说的「哪些有冲突」）：
   * 本地已经有一个「棉签」，导入文件里又有一个 id 不同的「棉签」，
   * 合起来就变成两条。程序**不敢替你判断**它们是不是同一件
   * （真有两根一样的棉签也很正常），所以只如实标出来，让你自己看。
   */
  nameConflicts: Array<{
    name: string
    leftId: string
    rightId: string
    leftSummary: string
    rightSummary: string
  }>
  /** 物品总数（左右的），给摘要行用 */
  leftItemCount: number
  rightItemCount: number
  /** 件数（数量字段求和）——「东西变多了还是变少了」看这个比看条数准 */
  leftUnitCount: number
  rightUnitCount: number
  /** 分类 / 位置 / 属性 / 标签 / 活动 / 清单 的增删 */
  categories: { added: string[]; removed: string[] }
  locations: { added: string[]; removed: string[] }
  attributeDefs: { added: string[]; removed: string[] }
  tags: { added: string[]; removed: string[] }
  collections: { added: string[]; removed: string[] }
  checklists: { added: string[]; removed: string[] }
  /** 两边完全没有任何差别 */
  identical: boolean
}

type PathFn = (id: string | null) => string

function buildPathFn(nodes: Array<{ id: string; name: string; parentId: string | null }>): PathFn {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  return (id) => {
    if (id === null) return ''
    const names: string[] = []
    const seen = new Set<string>()
    let current: string | null = id
    while (current && !seen.has(current)) {
      seen.add(current)
      const node = byId.get(current)
      if (!node) break
      names.unshift(node.name)
      current = node.parentId && byId.has(node.parentId) ? node.parentId : null
    }
    return names.join(' / ')
  }
}

/** 名字路径的集合（标签一样的东西比起名字才有意义 —— 两边的 id 是不同的） */
function nameSet(nodes: Array<{ name: string; parentId: string | null; id: string }>): Set<string> {
  const path = buildPathFn(nodes)
  const out = new Set<string>()
  for (const node of nodes) out.add(path(node.id))
  return out
}

function setDiff(left: Set<string>, right: Set<string>): { added: string[]; removed: string[] } {
  const added: string[] = []
  const removed: string[] = []
  for (const value of right) if (!left.has(value)) added.push(value)
  for (const value of left) if (!right.has(value)) removed.push(value)
  added.sort()
  removed.sort()
  return { added, removed }
}

/** 一条物品的「人话」描述 —— 用来判断两边是否相同、以及写清差在哪 */
function describe(item: Item, ctx: DescCtx): string[] {
  return [
    item.name,
    String(item.quantity),
    item.status,
    item.categoryIds
      .map((id) => ctx.categoryPath(id))
      .filter(Boolean)
      .sort()
      .join('|'),
    ctx.locationPath(item.locationId),
    item.locationId === null ? ctx.unassigned : '',
    [...item.tags].sort().join('|'),
    Object.entries(item.attrs)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${ctx.attrName(key)}=${String(value)}`)
      .join('|'),
    item.note.trim(),
    item.expiresAt ?? '',
    item.collectionIds
      .map((id) => ctx.collectionName(id))
      .sort()
      .join('|'),
  ]
}

interface DescCtx {
  categoryPath: PathFn
  locationPath: PathFn
  attrName: (id: string) => string
  collectionName: (id: string) => string
  unassigned: string
}

function makeCtx(data: AppData, unassigned: string): DescCtx {
  const attrById = new Map(data.attributeDefs.map((d) => [d.id, d.name]))
  const collectionById = new Map(data.collections.map((c) => [c.id, c.name]))
  return {
    categoryPath: buildPathFn(data.categories),
    locationPath: buildPathFn(data.locations),
    attrName: (id) => attrById.get(id) ?? id,
    collectionName: (id) => collectionById.get(id) ?? id,
    unassigned,
  }
}

/**
 * 逐字段的人话差异。
 *
 * 只列出**真的不一样**的字段，而且用「旧 → 新」的形式 ——
 * 用户要看的是「这条被改成了什么」，不是一串原始值。
 */
function fieldDiff(before: Item, after: Item, ctx: DescCtx): string[] {
  const out: string[] = []
  if (before.quantity !== after.quantity) {
    out.push(`quantity:${before.quantity}->${after.quantity}`)
  }
  if (before.status !== after.status) out.push(`status:${before.status}->${after.status}`)
  if (before.name !== after.name) out.push(`name:${before.name}->${after.name}`)

  const catOf = (item: Item) =>
    item.categoryIds
      .map((id) => ctx.categoryPath(id))
      .filter(Boolean)
      .sort()
      .join('、')
  if (catOf(before) !== catOf(after)) out.push(`categories:${catOf(before)}->${catOf(after)}`)

  const locOf = (item: Item) =>
    item.locationId === null ? ctx.unassigned : ctx.locationPath(item.locationId)
  if (locOf(before) !== locOf(after)) out.push(`location:${locOf(before)}->${locOf(after)}`)

  if ([...before.tags].sort().join('|') !== [...after.tags].sort().join('|')) {
    out.push(`tags:${[...before.tags].sort().join('、')}->${[...after.tags].sort().join('、')}`)
  }

  const attrsOf = (item: Item) =>
    Object.entries(item.attrs)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${ctx.attrName(key)}=${String(value)}`)
      .join('、')
  if (attrsOf(before) !== attrsOf(after)) out.push(`attrs:${attrsOf(before)}->${attrsOf(after)}`)

  if (before.note.trim() !== after.note.trim()) {
    out.push(`note:${before.note.trim()}->${after.note.trim()}`)
  }
  if ((before.expiresAt ?? '') !== (after.expiresAt ?? '')) {
    out.push(`expiresAt:${before.expiresAt ?? ''}->${after.expiresAt ?? ''}`)
  }

  const colOf = (item: Item) =>
    item.collectionIds
      .map((id) => ctx.collectionName(id))
      .sort()
      .join('、')
  if (colOf(before) !== colOf(after)) out.push(`collections:${colOf(before)}->${colOf(after)}`)

  return out
}

function unitCount(items: Item[]): number {
  return items.reduce((sum, item) => sum + Math.max(0, item.quantity), 0)
}

/** 一行的简短说明：「位置 · 数量 · 状态」—— 用来让用户认出「是不是同一件」 */
function summarise(item: Item, ctx: DescCtx): string {
  const where = item.locationId === null ? ctx.unassigned : ctx.locationPath(item.locationId)
  return [where, `×${item.quantity}`, item.status].filter(Boolean).join(' · ')
}

/**
 * 比较两份数据。
 *
 * `unassigned`：位置为空那一栏在界面上叫什么（「未归位」/「No place」）。
 * 由调用方取好传进来 —— lib/ 不该知道界面语言。
 */
export function diffAppData(
  left: AppData,
  right: AppData,
  unassigned: string,
): SnapshotDiff {
  const leftCtx = makeCtx(left, unassigned)
  const rightCtx = makeCtx(right, unassigned)

  const leftById = new Map(left.items.map((item) => [item.id, item]))
  const rightById = new Map(right.items.map((item) => [item.id, item]))

  const removed: SnapshotItemChange[] = []
  const added: SnapshotItemChange[] = []
  const changed: SnapshotItemChange[] = []
  let unchanged = 0

  for (const item of left.items) {
    if (!rightById.has(item.id)) {
      removed.push({ id: item.id, name: item.name, fields: [] })
    }
  }

  for (const item of right.items) {
    const before = leftById.get(item.id)
    if (!before) {
      added.push({ id: item.id, name: item.name, fields: [] })
      continue
    }
    const beforeFields = describe(before, leftCtx)
    const afterFields = describe(item, rightCtx)
    if (beforeFields.join('\u0000') === afterFields.join('\u0000')) {
      unchanged++
      continue
    }
    changed.push({
      id: item.id,
      name: item.name || before.name,
      // 字段差异用左边那份的语境来说 —— 它描述的是「从什么变成什么」
      fields: fieldDiff(before, item, { ...rightCtx, locationPath: leftCtx.locationPath }),
    })
  }

  /*
   * 疑似同一件东西：名字一样、id 不一样。
   *
   * 只在**新增的**那一侧找 —— 两边都有的那件已经按 id 配过对了。
   * 匹配用归一化名字（去空白、不分大小写），和 AI 那边的 `normName` 一致。
   */
  const norm = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase()
  const leftByName = new Map<string, Item>()
  for (const item of left.items) {
    const key = norm(item.name)
    if (key !== '' && !leftByName.has(key)) leftByName.set(key, item)
  }
  const nameConflicts: SnapshotDiff['nameConflicts'] = []
  for (const item of added) {
    const counter = leftByName.get(norm(item.name))
    if (!counter) continue
    const source = right.items.find((x) => x.id === item.id)
    nameConflicts.push({
      name: item.name,
      leftId: counter.id,
      rightId: item.id,
      leftSummary: summarise(counter, leftCtx),
      rightSummary: source ? summarise(source, rightCtx) : '',
    })
  }

  const categories = setDiff(nameSet(left.categories), nameSet(right.categories))
  const locations = setDiff(nameSet(left.locations), nameSet(right.locations))
  const namesOnly = (list: Array<{ name: string }>) => new Set(list.map((x) => x.name))
  const attributeDefs = setDiff(namesOnly(left.attributeDefs), namesOnly(right.attributeDefs))
  const tags = setDiff(namesOnly(left.tags), namesOnly(right.tags))
  const collections = setDiff(namesOnly(left.collections), namesOnly(right.collections))
  const checklists = setDiff(namesOnly(left.checklists), namesOnly(right.checklists))

  const identical =
    removed.length === 0 &&
    added.length === 0 &&
    changed.length === 0 &&
    nameConflicts.length === 0 &&
    categories.added.length === 0 &&
    categories.removed.length === 0 &&
    locations.added.length === 0 &&
    locations.removed.length === 0 &&
    attributeDefs.added.length === 0 &&
    attributeDefs.removed.length === 0 &&
    tags.added.length === 0 &&
    tags.removed.length === 0 &&
    collections.added.length === 0 &&
    collections.removed.length === 0 &&
    checklists.added.length === 0 &&
    checklists.removed.length === 0

  return {
    removed,
    added,
    changed,
    unchanged,
    nameConflicts,
    leftItemCount: left.items.length,
    rightItemCount: right.items.length,
    leftUnitCount: unitCount(left.items),
    rightUnitCount: unitCount(right.items),
    categories,
    locations,
    attributeDefs,
    tags,
    collections,
    checklists,
    identical,
  }
}
