import type { AppData, ImportReport, Item, Location } from '../types'
import { SCHEMA_VERSION } from '../types'
import { uid } from '../lib/id'

function uniq(values: string[]): string[] {
  return [...new Set(values)]
}

/**
 * 拆掉父子链里的环，并把指向不存在父节点的引用清空。
 * 导入的文件可能被手工改过，这里必须先保证父子关系是良构的，
 * 否则后面按「名称路径」匹配位置会陷入死循环。
 */
function normalizeParentChain(locations: Location[]): void {
  const byId = new Map(locations.map((l) => [l.id, l]))
  for (const loc of locations) {
    if (loc.parentId && !byId.has(loc.parentId)) {
      loc.parentId = null
      continue
    }
    const seen = new Set<string>([loc.id])
    let cur = loc.parentId ? byId.get(loc.parentId) : undefined
    while (cur) {
      if (seen.has(cur.id)) {
        loc.parentId = null
        break
      }
      seen.add(cur.id)
      cur = cur.parentId ? byId.get(cur.parentId) : undefined
    }
  }
}

function depthIn(byId: Map<string, Location>, loc: Location): number {
  let depth = 0
  const seen = new Set<string>([loc.id])
  let cur = loc
  while (cur.parentId) {
    const parent = byId.get(cur.parentId)
    if (!parent || seen.has(parent.id)) break
    seen.add(parent.id)
    depth++
    cur = parent
  }
  return depth
}

/** 「家/卧室/衣柜」这样的名称路径 —— 用于跨设备合并时对齐同一个位置 */
function pathKey(byId: Map<string, Location>, loc: Location): string {
  const names: string[] = [loc.name]
  const seen = new Set<string>([loc.id])
  let cur = loc
  while (cur.parentId) {
    const parent = byId.get(cur.parentId)
    if (!parent || seen.has(parent.id)) break
    seen.add(parent.id)
    names.unshift(parent.name)
    cur = parent
  }
  return names.join('/')
}

/** 覆盖：当前数据整体替换为导入数据 */
export function replaceWith(incoming: AppData): AppData {
  return { ...incoming, updatedAt: new Date().toISOString() }
}

export interface MergeResult {
  data: AppData
  report: ImportReport
}

/**
 * 合并：两边数据求并集。
 *
 * 核心难点是「悬空引用」——导入的物品可能指向本地不存在的
 * 位置 / 分类 / 属性。这里的策略是：
 *   1. 先按 id 匹配；
 *   2. 匹配不到就按**名称路径**匹配（位置）或名称匹配（分类、属性）；
 *   3. 仍然匹配不到 → 位置会**自动补建**（丢掉位置归属代价太大），
 *      分类和属性也会补建，并在报告里逐条列出，让人能核对。
 */
export function mergeAppData(current: AppData, incoming: AppData): MergeResult {
  const warnings: string[] = []
  const now = new Date().toISOString()

  /* ---------------- 位置 ---------------- */
  const incomingLocations = incoming.locations.map((l) => ({ ...l }))
  normalizeParentChain(incomingLocations)
  const incomingLocById = new Map(incomingLocations.map((l) => [l.id, l]))
  incomingLocations.sort((a, b) => depthIn(incomingLocById, a) - depthIn(incomingLocById, b))

  const locById = new Map(current.locations.map((l) => [l.id, l]))
  const locIdByPath = new Map<string, string>()
  for (const loc of current.locations) locIdByPath.set(pathKey(locById, loc), loc.id)

  const locations: Location[] = current.locations.map((l) => ({ ...l }))
  const locIdMap = new Map<string, string>()
  let locAdded = 0
  let locMatched = 0
  let locCreated = 0

  for (const loc of incomingLocations) {
    const existing = locById.get(loc.id)
    if (existing) {
      locIdMap.set(loc.id, existing.id)
      locMatched++
      continue
    }

    const key = pathKey(incomingLocById, loc)
    const byPath = locIdByPath.get(key)
    if (byPath) {
      locIdMap.set(loc.id, byPath)
      continue
    }

    // 本地确实没有 → 补建，保持导入方的层级关系
    const newParentId = loc.parentId ? (locIdMap.get(loc.parentId) ?? null) : null
    const created: Location = { ...loc, id: uid(), parentId: newParentId }
    locations.push(created)
    locById.set(created.id, created)
    locIdByPath.set(key, created.id)
    locIdMap.set(loc.id, created.id)
    locAdded++
    locCreated++
    warnings.push(`自动补建位置：${key.split('/').join(' / ')}`)
  }

  /* ---------------- 分类 ---------------- */
  const catById = new Map(current.categories.map((c) => [c.id, c]))
  const catIdByName = new Map(current.categories.map((c) => [c.name, c.id]))
  const categories = current.categories.map((c) => ({ ...c }))
  const catIdMap = new Map<string, string>()
  let catAdded = 0
  let catMatched = 0

  for (const cat of incoming.categories) {
    if (catById.has(cat.id)) {
      catIdMap.set(cat.id, cat.id)
      catMatched++
      continue
    }
    const byName = catIdByName.get(cat.name)
    if (byName) {
      catIdMap.set(cat.id, byName)
      continue
    }
    const created = { ...cat, id: uid(), order: categories.length }
    categories.push(created)
    catById.set(created.id, created)
    catIdByName.set(created.name, created.id)
    catIdMap.set(cat.id, created.id)
    catAdded++
    warnings.push(`自动补建分类：${cat.name}`)
  }

  /* ---------------- 属性 ---------------- */
  const attrById = new Map(current.attributeDefs.map((a) => [a.id, a]))
  const attrIdByName = new Map(current.attributeDefs.map((a) => [a.name, a.id]))
  const attributeDefs = current.attributeDefs.map((a) => ({ ...a }))
  const attrIdMap = new Map<string, string>()
  let attrAdded = 0
  let attrMatched = 0

  for (const def of incoming.attributeDefs) {
    if (attrById.has(def.id)) {
      attrIdMap.set(def.id, def.id)
      attrMatched++
      continue
    }
    const byName = attrIdByName.get(def.name)
    if (byName) {
      attrIdMap.set(def.id, byName)
      continue
    }
    const created = { ...def, id: uid(), order: attributeDefs.length }
    attributeDefs.push(created)
    attrById.set(created.id, created)
    attrIdByName.set(created.name, created.id)
    attrIdMap.set(def.id, created.id)
    attrAdded++
    warnings.push(`自动补建属性：${def.name}`)
  }

  /* ---------------- 物品 ---------------- */
  const items: Item[] = current.items.map((i) => ({ ...i }))
  const itemById = new Map(items.map((i) => [i.id, i]))
  let added = 0
  let updated = 0
  let unchanged = 0
  let lostLocations = 0

  for (const raw of incoming.items) {
    const mappedLocationId = raw.locationId
      ? (locIdMap.get(raw.locationId) ?? (locById.has(raw.locationId) ? raw.locationId : null))
      : null
    if (raw.locationId && !mappedLocationId) lostLocations++

    const mappedCategoryIds = uniq(
      raw.categoryIds
        .map((id) => catIdMap.get(id) ?? (catById.has(id) ? id : null))
        .filter((id): id is string => id !== null),
    )

    const mappedAttrs: Item['attrs'] = {}
    for (const [key, value] of Object.entries(raw.attrs)) {
      const target = attrIdMap.get(key) ?? (attrById.has(key) ? key : null)
      if (target) mappedAttrs[target] = value
    }

    const mapped: Item = {
      ...raw,
      locationId: mappedLocationId,
      categoryIds: mappedCategoryIds,
      attrs: mappedAttrs,
      tags: uniq(raw.tags),
    }

    const existing = itemById.get(mapped.id)
    if (!existing) {
      items.push(mapped)
      itemById.set(mapped.id, mapped)
      added++
      continue
    }

    // id 冲突：保留 updatedAt 较新的那条
    if (mapped.updatedAt > existing.updatedAt) {
      const index = items.indexOf(existing)
      items[index] = mapped
      itemById.set(mapped.id, mapped)
      updated++
    } else {
      unchanged++
    }
  }

  if (lostLocations > 0) {
    warnings.push(`${lostLocations} 件物品的位置引用无法解析，已改为「未归位」`)
  }

  /* ---------------- 标签 ---------------- */
  const tags = current.tags.map((t) => ({ ...t }))
  const tagNames = new Set(tags.map((t) => t.name))
  let tagAdded = 0

  const addTag = (name: string) => {
    if (tagNames.has(name)) return
    tagNames.add(name)
    tags.push({ name, createdAt: now })
    tagAdded++
  }

  for (const tag of incoming.tags) addTag(tag.name)
  // 兜底：物品上用到的标签也必须存在于标签表里，否则标签管理页会漏掉
  for (const item of items) for (const tag of item.tags) addTag(tag)

  const data: AppData = {
    schemaVersion: SCHEMA_VERSION,
    items,
    categories,
    locations,
    attributeDefs,
    tags,
    updatedAt: now,
  }

  const report: ImportReport = {
    strategy: 'merge',
    items: { added, updated, unchanged },
    categories: { added: catAdded, updated: catMatched },
    locations: { added: locAdded, updated: locMatched, created: locCreated },
    attributeDefs: { added: attrAdded, updated: attrMatched },
    tags: { added: tagAdded },
    warnings,
  }

  return { data, report }
}
