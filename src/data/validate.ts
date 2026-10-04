import type {
  AppData,
  AttrType,
  AttrValue,
  AttributeDef,
  Category,
  Collection,
  Item,
  ItemStatus,
  Location,
  Tag,
} from '../types'
import { APP_ID, SCHEMA_VERSION } from '../types'
import { normalizeExpiryDate } from '../lib/expiry'
// 警告和报错都要给用户看，所以取词写在**拼接消息的那一刻**：
// 模块顶层取词会把当时的语言冻住，切换语言后就露馅了。
import { t, tc } from '../i18n'

/* ------------------------------------------------------------------ */
/* 取值助手：导入的文件可能被手工改过，这里做防御性归一化               */
/* ------------------------------------------------------------------ */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback
}

function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function bool(v: unknown, fallback = false): boolean {
  return typeof v === 'boolean' ? v : fallback
}

function strArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.filter((x): x is string => typeof x === 'string')
}

function isoDate(v: unknown, fallback: string): string {
  if (typeof v !== 'string') return fallback
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? fallback : v
}

const ATTR_TYPES: AttrType[] = ['text', 'number', 'date', 'select', 'bool']
const ITEM_STATUSES: ItemStatus[] = ['active', 'idle', 'discarded']

function uniq(values: string[]): string[] {
  return [...new Set(values)]
}

function normalizeAttrs(v: unknown): Record<string, AttrValue> {
  if (!isRecord(v)) return {}
  const out: Record<string, AttrValue> = {}
  for (const [key, raw] of Object.entries(v)) {
    if (raw === null) continue
    if (typeof raw === 'string') {
      if (raw !== '') out[key] = raw
    } else if (typeof raw === 'number' && Number.isFinite(raw)) {
      out[key] = raw
    } else if (typeof raw === 'boolean') {
      out[key] = raw
    }
    // 其他类型（对象、数组）直接丢弃
  }
  return out
}

/* ------------------------------------------------------------------ */
/* 逐条归一化                                                          */
/* ------------------------------------------------------------------ */

function normalizeItem(raw: unknown, now: string, warn: string[], index: number): Item | null {
  if (!isRecord(raw)) {
    warn.push(t('data.validate.itemNotObject', { index: index + 1 }))
    return null
  }
  const name = str(raw.name).trim()
  if (name === '') {
    warn.push(t('data.validate.itemNoName', { index: index + 1 }))
    return null
  }
  const id = str(raw.id).trim()
  if (id === '') {
    warn.push(t('data.validate.itemNoId', { name }))
    return null
  }

  const statusRaw = str(raw.status, 'active')
  const status: ItemStatus = ITEM_STATUSES.includes(statusRaw as ItemStatus)
    ? (statusRaw as ItemStatus)
    : 'active'

  const locationIdRaw = raw.locationId
  const locationId =
    typeof locationIdRaw === 'string' && locationIdRaw.trim() !== '' ? locationIdRaw : null

  return {
    id,
    name,
    categoryIds: uniq(strArray(raw.categoryIds)),
    locationId,
    quantity: Math.max(1, Math.round(num(raw.quantity, 1))),
    status,
    tags: uniq(strArray(raw.tags).map((t) => t.trim()).filter(Boolean)),
    collectionIds: uniq(strArray(raw.collectionIds)),
    attrs: normalizeAttrs(raw.attrs),
    note: str(raw.note),
    createdAt: isoDate(raw.createdAt, now),
    updatedAt: isoDate(raw.updatedAt, now),
    idleAt: typeof raw.idleAt === 'string' ? isoDate(raw.idleAt, now) : null,
    discardedAt: typeof raw.discardedAt === 'string' ? isoDate(raw.discardedAt, now) : null,
    // 有效期过一遍归一化：备份文件可能被手工改过，也可能来自只会写日期的工具。
    // 认不出来就当成「没设置」，比塞一个坏字符串进去强。
    expiresAt: normalizeExpiryDate(raw.expiresAt),
  }
}

function normalizeLocation(raw: unknown, now: string, warn: string[]): Location | null {
  if (!isRecord(raw)) return null
  const id = str(raw.id).trim()
  const name = str(raw.name).trim()
  if (id === '' || name === '') {
    warn.push(t('data.validate.locationNoIdOrName'))
    return null
  }
  const parentIdRaw = raw.parentId
  const parentId =
    typeof parentIdRaw === 'string' && parentIdRaw.trim() !== '' ? parentIdRaw : null
  return {
    id,
    name,
    parentId,
    note: str(raw.note),
    order: num(raw.order, 0),
    createdAt: isoDate(raw.createdAt, now),
  }
}

function normalizeCategory(raw: unknown, now: string, warn: string[]): Category | null {
  if (!isRecord(raw)) return null
  const id = str(raw.id).trim()
  const name = str(raw.name).trim()
  if (id === '' || name === '') {
    warn.push(t('data.validate.categoryNoIdOrName'))
    return null
  }
  // parentId 是 v2 新增的。老备份（v1）里没有这个字段，
  // 读出来是 null，正好就是「顶层分类」—— 不需要额外的迁移逻辑。
  const parentIdRaw = raw.parentId
  const parentId =
    typeof parentIdRaw === 'string' && parentIdRaw.trim() !== '' ? parentIdRaw : null

  return {
    id,
    name,
    parentId,
    order: num(raw.order, 0),
    createdAt: isoDate(raw.createdAt, now),
  }
}

function normalizeAttributeDef(raw: unknown, now: string, warn: string[]): AttributeDef | null {
  if (!isRecord(raw)) return null
  const id = str(raw.id).trim()
  const name = str(raw.name).trim()
  if (id === '' || name === '') {
    warn.push(t('data.validate.attributeNoIdOrName'))
    return null
  }
  const typeRaw = str(raw.type, 'text')
  const type: AttrType = ATTR_TYPES.includes(typeRaw as AttrType)
    ? (typeRaw as AttrType)
    : 'text'
  return {
    id,
    name,
    type,
    options: uniq(strArray(raw.options)),
    unit: str(raw.unit),
    showByDefault: bool(raw.showByDefault, false),
    order: num(raw.order, 0),
    createdAt: isoDate(raw.createdAt, now),
  }
}

function normalizeTag(raw: unknown, now: string): Tag | null {
  // 标签兼容两种写法：{name, createdAt} 或 直接字符串
  if (typeof raw === 'string') {
    const name = raw.trim()
    return name ? { name, createdAt: now } : null
  }
  if (!isRecord(raw)) return null
  const name = str(raw.name).trim()
  if (name === '') return null
  return { name, createdAt: isoDate(raw.createdAt, now) }
}

function normalizeCollection(raw: unknown, now: string, warn: string[]): Collection | null {
  if (!isRecord(raw)) {
    warn.push(t('data.validate.collectionNotObject'))
    return null
  }
  const name = str(raw.name).trim()
  if (name === '') {
    warn.push(t('data.validate.collectionNoName'))
    return null
  }
  const id = str(raw.id).trim()
  if (id === '') {
    warn.push(t('data.validate.collectionNoId', { name }))
    return null
  }
  return {
    id,
    name,
    note: str(raw.note),
    order: num(raw.order, 0),
    createdAt: isoDate(raw.createdAt, now),
  }
}

/* ------------------------------------------------------------------ */
/* 解析与校验                                                          */
/* ------------------------------------------------------------------ */

export interface ParseSuccess {
  ok: true
  data: AppData
  exportedAt: string | null
  /** 归一化过程中发现的问题，用于提示用户 */
  warnings: string[]
}

export interface ParseFailure {
  ok: false
  error: string
}

export type ParseOutcome = ParseSuccess | ParseFailure

/**
 * 解析并归一化一个导出文件。
 * 任何一步失败都返回明确原因，调用方据此提示用户 —— 绝不半途写入。
 */
export function parseExportFile(text: string): ParseOutcome {
  const trimmed = text.trim()
  if (trimmed === '') return { ok: false, error: t('data.validate.fileEmpty') }

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return {
      ok: false,
      error: t('data.validate.fileNotJson'),
    }
  }

  if (!isRecord(parsed)) {
    return { ok: false, error: t('data.validate.fileNotObject') }
  }

  const format = str(parsed.format)
  if (format !== APP_ID) {
    return {
      ok: false,
      error: t('data.validate.fileNotOurs', { appId: APP_ID }),
    }
  }

  const schemaVersion = num(parsed.schemaVersion, 0)
  if (schemaVersion <= 0) {
    return { ok: false, error: t('data.validate.fileNoSchemaVersion') }
  }
  if (schemaVersion > SCHEMA_VERSION) {
    return {
      ok: false,
      error: t('data.validate.fileNewerSchema', {
        version: schemaVersion,
        supported: SCHEMA_VERSION,
      }),
    }
  }

  const dataRaw = parsed.data
  if (!isRecord(dataRaw)) {
    return { ok: false, error: t('data.validate.fileNoData') }
  }

  const now = new Date().toISOString()
  const warnings: string[] = []

  const rawItems = Array.isArray(dataRaw.items) ? dataRaw.items : []
  const rawLocations = Array.isArray(dataRaw.locations) ? dataRaw.locations : []
  const rawCategories = Array.isArray(dataRaw.categories) ? dataRaw.categories : []
  const rawAttrDefs = Array.isArray(dataRaw.attributeDefs) ? dataRaw.attributeDefs : []
  const rawTags = Array.isArray(dataRaw.tags) ? dataRaw.tags : []
  // v3 及更早的备份里没有 collections 字段 —— 读成空数组即可，不需要额外的迁移逻辑
  const rawCollections = Array.isArray(dataRaw.collections) ? dataRaw.collections : []

  if (
    !Array.isArray(dataRaw.items) &&
    !Array.isArray(dataRaw.locations) &&
    !Array.isArray(dataRaw.categories)
  ) {
    return { ok: false, error: t('data.validate.fileNoCollections') }
  }

  const items: Item[] = []
  rawItems.forEach((raw, i) => {
    const item = normalizeItem(raw, now, warnings, i)
    if (item) items.push(item)
  })

  const locations: Location[] = []
  for (const raw of rawLocations) {
    const loc = normalizeLocation(raw, now, warnings)
    if (loc) locations.push(loc)
  }

  const categories: Category[] = []
  for (const raw of rawCategories) {
    const cat = normalizeCategory(raw, now, warnings)
    if (cat) categories.push(cat)
  }

  const attributeDefs: AttributeDef[] = []
  for (const raw of rawAttrDefs) {
    const def = normalizeAttributeDef(raw, now, warnings)
    if (def) attributeDefs.push(def)
  }

  const tags: Tag[] = []
  const seenTags = new Set<string>()
  for (const raw of rawTags) {
    const tag = normalizeTag(raw, now)
    if (tag && !seenTags.has(tag.name)) {
      seenTags.add(tag.name)
      tags.push(tag)
    }
  }

  const collections: Collection[] = []
  for (const raw of rawCollections) {
    const collection = normalizeCollection(raw, now, warnings)
    if (collection) collections.push(collection)
  }

  // 去重：id 重复时保留第一条，避免出现两个「同一个位置」
  const dedupe = <T extends { id: string }>(list: T[], kind: string): T[] => {
    const seen = new Set<string>()
    const out: T[] = []
    for (const entry of list) {
      if (seen.has(entry.id)) {
        warnings.push(t('data.validate.duplicateId', { kind }))
        continue
      }
      seen.add(entry.id)
      out.push(entry)
    }
    return out
  }

  const dedupedItems = dedupe(items, t('data.kind.item'))
  const dedupedLocations = dedupe(locations, t('data.kind.location'))
  const dedupedCategories = dedupe(categories, t('data.kind.category'))
  const dedupedAttrDefs = dedupe(attributeDefs, t('data.kind.attribute'))
  const dedupedCollections = dedupe(collections, t('data.kind.collection'))

  // 悬空引用修复：物品指向了不存在的位置/分类/属性/活动
  const locIds = new Set(dedupedLocations.map((l) => l.id))
  const catIds = new Set(dedupedCategories.map((c) => c.id))
  const attrIds = new Set(dedupedAttrDefs.map((a) => a.id))
  const collectionIds = new Set(dedupedCollections.map((c) => c.id))

  let danglingLocations = 0
  let danglingCategories = 0
  let danglingCollections = 0
  for (const item of dedupedItems) {
    if (item.locationId && !locIds.has(item.locationId)) {
      item.locationId = null
      danglingLocations++
    }
    const before = item.categoryIds.length
    item.categoryIds = item.categoryIds.filter((id) => catIds.has(id))
    danglingCategories += before - item.categoryIds.length

    const beforeCollections = item.collectionIds.length
    item.collectionIds = item.collectionIds.filter((id) => collectionIds.has(id))
    danglingCollections += beforeCollections - item.collectionIds.length

    item.attrs = Object.fromEntries(
      Object.entries(item.attrs).filter(([key]) => attrIds.has(key)),
    )
  }
  if (danglingLocations > 0) {
    warnings.push(tc(danglingLocations, 'data.validate.danglingLocation'))
  }
  if (danglingCategories > 0) {
    warnings.push(tc(danglingCategories, 'data.validate.danglingCategory'))
  }
  if (danglingCollections > 0) {
    warnings.push(tc(danglingCollections, 'data.validate.danglingCollection'))
  }

  // 位置父子引用修复
  const parentFixed = dedupedLocations.filter(
    (l) => l.parentId !== null && !locIds.has(l.parentId),
  )
  for (const loc of parentFixed) {
    loc.parentId = null
    warnings.push(t('data.validate.locationParentMissing', { name: loc.name }))
  }

  // 分类父子引用修复（分类现在也是树，同样要处理）
  const categoryParentFixed = dedupedCategories.filter(
    (c) => c.parentId !== null && !catIds.has(c.parentId),
  )
  for (const category of categoryParentFixed) {
    category.parentId = null
    warnings.push(t('data.validate.categoryParentMissing', { name: category.name }))
  }

  const data: AppData = {
    schemaVersion: SCHEMA_VERSION,
    items: dedupedItems,
    categories: dedupedCategories,
    locations: dedupedLocations,
    attributeDefs: dedupedAttrDefs,
    tags,
    collections: dedupedCollections,
    updatedAt: now,
  }

  return {
    ok: true,
    data,
    exportedAt: typeof parsed.exportedAt === 'string' ? parsed.exportedAt : null,
    warnings,
  }
}
