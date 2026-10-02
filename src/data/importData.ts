import type { AppData, Category, ImportReport, Item, Location, TreeItem } from '../types'
import { SCHEMA_VERSION } from '../types'
import { uid } from '../lib/id'

function uniq(values: string[]): string[] {
  return [...new Set(values)]
}

/**
 * 拆掉父子链里的环，并把指向不存在父节点的引用清空。
 * 导入的文件可能被手工改过，这里必须先保证父子关系是良构的，
 * 否则后面按「名称路径」匹配会陷入死循环。
 *
 * 泛型化：位置和分类都是树，共用这一套。
 */
function normalizeParentChain<T extends TreeItem>(nodes: T[]): void {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  for (const node of nodes) {
    if (node.parentId && !byId.has(node.parentId)) {
      node.parentId = null
      continue
    }
    const seen = new Set<string>([node.id])
    let current = node.parentId ? byId.get(node.parentId) : undefined
    while (current) {
      if (seen.has(current.id)) {
        node.parentId = null
        break
      }
      seen.add(current.id)
      current = current.parentId ? byId.get(current.parentId) : undefined
    }
  }
}

function depthIn<T extends TreeItem>(byId: Map<string, T>, node: T): number {
  let depth = 0
  const seen = new Set<string>([node.id])
  let current = node
  while (current.parentId) {
    const parent = byId.get(current.parentId)
    if (!parent || seen.has(parent.id)) break
    seen.add(parent.id)
    depth++
    current = parent
  }
  return depth
}

/** 「化妆品/眼妆」这样的名称路径 —— 用于跨设备合并时对齐同一个节点 */
function pathKey<T extends TreeItem>(byId: Map<string, T>, node: T): string {
  const names: string[] = [node.name]
  const seen = new Set<string>([node.id])
  let current = node
  while (current.parentId) {
    const parent = byId.get(current.parentId)
    if (!parent || seen.has(parent.id)) break
    seen.add(parent.id)
    names.unshift(parent.name)
    current = parent
  }
  return names.join('/')
}

/**
 * 按「名称路径」合并一棵树（位置、分类共用）。
 *
 * 策略：先按 id 命中 → 再按完整名称路径命中 → 都不行就**补建**。
 * 补建是必要的：直接丢掉引用会让东西变成未归位/未分类，
 * 而按路径补建至少保住了用户的意图，报告里也会逐条列出来让人核对。
 */
function mergeTree<T extends TreeItem>(
  current: T[],
  incomingRaw: T[],
  make: (source: T, id: string, parentId: string | null) => T,
  label: string,
  warnings: string[],
): { merged: T[]; idMap: Map<string, string>; added: number; matched: number; created: number } {
  const incoming = incomingRaw.map((node) => ({ ...node }))
  normalizeParentChain(incoming)
  const incomingById = new Map(incoming.map((node) => [node.id, node]))
  incoming.sort((a, b) => depthIn(incomingById, a) - depthIn(incomingById, b))

  const byId = new Map(current.map((node) => [node.id, node]))
  const idByPath = new Map<string, string>()
  for (const node of current) idByPath.set(pathKey(byId, node), node.id)

  const merged: T[] = current.map((node) => ({ ...node }))
  const idMap = new Map<string, string>()
  let added = 0
  let matched = 0
  let created = 0

  for (const node of incoming) {
    const existing = byId.get(node.id)
    if (existing) {
      idMap.set(node.id, existing.id)
      matched++
      continue
    }

    const key = pathKey(incomingById, node)
    const byPath = idByPath.get(key)
    if (byPath) {
      idMap.set(node.id, byPath)
      continue
    }

    const newParentId = node.parentId ? (idMap.get(node.parentId) ?? null) : null
    const built = make(node, uid(), newParentId)
    merged.push(built)
    byId.set(built.id, built)
    idByPath.set(key, built.id)
    idMap.set(node.id, built.id)
    added++
    created++
    warnings.push(`自动补建${label}：${key.split('/').join(' / ')}`)
  }

  return { merged, idMap, added, matched, created }
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
  const locationMerge = mergeTree<Location>(
    current.locations,
    incoming.locations,
    (source, id, parentId): Location => ({
      id,
      name: source.name,
      parentId,
      note: source.note,
      order: source.order,
      createdAt: source.createdAt,
    }),
    '位置',
    warnings,
  )

  /* ---------------- 分类 ---------------- */
  const categoryMerge = mergeTree<Category>(
    current.categories,
    incoming.categories,
    (source, id, parentId): Category => ({
      id,
      name: source.name,
      parentId,
      order: source.order,
      createdAt: source.createdAt,
    }),
    '分类',
    warnings,
  )

  const locations = locationMerge.merged
  const categories = categoryMerge.merged
  const locIdMap = locationMerge.idMap
  const catIdMap = categoryMerge.idMap
  const locById = new Map(locations.map((l) => [l.id, l]))
  const catById = new Map(categories.map((c) => [c.id, c]))

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
    categories: { added: categoryMerge.added, updated: categoryMerge.matched },
    locations: {
      added: locationMerge.added,
      updated: locationMerge.matched,
      created: locationMerge.created,
    },
    attributeDefs: { added: attrAdded, updated: attrMatched },
    tags: { added: tagAdded },
    warnings,
  }

  return { data, report }
}
