import { create } from 'zustand'
import type {
  AppData,
  AttributeDef,
  AttrType,
  AttrValue,
  Category,
  ImportReport,
  Item,
  ItemStatus,
  Location,
  SnapshotReason,
  UiPrefs,
} from '../types'
import { DEFAULT_UI_PREFS, SCHEMA_VERSION } from '../types'
import { mergeAppData } from '../data/importData'
import { uid } from '../lib/id'
import { canReparent } from '../lib/tree'
import { getRepository } from '../storage/repository'
import { createEmptyData, createSeedData } from '../storage/seed'
import { createSnapshot, getSnapshot } from '../storage/snapshots'
import type { DerivedContext } from './selectors'
import { createDerived } from './selectors'

/* ------------------------------------------------------------------ */
/* 写入串行化                                                          */
/* ------------------------------------------------------------------ */

/**
 * 所有落盘操作排成一条链，保证「先存的先写完」。
 * 没有这道闸，快速连续录入时两次异步写入可能乱序，把数据写坏。
 */
let writeChain: Promise<void> = Promise.resolve()

function enqueueWrite(task: () => Promise<void>): Promise<void> {
  writeChain = writeChain.then(task, task)
  return writeChain
}

/* ------------------------------------------------------------------ */
/* 界面偏好（存 localStorage —— 丢了完全不影响数据）                     */
/* ------------------------------------------------------------------ */

const UI_KEY = 'duansheli:ui'

function loadUiPrefs(): UiPrefs {
  try {
    const raw = localStorage.getItem(UI_KEY)
    if (!raw) return { ...DEFAULT_UI_PREFS }
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { ...DEFAULT_UI_PREFS }
    }
    return { ...DEFAULT_UI_PREFS, ...(parsed as Partial<UiPrefs>) }
  } catch {
    return { ...DEFAULT_UI_PREFS }
  }
}

function persistUiPrefs(prefs: UiPrefs): void {
  try {
    localStorage.setItem(UI_KEY, JSON.stringify(prefs))
  } catch {
    // 无痕模式下 localStorage 可能被禁用；界面偏好丢失无关紧要
  }
}

/* ------------------------------------------------------------------ */
/* 小工具                                                              */
/* ------------------------------------------------------------------ */

function uniq(values: string[]): string[] {
  return [...new Set(values)]
}

/** 丢弃空值，保证导出的数据干净 */
function cleanAttrs(attrs: Record<string, AttrValue> | undefined): Record<string, AttrValue> {
  const out: Record<string, AttrValue> = {}
  if (!attrs) return out
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === '') continue
    out[key] = value
  }
  return out
}

/** 把用到的标签登记进标签表，否则标签管理页会漏掉它们 */
function ensureTags(existing: AppData['tags'], used: string[], now: string): AppData['tags'] {
  const names = new Set(existing.map((t) => t.name))
  const missing = used.filter((name) => !names.has(name))
  if (missing.length === 0) return existing
  return [...existing, ...missing.map((name) => ({ name, createdAt: now }))]
}

/** 补齐从旧版本读到的数据里可能缺失的字段 */
function normalizeShape(data: AppData): AppData {
  return {
    schemaVersion: data.schemaVersion ?? SCHEMA_VERSION,
    items: Array.isArray(data.items) ? data.items : [],
    categories: Array.isArray(data.categories) ? data.categories : [],
    locations: Array.isArray(data.locations) ? data.locations : [],
    attributeDefs: Array.isArray(data.attributeDefs) ? data.attributeDefs : [],
    tags: Array.isArray(data.tags) ? data.tags : [],
    updatedAt: data.updatedAt ?? new Date().toISOString(),
  }
}

function orderAmongSiblings(locations: Location[], parentId: string | null): number {
  let max = -1
  for (const loc of locations) {
    if ((loc.parentId ?? null) === parentId) max = Math.max(max, loc.order)
  }
  return max + 1
}

/* ------------------------------------------------------------------ */
/* 对外类型                                                            */
/* ------------------------------------------------------------------ */

export interface ItemInput {
  name: string
  categoryIds?: string[]
  locationId?: string | null
  quantity?: number
  status?: ItemStatus
  tags?: string[]
  attrs?: Record<string, AttrValue>
  note?: string
}

/* ------------------------------------------------------------------ */
/* 按「名称」批量写入（AI 录入用）                                      */
/* ------------------------------------------------------------------ */

/**
 * 批量录入计划。
 * 用分类名和位置名称路径而不是 id —— 因为不存在的分类和位置需要在写入时创建出来。
 */
export interface BulkAddItem {
  name: string
  quantity: number
  categoryNames: string[]
  /** 从顶层到末级的名称路径；null = 未归位 */
  locationPath: string[] | null
  tags: string[]
  /** 属性名 → 值 */
  attrs: Record<string, string>
  note: string
}

export interface BulkUpdateItem {
  id: string
  categoryNames: string[]
  locationPath: string[] | null
}

export interface BulkWriteResult {
  items: number
  createdCategories: number
  createdLocations: number
}

/**
 * 名称解析器：把「分类名 / 位置名称路径」解析成 id，不存在就顺手创建。
 *
 * 抽成独立函数是为了让「创建分类」和「创建位置」在一批写入里只发生一次 ——
 * 否则 200 件物品引用同一个新分类，会造出 200 个重名分类。
 */
function createNameResolvers(data: AppData, now: string) {
  const categories: Category[] = data.categories.map((c) => ({ ...c }))
  const locations: Location[] = data.locations.map((l) => ({ ...l }))

  const categoryIdCache = new Map<string, string>()
  const locationIdCache = new Map<string, string | null>()
  let createdCategories = 0
  let createdLocations = 0

  const resolveCategory = (raw: string): string | null => {
    const name = raw.trim()
    if (name === '') return null
    const cached = categoryIdCache.get(name)
    if (cached !== undefined) return cached

    let found = categories.find((c) => c.name === name)
    if (!found) {
      found = { id: uid(), name, order: categories.length, createdAt: now }
      categories.push(found)
      createdCategories++
    }
    categoryIdCache.set(name, found.id)
    return found.id
  }

  const resolveCategories = (names: string[]): string[] => {
    const ids: string[] = []
    for (const name of names) {
      const id = resolveCategory(name)
      if (id && !ids.includes(id)) ids.push(id)
    }
    return ids
  }

  /** 逐层往下走，缺哪层建哪层 */
  const resolveLocation = (path: string[] | null): string | null => {
    if (!path || path.length === 0) return null
    const key = path.join('/')
    const cached = locationIdCache.get(key)
    if (cached !== undefined) return cached

    let parentId: string | null = null
    for (const raw of path) {
      const name = raw.trim()
      if (name === '') continue
      let found = locations.find((l) => (l.parentId ?? null) === parentId && l.name === name)
      if (!found) {
        found = {
          id: uid(),
          name,
          parentId,
          note: '',
          order: orderAmongSiblings(locations, parentId),
          createdAt: now,
        }
        locations.push(found)
        createdLocations++
      }
      parentId = found.id
    }
    locationIdCache.set(key, parentId)
    return parentId
  }

  return {
    categories,
    locations,
    resolveCategory,
    resolveCategories,
    resolveLocation,
    stats: (): { createdCategories: number; createdLocations: number } => ({
      createdCategories,
      createdLocations,
    }),
  }
}

export interface AttributeDefInput {
  name: string
  type: AttrType
  options?: string[]
  unit?: string
  showByDefault?: boolean
}

export interface Toast {
  id: string
  message: string
  tone: 'info' | 'success' | 'error'
}

export interface DeleteLocationResult {
  ok: boolean
  reason?: string
  childCount: number
  itemCount: number
}

export interface AppState {
  status: 'loading' | 'ready' | 'error'
  error: string | null
  data: AppData
  derived: DerivedContext
  ui: UiPrefs
  toasts: Toast[]

  init: () => Promise<void>
  notify: (message: string, tone?: Toast['tone']) => void
  dismissToast: (id: string) => void

  /* ---------------- AI ---------------- */

  /**
   * DeepSeek API Key。
   * **只存在内存里** —— 不写 localStorage、不写 IndexedDB、不进导出文件，
   * 刷新页面就没了。这是刻意的取舍：纯前端存 Key 有固有风险，见 README。
   */
  aiApiKey: string
  setAiApiKey: (key: string) => void

  /* ---------------- 按名称批量写入 ---------------- */

  /** 批量录入：分类 / 位置不存在时自动创建 */
  bulkAddItems: (items: BulkAddItem[]) => BulkWriteResult
  /** 批量更新已有物品的分类与位置 */
  bulkUpdateItems: (updates: BulkUpdateItem[]) => BulkWriteResult

  setUi: (patch: Partial<UiPrefs>) => void
  toggleGroupCollapsed: (key: string) => void
  rememberAttrSelection: (categoryIds: string[], attrIds: string[]) => void

  /* 物品 */
  addItem: (input: ItemInput) => Item | null
  updateItem: (id: string, patch: Partial<ItemInput>) => void
  setIdle: (id: string, idle: boolean) => void
  markDiscarded: (id: string) => void
  restoreItem: (id: string) => void
  purgeItem: (id: string) => void
  batchSetStatus: (ids: string[], status: ItemStatus) => void
  batchMoveToLocation: (ids: string[], locationId: string | null) => void
  batchAddTag: (ids: string[], tag: string) => void
  purgeAllDiscarded: () => void

  /* 位置 */
  addLocation: (name: string, parentId: string | null) => Location | null
  renameLocation: (id: string, name: string) => void
  updateLocationNote: (id: string, note: string) => void
  moveLocation: (id: string, newParentId: string | null) => { ok: boolean; reason?: string }
  deleteLocation: (id: string, reassignTo?: string | null) => DeleteLocationResult

  /* 分类 */
  addCategory: (name: string) => Category | null
  renameCategory: (id: string, name: string) => void
  deleteCategory: (id: string) => number

  /* 属性库 */
  addAttributeDef: (input: AttributeDefInput) => AttributeDef | null
  updateAttributeDef: (id: string, patch: Partial<AttributeDefInput>) => void
  deleteAttributeDef: (id: string) => number

  /* 标签 */
  addTag: (name: string) => void
  renameTag: (from: string, to: string) => void
  deleteTag: (name: string) => void

  /* 数据整体操作 */
  replaceAll: (next: AppData, reason: SnapshotReason, message?: string) => Promise<void>
  mergeAll: (incoming: AppData) => Promise<ImportReport>
  resetToSeed: () => Promise<void>
  clearEverything: () => Promise<void>
  backupNow: () => Promise<void>
  restoreFromSnapshot: (snapshotId: string) => Promise<boolean>
}

/* ------------------------------------------------------------------ */
/* store                                                               */
/* ------------------------------------------------------------------ */

const initialData = createEmptyData()

export const useAppStore = create<AppState>()((set, get) => {
  /**
   * 提交一次数据变更。
   * 先同步更新界面（保证手感跟手），再把「快照 + 落盘」排进写入队列。
   */
  const commit = (next: AppData, reason: SnapshotReason | null = 'auto') => {
    const previous = get().data
    const stamped: AppData = { ...next, updatedAt: new Date().toISOString() }
    set({ data: stamped, derived: createDerived(stamped) })

    void enqueueWrite(async () => {
      try {
        if (reason) await createSnapshot(previous, reason)
        await getRepository().save(stamped)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        set({ error: message })
        get().notify(`保存到本地失败：${message}`, 'error')
      }
    })
  }

  const replaceItems = (items: Item[], reason: SnapshotReason | null = 'auto') => {
    const data = get().data
    const now = new Date().toISOString()
    const usedTags = items.flatMap((i) => i.tags)
    commit({ ...data, items, tags: ensureTags(data.tags, usedTags, now) }, reason)
  }

  return {
    status: 'loading',
    error: null,
    data: initialData,
    derived: createDerived(initialData),
    ui: { ...DEFAULT_UI_PREFS },
    toasts: [],
    aiApiKey: '',

    /* ---------------- 生命周期 ---------------- */

    init: async () => {
      set({ status: 'loading', error: null, ui: loadUiPrefs() })
      try {
        const repo = getRepository()
        let data = await repo.load()
        if (!data) {
          // 首次使用：铺一套脚手架（分类 / 位置树 / 属性库 / 标签），物品为空
          data = createSeedData()
          await repo.save(data)
        }
        const normalized = normalizeShape(data)
        set({
          data: normalized,
          derived: createDerived(normalized),
          status: 'ready',
          error: null,
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        set({ status: 'error', error: message })
      }
    },

    notify: (message, tone = 'info') => {
      const id = uid()
      set((state) => ({ toasts: [...state.toasts, { id, message, tone }] }))
      setTimeout(() => get().dismissToast(id), tone === 'error' ? 7000 : 2800)
    },

    dismissToast: (id) => {
      set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }))
    },

    /* ---------------- AI（Key 只在内存里） ---------------- */

    setAiApiKey: (key) => set({ aiApiKey: key }),

    /* ---------------- 按名称批量写入 ---------------- */

    bulkAddItems: (plan) => {
      const data = get().data
      const now = new Date().toISOString()
      const resolvers = createNameResolvers(data, now)
      const items = [...data.items]
      let added = 0

      for (const entry of plan) {
        const name = entry.name.trim()
        if (name === '') continue

        const categoryIds = resolvers.resolveCategories(entry.categoryNames)
        const locationId = resolvers.resolveLocation(entry.locationPath)

        const attrs: Record<string, AttrValue> = {}
        for (const [attrName, value] of Object.entries(entry.attrs)) {
          const def = data.attributeDefs.find((d) => d.name === attrName)
          if (def && value !== '') attrs[def.id] = value
        }

        items.push({
          id: uid(),
          name,
          categoryIds,
          locationId,
          quantity: Math.max(1, Math.round(entry.quantity || 1)),
          status: 'active',
          tags: uniq((entry.tags ?? []).map((t) => t.trim()).filter(Boolean)),
          attrs,
          note: entry.note ?? '',
          createdAt: now,
          updatedAt: now,
          idleAt: null,
          discardedAt: null,
        })
        added++
      }

      const { createdCategories, createdLocations } = resolvers.stats()

      commit(
        {
          ...data,
          items,
          categories: resolvers.categories,
          locations: resolvers.locations,
          tags: ensureTags(
            data.tags,
            items.flatMap((i) => i.tags),
            now,
          ),
        },
        'auto',
      )

      return { items: added, createdCategories, createdLocations }
    },

    bulkUpdateItems: (updates) => {
      const data = get().data
      const now = new Date().toISOString()
      const resolvers = createNameResolvers(data, now)
      const byId = new Map(updates.map((update) => [update.id, update]))

      let changed = 0
      const items = data.items.map((item) => {
        const update = byId.get(item.id)
        if (!update) return item

        const categoryIds = resolvers.resolveCategories(update.categoryNames)
        const locationId = resolvers.resolveLocation(update.locationPath)
        changed++
        return { ...item, categoryIds, locationId, updatedAt: now }
      })

      if (changed === 0) {
        return { items: 0, createdCategories: 0, createdLocations: 0 }
      }

      const { createdCategories, createdLocations } = resolvers.stats()

      commit(
        {
          ...data,
          items,
          categories: resolvers.categories,
          locations: resolvers.locations,
        },
        'auto',
      )

      return { items: changed, createdCategories, createdLocations }
    },

    /* ---------------- 界面偏好 ---------------- */

    setUi: (patch) => {
      const next = { ...get().ui, ...patch }
      persistUiPrefs(next)
      set({ ui: next })
    },

    toggleGroupCollapsed: (key) => {
      const ui = get().ui
      const collapsed = ui.collapsedGroups.includes(key)
        ? ui.collapsedGroups.filter((k) => k !== key)
        : [...ui.collapsedGroups, key]
      const next = { ...ui, collapsedGroups: collapsed }
      persistUiPrefs(next)
      set({ ui: next })
    },

    rememberAttrSelection: (categoryIds, attrIds) => {
      if (categoryIds.length === 0) return
      const ui = get().ui
      const map = { ...ui.attrsByCategory }
      for (const id of categoryIds) {
        // 记下空数组也有意义：表示「这个分类不需要额外属性」
        map[id] = [...attrIds]
      }
      const next = { ...ui, attrsByCategory: map }
      persistUiPrefs(next)
      set({ ui: next })
    },

    /* ---------------- 物品 ---------------- */

    addItem: (input) => {
      const name = input.name.trim()
      if (name === '') return null

      const data = get().data
      const now = new Date().toISOString()
      const status = input.status ?? 'active'

      const item: Item = {
        id: uid(),
        name,
        categoryIds: uniq(input.categoryIds ?? []),
        locationId: input.locationId ?? null,
        quantity: Math.max(1, Math.round(input.quantity ?? 1)),
        status,
        tags: uniq((input.tags ?? []).map((t) => t.trim()).filter(Boolean)),
        attrs: cleanAttrs(input.attrs),
        note: input.note ?? '',
        createdAt: now,
        updatedAt: now,
        idleAt: status === 'idle' ? now : null,
        discardedAt: status === 'discarded' ? now : null,
      }

      commit(
        {
          ...data,
          items: [...data.items, item],
          tags: ensureTags(data.tags, item.tags, now),
        },
        'auto',
      )
      return item
    },

    updateItem: (id, patch) => {
      const data = get().data
      const index = data.items.findIndex((i) => i.id === id)
      if (index < 0) return

      const prev = data.items[index]
      const now = new Date().toISOString()

      const nextItem: Item = {
        ...prev,
        name: patch.name !== undefined ? patch.name.trim() || prev.name : prev.name,
        categoryIds: patch.categoryIds !== undefined ? uniq(patch.categoryIds) : prev.categoryIds,
        locationId: patch.locationId !== undefined ? patch.locationId : prev.locationId,
        quantity:
          patch.quantity !== undefined
            ? Math.max(1, Math.round(patch.quantity))
            : prev.quantity,
        tags:
          patch.tags !== undefined
            ? uniq(patch.tags.map((t) => t.trim()).filter(Boolean))
            : prev.tags,
        attrs: patch.attrs !== undefined ? cleanAttrs(patch.attrs) : prev.attrs,
        note: patch.note !== undefined ? patch.note : prev.note,
        updatedAt: now,
      }

      if (patch.status !== undefined && patch.status !== prev.status) {
        nextItem.status = patch.status
        nextItem.idleAt = patch.status === 'idle' ? (prev.idleAt ?? now) : null
        nextItem.discardedAt = patch.status === 'discarded' ? (prev.discardedAt ?? now) : null
      }

      const items = [...data.items]
      items[index] = nextItem
      commit({ ...data, items, tags: ensureTags(data.tags, nextItem.tags, now) }, 'auto')
    },

    setIdle: (id, idle) => {
      get().updateItem(id, { status: idle ? 'idle' : 'active' })
    },

    markDiscarded: (id) => {
      get().updateItem(id, { status: 'discarded' })
    },

    restoreItem: (id) => {
      get().updateItem(id, { status: 'active' })
    },

    purgeItem: (id) => {
      const data = get().data
      replaceItems(
        data.items.filter((i) => i.id !== id),
        'destructive',
      )
    },

    batchSetStatus: (ids, status) => {
      const idSet = new Set(ids)
      if (idSet.size === 0) return
      const data = get().data
      const now = new Date().toISOString()

      const items = data.items.map((item) => {
        if (!idSet.has(item.id) || item.status === status) return item
        return {
          ...item,
          status,
          idleAt: status === 'idle' ? (item.idleAt ?? now) : null,
          discardedAt: status === 'discarded' ? (item.discardedAt ?? now) : null,
          updatedAt: now,
        }
      })
      replaceItems(items, 'auto')
    },

    batchMoveToLocation: (ids, locationId) => {
      const idSet = new Set(ids)
      if (idSet.size === 0) return
      const data = get().data
      const now = new Date().toISOString()
      const items = data.items.map((item) =>
        idSet.has(item.id) ? { ...item, locationId, updatedAt: now } : item,
      )
      replaceItems(items, 'auto')
    },

    batchAddTag: (ids, tag) => {
      const name = tag.trim()
      if (name === '') return
      const idSet = new Set(ids)
      if (idSet.size === 0) return
      const data = get().data
      const now = new Date().toISOString()
      const items = data.items.map((item) =>
        idSet.has(item.id) && !item.tags.includes(name)
          ? { ...item, tags: [...item.tags, name], updatedAt: now }
          : item,
      )
      replaceItems(items, 'auto')
    },

    purgeAllDiscarded: () => {
      const data = get().data
      replaceItems(
        data.items.filter((i) => i.status !== 'discarded'),
        'destructive',
      )
    },

    /* ---------------- 位置 ---------------- */

    addLocation: (name, parentId) => {
      const trimmed = name.trim()
      if (trimmed === '') return null
      if (parentId !== null && !get().derived.index.has(parentId)) return null

      const data = get().data
      const location: Location = {
        id: uid(),
        name: trimmed,
        parentId,
        note: '',
        order: orderAmongSiblings(data.locations, parentId),
        createdAt: new Date().toISOString(),
      }
      commit({ ...data, locations: [...data.locations, location], updatedAt: data.updatedAt })
      return location
    },

    renameLocation: (id, name) => {
      const trimmed = name.trim()
      if (trimmed === '') return
      const data = get().data
      commit({
        ...data,
        locations: data.locations.map((l) => (l.id === id ? { ...l, name: trimmed } : l)),
      })
    },

    updateLocationNote: (id, note) => {
      const data = get().data
      commit({
        ...data,
        locations: data.locations.map((l) => (l.id === id ? { ...l, note } : l)),
      })
    },

    moveLocation: (id, newParentId) => {
      const ctx = get().derived
      const check = canReparent(ctx.index, id, newParentId)
      if (!check.ok) return check

      const data = get().data
      const locations = data.locations.map((l) =>
        l.id === id
          ? { ...l, parentId: newParentId, order: orderAmongSiblings(data.locations, newParentId) }
          : l,
      )
      commit({ ...data, locations })
      return { ok: true }
    },

    deleteLocation: (id, reassignTo) => {
      const data = get().data
      const ctx = get().derived

      const node = ctx.index.byId.get(id)
      if (!node) return { ok: false, reason: '位置不存在', childCount: 0, itemCount: 0 }

      const childCount = data.locations.filter((l) => l.parentId === id).length
      const scope = ctx.index.descendantIds(id)
      const affectedItems = data.items.filter(
        (i) => i.locationId !== null && scope.has(i.locationId),
      )

      // 有内容又没指定去处 → 拒绝删除，把情况报给界面去提示
      if ((childCount > 0 || affectedItems.length > 0) && reassignTo === undefined) {
        return {
          ok: false,
          reason:
            childCount > 0 && affectedItems.length > 0
              ? `该位置下有 ${childCount} 个子位置和 ${affectedItems.length} 件物品`
              : childCount > 0
                ? `该位置下有 ${childCount} 个子位置`
                : `该位置下有 ${affectedItems.length} 件物品`,
          childCount,
          itemCount: affectedItems.length,
        }
      }

      // 指定了去处 → 把物品和直接子节点都挪过去，再删除
      if (reassignTo !== undefined) {
        if (reassignTo !== null && !ctx.index.has(reassignTo)) {
          return { ok: false, reason: '目标位置不存在', childCount, itemCount: 0 }
        }
        if (reassignTo !== null && (reassignTo === id || scope.has(reassignTo))) {
          return {
            ok: false,
            reason: '不能把内容移动到正在删除的这个位置下面',
            childCount,
            itemCount: 0,
          }
        }
      }

      const now = new Date().toISOString()
      const items =
        reassignTo === undefined
          ? data.items
          : data.items.map((item) =>
              item.locationId !== null && scope.has(item.locationId)
                ? { ...item, locationId: reassignTo, updatedAt: now }
                : item,
            )

      const locations =
        reassignTo === undefined
          ? data.locations.filter((l) => l.id !== id)
          : data.locations
              .filter((l) => l.id !== id)
              .map((l) =>
                l.parentId === id
                  ? { ...l, parentId: reassignTo, order: orderAmongSiblings(data.locations, reassignTo) }
                  : l,
              )

      // 删除位置会连带影响物品归属，属于结构性破坏操作 → 落一份 destructive 快照
      commit({ ...data, locations, items }, 'destructive')
      return { ok: true, childCount, itemCount: affectedItems.length }
    },

    /* ---------------- 分类 ---------------- */

    addCategory: (name) => {
      const trimmed = name.trim()
      if (trimmed === '') return null
      const data = get().data
      if (data.categories.some((c) => c.name === trimmed)) return null

      const category: Category = {
        id: uid(),
        name: trimmed,
        order: data.categories.length,
        createdAt: new Date().toISOString(),
      }
      commit({ ...data, categories: [...data.categories, category] })
      return category
    },

    renameCategory: (id, name) => {
      const trimmed = name.trim()
      if (trimmed === '') return
      const data = get().data
      if (data.categories.some((c) => c.name === trimmed && c.id !== id)) return
      commit({
        ...data,
        categories: data.categories.map((c) => (c.id === id ? { ...c, name: trimmed } : c)),
      })
    },

    deleteCategory: (id) => {
      const data = get().data
      const affected = data.items.filter((i) => i.categoryIds.includes(id)).length
      const now = new Date().toISOString()
      commit(
        {
          ...data,
          categories: data.categories.filter((c) => c.id !== id),
          items: data.items.map((item) =>
            item.categoryIds.includes(id)
              ? { ...item, categoryIds: item.categoryIds.filter((c) => c !== id), updatedAt: now }
              : item,
          ),
        },
        'destructive',
      )
      return affected
    },

    /* ---------------- 属性库 ---------------- */

    addAttributeDef: (input) => {
      const trimmed = input.name.trim()
      if (trimmed === '') return null
      const data = get().data
      if (data.attributeDefs.some((d) => d.name === trimmed)) return null

      const def: AttributeDef = {
        id: uid(),
        name: trimmed,
        type: input.type,
        options: input.type === 'select' ? uniq(input.options ?? []) : [],
        unit: input.type === 'number' ? (input.unit ?? '') : '',
        showByDefault: input.showByDefault ?? false,
        order: data.attributeDefs.length,
        createdAt: new Date().toISOString(),
      }
      commit({ ...data, attributeDefs: [...data.attributeDefs, def] })
      return def
    },

    updateAttributeDef: (id, patch) => {
      const data = get().data
      commit({
        ...data,
        attributeDefs: data.attributeDefs.map((def) => {
          if (def.id !== id) return def
          const type = patch.type ?? def.type
          return {
            ...def,
            name: patch.name !== undefined ? patch.name.trim() || def.name : def.name,
            type,
            options:
              patch.options !== undefined
                ? uniq(patch.options)
                : type === 'select'
                  ? def.options
                  : [],
            unit: patch.unit !== undefined ? patch.unit : def.unit,
            showByDefault: patch.showByDefault ?? def.showByDefault,
          }
        }),
      })
    },

    deleteAttributeDef: (id) => {
      const data = get().data
      const affected = data.items.filter((i) => i.attrs[id] !== undefined && i.attrs[id] !== null)
        .length
      const now = new Date().toISOString()
      commit(
        {
          ...data,
          attributeDefs: data.attributeDefs.filter((d) => d.id !== id),
          items: data.items.map((item) => {
            if (item.attrs[id] === undefined) return item
            const attrs = { ...item.attrs }
            delete attrs[id]
            return { ...item, attrs, updatedAt: now }
          }),
        },
        'destructive',
      )
      return affected
    },

    /* ---------------- 标签 ---------------- */

    addTag: (name) => {
      const trimmed = name.trim()
      if (trimmed === '') return
      const data = get().data
      if (data.tags.some((t) => t.name === trimmed)) return
      commit({ ...data, tags: [...data.tags, { name: trimmed, createdAt: new Date().toISOString() }] })
    },

    renameTag: (from, to) => {
      const trimmed = to.trim()
      if (trimmed === '' || from === trimmed) return
      const data = get().data
      const now = new Date().toISOString()

      const tags = data.tags.some((t) => t.name === trimmed)
        ? data.tags.filter((t) => t.name !== from)
        : data.tags.map((t) =>
            t.name === from ? { ...t, name: trimmed } : t,
          )

      const items = data.items.map((item) => {
        if (!item.tags.includes(from)) return item
        return {
          ...item,
          tags: uniq(item.tags.map((t) => (t === from ? trimmed : t))),
          updatedAt: now,
        }
      })

      commit({ ...data, tags, items })
    },

    deleteTag: (name) => {
      const data = get().data
      const now = new Date().toISOString()
      commit({
        ...data,
        tags: data.tags.filter((t) => t.name !== name),
        items: data.items.map((item) =>
          item.tags.includes(name)
            ? { ...item, tags: item.tags.filter((t) => t !== name), updatedAt: now }
            : item,
        ),
      })
    },

    /* ---------------- 数据整体操作 ---------------- */

    replaceAll: async (next, reason, message) => {
      commit(normalizeShape(next), reason)
      await writeChain
      if (message) get().notify(message, 'success')
    },

    mergeAll: async (incoming) => {
      const { data: merged, report } = mergeAppData(get().data, incoming)
      commit(merged, 'import')
      await writeChain
      return report
    },

    resetToSeed: async () => {
      commit(createSeedData(), 'destructive')
      await writeChain
      get().notify('已恢复为初始的分类、位置与属性库（物品已清空）', 'success')
    },

    clearEverything: async () => {
      // 先存一份快照，再清空 —— 清空本身也可回退
      const current = get().data
      await enqueueWrite(async () => {
        try {
          await createSnapshot(current, 'destructive')
          await getRepository().clear()
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          set({ error: message })
        }
      })

      const empty = createEmptyData()
      set({ data: empty, derived: createDerived(empty) })
      await enqueueWrite(() => getRepository().save(empty))
      get().notify('所有数据已清空（可在快照中回退）', 'success')
    },

    backupNow: async () => {
      await createSnapshot(get().data, 'manual')
      get().notify('已生成一份手动备份快照', 'success')
    },

    restoreFromSnapshot: async (snapshotId) => {
      const snapshot = await getSnapshot(snapshotId)
      if (!snapshot) {
        get().notify('找不到这份快照', 'error')
        return false
      }
      // 回退之前再存一份当前状态 —— 所以「回退」这个动作本身也可以回退
      await createSnapshot(get().data, 'manual')
      const restored = normalizeShape(snapshot.data)
      set({ data: restored, derived: createDerived(restored) })
      await enqueueWrite(() => getRepository().save(restored))
      get().notify('已回退到所选快照', 'success')
      return true
    },
  }
})

/* ------------------------------------------------------------------ */
/* 便捷选择器                                                          */
/* ------------------------------------------------------------------ */

/**
 * 等待所有排队中的落盘操作完成。
 * 导出前、以及自动化测试里需要「确认真的写进磁盘了」时用得上。
 */
export function flushWrites(): Promise<void> {
  return writeChain
}

/**
 * 录入表单里建议勾选哪些属性：
 * 先看这个分类上次用过什么（记住的习惯），没有就用属性库里标了「默认显示」的。
 */
export function suggestAttrIds(
  ui: UiPrefs,
  attributeDefs: AttributeDef[],
  categoryIds: string[],
): string[] {
  const remembered = new Set<string>()
  let hasMemory = false
  for (const id of categoryIds) {
    const rememberedForCategory = ui.attrsByCategory[id]
    if (!rememberedForCategory) continue
    hasMemory = true
    for (const attrId of rememberedForCategory) remembered.add(attrId)
  }

  const valid = new Set(attributeDefs.map((d) => d.id))
  if (hasMemory) return [...remembered].filter((id) => valid.has(id))
  return attributeDefs.filter((d) => d.showByDefault).map((d) => d.id)
}
