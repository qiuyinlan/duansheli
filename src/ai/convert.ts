/**
 * 把 AI 的原始输出对齐到用户现有的数据上。
 *
 * AI 只会给你「分类名」「位置名称路径」这类自然语言，而数据库里存的是 id。
 * 这一层负责：
 *   · 名称路径 → id 的匹配
 *   · 匹配不上的，标记为「AI 建议的新分类 / 新位置」，交给用户决定要不要建
 *   · 把本地不存在的属性名丢掉，避免污染数据
 *
 * 分类和位置现在都是树，匹配逻辑一模一样，所以用同一套 PathMatcher。
 */

import type { AppData, Item, TreeItem } from '../types'
import type { DerivedContext } from '../store/selectors'
import type { BulkAddItem, BulkUpdateItem } from '../store/useAppStore'
import type { TreeIndex } from '../lib/tree'
import { uid } from '../lib/id'
import type { RawAssignment, RawExtractedItem } from './parse'

/* ------------------------------------------------------------------ */
/* 路径匹配                                                            */
/* ------------------------------------------------------------------ */

export interface PathMatcher {
  /** 完整路径（'化妆品/眼妆'）→ id */
  byPath: Map<string, string>
  /**
   * 路径后缀 → id 集合。
   * AI 有时只输出部分层级（给「眼妆」而不是「化妆品 / 眼妆」），
   * 用后缀能对上；但**只有当后缀唯一时**才敢用，有歧义就交给用户决定。
   */
  bySuffix: Map<string, Set<string>>
}

export interface MatchContext {
  categories: PathMatcher
  locations: PathMatcher
  /** 属性名（归一化）→ 真实属性名 */
  attributeRealName: Map<string, string>
}

function buildPathMatcher<T extends TreeItem>(index: TreeIndex<T>): PathMatcher {
  const byPath = new Map<string, string>()
  const bySuffix = new Map<string, Set<string>>()

  for (const node of index.byId.values()) {
    const rawPath = index.pathNames(node.id)
    if (rawPath.length === 0) continue

    // 每一段都做归一化（去首尾空格），否则 AI 写「 衣物 」就匹配不上了
    const path = rawPath.map(norm)
    byPath.set(path.join('/'), node.id)

    // 收录这条路径的所有真后缀：['化妆品','眼妆'] 会收录 '眼妆'
    for (let start = 1; start < path.length; start++) {
      const key = path.slice(start).join('/')
      const bucket = bySuffix.get(key)
      if (bucket) bucket.add(node.id)
      else bySuffix.set(key, new Set([node.id]))
    }
  }

  return { byPath, bySuffix }
}

const norm = (value: string) => value.trim()

export function createMatchContext(data: AppData, derived: DerivedContext): MatchContext {
  const attributeRealName = new Map<string, string>()
  for (const def of data.attributeDefs) {
    const key = norm(def.name)
    if (key !== '' && !attributeRealName.has(key)) attributeRealName.set(key, def.name)
  }

  return {
    categories: buildPathMatcher(derived.categoryIndex),
    locations: buildPathMatcher(derived.index),
    attributeRealName,
  }
}

/**
 * 路径匹配，三级降级：
 *   1. 完整路径精确匹配
 *   2. 把 AI 给的路径当作已有路径的**后缀**匹配 —— 但只在后缀唯一时才用
 *   3. 都不行 → 返回 null，由调用方标记成「新建」
 *
 * 刻意**不做**「路径对不上就退回按末级名称找」——
 * 那看起来更"聪明"，实际很危险：AI 说「家 / 车库 / 货架」，
 * 而你树里另有一处「家 / 储物间 / 货架」，按名称匹配就会把东西
 * 悄悄挪到储物间去。宁可标成新建让你自己决定，也不要猜。
 *
 * 第 2 条之所以敢做，是因为它要求「唯一」：有歧义的一律不猜。
 */
function matchPath(path: string[], matcher: PathMatcher): string | null {
  // 跟 buildPathMatcher 用同一套归一化，否则「 衣物 」这种带空格的就对不上
  const normalized = path.map(norm).filter((part) => part !== '')
  if (normalized.length === 0) return null

  const key = normalized.join('/')
  const exact = matcher.byPath.get(key)
  if (exact) return exact

  const suffix = matcher.bySuffix.get(key)
  if (suffix && suffix.size === 1) return [...suffix][0]

  return null
}

/* ------------------------------------------------------------------ */
/* 一、批量录入的草稿                                                  */
/* ------------------------------------------------------------------ */

export interface ItemDraft {
  key: string
  name: string
  quantity: number
  /** 匹配到的已有位置的 id；没匹配上就是 null */
  locationId: string | null
  /** 展示用的位置文字 */
  locationLabel: string
  /** AI 给出、但本地还没有的位置路径 */
  newLocationPath: string[] | null
  matchedCategoryIds: string[]
  /** AI 建议、但本地还没有的分类路径（每条是从顶层到末级的名字） */
  newCategoryPaths: string[][]
  tags: string[]
  /** 只保留本地确实存在的属性名 */
  attrs: Record<string, string>
  /** 被丢掉的属性名（本地没有这个属性），界面上如实提示 */
  droppedAttrs: string[]
  note: string

  include: boolean
  /** 是否采纳 AI 建议的新分类（默认否 —— 分类是受控词表，得你点头） */
  adoptNewCategories: boolean
  /** 是否采纳 AI 建议的新位置 */
  adoptNewLocation: boolean
}

export function toItemDraft(
  raw: RawExtractedItem,
  ctx: MatchContext,
  derived: DerivedContext,
): ItemDraft {
  const locationId = raw.location ? matchPath(raw.location, ctx.locations) : null
  const newLocationPath = raw.location && !locationId ? raw.location : null

  const matchedCategoryIds: string[] = []
  const newCategoryPaths: string[][] = []
  for (const path of raw.categoryPaths) {
    const id = matchPath(path, ctx.categories)
    if (id) {
      if (!matchedCategoryIds.includes(id)) matchedCategoryIds.push(id)
    } else if (path.length > 0) {
      newCategoryPaths.push(path)
    }
  }

  const attrs: Record<string, string> = {}
  const droppedAttrs: string[] = []
  for (const [name, value] of Object.entries(raw.attributes)) {
    const realName = ctx.attributeRealName.get(norm(name))
    if (realName) attrs[realName] = value
    else droppedAttrs.push(name)
  }

  const locationLabel = locationId
    ? derived.index.pathString(locationId, ' / ')
    : newLocationPath
      ? `${newLocationPath.join(' / ')}（新）`
      : '未归位'

  return {
    key: uid(),
    name: raw.name,
    quantity: raw.quantity,
    locationId,
    locationLabel,
    newLocationPath,
    matchedCategoryIds,
    newCategoryPaths,
    tags: raw.tags,
    attrs,
    droppedAttrs,
    note: raw.note,
    include: true,
    adoptNewCategories: false,
    adoptNewLocation: false,
  }
}

/* ------------------------------------------------------------------ */
/* 二、整理已有物品的草稿                                              */
/* ------------------------------------------------------------------ */

export interface TidyDraft {
  key: string
  itemId: string
  itemName: string
  /** 当前分类的完整名称路径 */
  currentCategoryPaths: string[][]
  currentLocationLabel: string

  matchedCategoryIds: string[]
  newCategoryPaths: string[][]
  locationId: string | null
  newLocationPath: string[] | null

  reason: string
  include: boolean
  adoptNewCategories: boolean
  adoptNewLocation: boolean
}

export function toTidyDraft(
  assignment: RawAssignment,
  item: Item,
  ctx: MatchContext,
  derived: DerivedContext,
): TidyDraft | null {
  const locationId = assignment.location ? matchPath(assignment.location, ctx.locations) : null
  const newLocationPath = assignment.location && !locationId ? assignment.location : null

  const matchedCategoryIds: string[] = []
  const newCategoryPaths: string[][] = []
  for (const path of assignment.categoryPaths) {
    const id = matchPath(path, ctx.categories)
    if (id) {
      if (!matchedCategoryIds.includes(id)) matchedCategoryIds.push(id)
    } else if (path.length > 0) {
      newCategoryPaths.push(path)
    }
  }

  const currentCategoryPaths = item.categoryIds
    .map((id) => derived.categoryIndex.pathNames(id))
    .filter((path) => path.length > 0)

  const currentLocationLabel = item.locationId
    ? derived.index.pathString(item.locationId, ' / ')
    : '未归位'

  // 完全没变、也没提出任何新东西 → 这条建议没有价值，直接丢掉
  const locationUnchanged =
    (locationId === null && newLocationPath === null) || locationId === item.locationId

  const categoriesUnchanged =
    matchedCategoryIds.length === item.categoryIds.length &&
    matchedCategoryIds.every((id) => item.categoryIds.includes(id))

  if (locationUnchanged && categoriesUnchanged && newCategoryPaths.length === 0) {
    return null
  }

  return {
    key: uid(),
    itemId: item.id,
    itemName: item.name,
    currentCategoryPaths,
    currentLocationLabel,
    matchedCategoryIds,
    newCategoryPaths,
    locationId,
    newLocationPath,
    reason: assignment.reason,
    include: true,
    adoptNewCategories: false,
    adoptNewLocation: false,
  }
}

/* ------------------------------------------------------------------ */
/* 草稿 → 提交给 store 的计划                                          */
/* ------------------------------------------------------------------ */

/**
 * 批量录入计划。
 *
 * 这里刻意用「分类路径 / 位置路径」而不是 id —— 因为不存在的分类和位置
 * 需要在写入时被创建出来，创建这件事由 store 统一处理。
 * 类型定义在 store 里，因为写入方才是它的归属方。
 */
export function draftsToBulkAddItems(
  drafts: ItemDraft[],
  _ctx: MatchContext,
  derived: DerivedContext,
): BulkAddItem[] {
  return drafts
    .filter((draft) => draft.include && draft.name.trim() !== '')
    .map((draft) => {
      const categoryPaths = [
        ...draft.matchedCategoryIds.map((id) => derived.categoryIndex.pathNames(id)),
        ...(draft.adoptNewCategories ? draft.newCategoryPaths : []),
      ].filter((path) => path.length > 0)

      const locationPath = draft.locationId
        ? derived.index.pathNames(draft.locationId)
        : draft.adoptNewLocation && draft.newLocationPath
          ? draft.newLocationPath
          : null

      return {
        name: draft.name.trim(),
        quantity: draft.quantity,
        categoryPaths,
        locationPath,
        tags: draft.tags,
        attrs: draft.attrs,
        note: draft.note,
      }
    })
}

export function draftsToBulkUpdates(
  drafts: TidyDraft[],
  _ctx: MatchContext,
  derived: DerivedContext,
): BulkUpdateItem[] {
  return drafts
    .filter((draft) => draft.include)
    .map((draft) => {
      const categoryPaths = [
        ...draft.matchedCategoryIds.map((id) => derived.categoryIndex.pathNames(id)),
        ...(draft.adoptNewCategories ? draft.newCategoryPaths : []),
      ].filter((path) => path.length > 0)

      const locationPath = draft.locationId
        ? derived.index.pathNames(draft.locationId)
        : draft.adoptNewLocation && draft.newLocationPath
          ? draft.newLocationPath
          : null

      return { id: draft.itemId, categoryPaths, locationPath }
    })
}
