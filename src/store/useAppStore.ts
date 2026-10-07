import { create } from 'zustand'
import type {
  AppData,
  AttributeDef,
  AttrType,
  AttrValue,
  Category,
  Checklist,
  ChecklistEntry,
  Collection,
  ImportReport,
  Item,
  ItemStatus,
  Location,
  SnapshotReason,
  UiPrefs,
} from '../types'
import { DEFAULT_UI_PREFS, SCHEMA_VERSION } from '../types'
import { mergeAppData } from '../data/importData'
import { normalizeExpiryDate } from '../lib/expiry'
import { uid } from '../lib/id'
import { canReparent, type TreeItem } from '../lib/tree'
import { getRepository } from '../storage/repository'
import { createEmptyData, createSeedData } from '../storage/seed'
import { t } from '../i18n'
import type { ReparentBlock } from '../lib/tree'
import { createSnapshot, getSnapshot, listSnapshots } from '../storage/snapshots'
import {
  applyCategoryPlan as applyCategoryPlanPure,
  type CategoryPlanEntry,
} from '../ai/categoryEdit'
import type { DerivedContext } from './selectors'
import { createDerived } from './selectors'
import { clearAiSession, useAiSessionStore } from './useAiSessionStore'

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

/**
 * 内存里有没有**还没落盘**的改动。
 *
 * 存在的唯一理由是挡住 `init()` 的覆盖：`init` 会从 IndexedDB 重新读一遍，
 * 而排队没写完的改动不在盘上 —— 读回来的就是旧数据，覆盖之后
 * 用户刚刚新建的东西会在眼前消失（issue 10）。
 *
 * 不放进 store 是因为它**不需要触发重渲染**：界面上没有任何东西依赖它，
 * 它只用来做一个判断（和 `setAiCancel` 同一个道理）。
 */
let dirtySinceFlush = false

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
    items: (Array.isArray(data.items) ? data.items : []).map((item) => ({
      ...item,
      // v4 新增：老数据里没有这个字段，补成空数组
      collectionIds: Array.isArray(item.collectionIds) ? item.collectionIds : [],
    })),
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
    // v4 新增：老数据里没有活动合集
    collections: Array.isArray(data.collections) ? data.collections : [],
    // v5 新增：老数据里没有清单
    checklists: Array.isArray(data.checklists) ? data.checklists : [],
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

/* ------------------------------------------------------------------ */
/* 位置 / 分类的移动与删除：把代号翻成人话                              */
/* ------------------------------------------------------------------ */

type NodeKind = 'location' | 'category'

/**
 * 「位置」还是「分类」。
 *
 * lib/tree.ts 的那段判断两个维度共用，所以它只返回代号；
 * 到了这一层才知道该说哪个词 —— 句子必须在这里拼，不然就会出现
 * 「不能移动分类」的提示里写着「位置」这种明显不对的话。
 */
function kindWord(kind: NodeKind): string {
  return t(kind === 'category' ? 'data.kind.category' : 'data.kind.location')
}

function reparentReason(blocked: ReparentBlock, kind: NodeKind): string {
  switch (blocked) {
    case 'self':
      return t('data.tree.moveBlockedSelf')
    case 'missing':
      return t('data.tree.moveBlockedMissing', { kind: kindWord(kind) })
    case 'descendant':
      return t('data.tree.moveBlockedDescendant')
  }
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
  /** 有效期至（YYYY-MM-DD）；null 或 undefined 都是「没设置」 */
  expiresAt?: string | null
  /** 所属活动合集的 id */
  collectionIds?: string[]
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
  /** 有效期至（YYYY-MM-DD）；null = 没设置 */
  expiresAt: string | null
  /**
   * 所属活动合集。
   *
   * 可选，而且**更新已有物品时不传就等于「保持原样」**（不是清空）——
   * 这是为了兼容早期版本：那时候 AI 还认不出活动，如果默认成空数组，
   * 每次让 AI 改个名字都会把物品身上的活动全抹掉。
   * 现在 AI 会明确给出它看到的活动列表，所以传了就是「替换成这一批」。
   */
  collectionIds?: string[]
  /**
   * 状态（在用 / 闲置 / 备用）。
   *
   * 刻意**没有**可选值里的「已舍弃」：舍弃是另一个动作（走 removedKeys
   * 进回收站）。让一个字段顺手就能把东西扔掉太轻率了。
   * 不传 = 保持原样（新建时按「在用」）。
   */
  status?: 'active' | 'idle' | 'spare'
}

export interface ApplyDraftResult {
  added: number
  updated: number
  /** 被移入回收站的已有物品数 */
  discarded: number
  /**
   * 要求删、但数据库里找不到的那些 id 的条数。
   *
   * 以前这是**静默跳过**的：点完采纳、提示说「移入回收站 3」，
   * 其实一件都没动。所以数出来，让界面如实说一句。
   */
  missingDiscards: number
  createdCategories: number
  createdLocations: number
  /**
   * 计划里第 i 条最终落到了哪件物品上（`null` = 这一条被跳过了）。
   *
   * 采纳之后要靠它把「已落库」这件事写回对应的草稿：新建的条目从此有了
   * 自己的物品 id，下一次 AI 碰到它才是**更新**而不是又新建一条。
   * 没有这份对应关系，用户就会看到「采纳完 AI 再改一次，库里多出第二件」。
   */
  appliedIds: Array<string | null>
}

export interface DeleteCategoryResult {
  ok: boolean
  reason?: string
  childCount: number
  /** 直接挂在这个分类上的物品数（不含子分类里的） */
  itemCount: number
}

/** 一批分类改动落库之后的结果（给界面报数用） */
export interface CategoryApplyStats {
  created: number
  renamed: number
  moved: number
  deleted: number
  /** 被挂到父级去的子分类数（删分类的连带） */
  reparentedChildren: number
  /** 失去了这个分类归属的物品数（删分类的连带，物品本身一件不少） */
  affectedItems: number
}

/** 取用一件备用的结果 */
export interface TakeSpareResult {
  /** 这次取用是否让整条记录变成了「在用」 */
  becameActive: boolean
  /** 这条记录还剩几件备用（变成在用之后是 0，已经不属于备用区了） */
  remaining: number
}

/**
 * 拆出备用的结果。
 *
 * 失败时给的是**机器码**而不是一句话：调用方才知道该怎么措辞，
 * 而且分类 / 位置那两处已经踩过这个坑（见 `canReparent`）。
 */
export type SplitToSpareResult =
  | { ok: true; spareId: string; movedCount: number; leftCount: number }
  | { ok: false; reason: 'notFound' | 'discarded' | 'tooFew' }

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
  /**
   * 上一次落盘失败。null = 一切正常。
   *
   * 为什么要单独留一个持久状态（而不是只弹一条提示）：
   * 落盘失败时界面已经按新数据渲染了，**看起来完全正常**，
   * 但刷新就没了。提示三秒后消失，用户会以为没事 ——
   * 所以界面上要一直挂着横幅，直到真的存进去为止（见 AppShell）。
   */
  saveFailure: { message: string; at: string } | null
  /**
   * 手动重试落盘。
   *
   * 内存里那份数据一直是新的，所以重试就是把当前这份再写一次。
   * 这条路的用处：自动重试也失败时（比如浏览器就是不给写），
   * 用户至少还有个能按的按钮，而不是只剩「刷新就丢」。
   */
  retrySave: () => Promise<void>
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
   *
   * `duplicates`：名字撞上已有物品、且**用户明确选了「就是那一条」**的条目。
   * 键是 `DraftApplyItem` 在前面的顺序号，值是那件已有物品的 id。
   * 顺序号而不是名字：同名的两条草稿指向不同物品时，按名字查会全部落到同一条上。
   */
  applyDraftItems: (plan: {
    items: DraftApplyItem[]
    discardIds?: string[]
    duplicates?: ReadonlyMap<number, string>
  }) => ApplyDraftResult

  /* ---------------- AI 分类改动落库 ---------------- */

  /**
   * 把 AI 提议的**分类改动**落到数据上：新建 / 改名 / 移动 / 删除，**一次提交**。
   *
   * 用户要的能力：「我希望 ai 可以编辑分类，我可以让它帮我整理已有的分类。」
   *
   * 传进来的是**已经算好的计划**（`planCategoryChanges` 的产物）——
   * 每条的 id、能不能做都已经定好了。这一层只负责：
   *   1. 用计划里的路径和 id 去改那棵树（真正的算法在
   *      `ai/categoryEdit.ts` 的 `applyCategoryPlan`，纯函数、被用例钉死）
   *   2. commit 一次（所以只留一份快照、只写一次盘）
   *
   * 为什么把算法放在 `ai/` 那一层的纯函数里，而不是写在这儿：
   * 分类是结构，改错了没法用眼睛验（你只知道树变了样子），
   * 所以「算」必须能被逐条测试。这里只做搬运。
   */
  applyCategoryPlan: (entries: CategoryPlanEntry[]) => CategoryApplyStats

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
  /**
   * 取用一件备用。
   *
   * 两种情况其实是**同一件事**：刚好一件从备用区出来、进入使用。
   *   · 还有存货（数量 > 1）→ 少一件，剩下的继续待在备用区
   *   · 这是最后一件 → 整条记录改成「在用」
   * 所以这不是特例，是同一条规则的两个结果。
   */
  takeSpareOne: (id: string) => TakeSpareResult
  /**
   * 从一条物品里拆出 n 件，新建一条**备用**记录。
   *
   * 「一个东西买多了」就靠这个：牙膏 ×3 → 拆出 2 件 →
   * 新建「牙膏（备用）×2」进备用区，原来那条变成 ×1。
   *
   * `spareLocationId`：
   *   · `undefined` = 用记住的那个备用位置（`ui.spareLocationId`）
   *   · `null`      = 明确放「未归位」
   * 之所以要区分这两者：备用基本都是收在**同一个盒子**里的，
   * 但「我没设置过」和「我就是要未归位」是两回事。
   */
  splitToSpare: (
    id: string,
    count: number,
    spareLocationId?: string | null,
  ) => SplitToSpareResult
  /** 批量设/清有效期。传 null 就是清掉。 */
  setExpiry: (ids: string[], expiresAt: string | null) => void
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

  /* 活动合集 */
  /** 新建一个活动。返回它的 id（名字已存在时返回那个已有的 id） */
  addCollection: (name: string, note?: string) => string | null
  updateCollection: (id: string, patch: { name?: string; note?: string }) => void
  /**
   * 删掉一个活动。
   *
   * **只解除关联，绝不删物品** —— 删掉「旅行」不该把你为了旅行准备的充电宝也删了。
   * 返回受影响的物品数，界面上如实告诉用户。
   */
  deleteCollection: (id: string) => number
  /** 把一批物品加进某个活动（已在里面的自动跳过） */
  addItemsToCollection: (itemIds: string[], collectionId: string) => number
  /** 把一批物品从某个活动里移出 */
  removeItemsFromCollection: (itemIds: string[], collectionId: string) => number

  /* 清单（一次性的待办） */
  /**
   * 建一份清单。
   *
   * 两种来源都用它：
   *   · 从物品列表勾选 → 传 itemIds
   *   · 从活动里勾选   → 传 itemIds + fromCollectionId（只是记个来源）
   *
   * 条目里的名字和数量是**从物品抄一份快照**，之后物品改名或删掉都不影响这份清单。
   */
  createChecklist: (input: {
    name: string
    itemIds?: string[]
    fromCollectionId?: string | null
  }) => string | null
  renameChecklist: (id: string, name: string) => void
  /** 删掉整份清单。清单本来就是临时的东西，删了不留痕迹 */
  deleteChecklist: (id: string) => void
  /** 打钩 / 取消。不传 checked 就是取反 */
  toggleChecklistEntry: (checklistId: string, entryId: string, checked?: boolean) => void
  /** 改条目本身（清单内的编辑，**不会去改库里的物品** —— 这是张临时清单） */
  updateChecklistEntry: (
    checklistId: string,
    entryId: string,
    patch: { name?: string; quantity?: number },
  ) => void
  /** 往清单里加一条（可以是库里没有的东西，比如顺路买瓶水） */
  addChecklistEntry: (checklistId: string, name: string, quantity?: number) => string | null
  removeChecklistEntry: (checklistId: string, entryId: string) => void
  /** 把已打钩的一次清掉，剩下一堆未办的在眼前 */
  clearCheckedEntries: (checklistId: string) => number

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
    /*
     * 记下「内存里这份还没落盘」。
     *
     * 为什么非记不可：`init()` 会从 IndexedDB **重新读一遍并覆盖内存里的数据**。
     * 如果那一刻还有排队没写完的改动，那次读取拿到的就是**旧**数据 ——
     * 覆盖之后，用户刚刚新建的那件东西就在眼前消失了（issue 10：
     * 「就我刚刚才新建的东西，过了一会他就不见了」）。
     * 这个标记就是给 init 看的闸门，见下面 init 里的判断。
     */
    dirtySinceFlush = true

    void enqueueWrite(async () => {
      try {
        if (reason) await createSnapshot(previous, reason)
        await getRepository().save(stamped)
        /*
         * 存成功才清掉「脏」标记。
         *
         * 注意：这里清的是「当前这一笔已落盘」，而**不能**简单地在读的时候
         * 再比一次 —— 写入是串行的，一笔一笔来，所以到这一步时内存里
         * 那份一定等于刚存下去的这份。
         */
        dirtySinceFlush = false
        // 存成功就把「上次没存进去」的横幅撤掉
        if (get().saveFailure !== null) set({ saveFailure: null, error: null })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        /*
         * 落盘失败是最危险的**静默失败**：界面已经按新数据渲染了，
         * 看起来一切正常，但刷新就没了。
         *
         * 所以除了弹一条会消失的提示，还要留下一个**持久的状态**，
         * 让界面上一直挂着横幅（见 AppShell）——「没存进去」这件事
         * 不能让用户三秒之后就忘了。
         */
        set({ error: message, saveFailure: { message, at: new Date().toISOString() } })
        get().notify(t('data.storage.saveFailed', { message }), 'error')
      }
    })
  }

  const replaceItems = (items: Item[], reason: SnapshotReason | null = 'auto') => {
    const data = get().data
    const now = new Date().toISOString()
    const usedTags = items.flatMap((i) => i.tags)
    commit({ ...data, items, tags: ensureTags(data.tags, usedTags, now) }, reason)
  }

  /**
   * 页面要走了 —— 把内存里还没落盘的改动**立刻写完**。
   *
   * ── 为什么非做不可 ──────────────────────────────────────────────
   * `commit` 是「先改内存、再把写盘排进队列」，而写盘是异步的
   * （IndexedDB 事务要跨几个微任务/宏任务）。于是有一个真实存在的窗口：
   *
   *   1. 用户刚录完一件东西（或者刚点完采纳）
   *   2. 写盘还排在队列里
   *   3. **页面被卸载**——用户自己刷新、或者开发时 Vite 因为改了 i18n
   *      之类的模块触发了一次整页重载
   *   4. 那笔写永远不会执行 → 数据没了
   *
   * 这是一个「用户会归因于我」的 bug：他只知道「我刚弄完的东西，
   * 你更新一下就没了」。而它跟更新本身其实只是**撞上了**。
   *
   * `pagehide` 和 `beforeunload` 都挂上：前者在移动端和 bfcache 场景更可靠，
   * 后者在桌面浏览器更常见。两个都挂不冲突 —— 这个函数是幂等的。
   *
   * ⚠️ 只在还有没落盘的东西时才动手（`dirtySinceFlush`）。
   * 否则每次关页面都白写一遍整份数据，白白磨损存储。
   */
  const flushPendingWrites = (): void => {
    if (!dirtySinceFlush) return
    const snapshot = get().data
    /*
     * 不走 `enqueueWrite`，**直接写**。
     *
     * 走队列的话，前面可能还排着好几笔快照 + 写盘，等它们跑完页面早没了。
     * 这里要的是「无论如何尽快把最新那份数据写进去」—— 后面那些排队里的
     * 写入内容都是旧的，跳过它们反而更安全。
     *
     * 不 await、也不 catch 到界面上：`pagehide` 之后没有界面可言了，
     * 抛错也没人看。写失败的话下次打开时那件东西就是不在 —— 这是这个
     * 方案固有的极限，能在卸载前抢到的就抢到了。
     */
    void getRepository()
      .save(snapshot)
      .then(() => {
        dirtySinceFlush = false
      })
      .catch(() => {
        // 卸载途中，没地方报告，也不该阻塞
      })
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', flushPendingWrites)
    window.addEventListener('beforeunload', flushPendingWrites)
  }

  /**
   * 数据被**整体替换**之后，把 AI 会话作废。
   *
   * 为什么非做不可：AI 会话现在能跨页面存活了，而**草稿是「针对某一份数据」
   * 的计划** —— 每条草稿的 `sourceItemId` / `locationId` / `matchedCategoryIds`
   * 都是当时那份数据里的 id。整体替换（清空 / 导入覆盖 / 回退快照 /
   * 恢复脚手架）之后，这些 id 就指不到任何东西了。
   *
   * 后果不是「会建错东西」，而是更隐蔽的一种：`draftsToApply` 对
   * 「有 sourceItemId 但找不到」是**静默跳过**的，于是用户点「采纳」
   * 会得到一个悄悄少了几条的结果，界面上也不说哪一条为什么不见了。
   * 默默少做一部分还不说，正是这个项目一直在避免的事。
   *
   * 只在这些**整体替换**的操作里调用。普通的增删改不碰会话：
   * 那种情况下草稿仍然有效，清掉反而会让用户白丢一段对话。
   */
  const invalidateAiSession = () => {
    const session = useAiSessionStore.getState()
    const hadWork = session.drafts.length > 0 || session.bubbles.length > 0
    clearAiSession()
    // 只在真的弄丢了东西的时候说一声 —— 没事就弹提示只是噪音
    if (hadWork) get().notify(t('ai.sessionClearedByDataReset'), 'info')
  }

  /**
   * 醒来发现盘上的数据比最新快照还少 → 用那份快照救回来。
   *
   * 返回 `null` = 不用救（盘上是完好的）。
   *
   * ── 判断依据 ──────────────────────────────────────────────────
   *
   * 快照有两类：
   *   · **自动快照**（reason 'auto'）—— 每次修改**之前**存的，也就是
   *     「上一次写完时的完整数据」。所以数据没丢的话，盘上那份的物品数
   *     一定 **≥** 最新的自动快照。反过来说：比它**严格更少**，
   *     就一定是丢东西了。
   *   · 手动 / 导入 / 破坏性快照 —— 用户主动动作留下的，不能用它们判断
   *     （比如「清空所有数据」会留一份装满东西的 destructive 快照，
   *     而盘上确实是空的，那是用户要的）。
   *
   * 只看**最新那一份自动快照**，不往前找。因为「刚清空」「刚批量清理」
   * 这些主动操作之后，第一笔写入就会存下一份新的自动快照（数量很小）——
   * 它成了新的基线，于是往前找的冲动就没有了。
   * 只认最新那份，等于把判断完全交给「最近一次修改」，误判面最小。
   *
   * ⚠️ 只在**严格更少**时动手。宁可漏救，不可误改。
   */
  async function rescueFromNewestSnapshot(
    onDisk: AppData,
  ): Promise<{ data: AppData; missing: number } | null> {
    const metas = await listSnapshots()
    const newestAuto = metas.find((meta) => meta.reason === 'auto')
    if (!newestAuto) return null

    const onDiskCount = onDisk.items.length
    if (newestAuto.itemCount <= onDiskCount) return null

    const snapshot = await getSnapshot(newestAuto.id)
    if (!snapshot) return null

    const restored = normalizeShape(snapshot.data)

    /*
     * 再确认一遍：物品数**更少或者一样**的快照绝不用来覆盖。
     * 那就不是「救」，而是拿一份更旧的东西把盘上那份换掉 ——
     * 正是这个项目最该避免的那种「偷偷改变用户数据」。
     */
    if (restored.items.length <= onDiskCount) return null

    return { data: restored, missing: restored.items.length - onDiskCount }
  }

  return {
    status: 'loading',
    error: null,
    saveFailure: null,
    data: initialData,
    derived: createDerived(initialData),
    ui: { ...DEFAULT_UI_PREFS },
    toasts: [],
    aiApiKey: loadAiKey(),

    /* ---------------- 生命周期 ---------------- */

    init: async () => {
      /*
       * 先把排队中的写入等完，再读盘。
       *
       * 不等的话会出现这件事（issue 10 的真凶）：
       *   1. 用户新建了一件东西 → commit 立刻改了内存、把写盘排进队列
       *   2. 写盘还没轮到（IndexedDB 是异步的，中间可能隔好几毫秒）
       *   3. init() 被再次调用（组件重新挂载 / 用户点了「重试」）
       *   4. init 从盘上读回来的是**没有那件东西的旧数据**，然后把内存覆盖掉
       *      → 用户眼睁睁看着刚录的东西消失了
       *
       * `writeChain` 是串行的，所以 `await writeChain` 之后就一定读得到最新的。
       */
      set({ status: 'loading', error: null, ui: loadUiPrefs(), aiApiKey: loadAiKey() })
      try {
        await writeChain
        /*
         * 再挡一道。
         *
         * 等待之后理论上盘上已是最新，但「上一次写盘**失败**了」的情况
         * 也走这条链：那时内存里那份才是用户看到的东西，**绝不能拿盘上的旧数据覆盖它**
         * —— 覆盖就等于把「界面上还看得见、还有机会导出/重试」的东西真的弄丢。
         * 失败时 saveFailure 已经挂着横幅（见 AppShell），用户知情。
         */
        const pendingFailure = get().saveFailure !== null
        if (dirtySinceFlush && pendingFailure) {
          set({ status: 'ready' })
          return
        }

        const repo = getRepository()
        let data = await repo.load()
        if (!data) {
          // 首次使用：铺一套脚手架（分类 / 位置树 / 属性库 / 标签），物品为空
          data = createSeedData()
          await repo.save(data)
        }
        const normalized = normalizeShape(data)

        /*
         * ── 醒来发现盘上的东西比上一份快照还少 → 自动救回来 ──────────
         *
         * 这是给「数据莫名其妙没了」准备的**最后一道**，而且是唯一一道
         * 主动把东西放回去的：
         *
         * 快照是在每次修改**之前**存的，所以「上一份快照」里一定含有
         * 「上一次写完时的完整数据」。于是只要盘上的物品数**少于**
         * 最新一份快照，就说明盘上那份是**残缺的** —— 不是用户主动删的
         * （主动删会留下新的快照，而且删完的那份自己就是新的基线）。
         *
         * 一个真实会走到这里的场景：写完还没落盘就被页面卸载了
         * （自己刷新、或者开发时改代码触发的整页重载）。
         *
         * ⚠️ 只在**严格更少**时动手，等于的情况不碰 ——
         * 「用户刚删掉几件」是再正常不过的操作，那种时候盘上会有一份
         * 数量相等或更多的新快照，不会误判。宁可漏救，不可误改。
         */
        const rescue = await rescueFromNewestSnapshot(normalized)
        if (rescue) {
          set({
            data: rescue.data,
            derived: createDerived(rescue.data),
            status: 'ready',
            error: null,
          })
          get().notify(
            t('data.store.restoredFromSnapshot', {
              count: rescue.data.items.length,
              missing: rescue.missing,
            }),
            'success',
          )
          return
        }

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

    applyDraftItems: ({ items: plan, discardIds = [], duplicates }) => {
      const data = get().data
      const now = new Date().toISOString()
      const resolvers = createNameResolvers(data, now)
      const items = [...data.items]
      const indexById = new Map(items.map((item, index) => [item.id, index]))

      let added = 0
      let updated = 0
      let discarded = 0
      /** 计划里每条最终落到哪件物品上 —— 采纳流程靠它把草稿绑到真实 id */
      const appliedIds: Array<string | null> = plan.map(() => null)

      for (const [planIndex, entry] of plan.entries()) {
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
        const expiresAt = normalizeExpiryDate(entry.expiresAt)

        /*
         * 更新哪一条：先看调用方明确给的 existingId（计划里已经定好的），
         * 再看用户在这一轮确认过的「名字撞上的就是它」。
         * 后者是 issue 2 的兜底 —— 用户说「我仓库里有」，而 AI 给的是一条
         * 要新建的草稿，那份确认就是在这里生效的。
         */
        const targetId = entry.existingId ?? duplicates?.get(planIndex)
        const index = targetId ? indexById.get(targetId) : undefined

        /*
         * 状态。
         *
         * 只在 entry.status 明确给了值时改动 —— 而且**顺手维护 idleAt**：
         * 变成闲置就记下开始闲置的时刻，离开闲置就清掉。
         * 漏了这一步，「闲置了 217 天」那个排序就会算在错误的起点上。
         *
         * 只有这三个值能走到这里：`DraftApplyItem.status` 里没有「已舍弃」，
         * 舍弃是 removedKeys 那条路（进回收站，可恢复）。
         */
        const previousStatus: ItemStatus = index === undefined ? 'active' : items[index].status
        const nextStatus: ItemStatus = entry.status ?? previousStatus

        if (index !== undefined) {
          const prev = items[index] as Item
          // 更新：只动这几项，createdAt / 已舍弃时间保持原样
          items[index] = {
            ...prev,
            name: name || prev.name,
            quantity,
            categoryIds,
            locationId,
            tags,
            attrs,
            note: entry.note ?? '',
            expiresAt,
            collectionIds: entry.collectionIds ?? prev.collectionIds,
            status: nextStatus,
            idleAt:
              nextStatus === 'idle'
                ? previousStatus === 'idle'
                  ? prev.idleAt
                  : now
                : null,
            updatedAt: now,
          }
          updated++
          appliedIds[planIndex] = prev.id
          continue
        }

        if (name === '') continue
        const createdId = uid()
        items.push({
          id: createdId,
          name,
          quantity,
          categoryIds,
          locationId,
          // 新建但 AI 明确说了「备用」的，就按备用建 —— 别丢掉这个信息
          status: nextStatus,
          tags,
          attrs,
          note: entry.note ?? '',
          collectionIds: entry.collectionIds ?? [],
          createdAt: now,
          updatedAt: now,
          idleAt: nextStatus === 'idle' ? now : null,
          discardedAt: null,
          expiresAt,
        })
        added++
        appliedIds[planIndex] = createdId
      }

      // 被移出草稿的已有物品 → 软删除进回收站，不是硬删
      /*
       * 被移出草稿的已有物品 → 软删除进回收站，不是硬删。
       *
       * 同时数出「要求删、但数据库里找不到」的那些 —— 那是静默丢失的入口：
       * 以前它们被一声不响地跳过，用户点完采纳、提示说「移入回收站 3」，
       * 其实一件都没动。**说做了、没做、还不说**是这个项目最该避免的一种失败，
       * 所以交给调用方去如实报。
       */
      let missingDiscards = 0
      for (const id of discardIds) {
        const index = indexById.get(id)
        if (index === undefined) {
          missingDiscards++
          continue
        }
        const prev = items[index]
        if (prev.status === 'discarded') continue
        items[index] = { ...prev, status: 'discarded', discardedAt: now, updatedAt: now }
        discarded++
      }

      if (added + updated + discarded === 0) {
        return {
          added: 0,
          updated: 0,
          discarded: 0,
          missingDiscards,
          createdCategories: 0,
          createdLocations: 0,
          appliedIds,
        }
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

      return {
        added,
        updated,
        discarded,
        missingDiscards,
        createdCategories,
        createdLocations,
        appliedIds,
      }
    },

    applyCategoryPlan: (entries) => {
      const data = get().data
      const result = applyCategoryPlanPure(data, entries)

      /*
       * 一条都没改成 → 不 commit。
       * 不然会白白留下一份快照、白写一次盘，还刷了 updatedAt。
       */
      if (
        result.created + result.renamed + result.moved + result.deleted ===
        0
      ) {
        return {
          created: 0,
          renamed: 0,
          moved: 0,
          deleted: 0,
          reparentedChildren: 0,
          affectedItems: 0,
        }
      }

      /*
       * `auto` 快照 —— 和别的结构性改动一个待遇。
       * （`deleteCategory` 用的是 `destructive`，但那是因为它只删、
       * 用户看不到「删了什么」；这里改完界面上有明确的报告，
       * 而且新建/改名/移动占大多数，用 auto 更合适。）
       */
      commit(result.data, 'auto')

      return {
        created: result.created,
        renamed: result.renamed,
        moved: result.moved,
        deleted: result.deleted,
        reparentedChildren: result.reparentedChildren,
        affectedItems: result.affectedItems,
      }
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
        collectionIds: uniq(input.collectionIds ?? []),
        createdAt: now,
        updatedAt: now,
        idleAt: status === 'idle' ? now : null,
        discardedAt: status === 'discarded' ? now : null,
        expiresAt: normalizeExpiryDate(input.expiresAt ?? null),
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
        collectionIds:
          patch.collectionIds !== undefined ? uniq(patch.collectionIds) : prev.collectionIds,
        expiresAt:
          patch.expiresAt !== undefined
            ? normalizeExpiryDate(patch.expiresAt)
            : prev.expiresAt,
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

    takeSpareOne: (id) => {
      const data = get().data
      const index = data.items.findIndex((i) => i.id === id)
      const item = index >= 0 ? data.items[index] : undefined
      if (item === undefined || item.status !== 'spare') {
        return { becameActive: false, remaining: 0 }
      }

      const now = new Date().toISOString()
      const items = [...data.items]

      if (item.quantity > 1) {
        items[index] = { ...item, quantity: item.quantity - 1, updatedAt: now }
        commit({ ...data, items }, 'auto')
        return { becameActive: false, remaining: item.quantity - 1 }
      }

      // 最后一件：整条离开备用区，变成在用
      items[index] = {
        ...item,
        status: 'active',
        idleAt: null,
        discardedAt: null,
        updatedAt: now,
      }
      commit({ ...data, items }, 'auto')
      return { becameActive: true, remaining: 0 }
    },

    splitToSpare: (id, count, spareLocationId) => {
      const data = get().data
      const item = data.items.find((i) => i.id === id)
      if (item === undefined) return { ok: false, reason: 'notFound' }
      if (item.status === 'discarded') return { ok: false, reason: 'discarded' }

      /*
       * 原处必须**至少留一件**。
       *
       * 要是允许全拆走，那就不叫「拆出备用」了 —— 那叫「这一整条都变成备用」，
       * 是「标记备用」那个按钮干的事。两个动作用两条路，语义才不含糊。
       * 数量只有 1 时就是这种情况，如实告诉用户该用哪个动作。
       */
      if (item.quantity <= 1) return { ok: false, reason: 'tooFew' }

      const moved = Math.max(1, Math.min(Math.round(count), item.quantity - 1))
      const left = item.quantity - moved
      const now = new Date().toISOString()

      /*
       * 新那条是**同款的一个副本**：名字、分类、标签、属性、备注、有效期、
       * 所属活动全部照抄，只有 id / 数量 / 状态 / 位置不同。
       *
       * 抄备注是有意的，虽然备注有时是「还剩半瓶」这种和单件绑定的说法 ——
       * 但「拆出来的和原来那条一样，只是状态和数量不同」这条规则更好预测，
       * 而且抄错了看得见、改得掉；反过来悄悄丢掉才会让人莫名其妙。
       */
      const spare: Item = {
        ...item,
        id: uid(),
        quantity: moved,
        status: 'spare',
        locationId: spareLocationId === undefined ? get().ui.spareLocationId : spareLocationId,
        createdAt: now,
        updatedAt: now,
        idleAt: null,
        discardedAt: null,
      }

      const items = data.items.map((existing) =>
        existing.id === id ? { ...existing, quantity: left, updatedAt: now } : existing,
      )
      items.push(spare)

      commit({ ...data, items }, 'auto')
      return { ok: true, spareId: spare.id, movedCount: moved, leftCount: left }
    },

    /**
     * 批量设有效期。
     *
     * 只动 expiresAt 和 updatedAt，别的字段一概不碰 —— 特别注意**不改 status**。
     * 到期不等于闲置，更不等于要扔；用户只是想知道它什么时候到期。
     */
    setExpiry: (ids, expiresAt) => {
      const idSet = new Set(ids)
      if (idSet.size === 0) return
      const data = get().data
      const now = new Date().toISOString()
      const normalized = normalizeExpiryDate(expiresAt)

      const items = data.items.map((item) =>
        idSet.has(item.id) ? { ...item, expiresAt: normalized, updatedAt: now } : item,
      )
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
      // lib/tree.ts 只返回机器可读的代号（它不该知道界面语言），
      // 该说「位置」还是「分类」只有这里知道，所以句子在这一层拼。
      if (!check.ok) return { ok: false, reason: reparentReason(check.blocked, 'location') }

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
      if (!node) {
        return {
          ok: false,
          reason: t('data.tree.deleteMissing', { kind: kindWord('location') }),
          childCount: 0,
          itemCount: 0,
        }
      }

      const childCount = data.locations.filter((l) => l.parentId === id).length
      // 只统计**直接放在这个位置上**的物品。
      // 子位置里的东西不动 —— 删掉「衣柜」不该把「第二层抽屉」里的东西也倒出来。
      const directItems = data.items.filter((item) => item.locationId === id)

      // 有内容又没指定去处 → 拒绝删除，把情况报给界面去提示
      if ((childCount > 0 || directItems.length > 0) && reassignTo === undefined) {
        const kind = kindWord('location')
        return {
          ok: false,
          reason:
            childCount > 0 && directItems.length > 0
              ? t('data.tree.deleteHasChildrenAndItems', {
                  kind,
                  children: childCount,
                  items: directItems.length,
                })
              : childCount > 0
                ? t('data.tree.deleteHasChildren', { kind, children: childCount })
                : t('data.tree.deleteHasItems', { kind, items: directItems.length }),
          childCount,
          itemCount: directItems.length,
        }
      }

      // 指定了去处 → 把直接物品和直接子节点都挪过去，再删除
      if (reassignTo !== undefined) {
        if (reassignTo !== null && !ctx.index.has(reassignTo)) {
          return {
            ok: false,
            reason: t('data.tree.moveBlockedMissing', { kind: kindWord('location') }),
            childCount,
            itemCount: directItems.length,
          }
        }
        if (
          reassignTo !== null &&
          (reassignTo === id || ctx.index.descendantIds(id).has(reassignTo))
        ) {
          return {
            ok: false,
            reason: t('data.tree.deleteBlockedDescendant', { kind: kindWord('location') }),
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
      if (!check.ok) return { ok: false, reason: reparentReason(check.blocked, 'category') }

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
      if (!node) {
        return {
          ok: false,
          reason: t('data.tree.deleteMissing', { kind: kindWord('category') }),
          childCount: 0,
          itemCount: 0,
        }
      }

      const childCount = data.categories.filter((c) => c.parentId === id).length
      // 只统计**直接挂在这个分类上**的物品。
      // 子分类里的东西不动 —— 删掉「化妆品」不该把「眼影盘」也弄丢归属。
      const directItems = data.items.filter((item) => item.categoryIds.includes(id))

      if ((childCount > 0 || directItems.length > 0) && reassignTo === undefined) {
        const kind = kindWord('category')
        return {
          ok: false,
          reason:
            childCount > 0 && directItems.length > 0
              ? t('data.tree.deleteHasChildrenAndItems', {
                  kind,
                  children: childCount,
                  items: directItems.length,
                })
              : childCount > 0
                ? t('data.tree.deleteHasChildren', { kind, children: childCount })
                : t('data.tree.deleteHasItems', { kind, items: directItems.length }),
          childCount,
          itemCount: directItems.length,
        }
      }

      if (reassignTo !== undefined && reassignTo !== null) {
        if (!ctx.categoryById.has(reassignTo)) {
          return {
            ok: false,
            reason: t('data.tree.moveBlockedMissing', { kind: kindWord('category') }),
            childCount,
            itemCount: directItems.length,
          }
        }
        if (reassignTo === id || ctx.categoryIndex.descendantIds(id).has(reassignTo)) {
          return {
            ok: false,
            reason: t('data.tree.deleteBlockedDescendant', { kind: kindWord('category') }),
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

    /* ---------------- 活动合集 ---------------- */

    addCollection: (name, note = '') => {
      const trimmed = name.trim()
      if (trimmed === '') return null

      const data = get().data
      // 同名视为「就是它」，返回已有的 id：用户在弹框里手打一个已经存在的名字时，
      // 期望的是「加进去」，而不是被提示重名再操作一遍
      const existing = data.collections.find((c) => c.name === trimmed)
      if (existing) return existing.id

      const now = new Date().toISOString()
      const collection: Collection = {
        id: uid(),
        name: trimmed,
        note: note.trim(),
        order: data.collections.length,
        createdAt: now,
      }
      commit({ ...data, collections: [...data.collections, collection] })
      return collection.id
    },

    updateCollection: (id, patch) => {
      const data = get().data
      const target = data.collections.find((c) => c.id === id)
      if (!target) return

      const name = patch.name === undefined ? target.name : patch.name.trim()
      if (name === '') return // 名字不能清空 —— 一个没名字的活动在列表里没法认
      // 重名就拒绝改名，否则列表里会出现两个「旅行」，谁也分不清
      if (name !== target.name && data.collections.some((c) => c.name === name)) return

      commit({
        ...data,
        collections: data.collections.map((c) =>
          c.id === id ? { ...c, name, note: patch.note === undefined ? c.note : patch.note } : c,
        ),
      })
    },

    deleteCollection: (id) => {
      const data = get().data
      if (!data.collections.some((c) => c.id === id)) return 0

      const now = new Date().toISOString()
      let affected = 0
      const items = data.items.map((item) => {
        if (!item.collectionIds.includes(id)) return item
        affected++
        return {
          ...item,
          collectionIds: item.collectionIds.filter((c) => c !== id),
          updatedAt: now,
        }
      })

      commit({
        ...data,
        collections: data.collections.filter((c) => c.id !== id),
        items,
      })
      return affected
    },

    addItemsToCollection: (itemIds, collectionId) => {
      const idSet = new Set(itemIds)
      if (idSet.size === 0) return 0
      const data = get().data
      if (!data.collections.some((c) => c.id === collectionId)) return 0

      const now = new Date().toISOString()
      let changed = 0
      const items = data.items.map((item) => {
        if (!idSet.has(item.id) || item.collectionIds.includes(collectionId)) return item
        changed++
        return {
          ...item,
          collectionIds: [...item.collectionIds, collectionId],
          updatedAt: now,
        }
      })

      if (changed === 0) return 0
      commit({ ...data, items })
      return changed
    },

    removeItemsFromCollection: (itemIds, collectionId) => {
      const idSet = new Set(itemIds)
      if (idSet.size === 0) return 0
      const data = get().data

      const now = new Date().toISOString()
      let changed = 0
      const items = data.items.map((item) => {
        if (!idSet.has(item.id) || !item.collectionIds.includes(collectionId)) return item
        changed++
        return {
          ...item,
          collectionIds: item.collectionIds.filter((c) => c !== collectionId),
          updatedAt: now,
        }
      })

      if (changed === 0) return 0
      commit({ ...data, items })
      return changed
    },

    /* ---------------- 清单 ---------------- */

    createChecklist: ({ name, itemIds = [], fromCollectionId = null }) => {
      const trimmed = name.trim()
      if (trimmed === '') return null

      const data = get().data
      const now = new Date().toISOString()
      const wanted = new Set(itemIds)

      // 从物品抄一份快照：名字和数量都记下来，
      // 之后物品改名、改数量、甚至被删掉，这张清单都还是当时那个样子
      const entries: ChecklistEntry[] = data.items
        .filter((item) => wanted.has(item.id))
        .map((item) => ({
          id: uid(),
          itemId: item.id,
          name: item.name,
          quantity: item.quantity,
          checked: false,
        }))

      const checklist: Checklist = {
        id: uid(),
        name: trimmed,
        fromCollectionId,
        entries,
        createdAt: now,
      }

      commit({ ...data, checklists: [...data.checklists, checklist] })
      return checklist.id
    },

    renameChecklist: (id, name) => {
      const trimmed = name.trim()
      if (trimmed === '') return
      const data = get().data
      if (!data.checklists.some((c) => c.id === id)) return
      commit({
        ...data,
        checklists: data.checklists.map((c) => (c.id === id ? { ...c, name: trimmed } : c)),
      })
    },

    deleteChecklist: (id) => {
      const data = get().data
      if (!data.checklists.some((c) => c.id === id)) return
      commit({ ...data, checklists: data.checklists.filter((c) => c.id !== id) })
    },

    toggleChecklistEntry: (checklistId, entryId, checked) => {
      const data = get().data
      commit({
        ...data,
        checklists: data.checklists.map((checklist) =>
          checklist.id !== checklistId
            ? checklist
            : {
                ...checklist,
                entries: checklist.entries.map((entry) =>
                  entry.id !== entryId
                    ? entry
                    : { ...entry, checked: checked === undefined ? !entry.checked : checked },
                ),
              },
        ),
      })
    },

    updateChecklistEntry: (checklistId, entryId, patch) => {
      const data = get().data
      const name = patch.name === undefined ? undefined : patch.name.trim()
      // 名字不能改成空的 —— 一条没名字的待办在清单里没法认
      if (name === '') return

      commit({
        ...data,
        checklists: data.checklists.map((checklist) =>
          checklist.id !== checklistId
            ? checklist
            : {
                ...checklist,
                entries: checklist.entries.map((entry) =>
                  entry.id !== entryId
                    ? entry
                    : {
                        ...entry,
                        name: name ?? entry.name,
                        quantity:
                          patch.quantity === undefined
                            ? entry.quantity
                            : Math.max(1, Math.round(patch.quantity)),
                      },
                ),
              },
        ),
      })
    },

    addChecklistEntry: (checklistId, name, quantity = 1) => {
      const trimmed = name.trim()
      if (trimmed === '') return null
      const data = get().data
      if (!data.checklists.some((c) => c.id === checklistId)) return null

      const entryId = uid()
      commit({
        ...data,
        checklists: data.checklists.map((checklist) =>
          checklist.id !== checklistId
            ? checklist
            : {
                ...checklist,
                entries: [
                  ...checklist.entries,
                  {
                    id: entryId,
                    // 手打的条目在库里没有对应物品 —— 这是刻意的，
                    // 「顺路买瓶水」这种事本来就不该先录一件物品
                    itemId: null,
                    name: trimmed,
                    quantity: Math.max(1, Math.round(quantity)),
                    checked: false,
                  },
                ],
              },
        ),
      })
      return entryId
    },

    removeChecklistEntry: (checklistId, entryId) => {
      const data = get().data
      commit({
        ...data,
        checklists: data.checklists.map((checklist) =>
          checklist.id !== checklistId
            ? checklist
            : { ...checklist, entries: checklist.entries.filter((e) => e.id !== entryId) },
        ),
      })
    },

    clearCheckedEntries: (checklistId) => {
      const data = get().data
      const target = data.checklists.find((c) => c.id === checklistId)
      if (!target) return 0
      const removed = target.entries.filter((e) => e.checked).length
      if (removed === 0) return 0

      commit({
        ...data,
        checklists: data.checklists.map((checklist) =>
          checklist.id !== checklistId
            ? checklist
            : { ...checklist, entries: checklist.entries.filter((e) => !e.checked) },
        ),
      })
      return removed
    },

    /* ---------------- 数据整体操作 ---------------- */

    replaceAll: async (next, reason, message) => {
      commit(normalizeShape(next), reason)
      await writeChain
      invalidateAiSession()
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
      invalidateAiSession()
      get().notify(t('data.store.scaffoldRestored'), 'success')
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
      invalidateAiSession()
      get().notify(t('data.store.allCleared'), 'success')
    },

    backupNow: async () => {
      await createSnapshot(get().data, 'manual')
      get().notify(t('data.store.manualSnapshotCreated'), 'success')
    },

    retrySave: async () => {
      const data = get().data
      await enqueueWrite(async () => {
        try {
          await getRepository().save(data)
          set({ saveFailure: null, error: null })
          get().notify(t('data.storage.saveRetryOk'), 'success')
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          set({ error: message, saveFailure: { message, at: new Date().toISOString() } })
          get().notify(t('data.storage.saveFailed', { message }), 'error')
        }
      })
    },

    restoreFromSnapshot: async (snapshotId) => {
      const snapshot = await getSnapshot(snapshotId)
      if (!snapshot) {
        get().notify(t('data.store.snapshotNotFound'), 'error')
        return false
      }
      /*
       * 回退之前先记下现在有几件 —— 回退之后要如实说出差别（issue 16）。
       *
       * 为什么非说不可：用户的原话是「我点击回退后发现物品数量跟上面
       * 显示的不一样」。快照里那个数字现在保证和内容一致了
       * （见 storage/snapshots.ts），但**回退这个动作本身就会改变物品数量** ——
       * 那是它的作用，不该让人毫无准备地发现「怎么少了几件」。
       */
      const before = get().data
      const beforeCount = before.items.length

      // 回退之前再存一份当前状态 —— 所以「回退」这个动作本身也可以回退
      await createSnapshot(before, 'manual')
      const restored = normalizeShape(snapshot.data)
      set({ data: restored, derived: createDerived(restored) })
      await enqueueWrite(() => getRepository().save(restored))
      invalidateAiSession()

      const afterCount = restored.items.length
      const delta = afterCount - beforeCount
      get().notify(
        delta === 0
          ? t('data.store.snapshotRestored', { count: afterCount })
          : delta > 0
            ? t('data.store.snapshotRestoredMore', {
                before: beforeCount,
                after: afterCount,
                delta,
              })
            : t('data.store.snapshotRestoredFewer', {
                before: beforeCount,
                after: afterCount,
                delta: -delta,
              }),
        // 变少了用警示色 —— 那正是需要他立刻看一眼的情况
        delta < 0 ? 'error' : 'success',
      )
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
 * 导出给测试用：手动触发一次「页面要走了」的抢救写盘。
 *
 * 生产路径上它是挂在 `pagehide` / `beforeunload` 上的（见 store 内部），
 * 但 jsdom 里派发 unload 事件比较绕，所以把它暴露出来让用例直接调 ——
 * 走的完全是同一条路，验的就是「待落盘的东西能不能在卸载前写下去」。
 */
export function flushBeforeUnload(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event('pagehide'))
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
