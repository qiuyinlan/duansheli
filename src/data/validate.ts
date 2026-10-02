import type {
  AppData,
  AttrType,
  AttrValue,
  AttributeDef,
  Category,
  Item,
  ItemStatus,
  Location,
  Tag,
} from '../types'
import { APP_ID, SCHEMA_VERSION } from '../types'

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
    warn.push(`第 ${index + 1} 条物品不是有效对象，已跳过`)
    return null
  }
  const name = str(raw.name).trim()
  if (name === '') {
    warn.push(`第 ${index + 1} 条物品没有名称，已跳过`)
    return null
  }
  const id = str(raw.id).trim()
  if (id === '') {
    warn.push(`物品「${name}」缺少 id，已跳过`)
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
    attrs: normalizeAttrs(raw.attrs),
    note: str(raw.note),
    createdAt: isoDate(raw.createdAt, now),
    updatedAt: isoDate(raw.updatedAt, now),
    idleAt: typeof raw.idleAt === 'string' ? isoDate(raw.idleAt, now) : null,
    discardedAt: typeof raw.discardedAt === 'string' ? isoDate(raw.discardedAt, now) : null,
  }
}

function normalizeLocation(raw: unknown, now: string, warn: string[]): Location | null {
  if (!isRecord(raw)) return null
  const id = str(raw.id).trim()
  const name = str(raw.name).trim()
  if (id === '' || name === '') {
    warn.push('发现一条缺少 id 或名称的位置，已跳过')
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
    warn.push('发现一条缺少 id 或名称的分类，已跳过')
    return null
  }
  return { id, name, order: num(raw.order, 0), createdAt: isoDate(raw.createdAt, now) }
}

function normalizeAttributeDef(raw: unknown, now: string, warn: string[]): AttributeDef | null {
  if (!isRecord(raw)) return null
  const id = str(raw.id).trim()
  const name = str(raw.name).trim()
  if (id === '' || name === '') {
    warn.push('发现一条缺少 id 或名称的属性，已跳过')
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
  if (trimmed === '') return { ok: false, error: '文件是空的。' }

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return {
      ok: false,
      error: '文件内容不是合法的 JSON，可能已损坏或不是导出文件。',
    }
  }

  if (!isRecord(parsed)) {
    return { ok: false, error: '文件结构不正确：顶层应该是一个对象。' }
  }

  const format = str(parsed.format)
  if (format !== APP_ID) {
    return {
      ok: false,
      error: `这不是「断舍离」的备份文件（缺少 format: "${APP_ID}" 标记）。`,
    }
  }

  const schemaVersion = num(parsed.schemaVersion, 0)
  if (schemaVersion <= 0) {
    return { ok: false, error: '备份文件缺少有效的 schemaVersion 字段。' }
  }
  if (schemaVersion > SCHEMA_VERSION) {
    return {
      ok: false,
      error:
        `这份备份来自更新版本（数据结构 v${schemaVersion}），` +
        `当前程序只支持到 v${SCHEMA_VERSION}。请先升级程序再导入。`,
    }
  }

  const dataRaw = parsed.data
  if (!isRecord(dataRaw)) {
    return { ok: false, error: '备份文件里没有 data 字段，或 data 不是对象。' }
  }

  const now = new Date().toISOString()
  const warnings: string[] = []

  const rawItems = Array.isArray(dataRaw.items) ? dataRaw.items : []
  const rawLocations = Array.isArray(dataRaw.locations) ? dataRaw.locations : []
  const rawCategories = Array.isArray(dataRaw.categories) ? dataRaw.categories : []
  const rawAttrDefs = Array.isArray(dataRaw.attributeDefs) ? dataRaw.attributeDefs : []
  const rawTags = Array.isArray(dataRaw.tags) ? dataRaw.tags : []

  if (
    !Array.isArray(dataRaw.items) &&
    !Array.isArray(dataRaw.locations) &&
    !Array.isArray(dataRaw.categories)
  ) {
    return { ok: false, error: '备份文件里找不到 items / locations / categories 数据。' }
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

  // 去重：id 重复时保留第一条，避免出现两个「同一个位置」
  const dedupe = <T extends { id: string }>(list: T[], label: string): T[] => {
    const seen = new Set<string>()
    const out: T[] = []
    for (const entry of list) {
      if (seen.has(entry.id)) {
        warnings.push(`发现重复的${label} id，已忽略后出现的那条`)
        continue
      }
      seen.add(entry.id)
      out.push(entry)
    }
    return out
  }

  const dedupedItems = dedupe(items, '物品')
  const dedupedLocations = dedupe(locations, '位置')
  const dedupedCategories = dedupe(categories, '分类')
  const dedupedAttrDefs = dedupe(attributeDefs, '属性')

  // 悬空引用修复：物品指向了不存在的位置/分类/属性
  const locIds = new Set(dedupedLocations.map((l) => l.id))
  const catIds = new Set(dedupedCategories.map((c) => c.id))
  const attrIds = new Set(dedupedAttrDefs.map((a) => a.id))

  let danglingLocations = 0
  let danglingCategories = 0
  for (const item of dedupedItems) {
    if (item.locationId && !locIds.has(item.locationId)) {
      item.locationId = null
      danglingLocations++
    }
    const before = item.categoryIds.length
    item.categoryIds = item.categoryIds.filter((id) => catIds.has(id))
    danglingCategories += before - item.categoryIds.length
    item.attrs = Object.fromEntries(
      Object.entries(item.attrs).filter(([key]) => attrIds.has(key)),
    )
  }
  if (danglingLocations > 0) {
    warnings.push(`${danglingLocations} 件物品指向了不存在的位置，已改为「未归位」`)
  }
  if (danglingCategories > 0) {
    warnings.push(`${danglingCategories} 处分类引用已失效，已移除`)
  }

  // 位置父子引用修复
  const parentFixed = dedupedLocations.filter(
    (l) => l.parentId !== null && !locIds.has(l.parentId),
  )
  for (const loc of parentFixed) {
    loc.parentId = null
    warnings.push(`位置「${loc.name}」的上级位置不存在，已提升为顶层`)
  }

  const data: AppData = {
    schemaVersion: SCHEMA_VERSION,
    items: dedupedItems,
    categories: dedupedCategories,
    locations: dedupedLocations,
    attributeDefs: dedupedAttrDefs,
    tags,
    updatedAt: now,
  }

  return {
    ok: true,
    data,
    exportedAt: typeof parsed.exportedAt === 'string' ? parsed.exportedAt : null,
    warnings,
  }
}
