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
import { canReparent, type TreeItem } from '../lib/tree'
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

/**
 * API Key 的存放位置。
 *
 * ⚠️ 这里是**唯一**会落盘保存 Key 的地方，而且是用户明确要求的行为。
 * 刻意跟界面偏好分开用一个独立的键，好处有两个：
 *   · 清 UI 偏好不会连 Key 一起清掉，反过来也一样
 *   · 想手动删的时候，在浏览器里搜 duansheli 就能找到它
 *
 * Key **绝不会**进导出的备份文件（导出只序列化 data，Key 不在里面），
 * 也绝不会进 IndexedDB。
 */
const AI_KEY_STORAGE = 'duansheli:ai-key'

function loadAiKey(): string {
  try {
    return localStorage.getItem(AI_KEY_STORAGE) ?? ''
  } catch {
    // 无痕模式下 localStorage 可能被禁用
    return ''
  }
}

function persistAiKey(key: string): void {
  try {
    if (key === '') localStorage.removeItem(AI_KEY_STORAGE)
    else localStorage.setItem(AI_KEY_STORAGE, key)
  } catch {
    // 存不下也不影响本次会话使用
  }
}

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
    // parentId 统一成 null 或字符串。老数据里可能是 undefined，
    // 而 undefined 在 JSON.stringify 时会整个键消失，导出文件就不干净了。
    items: Array.isArray(data.items) ? data.items : [],
    categories: (Array.isArray(data.categories) ? data.categories : []).map((c) => ({
      ...c,
      parentId: c.parentId ?? null,
    })),
    locations: (Array.isArray(data.locations) ? data.locations : []).map((l) => ({
      ...l,
      parentId: l.parentId ?? null,
    })),
    attributeDefs: Array.isArray(data.attributeDefs) ? data.attributeDefs : [],
    tags: Array.isArray(data.tags) ? data.tags : [],
    updatedAt: data.updatedAt ?? new Date().toISOString(),
  }
}

function orderAmongSiblings(
  nodes: Array<{ parentId: string | null; order: number }>,
  parentId: string | null,
): number {
  let max = -1
  for (const node of nodes) {
    if ((node.parentId ?? null) === parentId) max = Math.max(max, node.order)
  }
  return max + 1
}

/**
 * 把一条「名称路径」解析成节点 id，缺哪一层就建哪一层。
 *
 * 位置和分类现在都是不限层级的树，解析逻辑一模一样，
 * 所以做成泛型共用 —— 免得两处各写一遍，其中一份悄悄长出 bug。
 */
function resolvePathIn<T extends TreeItem>(
  nodes: T[],
  path: string[],
  now: string,
  make: (name: string, parentId: string | null, order: number, createdAt: string) => T,
): { id: string | null; created: number } {
  let parentId: string | null = null
  let created = 0

  for (const raw of path) {
    const name = raw.trim()
    if (name === '') continue

    let found = nodes.find((n) => (n.parentId ?? null) === parentId && n.name === name)
    if (!found) {
      found = make(name, parentId, orderAmongSiblings(nodes, parentId), now)
      nodes.push(found)
      created++
    }
    parentId = found.id
  }

  return { id: parentId, created }
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
/* AI 落库计划                                                          */
/* ------------------------------------------------------------------ */

/**
 * 落库计划的一条。
 *
 * `existingId` 有值 → **更新**那件已有物品；没有 → **新建**。
 * 用它把「对话整理」里新录入的和拉进来修改的两种条目一次写完。
 */
export interface DraftApplyItem {
  existingId?: string
  name: string
  quantity: number
  categoryPaths: string[][]
  locationPath: string[] | null
  tags: string[]
  attrs: Record<string, string>
  note: string
}

export interface ApplyDraftResult {
  added: number
  updated: number
  /** 被移入回收站的已有物品数 */
  discarded: number
  createdCategories: number
  createdLocations: number
}

export interface DeleteCategoryResult {
  ok: boolean
  reason?: string
  childCount: number
  /** 直接挂在这个分类上的物品数（不含子分类里的） */
  itemCount: number
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

  const categoryIdCache = new Map<string, string | null>()
  const locationIdCache = new Map<string, string | null>()
  let createdCategories = 0
  let createdLocations = 0

  /**
   * 按名称路径解析分类，缺哪一层建哪一层。
   *
   * 注意：调用方（AI 匹配层）已经先拿现有分类树比对过了，
   * 所以这里收到的要么是一条**已存在的完整路径**（原样命中，不会重复建），
   * 要么是一条**确定要新建的路径**。不会出现「本该复用却建了个新的」。
   */
  const resolveCategoryPath = (path: string[]): string | null => {
    const cleaned = path.map((part) => part.trim()).filter((part) => part !== '')
    if (cleaned.length === 0) return null

    const key = cleaned.join('/')
    const cached = categoryIdCache.get(key)
    if (cached !== undefined) return cached

    const { id, created } = resolvePathIn(
      categories,
      cleaned,
      now,
      (name, parentId, order, createdAt): Category => ({
        id: uid(),
        name,
        parentId,
        order,
        createdAt,
      }),
    )
    createdCategories += created
    categoryIdCache.set(key, id)
    return id
  }

  const resolveCategoryPaths = (paths: string[][]): string[] => {
    const ids: string[] = []
    for (const path of paths) {
      const id = resolveCategoryPath(path)
      if (id && !ids.includes(id)) ids.push(id)
    }
    return ids
  }

  /** 位置同理 */
  const resolveLocation = (path: string[] | null): string | null => {
    if (!path || path.length === 0) return null

    const key = path.join('/')
    const cached = locationIdCache.get(key)
    if (cached !== undefined) return cached

    const { id, created } = resolvePathIn(
      locations,
      path,
      now,
      (name, parentId, order, createdAt): Location => ({
        id: uid(),
        name,
        parentId,
        note: '',
        order,
        createdAt,
      }),
    )
    createdLocations += created
    locationIdCache.set(key, id)
    return id
  }

  return {
    categories,
    locations,
    resolveCategoryPath,
    resolveCategoryPaths,
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
   *
   * 会保存在这台设备的 localStorage 里（用户明确要求），所以**刷新不会丢**。
   * 但仍然：不进导出的备份文件、不进 IndexedDB。
   *
   * ⚠️ 纯前端存 Key 有两个固有风险，界面上必须如实告诉用户：
   *   1. 任何能在你浏览器上执行 JS 的代码理论上都能读到它
   *   2. `用户名.github.io` 是所有仓库共享同一个域名的 ——
   *      同一账号下部署的其他项目页面也能读到它
   * 所以「清除」按钮要显眼，建议单独建一个只用于这里的 Key。
   */
  aiApiKey: string
  /** 传空字符串表示清除（同时从 localStorage 删掉） */
  setAiApiKey: (key: string) => void

  /* ---------------- AI 草稿落库 ---------------- */

  /**
   * 把草稿落库：带 existingId 的更新、不带的创建、discardIds 的移入回收站，
   * **一次提交**。AI 对话的「采纳」走这条路。
   */
  applyDraftItems: (plan: { items: DraftApplyItem[]; discardIds?: string[] }) => ApplyDraftResult

  setUi: (patch: Partial<UiPrefs>) => void
  /** 展开 / 收起某个分组。展开和折叠分别记录，因为默认值会随分组维度变化。 */
  setGroupExpanded: (key: string, expanded: boolean) => void
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
  addCategory: (name: string, parentId?: string | null) => Category | null
  renameCategory: (id: string, name: string) => void
  moveCategory: (id: string, newParentId: string | null) => { ok: boolean; reason?: string }
  /**
   * 删除分类。
   * 有子分类或挂着物品时，不传 reassignTo 会拒绝（返回原因）；
   * 传了就先把直接子分类和直接挂的物品挪过去，再删除。
   */
  deleteCategory: (id: string, reassignTo?: string | null) => DeleteCategoryResult

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
    aiApiKey: loadAiKey(),

    /* ---------------- 生命周期 ---------------- */

    init: async () => {
      set({ status: 'loading', error: null, ui: loadUiPrefs(), aiApiKey: loadAiKey() })
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

    /* ---------------- AI（Key 存在 localStorage） ---------------- */

    setAiApiKey: (key) => {
      const trimmed = key.trim()
      persistAiKey(trimmed)
      set({ aiApiKey: trimmed })
    },

    applyDraftItems: ({ items: plan, discardIds = [] }) => {
      const data = get().data
      const now = new Date().toISOString()
      const resolvers = createNameResolvers(data, now)
      const items = [...data.items]
      const indexById = new Map(items.map((item, index) => [item.id, index]))

      let added = 0
      let updated = 0
      let discarded = 0

      for (const entry of plan) {
        const categoryIds = resolvers.resolveCategoryPaths(entry.categoryPaths)
        const locationId = resolvers.resolveLocation(entry.locationPath)

        const attrs: Record<string, AttrValue> = {}
        for (const [attrName, value] of Object.entries(entry.attrs)) {
          const def = data.attributeDefs.find((d) => d.name === attrName)
          if (def && value !== '') attrs[def.id] = value
        }

        const tags = uniq((entry.tags ?? []).map((t) => t.trim()).filter(Boolean))
        const name = entry.name.trim()
        const quantity = Math.max(1, Math.round(entry.quantity || 1))

        const index = entry.existingId ? indexById.get(entry.existingId) : undefined

        if (index !== undefined) {
          // 更新：只动这几项，status / createdAt / 闲置时间都保持原样
          items[index] = {
            ...items[index],
            name: name || items[index].name,
            quantity,
            categoryIds,
            locationId,
            tags,
            attrs,
            note: entry.note ?? '',
            updatedAt: now,
          }
          updated++
          continue
        }

        if (name === '') continue
        items.push({
          id: uid(),
          name,
          quantity,
          categoryIds,
          locationId,
          status: 'active',
          tags,
          attrs,
          note: entry.note ?? '',
          createdAt: now,
          updatedAt: now,
          idleAt: null,
          discardedAt: null,
        })
        added++
      }

      // 被移出草稿的已有物品 → 软删除进回收站，不是硬删
      for (const id of discardIds) {
        const index = indexById.get(id)
        if (index === undefined) continue
        const prev = items[index]
        if (prev.status === 'discarded') continue
        items[index] = { ...prev, status: 'discarded', discardedAt: now, updatedAt: now }
        discarded++
      }

      if (added + updated + discarded === 0) {
        return { added: 0, updated: 0, discarded: 0, createdCategories: 0, createdLocations: 0 }
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

      return { added, updated, discarded, createdCategories, createdLocations }
    },

    /* ---------------- 界面偏好 ---------------- */

    setUi: (patch) => {
      const next = { ...get().ui, ...patch }
      persistUiPrefs(next)
      set({ ui: next })
    },

    setGroupExpanded: (key, expanded) => {
      const ui = get().ui
      const next: UiPrefs = {
        ...ui,
        expandedGroups: expanded
          ? [...new Set([...ui.expandedGroups, key])]
          : ui.expandedGroups.filter((k) => k !== key),
        collapsedGroups: expanded
          ? ui.collapsedGroups.filter((k) => k !== key)
          : [...new Set([...ui.collapsedGroups, key])],
      }
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
      // 只统计**直接放在这个位置上**的物品。
      // 子位置里的东西不动 —— 删掉「衣柜」不该把「第二层抽屉」里的东西也倒出来。
      const directItems = data.items.filter((item) => item.locationId === id)

      // 有内容又没指定去处 → 拒绝删除，把情况报给界面去提示
      if ((childCount > 0 || directItems.length > 0) && reassignTo === undefined) {
        return {
          ok: false,
          reason:
            childCount > 0 && directItems.length > 0
              ? `该位置下有 ${childCount} 个子位置和 ${directItems.length} 件物品`
              : childCount > 0
                ? `该位置下有 ${childCount} 个子位置`
                : `该位置下有 ${directItems.length} 件物品`,
          childCount,
          itemCount: directItems.length,
        }
      }

      // 指定了去处 → 把直接物品和直接子节点都挪过去，再删除
      if (reassignTo !== undefined) {
        if (reassignTo !== null && !ctx.index.has(reassignTo)) {
          return { ok: false, reason: '目标位置不存在', childCount, itemCount: directItems.length }
        }
        if (
          reassignTo !== null &&
          (reassignTo === id || ctx.index.descendantIds(id).has(reassignTo))
        ) {
          return {
            ok: false,
            reason: '不能把内容移动到正在删除的这个位置下面',
            childCount,
            itemCount: directItems.length,
          }
        }
      }

      const now = new Date().toISOString()
      const items =
        reassignTo === undefined
          ? data.items
          : data.items.map((item) =>
              item.locationId === id ? { ...item, locationId: reassignTo, updatedAt: now } : item,
            )

      const locations =
        reassignTo === undefined
          ? data.locations.filter((l) => l.id !== id)
          : data.locations
              .filter((l) => l.id !== id)
              .map((l) =>
                l.parentId === id
                  ? {
                      ...l,
                      parentId: reassignTo,
                      order: orderAmongSiblings(data.locations, reassignTo),
                    }
                  : l,
              )

      // 删除位置会连带影响物品归属，属于结构性破坏操作 → 落一份 destructive 快照
      commit({ ...data, locations, items }, 'destructive')
      return { ok: true, childCount, itemCount: directItems.length }
    },

    /* ---------------- 分类 ---------------- */

    addCategory: (name, parentId = null) => {
      const trimmed = name.trim()
      if (trimmed === '') return null

      const data = get().data
      if (parentId !== null && !get().derived.categoryIndex.has(parentId)) return null

      // 重名只在**同一个父级下**算冲突 ——
      // 「化妆品 › 眼妆」和「护肤 › 眼妆」是两个不同的分类，应该允许
      const duplicate = data.categories.some(
        (c) => (c.parentId ?? null) === parentId && c.name === trimmed,
      )
      if (duplicate) return null

      const category: Category = {
        id: uid(),
        name: trimmed,
        parentId,
        order: orderAmongSiblings(data.categories, parentId),
        createdAt: new Date().toISOString(),
      }
      commit({ ...data, categories: [...data.categories, category] })
      return category
    },

    renameCategory: (id, name) => {
      const trimmed = name.trim()
      if (trimmed === '') return

      const data = get().data
      const target = data.categories.find((c) => c.id === id)
      if (!target) return

      const duplicate = data.categories.some(
        (c) =>
          c.id !== id && (c.parentId ?? null) === (target.parentId ?? null) && c.name === trimmed,
      )
      if (duplicate) return

      commit({
        ...data,
        categories: data.categories.map((c) => (c.id === id ? { ...c, name: trimmed } : c)),
      })
    },

    moveCategory: (id, newParentId) => {
      const check = canReparent(get().derived.categoryIndex, id, newParentId)
      if (!check.ok) return check

      const data = get().data
      const categories = data.categories.map((c) =>
        c.id === id
          ? {
              ...c,
              parentId: newParentId,
              order: orderAmongSiblings(data.categories, newParentId),
            }
          : c,
      )
      commit({ ...data, categories })
      return { ok: true }
    },

    deleteCategory: (id, reassignTo) => {
      const data = get().data
      const ctx = get().derived

      const node = ctx.categoryById.get(id)
      if (!node) return { ok: false, reason: '分类不存在', childCount: 0, itemCount: 0 }

      const childCount = data.categories.filter((c) => c.parentId === id).length
      // 只统计**直接挂在这个分类上**的物品。
      // 子分类里的东西不动 —— 删掉「化妆品」不该把「眼影盘」也弄丢归属。
      const directItems = data.items.filter((item) => item.categoryIds.includes(id))

      if ((childCount > 0 || directItems.length > 0) && reassignTo === undefined) {
        return {
          ok: false,
          reason:
            childCount > 0 && directItems.length > 0
              ? `该分类下有 ${childCount} 个子分类和 ${directItems.length} 件物品`
              : childCount > 0
                ? `该分类下有 ${childCount} 个子分类`
                : `该分类下有 ${directItems.length} 件物品`,
          childCount,
          itemCount: directItems.length,
        }
      }

      if (reassignTo !== undefined && reassignTo !== null) {
        if (!ctx.categoryById.has(reassignTo)) {
          return { ok: false, reason: '目标分类不存在', childCount, itemCount: directItems.length }
        }
        if (reassignTo === id || ctx.categoryIndex.descendantIds(id).has(reassignTo)) {
          return {
            ok: false,
            reason: '不能把内容移动到正在删除的这个分类下面',
            childCount,
            itemCount: directItems.length,
          }
        }
      }

      const now = new Date().toISOString()

      const items =
        reassignTo === undefined
          ? data.items
          : data.items.map((item) => {
              if (!item.categoryIds.includes(id)) return item
              const next = item.categoryIds.filter((c) => c !== id)
              if (reassignTo !== null && !next.includes(reassignTo)) next.push(reassignTo)
              return { ...item, categoryIds: next, updatedAt: now }
            })

      const categories =
        reassignTo === undefined
          ? data.categories.filter((c) => c.id !== id)
          : data.categories
              .filter((c) => c.id !== id)
              .map((c) =>
                c.parentId === id
                  ? {
                      ...c,
                      parentId: reassignTo,
                      order: orderAmongSiblings(data.categories, reassignTo),
                    }
                  : c,
              )

      commit({ ...data, categories, items }, 'destructive')
      return { ok: true, childCount, itemCount: directItems.length }
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
