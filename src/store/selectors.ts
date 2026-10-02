import type {
  AppData,
  AttributeDef,
  AttrValue,
  Category,
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
}

export function createDerived(data: AppData): DerivedContext {
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
  }
}

/** 位置路径，未归位时返回「未归位」 */
export function locationPath(ctx: DerivedContext, id: string | null, sep = ' / '): string {
  return ctx.index.pathString(id, sep, '未归位')
}

/** 分类路径，未分类时返回「未分类」 */
export function categoryPath(ctx: DerivedContext, id: string | null, sep = ' / '): string {
  return ctx.categoryIndex.pathString(id, sep, '未分类')
}

/* ------------------------------------------------------------------ */
/* 统计                                                                */
/* ------------------------------------------------------------------ */

export interface Stats {
  /** 在用 + 闲置（不含已舍弃） */
  totalItems: number
  activeCount: number
  idleCount: number
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
}

export function computeStats(data: AppData): Stats {
  let activeCount = 0
  let idleCount = 0
  let discardedCount = 0
  let unassignedCount = 0
  let uncategorizedCount = 0

  for (const item of data.items) {
    if (item.status === 'discarded') {
      discardedCount++
      continue
    }
    if (item.status === 'idle') idleCount++
    else activeCount++

    if (!item.locationId) unassignedCount++
    if (item.categoryIds.length === 0) uncategorizedCount++
  }

  return {
    totalItems: activeCount + idleCount,
    activeCount,
    idleCount,
    discardedCount,
    unassignedCount,
    uncategorizedCount,
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
    out.push({ key: UNCATEGORIZED_ID, label: '未分类', value: uncategorized })
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
    out.push({ key: UNASSIGNED_ID, label: '未归位', value: unassigned })
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

  if (untagged > 0) out.push({ key: '__untagged__', label: '未加标签', value: untagged })
  return out
}

export const STATUS_LABEL: Record<ItemStatus, string> = {
  active: '在用',
  idle: '闲置',
  discarded: '已舍弃',
}

export const STATUS_ORDER: ItemStatus[] = ['active', 'idle', 'discarded']

export function countByStatus(items: Item[]): BarDatum[] {
  const counts: Record<ItemStatus, number> = { active: 0, idle: 0, discarded: 0 }
  for (const item of items) counts[item.status]++
  return STATUS_ORDER.filter((s) => counts[s] > 0).map((s) => ({
    key: s,
    label: STATUS_LABEL[s],
    value: counts[s],
    target: { kind: 'status' as const, id: s },
  }))
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
    parts.push(typeof value === 'boolean' ? (value ? '是' : '否') : String(value))
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

export interface ItemGroup {
  key: string
  label: string
  /** 标题下的次要说明（完整路径） */
  sublabel?: string
  items: Item[]
}

export function groupItems(items: Item[], groupBy: GroupBy, ctx: DerivedContext): ItemGroup[] {
  if (groupBy === 'none') {
    return [{ key: '__all__', label: '全部', items }]
  }

  if (groupBy === 'status') {
    const buckets = new Map<ItemStatus, Item[]>()
    for (const item of items) {
      const bucket = buckets.get(item.status)
      if (bucket) bucket.push(item)
      else buckets.set(item.status, [item])
    }
    return STATUS_ORDER.filter((s) => buckets.has(s)).map((s) => ({
      key: s,
      label: STATUS_LABEL[s],
      items: buckets.get(s) as Item[],
    }))
  }

  if (groupBy === 'category') {
    // 按「物品实际挂的那个分类节点」分组（可以是任意层级），
    // 标题显示节点名，次要说明显示完整路径，方便区分同名的子分类。
    const buckets = new Map<string, Item[]>()
    const uncategorized: Item[] = []

    for (const item of items) {
      if (item.categoryIds.length === 0) {
        uncategorized.push(item)
        continue
      }
      for (const id of new Set(item.categoryIds)) {
        const bucket = buckets.get(id)
        if (bucket) bucket.push(item)
        else buckets.set(id, [item])
      }
    }

    const groups: ItemGroup[] = [...buckets]
      .map(([id, groupItemsList]): ItemGroup => ({
        key: id,
        label: ctx.categoryById.get(id)?.name ?? '（已删除的分类）',
        sublabel: ctx.categoryIndex.pathString(id, ' / '),
        items: groupItemsList,
      }))
      .sort(
        (a, b) =>
          (ctx.categoryOrder.get(a.key) ?? 1e6) - (ctx.categoryOrder.get(b.key) ?? 1e6) ||
          b.items.length - a.items.length,
      )

    if (uncategorized.length > 0) {
      groups.push({ key: UNCATEGORIZED_ID, label: '未分类', items: uncategorized })
    }
    return groups
  }

  if (groupBy === 'location') {
    const buckets = new Map<string, Item[]>()
    const unassigned: Item[] = []

    for (const item of items) {
      if (!item.locationId || !ctx.index.has(item.locationId)) {
        unassigned.push(item)
        continue
      }
      const bucket = buckets.get(item.locationId)
      if (bucket) bucket.push(item)
      else buckets.set(item.locationId, [item])
    }

    const groups: ItemGroup[] = [...buckets]
      .map(([id, groupItemsList]): ItemGroup => ({
        key: id,
        label: ctx.locationById.get(id)?.name ?? '（已删除的位置）',
        sublabel: ctx.index.pathString(id, ' / '),
        items: groupItemsList,
      }))
      .sort(
        (a, b) => (ctx.locationOrder.get(a.key) ?? 1e6) - (ctx.locationOrder.get(b.key) ?? 1e6),
      )

    if (unassigned.length > 0) {
      groups.push({ key: UNASSIGNED_ID, label: '未归位', items: unassigned })
    }
    return groups
  }

  // groupBy === 'tag'：一件物品有多个标签时会出现在多个分组里（与分类同理）
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

  const groups: ItemGroup[] = [...buckets]
    .map(([tag, groupItemsList]): ItemGroup => ({ key: tag, label: tag, items: groupItemsList }))
    .sort((a, b) => b.items.length - a.items.length || a.label.localeCompare(b.label, 'zh-CN'))

  if (untagged.length > 0) {
    groups.push({ key: UNTAGGED_ID, label: '未加标签', items: untagged })
  }
  return groups
}

/** 分组后每个分组内也要排序 */
export function groupAndSort(
  items: Item[],
  groupBy: GroupBy,
  sortBy: SortBy,
  sortDir: SortDir,
  ctx: DerivedContext,
): ItemGroup[] {
  return groupItems(sortItems(items, sortBy, sortDir, ctx), groupBy, ctx)
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
      return value === true ? '是' : '否'
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
