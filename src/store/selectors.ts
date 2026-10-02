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
} from '../types'
import { UNASSIGNED_ID, UNCATEGORIZED_ID, UNTAGGED_ID } from '../types'
import type { LocationIndex, TreeNode } from '../lib/tree'
import { buildLocationTree, createLocationIndex, flattenTree } from '../lib/tree'
import { daysSince } from '../lib/format'

/* ------------------------------------------------------------------ */
/* 派生上下文 —— 每次数据变化时算一次，供所有筛选/分组/统计复用         */
/* ------------------------------------------------------------------ */

export interface DerivedContext {
  index: LocationIndex
  tree: TreeNode<Location>[]
  flat: TreeNode<Location>[]
  /** 位置 id → 在树中的显示顺序，用于排序 */
  locationOrder: Map<string, number>
  categoryById: Map<string, Category>
  categoryOrder: Map<string, number>
  attrDefById: Map<string, AttributeDef>
}

export function createDerived(data: AppData): DerivedContext {
  const index = createLocationIndex(data.locations)
  const tree = buildLocationTree(data.locations)
  const flat = flattenTree(tree)

  const locationOrder = new Map<string, number>()
  flat.forEach((n, i) => locationOrder.set(n.node.id, i))

  const sortedCategories = [...data.categories].sort(categoryCmp)
  const categoryById = new Map(data.categories.map((c) => [c.id, c]))
  const categoryOrder = new Map<string, number>()
  sortedCategories.forEach((c, i) => categoryOrder.set(c.id, i))

  const attrDefById = new Map(data.attributeDefs.map((a) => [a.id, a]))

  return { index, tree, flat, locationOrder, categoryById, categoryOrder, attrDefById }
}

function categoryCmp(a: Category, b: Category): number {
  if (a.order !== b.order) return a.order - b.order
  return a.name.localeCompare(b.name, 'zh-CN')
}

/** 找出某个位置所属的顶层节点 id（自己就是顶层时返回自己） */
export function rootLocationId(ctx: DerivedContext, id: string): string | null {
  let cur = ctx.index.byId.get(id)
  const seen = new Set<string>()
  while (cur && cur.parentId && !seen.has(cur.id)) {
    seen.add(cur.id)
    const parent: Location | undefined = ctx.index.byId.get(cur.parentId)
    if (!parent) break
    cur = parent
  }
  return cur?.id ?? null
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
  categorizedCount: number
  categoryCount: number
  locationCount: number
  tagCount: number
  attributeDefCount: number
}

export function computeStats(data: AppData): Stats {
  let activeCount = 0
  let idleCount = 0
  let discardedCount = 0
  let unassignedCount = 0
  let categorizedCount = 0

  for (const item of data.items) {
    if (item.status === 'discarded') {
      discardedCount++
      continue
    }
    if (item.status === 'idle') idleCount++
    else activeCount++

    if (!item.locationId) unassignedCount++
    if (item.categoryIds.length > 0) categorizedCount++
  }

  return {
    totalItems: activeCount + idleCount,
    activeCount,
    idleCount,
    discardedCount,
    unassignedCount,
    categorizedCount,
    categoryCount: data.categories.length,
    locationCount: data.locations.length,
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

export function countByCategory(items: Item[], ctx: DerivedContext): BarDatum[] {
  const counts = new Map<string, number>()
  let uncategorized = 0

  for (const item of items) {
    if (item.categoryIds.length === 0) {
      uncategorized++
      continue
    }
    for (const id of new Set(item.categoryIds)) {
      counts.set(id, (counts.get(id) ?? 0) + 1)
    }
  }

  const out: BarDatum[] = []
  for (const [id, value] of counts) {
    const cat = ctx.categoryById.get(id)
    if (!cat) continue
    out.push({ key: id, label: cat.name, value, target: { kind: 'category', id } })
  }
  out.sort((a, b) => b.value - a.value || a.label.localeCompare(b.label, 'zh-CN'))

  if (uncategorized > 0) {
    out.push({ key: '__uncategorized__', label: '未分类', value: uncategorized })
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
    const rootId = rootLocationId(ctx, item.locationId)
    if (!rootId) {
      unassigned++
      continue
    }
    counts.set(rootId, (counts.get(rootId) ?? 0) + 1)
  }

  const out: BarDatum[] = []
  for (const [id, value] of counts) {
    const loc = ctx.index.byId.get(id)
    if (!loc) continue
    out.push({ key: id, label: loc.name, value, target: { kind: 'location', id } })
  }
  // 按位置树顺序排，跟位置页保持一致，便于对照
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
    .map(([tag, value]): BarDatum => ({ key: tag, label: tag, value, target: { kind: 'tag', id: tag } }))
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

export type AttrOp = 'contains' | 'eq' | 'gt' | 'lt' | 'isTrue' | 'isFalse' | 'hasValue' | 'noValue'

export interface AttrFilter {
  defId: string
  op: AttrOp
  value: string
}

export interface ItemFilter {
  search: string
  categoryIds: string[]
  /** 可以是位置 id，也可以是 UNASSIGNED_ID */
  locationIds: string[]
  statuses: ItemStatus[]
  tags: string[]
  attrFilters: AttrFilter[]
  /** 位置筛选是否包含子孙节点 */
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

/** 把物品的可搜索文本拼成一个串（名称 + 备注 + 标签 + 属性值） */
function searchHaystack(item: Item): string {
  const parts: string[] = [item.name, item.note, ...item.tags]
  for (const v of Object.values(item.attrs)) {
    if (v === null || v === undefined) continue
    if (typeof v === 'boolean') parts.push(v ? '是' : '否')
    else parts.push(String(v))
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

export function matchesFilter(item: Item, filter: ItemFilter, ctx: DerivedContext): boolean {
  const search = filter.search.trim().toLowerCase()
  if (search !== '' && !searchHaystack(item).includes(search)) return false

  if (filter.statuses.length > 0 && !filter.statuses.includes(item.status)) return false

  if (filter.categoryIds.length > 0) {
    const wantsUncategorized = filter.categoryIds.includes(UNCATEGORIZED_ID)
    const hit =
      item.categoryIds.some((id) => filter.categoryIds.includes(id)) ||
      (wantsUncategorized && item.categoryIds.length === 0)
    if (!hit) return false
  }

  if (filter.locationIds.length > 0) {
    const locId = item.locationId
    let hit = false

    if (!locId) {
      hit = filter.locationIds.includes(UNASSIGNED_ID)
    } else {
      for (const selected of filter.locationIds) {
        if (selected === UNASSIGNED_ID) continue
        if (selected === locId) {
          hit = true
          break
        }
        if (filter.includeDescendants && ctx.index.descendantIds(selected).has(locId)) {
          hit = true
          break
        }
      }
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

  for (const af of filter.attrFilters) {
    // 属性定义已被删除的筛选条件自动失效，不阻塞结果
    if (!ctx.attrDefById.has(af.defId)) continue
    if (!matchAttrValue(item.attrs[af.defId], af)) return false
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
  /** 标题下的次要说明 */
  sublabel?: string
  items: Item[]
}

export function groupItems(
  items: Item[],
  groupBy: GroupBy,
  ctx: DerivedContext,
): ItemGroup[] {
  if (groupBy === 'none') {
    return [{ key: '__all__', label: '全部', items }]
  }

  if (groupBy === 'status') {
    const buckets = new Map<ItemStatus, Item[]>()
    for (const item of items) {
      const arr = buckets.get(item.status)
      if (arr) arr.push(item)
      else buckets.set(item.status, [item])
    }
    return STATUS_ORDER.filter((s) => buckets.has(s)).map((s) => ({
      key: s,
      label: STATUS_LABEL[s],
      items: buckets.get(s)!,
    }))
  }

  if (groupBy === 'category') {
    const buckets = new Map<string, Item[]>()
    const uncategorized: Item[] = []
    for (const item of items) {
      if (item.categoryIds.length === 0) {
        uncategorized.push(item)
        continue
      }
      for (const id of new Set(item.categoryIds)) {
        const arr = buckets.get(id)
        if (arr) arr.push(item)
        else buckets.set(id, [item])
      }
    }

    const groups: ItemGroup[] = [...buckets]
      .map(([id, groupItemsList]): ItemGroup => ({
        key: id,
        label: ctx.categoryById.get(id)?.name ?? '（已删除的分类）',
        items: groupItemsList,
      }))
      .sort(
        (a, b) =>
          (ctx.categoryOrder.get(a.key) ?? 1e6) - (ctx.categoryOrder.get(b.key) ?? 1e6) ||
          b.items.length - a.items.length,
      )

    if (uncategorized.length > 0) {
      groups.push({ key: '__uncategorized__', label: '未分类', items: uncategorized })
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
      const arr = buckets.get(item.locationId)
      if (arr) arr.push(item)
      else buckets.set(item.locationId, [item])
    }

    const groups: ItemGroup[] = [...buckets]
      .map(([id, groupItemsList]): ItemGroup => ({
        key: id,
        label: ctx.index.byId.get(id)?.name ?? '（已删除的位置）',
        sublabel: ctx.index.pathString(id),
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
      const arr = buckets.get(tag)
      if (arr) arr.push(item)
      else buckets.set(tag, [item])
    }
  }

  const groups: ItemGroup[] = [...buckets]
    .map(([tag, groupItemsList]): ItemGroup => ({ key: tag, label: tag, items: groupItemsList }))
    .sort((a, b) => b.items.length - a.items.length || a.label.localeCompare(b.label, 'zh-CN'))

  if (untagged.length > 0) {
    groups.push({ key: '__untagged__', label: '未加标签', items: untagged })
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
/* 位置视角                                                            */
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
  const scope = includeDescendants ? ctx.index.descendantIds(locationId) : new Set([locationId])
  return items.filter((i) => i.locationId !== null && scope.has(i.locationId))
}

/** 每个位置节点下的物品数量，用于在位置树上显示徽标 */
export function countByLocationIncludingDescendants(
  items: Item[],
  ctx: DerivedContext,
): Map<string, number> {
  const direct = new Map<string, number>()
  for (const item of items) {
    if (!item.locationId || !ctx.index.has(item.locationId)) continue
    direct.set(item.locationId, (direct.get(item.locationId) ?? 0) + 1)
  }

  // 自底向上累加：先把直接数量放到自己身上，再沿树往上加
  const total = new Map<string, number>(direct)
  // 按深度从深到浅处理，保证父节点累加时子节点已经算完
  const ordered = [...ctx.flat].sort((a, b) => b.depth - a.depth)
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
