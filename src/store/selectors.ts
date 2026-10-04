import type {
  AppData,
  AttributeDef,
  AttrValue,
  Category,
  Collection,
  GroupBy,
  Item,
  ItemStatus,
  Location,
  SortBy,
  SortDir,
  TreeItem,
} from '../types'
import { UNASSIGNED_ID, UNCATEGORIZED_ID, UNTAGGED_ID } from '../types'
import type { TreeIndex, TreeNode } from '../lib/tree'
import { buildTree, createTreeIndex, flattenTree } from '../lib/tree'
import { daysSince } from '../lib/format'
import type { ExpiryState } from '../lib/expiry'
import { EXPIRY_SOON_DEFAULT_DAYS, compareExpiry, expiryState } from '../lib/expiry'
import { t } from '../i18n'

/* ------------------------------------------------------------------ */
/* 派生上下文 —— 每次数据变化时算一次，供所有筛选/分组/统计复用         */
/* ------------------------------------------------------------------ */

export interface DerivedContext {
  /* 位置树 */
  index: TreeIndex<Location>
  tree: TreeNode<Location>[]
  flat: TreeNode<Location>[]
  locationOrder: Map<string, number>
  locationById: Map<string, Location>

  /* 分类树 */
  categoryIndex: TreeIndex<Category>
  categoryTree: TreeNode<Category>[]
  categoryFlat: TreeNode<Category>[]
  /** 分类 id → 树中的显示顺序 */
  categoryOrder: Map<string, number>
  categoryById: Map<string, Category>

  attrDefById: Map<string, AttributeDef>
  /**
   * 活动 id → 活动。
   *
   * 和 attrDefById 是同一个用途：AI 草稿那边存的是 id，
   * 但发给模型、以及给人看的时候都得是名字。
   */
  collectionById: Map<string, Collection>

  /**
   * 「快过期」的天数阈值，从界面偏好带进来。
   *
   * 为什么塞进派生上下文：筛选、分组、统计都要用它，
   * 一层层往下传参数会污染一大串签名。它是个纯数值、不影响数据本身，
   * 放在这里最省事。改了它记得重建 ctx（store 里已经这么做了）。
   */
  expirySoonDays: number
}

export function createDerived(
  data: AppData,
  expirySoonDays: number = EXPIRY_SOON_DEFAULT_DAYS,
): DerivedContext {
  // ---- 位置 ----
  const index = createTreeIndex(data.locations)
  const tree = buildTree(data.locations)
  const flat = flattenTree(tree)
  const locationOrder = new Map<string, number>()
  flat.forEach((node, i) => locationOrder.set(node.node.id, i))

  // ---- 分类 ----
  const categoryIndex = createTreeIndex(data.categories)
  const categoryTree = buildTree(data.categories)
  const categoryFlat = flattenTree(categoryTree)
  const categoryOrder = new Map<string, number>()
  categoryFlat.forEach((node, i) => categoryOrder.set(node.node.id, i))
  const categoryById = new Map(data.categories.map((c) => [c.id, c]))

  const attrDefById = new Map(data.attributeDefs.map((a) => [a.id, a]))
  const collectionById = new Map(data.collections.map((c) => [c.id, c]))

  return {
    index,
    tree,
    flat,
    locationOrder,
    locationById: index.byId,
    categoryIndex,
    categoryTree,
    categoryFlat,
    categoryOrder,
    categoryById,
    attrDefById,
    collectionById,
    expirySoonDays,
  }
}

/** 位置路径，未归位时返回「未归位」 */
export function locationPath(ctx: DerivedContext, id: string | null, sep = ' / '): string {
  return ctx.index.pathString(id, sep, t('status.unassigned'))
}

/** 分类路径，未分类时返回「未分类」 */
export function categoryPath(ctx: DerivedContext, id: string | null, sep = ' / '): string {
  return ctx.categoryIndex.pathString(id, sep, t('status.uncategorized'))
}

/* ------------------------------------------------------------------ */
/* 统计                                                                */
/* ------------------------------------------------------------------ */

export interface Stats {
  /** 在用 + 闲置（不含已舍弃） */
  totalItems: number
  activeCount: number
  idleCount: number
  /** 备用（另一条支线，见 ItemStatus 的注释） */
  spareCount: number
  discardedCount: number
  unassignedCount: number
  uncategorizedCount: number
  categoryCount: number
  /** 顶层分类数量 —— 概览里显示「几个分类」时用它更直观 */
  topCategoryCount: number
  locationCount: number
  topLocationCount: number
  tagCount: number
  attributeDefCount: number
  /** 已过期（不含已舍弃） */
  expiredCount: number
  /** 还有 expirySoonDays 天以内到期，且还没过期 */
  expiringSoonCount: number
  /** 填了有效期的件数 —— 用来提示「你还没给任何东西记有效期」 */
  hasExpiryCount: number
}

export function computeStats(
  data: AppData,
  soonDays: number = EXPIRY_SOON_DEFAULT_DAYS,
): Stats {
  let activeCount = 0
  let idleCount = 0
  let spareCount = 0
  let discardedCount = 0
  let unassignedCount = 0
  let uncategorizedCount = 0
  let expiredCount = 0
  let expiringSoonCount = 0
  let hasExpiryCount = 0

  for (const item of data.items) {
    if (item.status === 'discarded') {
      discardedCount++
      continue
    }
    if (item.status === 'idle') idleCount++
    else if (item.status === 'spare') spareCount++
    else activeCount++

    if (!item.locationId) unassignedCount++
    if (item.categoryIds.length === 0) uncategorizedCount++

    if (item.expiresAt !== null) {
      hasExpiryCount++
      const state = expiryState(item.expiresAt, soonDays)
      if (state === 'expired') expiredCount++
      else if (state === 'soon') expiringSoonCount++
    }
  }

  return {
    /*
     * 「我的东西」= 在用 + 闲置 + 备用。
     *
     * 备用算进来：它是你**实实在在拥有的东西**，只是存在盒子里等用 ——
     * 不算进去的话，概览首屏那个大数字会比你实际拥有的少，那是在骗自己。
     *
     * 副作用要如实说：「闲置占比」的分母因此变大了，也就是说备用越多，
     * 那个比例显示得越小。方向是**安全**的 —— 它只是让提醒更温和，
     * 不会跑去劝你处理你特意囤的东西。
     */
    totalItems: activeCount + idleCount + spareCount,
    activeCount,
    idleCount,
    spareCount,
    discardedCount,
    unassignedCount,
    uncategorizedCount,
    expiredCount,
    expiringSoonCount,
    hasExpiryCount,
    categoryCount: data.categories.length,
    topCategoryCount: data.categories.filter((c) => c.parentId === null).length,
    locationCount: data.locations.length,
    topLocationCount: data.locations.filter((l) => l.parentId === null).length,
    tagCount: data.tags.length,
    attributeDefCount: data.attributeDefs.length,
  }
}

/** 只看「在用 + 闲置」，即界面上说「我的东西」时所指的那批 */
export function liveItems(data: AppData): Item[] {
  return data.items.filter((i) => i.status !== 'discarded')
}

/* ------------------------------------------------------------------ */
/* 图表数据（条形图）                                                   */
/* ------------------------------------------------------------------ */

export interface BarDatum {
  key: string
  label: string
  value: number
  /** 点击后跳转用的筛选目标 */
  target?: { kind: 'category' | 'location' | 'tag' | 'status'; id: string }
}

/**
 * 按**顶层分类**统计。
 *
 * 为什么按顶层：分类是树之后，把所有层级都铺开会得到几十条，图就没法看了。
 * 和「按位置」那张图保持一致 —— 那张也是只显示第一层。
 *
 * 一件物品如果同时属于同一个顶层下的两个子类（眼影 + 唇膏），
 * 这一栏只算它一次，否则合计会虚高。
 */
export function countByCategory(items: Item[], ctx: DerivedContext): BarDatum[] {
  const counts = new Map<string, number>()
  let uncategorized = 0

  for (const item of items) {
    if (item.categoryIds.length === 0) {
      uncategorized++
      continue
    }

    const roots = new Set<string>()
    for (const id of item.categoryIds) {
      const root = ctx.categoryIndex.rootId(id)
      if (root) roots.add(root)
    }
    for (const root of roots) counts.set(root, (counts.get(root) ?? 0) + 1)
  }

  const out: BarDatum[] = []
  for (const [id, value] of counts) {
    const category = ctx.categoryById.get(id)
    if (!category) continue
    out.push({
      key: id,
      label: category.name,
      value,
      target: { kind: 'category', id },
    })
  }
  // 按分类树顺序排，跟分类管理页保持一致，便于对照
  out.sort(
    (a, b) =>
      (ctx.categoryOrder.get(a.key) ?? 0) - (ctx.categoryOrder.get(b.key) ?? 0) ||
      b.value - a.value,
  )

  if (uncategorized > 0) {
    out.push({ key: UNCATEGORIZED_ID, label: t('status.uncategorized'), value: uncategorized })
  }
  return out
}

export function countByTopLocation(items: Item[], ctx: DerivedContext): BarDatum[] {
  const counts = new Map<string, number>()
  let unassigned = 0

  for (const item of items) {
    if (!item.locationId || !ctx.index.has(item.locationId)) {
      unassigned++
      continue
    }
    const rootId = ctx.index.rootId(item.locationId)
    if (!rootId) {
      unassigned++
      continue
    }
    counts.set(rootId, (counts.get(rootId) ?? 0) + 1)
  }

  const out: BarDatum[] = []
  for (const [id, value] of counts) {
    const location = ctx.locationById.get(id)
    if (!location) continue
    out.push({ key: id, label: location.name, value, target: { kind: 'location', id } })
  }
  out.sort(
    (a, b) =>
      (ctx.locationOrder.get(a.key) ?? 0) - (ctx.locationOrder.get(b.key) ?? 0) ||
      b.value - a.value,
  )

  if (unassigned > 0) {
    out.push({ key: UNASSIGNED_ID, label: t('status.unassigned'), value: unassigned })
  }
  return out
}

export function countByTag(items: Item[], _ctx: DerivedContext): BarDatum[] {
  const counts = new Map<string, number>()
  let untagged = 0

  for (const item of items) {
    if (item.tags.length === 0) {
      untagged++
      continue
    }
    for (const tag of new Set(item.tags)) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  }

  const out: BarDatum[] = [...counts]
    .map(
      ([tag, value]): BarDatum => ({
        key: tag,
        label: tag,
        value,
        target: { kind: 'tag', id: tag },
      }),
    )
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label, 'zh-CN'))

  if (untagged > 0) out.push({ key: UNTAGGED_ID, label: t('status.untagged'), value: untagged })
  return out
}

/**
 * 物品状态的显示名。
 *
 * 注意这是个**函数**而不是常量表：语言可以在运行时切换，
 * 常量表会在模块加载那一刻就把当时语言的文字冻住，切了语言也不变。
 * 这类 bug 很隐蔽（其他文案都变了，就这一处没变），所以宁可多写一层函数。
 */
export function statusLabel(status: ItemStatus): string {
  switch (status) {
    case 'idle':
      return t('status.idle')
    case 'spare':
      return t('status.spare')
    case 'discarded':
      return t('status.discarded')
    case 'active':
    default:
      return t('status.active')
  }
}

export const STATUS_ORDER: ItemStatus[] = ['active', 'spare', 'idle', 'discarded']

/* ------------------------------------------------------------------ */
/* 有效期的分组与标签                                                   */
/* ------------------------------------------------------------------ */

/** 分组桶的 key。前缀 __ 会被配色逻辑识别成「虚拟分组」用中性灰。 */
export const EXPIRY_BUCKET_KEY: Record<ExpiryState, string> = {
  expired: '__expired__',
  soon: '__expiring_soon__',
  ok: '__expiry_ok__',
  none: '__no_expiry__',
}

/** 显示顺序 = 「最该处理的排最前」 */
export const EXPIRY_STATE_ORDER: ExpiryState[] = ['expired', 'soon', 'ok', 'none']

/**
 * 有效期分组标题。
 *
 * 用「已过期 / 即将过期 / 还早 / 没填有效期」这组词，而不是
 * 「已过期 / 30 天内」—— 前者是给人看的分组名，后者更像筛选条件。
 * 具体天数会显示在分组旁边的计数里。
 */
export function labelForExpiryState(state: ExpiryState, _soonDays: number): string {
  switch (state) {
    case 'expired':
      return t('expiry.groupExpired')
    case 'soon':
      return t('expiry.groupSoon')
    case 'ok':
      return t('expiry.groupLater')
    case 'none':
      return t('expiry.groupNone')
  }
}

export function countByStatus(items: Item[]): BarDatum[] {
  const counts: Record<ItemStatus, number> = { active: 0, spare: 0, idle: 0, discarded: 0 }
  for (const item of items) counts[item.status]++
  return STATUS_ORDER.filter((s) => counts[s] > 0).map((s) => ({
    key: s,
    label: statusLabel(s),
    value: counts[s],
    target: { kind: 'status' as const, id: s },
  }))
}

/* ------------------------------------------------------------------ */
/* 备用                                                                */
/* ------------------------------------------------------------------ */

/** 备用物品（不含已舍弃的） */
export function spareItems(data: AppData): Item[] {
  return data.items.filter((item) => item.status === 'spare')
}

/**
 * 一批物品一共有几「件」—— 数量求和，不是条数。
 *
 * 备用页要同时说清两个数，因为它们回答的是不同问题：
 *   「3 种」（条数）→ 我囤了几样东西
 *   「7 件」（件数）→ 盒子里到底塞了多少
 * 囤纸巾的人要的是后者。
 */
export function totalUnits(items: readonly Item[]): number {
  return items.reduce((sum, item) => sum + item.quantity, 0)
}

/* ------------------------------------------------------------------ */
/* 筛选                                                                */
/* ------------------------------------------------------------------ */

export type AttrOp =
  | 'contains'
  | 'eq'
  | 'gt'
  | 'lt'
  | 'isTrue'
  | 'isFalse'
  | 'hasValue'
  | 'noValue'

export interface AttrFilter {
  defId: string
  op: AttrOp
  value: string
}

export interface ItemFilter {
  search: string
  /** 可以是分类 id，也可以是 UNCATEGORIZED_ID */
  categoryIds: string[]
  /** 可以是位置 id，也可以是 UNASSIGNED_ID */
  locationIds: string[]
  statuses: ItemStatus[]
  tags: string[]
  /**
   * 有效期状态。空数组 = 不按有效期筛。
   *
   * 注意 `none`（没设置）也是一个可选项 —— 用户经常想反过来找
   * 「哪些东西我还没填有效期」，所以它必须能被单独筛出来。
   */
  expiryStates: ExpiryState[]
  attrFilters: AttrFilter[]
  /** 位置 / 分类筛选是否包含子孙节点 */
  includeDescendants: boolean
}

export const EMPTY_FILTER: ItemFilter = {
  search: '',
  categoryIds: [],
  locationIds: [],
  statuses: [],
  tags: [],
  expiryStates: [],
  attrFilters: [],
  includeDescendants: true,
}

/**
 * 把物品的可搜索文本拼成一个串。
 * 除了名称、备注、标签、属性值，**还包括分类名和位置名** ——
 * 这样搜「化妆品」能把该分类下的东西都找出来，是很实用的一条。
 */
function searchHaystack(item: Item, ctx: DerivedContext): string {
  const parts: string[] = [item.name, item.note, ...item.tags]

  for (const id of item.categoryIds) {
    parts.push(ctx.categoryIndex.pathString(id, ' '))
  }
  if (item.locationId) {
    parts.push(ctx.index.pathString(item.locationId, ' '))
  }
  for (const value of Object.values(item.attrs)) {
    if (value === null || value === undefined) continue
    parts.push(typeof value === 'boolean' ? (value ? t('common.yes') : t('common.no')) : String(value))
  }

  return parts.join('\u0000').toLowerCase()
}

function matchAttrValue(value: AttrValue | undefined, filter: AttrFilter): boolean {
  const hasValue = value !== undefined && value !== null && value !== ''
  switch (filter.op) {
    case 'hasValue':
      return hasValue
    case 'noValue':
      return !hasValue
    case 'isTrue':
      return value === true
    case 'isFalse':
      return value === false
    case 'eq':
      return String(value ?? '') === filter.value
    case 'contains':
      return String(value ?? '').toLowerCase().includes(filter.value.toLowerCase())
    case 'gt': {
      const n = Number(value)
      const t = Number(filter.value)
      return Number.isFinite(n) && Number.isFinite(t) && n > t
    }
    case 'lt': {
      const n = Number(value)
      const t = Number(filter.value)
      return Number.isFinite(n) && Number.isFinite(t) && n < t
    }
    default:
      return true
  }
}

/** 取出一组 id 在树上的作用范围（含/不含子孙） */
function scopeOf<T extends { id: string; name: string; parentId: string | null; order: number }>(
  index: TreeIndex<T>,
  id: string,
  includeDescendants: boolean,
): Set<string> {
  return includeDescendants ? index.descendantIds(id) : new Set([id])
}

export function matchesFilter(item: Item, filter: ItemFilter, ctx: DerivedContext): boolean {
  const search = filter.search.trim().toLowerCase()
  if (search !== '' && !searchHaystack(item, ctx).includes(search)) return false

  if (filter.statuses.length > 0 && !filter.statuses.includes(item.status)) return false

  if (filter.categoryIds.length > 0) {
    const wantsUncategorized = filter.categoryIds.includes(UNCATEGORIZED_ID)
    let hit = false

    for (const selected of filter.categoryIds) {
      if (selected === UNCATEGORIZED_ID) continue
      const scope = scopeOf(ctx.categoryIndex, selected, filter.includeDescendants)
      if (item.categoryIds.some((id) => scope.has(id))) {
        hit = true
        break
      }
    }

    if (!hit && wantsUncategorized && item.categoryIds.length === 0) hit = true
    if (!hit) return false
  }

  if (filter.locationIds.length > 0) {
    const wantsUnassigned = filter.locationIds.includes(UNASSIGNED_ID)
    let hit = false

    if (item.locationId) {
      for (const selected of filter.locationIds) {
        if (selected === UNASSIGNED_ID) continue
        if (scopeOf(ctx.index, selected, filter.includeDescendants).has(item.locationId)) {
          hit = true
          break
        }
      }
    } else if (wantsUnassigned) {
      hit = true
    }

    if (!hit) return false
  }

  if (filter.tags.length > 0) {
    const wantsUntagged = filter.tags.includes(UNTAGGED_ID)
    const hit =
      item.tags.some((t) => filter.tags.includes(t)) ||
      (wantsUntagged && item.tags.length === 0)
    if (!hit) return false
  }

  if (filter.expiryStates.length > 0) {
    const state = expiryState(item.expiresAt, ctx.expirySoonDays)
    if (!filter.expiryStates.includes(state)) return false
  }

  for (const attrFilter of filter.attrFilters) {
    // 属性定义已被删除的筛选条件自动失效，不阻塞结果
    if (!ctx.attrDefById.has(attrFilter.defId)) continue
    if (!matchAttrValue(item.attrs[attrFilter.defId], attrFilter)) return false
  }

  return true
}

export function filterItems(items: Item[], filter: ItemFilter, ctx: DerivedContext): Item[] {
  return items.filter((item) => matchesFilter(item, filter, ctx))
}

/* ------------------------------------------------------------------ */
/* 排序                                                                */
/* ------------------------------------------------------------------ */

const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' })

export function sortItems(
  items: Item[],
  sortBy: SortBy,
  dir: SortDir,
  ctx: DerivedContext,
): Item[] {
  const sign = dir === 'asc' ? 1 : -1
  const out = [...items]

  out.sort((a, b) => {
    let cmp = 0
    switch (sortBy) {
      case 'name':
        cmp = collator.compare(a.name, b.name)
        break
      case 'quantity':
        cmp = a.quantity - b.quantity
        break
      case 'created':
        cmp = a.createdAt.localeCompare(b.createdAt)
        break
      case 'location': {
        const ao = a.locationId ? (ctx.locationOrder.get(a.locationId) ?? 1e6) : 1e6
        const bo = b.locationId ? (ctx.locationOrder.get(b.locationId) ?? 1e6) : 1e6
        cmp = ao - bo
        break
      }
      case 'expiry': {
        // 没设置有效期的固定排在最后（compareExpiry 里处理），
        // 而且**不**乘 dir —— 否则倒序时一大片没填的会浮到最前面。
        const e = compareExpiry(a.expiresAt, b.expiresAt)
        if (e !== 0) return e
        cmp = 0
        break
      }
      case 'updated':
      default:
        cmp = a.updatedAt.localeCompare(b.updatedAt)
        break
    }
    if (cmp === 0) cmp = collator.compare(a.name, b.name)
    return cmp * sign
  })

  return out
}

/** 闲置页专用：按闲置时长倒序 —— 闲置最久的排最前，最该被扔的自动浮到顶 */
export function sortByIdleDuration(items: Item[]): Item[] {
  return [...items].sort((a, b) => {
    const da = daysSince(a.idleAt ?? a.updatedAt)
    const db = daysSince(b.idleAt ?? b.updatedAt)
    if (da !== db) return db - da
    return a.name.localeCompare(b.name, 'zh-CN')
  })
}

/* ------------------------------------------------------------------ */
/* 分组                                                                */
/* ------------------------------------------------------------------ */

/**
 * 一个分组节点。
 *
 * 分类和位置是树，所以分组也是树 —— 一级一级往下展开，
 * 而不是把「眼妆」「唇妆」平铺成一堆同级标题。
 */
export interface ItemGroupNode {
  key: string
  label: string
  /** 次要说明。树形分组里不用（层级本身就说明了位置） */
  sublabel?: string
  /** **直接**挂在这个节点上的物品 */
  items: Item[]
  /** 含全部子孙的**去重**总数 —— 同一件物品挂在同一棵子树的两个节点上只算一次 */
  total: number
  children: ItemGroupNode[]
}

/** 目前只有分类和位置是树，其它维度是平的 */
export function isTreeGrouping(groupBy: GroupBy): boolean {
  return groupBy === 'category' || groupBy === 'location'
}

/** 内部用：既要算去重总数，也要留着重算，所以额外带着 itemIds */
interface BuiltNode extends ItemGroupNode {
  itemIds: Set<string>
}

function buildTreeNodes<T extends TreeItem>(
  nodes: TreeNode<T>[],
  direct: Map<string, Item[]>,
): BuiltNode[] {
  const out: BuiltNode[] = []

  for (const node of nodes) {
    const own = direct.get(node.node.id) ?? []
    const children = buildTreeNodes(node.children, direct)

    const itemIds = new Set(own.map((item) => item.id))
    for (const child of children) {
      for (const id of child.itemIds) itemIds.add(id)
    }

    // 一件东西都没有的分支直接不显示 —— 空分类没必要占地方
    if (itemIds.size === 0) continue

    out.push({
      key: node.node.id,
      label: node.node.name,
      items: own,
      total: itemIds.size,
      children: children.map(({ itemIds: _drop, ...rest }) => rest),
      itemIds,
    })
  }

  return out
}

/**
 * 按树分组（分类 / 位置）。
 *
 * 物品挂在哪一级就归到哪一级：挂在「化妆品」上的直接算在化妆品名下，
 * 挂在「化妆品 / 眼妆」上的算在眼妆名下 —— 上层只是把子孙的合计出来。
 */
export function groupItemsTree(
  items: Item[],
  dimension: 'category' | 'location',
  ctx: DerivedContext,
): ItemGroupNode[] {
  const direct = new Map<string, Item[]>()
  const loose: Item[] = []

  if (dimension === 'category') {
    for (const item of items) {
      const valid = item.categoryIds.filter((id) => ctx.categoryIndex.has(id))
      if (valid.length === 0) {
        loose.push(item)
        continue
      }
      for (const id of new Set(valid)) {
        const bucket = direct.get(id)
        if (bucket) bucket.push(item)
        else direct.set(id, [item])
      }
    }
  } else {
    for (const item of items) {
      if (!item.locationId || !ctx.index.has(item.locationId)) {
        loose.push(item)
        continue
      }
      const bucket = direct.get(item.locationId)
      if (bucket) bucket.push(item)
      else direct.set(item.locationId, [item])
    }
  }

  const roots: ItemGroupNode[] = buildTreeNodes(
    dimension === 'category' ? ctx.categoryTree : ctx.tree,
    direct,
  ).map(({ itemIds: _drop, ...rest }) => rest)

  if (loose.length > 0) {
    roots.push({
      key: dimension === 'category' ? UNCATEGORIZED_ID : UNASSIGNED_ID,
      label: dimension === 'category' ? t('status.uncategorized') : t('status.unassigned'),
      items: loose,
      total: loose.length,
      children: [],
    })
  }

  return roots
}

/** 平铺分组（标签 / 状态 / 不分组）—— 这些维度本来就没有层级 */
export function groupItemsFlat(
  items: Item[],
  groupBy: GroupBy,
  ctx: DerivedContext,
): ItemGroupNode[] {
  const leaf = (key: string, label: string, bucket: Item[]): ItemGroupNode => ({
    key,
    label,
    items: bucket,
    total: bucket.length,
    children: [],
  })

  if (groupBy === 'none') {
    return [leaf('__all__', t('status.all'), items)]
  }

  if (groupBy === 'status') {
    const buckets = new Map<ItemStatus, Item[]>()
    for (const item of items) {
      const bucket = buckets.get(item.status)
      if (bucket) bucket.push(item)
      else buckets.set(item.status, [item])
    }
    return STATUS_ORDER.filter((s) => buckets.has(s)).map((s) =>
      leaf(s, statusLabel(s), buckets.get(s) as Item[]),
    )
  }

  // 有效期：固定四档，顺序就是「最该处理的排最前」。
  // 空档不显示（跟分类分组一个规矩），所以一件都没填时这里什么都不会出现。
  if (groupBy === 'expiry') {
    const buckets = new Map<ExpiryState, Item[]>()
    for (const item of items) {
      const state = expiryState(item.expiresAt, ctx.expirySoonDays)
      const bucket = buckets.get(state)
      if (bucket) bucket.push(item)
      else buckets.set(state, [item])
    }
    return EXPIRY_STATE_ORDER.filter((s) => buckets.has(s)).map((s) =>
      leaf(EXPIRY_BUCKET_KEY[s], labelForExpiryState(s, ctx.expirySoonDays), buckets.get(s) as Item[]),
    )
  }

  // 标签：一件物品有多个标签时会出现在多个分组里（与分类同理）
  const buckets = new Map<string, Item[]>()
  const untagged: Item[] = []
  for (const item of items) {
    if (item.tags.length === 0) {
      untagged.push(item)
      continue
    }
    for (const tag of new Set(item.tags)) {
      const bucket = buckets.get(tag)
      if (bucket) bucket.push(item)
      else buckets.set(tag, [item])
    }
  }

  const out = [...buckets]
    .map(([tag, bucket]) => leaf(tag, tag, bucket))
    .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label, 'zh-CN'))

  if (untagged.length > 0) out.push(leaf(UNTAGGED_ID, t('status.untagged'), untagged))
  return out
}

/** 分组后每个分组内也要排序 */
export function groupAndSort(
  items: Item[],
  groupBy: GroupBy,
  sortBy: SortBy,
  sortDir: SortDir,
  ctx: DerivedContext,
): ItemGroupNode[] {
  const sorted = sortItems(items, sortBy, sortDir, ctx)
  return isTreeGrouping(groupBy)
    ? groupItemsTree(sorted, groupBy as 'category' | 'location', ctx)
    : groupItemsFlat(sorted, groupBy, ctx)
}

/* ------------------------------------------------------------------ */
/* 分组展开状态                                                        */
/* ------------------------------------------------------------------ */

/**
 * 某个分组当前该不该展开。
 *
 * 默认值分两种情况：
 *   · **有子级的节点** → 折叠。先看一级标题，想看细的再点开 ——
 *     分类一多，全铺开根本看不出结构。
 *   · **没有子级的叶子** → 展开。它下面没有结构可钻，
 *     折叠只会把内容藏起来，白白多点一次。
 *
 * 用户点过的选择优先于默认值。因为默认值会随节点和数据变化，
 * 所以「展开」和「折叠」要分别记，不能只记一个。
 */
export function isGroupExpanded(
  key: string,
  hasChildren: boolean,
  groupBy: GroupBy,
  expandedGroups: readonly string[],
  collapsedGroups: readonly string[],
): boolean {
  if (collapsedGroups.includes(key)) return false
  if (expandedGroups.includes(key)) return true
  if (!hasChildren) return true
  return !isTreeGrouping(groupBy)
}

/** 递归找出某个 key 的节点，测试和"定位到某个分组"时用得上 */
export function findGroupNode(
  nodes: ItemGroupNode[],
  key: string,
): ItemGroupNode | undefined {
  for (const node of nodes) {
    if (node.key === key) return node
    const found = findGroupNode(node.children, key)
    if (found) return found
  }
  return undefined
}

/** 按显示顺序拍平所有分组节点（含子孙），用于分配颜色、判断哪些还有内容 */
export function flattenGroupNodes(nodes: ItemGroupNode[]): ItemGroupNode[] {
  const out: ItemGroupNode[] = []
  const walk = (list: ItemGroupNode[]) => {
    for (const node of list) {
      out.push(node)
      walk(node.children)
    }
  }
  walk(nodes)
  return out
}

/* ------------------------------------------------------------------ */
/* 位置 / 分类视角                                                     */
/* ------------------------------------------------------------------ */

/** 某个位置下的物品（可选是否含子孙位置） */
export function itemsInLocation(
  items: Item[],
  locationId: string | null,
  includeDescendants: boolean,
  ctx: DerivedContext,
): Item[] {
  if (locationId === null) {
    return items.filter((i) => !i.locationId || !ctx.index.has(i.locationId))
  }
  const scope = ctx.index.descendantIds(locationId)
  return items.filter(
    (i) => i.locationId !== null && (includeDescendants ? scope.has(i.locationId) : i.locationId === locationId),
  )
}

/** 某个分类下的物品（可选是否含子分类） */
export function itemsInCategory(
  items: Item[],
  categoryId: string,
  includeDescendants: boolean,
  ctx: DerivedContext,
): Item[] {
  const scope = scopeOf(ctx.categoryIndex, categoryId, includeDescendants)
  return items.filter((item) => item.categoryIds.some((id) => scope.has(id)))
}

/* ------------------------------------------------------------------ */
/* 活动合集                                                            */
/* ------------------------------------------------------------------ */

/**
 * 某个活动里的物品。
 *
 * 和分类 / 位置不同，活动**没有层级**，所以没有「含子孙」这回事 ——
 * 一件东西要么在「旅行」里，要么不在。
 */
export function itemsInCollection(items: Item[], collectionId: string): Item[] {
  return items.filter((item) => item.collectionIds.includes(collectionId))
}

/** 每个活动有多少件（不含已舍弃的）。活动本身没有内容时不出现 */
export function countByCollection(
  data: AppData,
  collections: readonly Collection[],
): Array<{ collection: Collection; count: number }> {
  const live = data.items.filter((item) => item.status !== 'discarded')

  // 一个活动下有几件东西，是**整个活动页最要紧的数字**，
  // 所以只遍历一次物品、按 id 累加，而不是每个活动各扫一遍全表
  const counts = new Map<string, number>()
  for (const item of live) {
    for (const id of item.collectionIds) {
      counts.set(id, (counts.get(id) ?? 0) + 1)
    }
  }

  return collections.map((collection) => ({
    collection,
    count: counts.get(collection.id) ?? 0,
  }))
}

/** 一件物品属于哪几个活动（用于物品行上显示小标签） */
export function collectionsOf(item: Item, collections: readonly Collection[]): Collection[] {
  if (item.collectionIds.length === 0) return []
  const byId = new Map(collections.map((c) => [c.id, c]))
  return item.collectionIds
    .map((id) => byId.get(id))
    .filter((c): c is Collection => c !== undefined)
}

/**
 * 每个位置节点下的物品数量（含子孙），用于在位置树上显示徽标。
 * 另外把「未归位」的数量挂在 UNASSIGNED_ID 这个键上，
 * 这样树组件不需要再单独传一个参数。
 */
export function countByLocationIncludingDescendants(
  items: Item[],
  ctx: DerivedContext,
): Map<string, number> {
  const owners: string[] = []
  let unassigned = 0

  for (const item of items) {
    if (!item.locationId || !ctx.index.has(item.locationId)) {
      unassigned++
      continue
    }
    owners.push(item.locationId)
  }

  const map = accumulateUpward(owners, ctx.flat, ctx.index)
  if (unassigned > 0) map.set(UNASSIGNED_ID, unassigned)
  return map
}

/**
 * 每个分类节点下的物品数量（含子分类），用于在分类树上显示徽标。
 * 「未分类」的数量挂在 UNCATEGORIZED_ID 上。
 */
export function countByCategoryIncludingDescendants(
  items: Item[],
  ctx: DerivedContext,
): Map<string, number> {
  const owners: string[] = []
  let uncategorized = 0

  for (const item of items) {
    const valid = item.categoryIds.filter((id) => ctx.categoryIndex.has(id))
    if (valid.length === 0) {
      uncategorized++
      continue
    }
    owners.push(...valid)
  }

  const map = accumulateUpward(owners, ctx.categoryFlat, ctx.categoryIndex)
  if (uncategorized > 0) map.set(UNCATEGORIZED_ID, uncategorized)
  return map
}

/**
 * 自底向上累加数量。
 * 先把直接数量放到各自节点上，再按深度从深到浅往父节点加 ——
 * 这样每个节点拿到的是「自己 + 所有子孙」的合计。
 *
 * 注意：同一件物品同时挂在同一棵子树的两个节点上时（眼影 + 唇膏），
 * 父节点只会被加一次，不会虚高。
 */
function accumulateUpward<T extends TreeItem>(
  ownerIds: string[],
  flat: TreeNode<T>[],
  index: TreeIndex<T>,
): Map<string, number> {
  const total = new Map<string, number>()
  const perNode = new Map<string, Set<string>>()

  // 同一个节点收到同一件物品只有一次
  ownerIds.forEach((id, index0) => {
    if (!index.has(id)) return
    const bucket = perNode.get(id)
    if (bucket) bucket.add(String(index0))
    else perNode.set(id, new Set([String(index0)]))
  })

  for (const [id, bucket] of perNode) total.set(id, bucket.size)

  const ordered = [...flat].sort((a, b) => b.depth - a.depth)
  for (const node of ordered) {
    const self = total.get(node.node.id) ?? 0
    if (node.node.parentId) {
      total.set(node.node.parentId, (total.get(node.node.parentId) ?? 0) + self)
    }
  }
  return total
}

/** 直接挂在某个位置（不含子孙）的物品数量 */
export function directCountByLocation(items: Item[], ctx: DerivedContext): Map<string, number> {
  const direct = new Map<string, number>()
  for (const item of items) {
    if (!item.locationId || !ctx.index.has(item.locationId)) continue
    direct.set(item.locationId, (direct.get(item.locationId) ?? 0) + 1)
  }
  return direct
}

/* ------------------------------------------------------------------ */
/* 属性显示值                                                          */
/* ------------------------------------------------------------------ */

/** 把属性值渲染成给人看的字符串 */
export function formatAttrValue(def: AttributeDef, value: AttrValue | undefined): string {
  if (value === undefined || value === null || value === '') return ''
  switch (def.type) {
    case 'bool':
      return value === true ? t('common.yes') : t('common.no')
    case 'number': {
      const n = Number(value)
      if (!Number.isFinite(n)) return String(value)
      return def.unit ? `${n} ${def.unit}` : String(n)
    }
    case 'date':
      return String(value)
    default:
      return String(value)
  }
}
