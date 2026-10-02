/**
 * 把 AI 的原始输出对齐到用户现有的数据上。
 *
 * AI 只会给你「分类名」「位置名称路径」这类自然语言，而数据库里存的是 id。
 * 这一层负责：
 *   · 名称 → id 的匹配（位置先按完整路径匹配，再退而按末级名称匹配）
 *   · 匹配不上的，标记为「AI 建议的新分类 / 新位置」，交给用户决定要不要建
 *   · 把本地不存在的属性名丢掉，避免污染数据
 */

import type { AppData, Item } from '../types'
import type { DerivedContext } from '../store/selectors'
import type { BulkAddItem, BulkUpdateItem } from '../store/useAppStore'
import { uid } from '../lib/id'
import type { RawAssignment, RawExtractedItem } from './parse'

/* ------------------------------------------------------------------ */
/* 匹配上下文                                                          */
/* ------------------------------------------------------------------ */

export interface MatchContext {
  categoryIdByName: Map<string, string>
  categoryNameById: Map<string, string>
  /** 完整路径（'家/卧室/衣柜'）→ id */
  locationIdByPath: Map<string, string>
  /**
   * 路径后缀 → id 集合。
   * AI 有时只输出部分层级（给「卧室/衣柜」而不是「家/卧室/衣柜」），
   * 用后缀能对上；但**只有当后缀唯一时**才敢用，有歧义就交给用户决定。
   */
  locationIdsBySuffix: Map<string, Set<string>>
  /** 属性名（归一化）→ 真实属性名 */
  attributeRealName: Map<string, string>
}

const norm = (value: string) => value.trim()

export function createMatchContext(data: AppData, derived: DerivedContext): MatchContext {
  const categoryIdByName = new Map<string, string>()
  const categoryNameById = new Map<string, string>()
  for (const category of data.categories) {
    const key = norm(category.name)
    if (key === '' || categoryIdByName.has(key)) continue
    categoryIdByName.set(key, category.id)
    categoryNameById.set(category.id, category.name)
  }

  const locationIdByPath = new Map<string, string>()
  const locationIdsBySuffix = new Map<string, Set<string>>()

  for (const node of derived.flat) {
    const path = derived.index.pathNames(node.node.id)
    locationIdByPath.set(path.join('/'), node.node.id)

    // 收录这条路径的所有真后缀：['家','卧室','衣柜'] 会收录
    // '卧室/衣柜' 和 '衣柜'（不含完整路径本身，那一份已经在上面了）
    for (let start = 1; start < path.length; start++) {
      const key = path.slice(start).join('/')
      const bucket = locationIdsBySuffix.get(key)
      if (bucket) bucket.add(node.node.id)
      else locationIdsBySuffix.set(key, new Set([node.node.id]))
    }
  }

  const attributeRealName = new Map<string, string>()
  for (const def of data.attributeDefs) {
    const key = norm(def.name)
    if (key !== '' && !attributeRealName.has(key)) attributeRealName.set(key, def.name)
  }

  return {
    categoryIdByName,
    categoryNameById,
    locationIdByPath,
    locationIdsBySuffix,
    attributeRealName,
  }
}

/* ------------------------------------------------------------------ */
/* 一、批量录入的草稿                                                  */
/* ------------------------------------------------------------------ */

export interface ItemDraft {
  key: string
  /** 名称 */
  name: string
  quantity: number
  /** 匹配到的已有位置的 id；没匹配上就是 null */
  locationId: string | null
  /** 展示用的位置文字 */
  locationLabel: string
  /** AI 给出、但本地还没有的位置路径 */
  newLocationPath: string[] | null
  matchedCategoryIds: string[]
  /** AI 建议、但本地还没有的分类名 */
  newCategoryNames: string[]
  tags: string[]
  /** 只保留本地确实存在的属性名 */
  attrs: Record<string, string>
  /** 被丢掉的属性名（本地没有这个属性），界面上如实提示 */
  droppedAttrs: string[]
  note: string

  /** 是否录入 */
  include: boolean
  /** 是否采纳 AI 建议的新分类（默认否 —— 分类是受控词表，得你点头） */
  adoptNewCategories: boolean
  /** 是否采纳 AI 建议的新位置 */
  adoptNewLocation: boolean
}

/**
 * 位置匹配，三级降级：
 *   1. 完整路径精确匹配
 *   2. 把 AI 给的路径当作已有路径的**后缀**匹配 —— 但只在后缀唯一时才用
 *   3. 都不行 → 标成「新位置」，交给用户决定
 *
 * 这里刻意**不做**「路径对不上就退回按末级名称找」——
 * 那看起来更"聪明"，实际很危险：AI 说「家 / 车库 / 货架」，
 * 而你树里另有一处「家 / 储物间 / 货架」，按名称匹配就会把东西
 * 悄悄挪到储物间去。宁可标成新位置让你自己决定，也不要猜。
 *
 * 第 2 条之所以敢做，是因为它要求「唯一」：`卧室/衣柜` 在全树里只能
 * 对应一个节点，对不上就跑第 3 条。有歧义的一律不猜。
 */
function matchLocation(
  path: string[],
  ctx: MatchContext,
): { locationId: string | null; newLocationPath: string[] | null } {
  if (path.length === 0) return { locationId: null, newLocationPath: null }

  const key = path.join('/')

  const byPath = ctx.locationIdByPath.get(key)
  if (byPath) return { locationId: byPath, newLocationPath: null }

  const bySuffix = ctx.locationIdsBySuffix.get(key)
  if (bySuffix && bySuffix.size === 1) {
    return { locationId: [...bySuffix][0], newLocationPath: null }
  }

  return { locationId: null, newLocationPath: path }
}

export function toItemDraft(
  raw: RawExtractedItem,
  ctx: MatchContext,
  derived: DerivedContext,
): ItemDraft {
  const { locationId, newLocationPath } = matchLocation(raw.location ?? [], ctx)

  const matchedCategoryIds: string[] = []
  const newCategoryNames: string[] = []
  for (const name of raw.categories) {
    const id = ctx.categoryIdByName.get(norm(name))
    if (id) {
      if (!matchedCategoryIds.includes(id)) matchedCategoryIds.push(id)
    } else if (!newCategoryNames.includes(name)) {
      newCategoryNames.push(name)
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
    newCategoryNames,
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
  currentCategoryNames: string[]
  currentLocationLabel: string

  /** 匹配到的已有分类 id */
  matchedCategoryIds: string[]
  /** AI 建议的新分类名 */
  newCategoryNames: string[]
  /** 匹配到的已有位置 id */
  locationId: string | null
  /**  AI 建议的新位置路径 */
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
  const { locationId, newLocationPath } = matchLocation(assignment.location ?? [], ctx)

  const matchedCategoryIds: string[] = []
  const newCategoryNames: string[] = []
  for (const name of assignment.categories) {
    const id = ctx.categoryIdByName.get(norm(name))
    if (id) {
      if (!matchedCategoryIds.includes(id)) matchedCategoryIds.push(id)
    } else if (!newCategoryNames.includes(name)) {
      newCategoryNames.push(name)
    }
  }

  const currentLocationLabel = item.locationId
    ? derived.index.pathString(item.locationId, ' / ')
    : '未归位'

  // 完全没变、也没提出任何新东西 → 这条建议没有价值，直接丢掉
  const locationUnchanged =
    (locationId === null && newLocationPath === null) || locationId === item.locationId

  const categoriesUnchanged =
    matchedCategoryIds.length === item.categoryIds.length &&
    matchedCategoryIds.every((id) => item.categoryIds.includes(id))

  if (locationUnchanged && categoriesUnchanged && newCategoryNames.length === 0) {
    return null
  }

  return {
    key: uid(),
    itemId: item.id,
    itemName: item.name,
    currentCategoryNames: item.categoryIds
      .map((id) => ctx.categoryNameById.get(id))
      .filter((name): name is string => Boolean(name)),
    currentLocationLabel,
    matchedCategoryIds,
    newCategoryNames,
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
 * 这里刻意用「分类名 / 位置路径」而不是 id —— 因为不存在的分类和位置
 * 需要在写入时被创建出来，创建这件事由 store 统一处理。
 * 类型定义在 store 里，因为写入方才是它的归属方。
 */
export function draftsToBulkAddItems(
  drafts: ItemDraft[],
  ctx: MatchContext,
  derived: DerivedContext,
): BulkAddItem[] {
  return drafts
    .filter((draft) => draft.include && draft.name.trim() !== '')
    .map((draft) => {
      const categoryNames = [
        ...draft.matchedCategoryIds.map((id) => ctx.categoryNameById.get(id) ?? ''),
        ...(draft.adoptNewCategories ? draft.newCategoryNames : []),
      ].filter((name) => name !== '')

      const locationPath = draft.locationId
        ? derived.index.pathNames(draft.locationId)
        : draft.adoptNewLocation && draft.newLocationPath
          ? draft.newLocationPath
          : null

      return {
        name: draft.name.trim(),
        quantity: draft.quantity,
        categoryNames,
        locationPath,
        tags: draft.tags,
        attrs: draft.attrs,
        note: draft.note,
      }
    })
}

/** 整理计划：只带上真正要改的字段 */
export function draftsToBulkUpdates(
  drafts: TidyDraft[],
  ctx: MatchContext,
  derived: DerivedContext,
): BulkUpdateItem[] {
  return drafts
    .filter((draft) => draft.include)
    .map((draft) => {
      const categoryNames = [
        ...draft.matchedCategoryIds.map((id) => ctx.categoryNameById.get(id) ?? ''),
        ...(draft.adoptNewCategories ? draft.newCategoryNames : []),
      ].filter((name) => name !== '')

      const locationPath = draft.locationId
        ? derived.index.pathNames(draft.locationId)
        : draft.adoptNewLocation && draft.newLocationPath
          ? draft.newLocationPath
          : null

      return { id: draft.itemId, categoryNames, locationPath }
    })
}
