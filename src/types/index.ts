/**
 * 全部类型定义 —— 整个应用的数据模型都在这一个文件里。
 * 详见 docs/设计文档.md 第 4 章。
 */

/** 应用标识，写入导出文件用于校验；IndexedDB 数据库名也是它 */
export const APP_ID = 'duansheli'

/** 数据结构版本。将来结构有破坏性变更时 +1，并在导入时做迁移 */
export const SCHEMA_VERSION = 1

/* ------------------------------------------------------------------ */
/* 物品                                                                */
/* ------------------------------------------------------------------ */

/**
 * 物品状态机：
 *   active(在用) ──标记闲置──> idle(闲置) ──舍弃──> discarded(已舍弃)
 *        ↑                        │                      │
 *        └────────改回在用─────────┘      恢复 ←──────────┘
 */
export type ItemStatus = 'active' | 'idle' | 'discarded'

export type AttrType = 'text' | 'number' | 'date' | 'select' | 'bool'

export type AttrValue = string | number | boolean | null

export interface Item {
  id: string
  /** 唯一必填字段 */
  name: string
  /** 可属多个分类 */
  categoryIds: string[]
  /** 单一位置，指向位置树的任意层级节点；null = 未归位 */
  locationId: string | null
  quantity: number
  status: ItemStatus
  /** 自由标签 */
  tags: string[]
  /** 稀疏字典：key = AttributeDef.id，只存真正填了值的属性 */
  attrs: Record<string, AttrValue>
  note: string
  createdAt: string
  updatedAt: string
  /** 首次标记闲置的时间，用于计算「已闲置天数」 */
  idleAt: string | null
  /** 舍弃时间，用于回收站排序 */
  discardedAt: string | null
}

/* ------------------------------------------------------------------ */
/* 位置（不限层数的树）                                                 */
/* ------------------------------------------------------------------ */

export interface Location {
  id: string
  name: string
  /** null = 顶层节点（如「家」） */
  parentId: string | null
  note: string
  /** 同级手动排序 */
  order: number
  createdAt: string
}

/** 「未归位」虚拟节点的 id，不存进数据里，只在视图层使用 */
export const UNASSIGNED_ID = '__unassigned__'

/** 「未分类」「未加标签」的虚拟 id，用于筛选与图表分组 */
export const UNCATEGORIZED_ID = '__uncategorized__'
export const UNTAGGED_ID = '__untagged__'

/* ------------------------------------------------------------------ */
/* 分类与标签                                                          */
/* ------------------------------------------------------------------ */

/** 受控词表：你亲手维护的固定清单，回答「这是什么」 */
export interface Category {
  id: string
  name: string
  order: number
  createdAt: string
}

/** 自由标签：回答「什么情境」，如 想送人 / 舍不得扔 */
export interface Tag {
  name: string
  createdAt: string
}

/* ------------------------------------------------------------------ */
/* 属性库                                                              */
/* ------------------------------------------------------------------ */

export interface AttributeDef {
  id: string
  name: string
  type: AttrType
  /** 仅 type === 'select' 使用 */
  options: string[]
  /** 仅 type === 'number' 使用，如「元」「cm」 */
  unit: string
  /** 录入表单中是否默认勾选 */
  showByDefault: boolean
  order: number
  createdAt: string
}

/* ------------------------------------------------------------------ */
/* 应用全集                                                            */
/* ------------------------------------------------------------------ */

/**
 * 整个应用的数据就是一个纯 JSON 对象：无循环引用、无二进制。
 * IndexedDB 里存的就是这一个对象，导出的也是它。
 */
export interface AppData {
  schemaVersion: number
  items: Item[]
  categories: Category[]
  locations: Location[]
  attributeDefs: AttributeDef[]
  tags: Tag[]
  updatedAt: string
}

/* ------------------------------------------------------------------ */
/* 备份快照                                                            */
/* ------------------------------------------------------------------ */

export type SnapshotReason = 'auto' | 'import' | 'manual' | 'destructive'

export interface Snapshot {
  id: string
  at: string
  reason: SnapshotReason
  itemCount: number
  data: AppData
}

/** 列表展示用（不含 data，避免把整个数据集读进内存） */
export interface SnapshotMeta {
  id: string
  at: string
  reason: SnapshotReason
  itemCount: number
}

/* ------------------------------------------------------------------ */
/* 导出文件格式                                                        */
/* ------------------------------------------------------------------ */

export interface ExportFile {
  /** 魔术字符串，导入时校验 */
  format: typeof APP_ID
  schemaVersion: number
  exportedAt: string
  generator: string
  /** 便于人肉查看，导入时忽略 */
  summary: {
    items: number
    categories: number
    locations: number
    attributeDefs: number
    tags: number
  }
  data: {
    items: Item[]
    categories: Category[]
    locations: Location[]
    attributeDefs: AttributeDef[]
    tags: Tag[]
  }
}

export type ImportStrategy = 'replace' | 'merge'

export interface ImportReport {
  strategy: ImportStrategy
  items: { added: number; updated: number; unchanged: number }
  categories: { added: number; updated: number }
  locations: { added: number; updated: number; created: number }
  attributeDefs: { added: number; updated: number }
  tags: { added: number }
  /** 合并时因引用缺失而自动补建的位置（给人看的提示） */
  warnings: string[]
}

/* ------------------------------------------------------------------ */
/* 界面偏好（存 localStorage，丢了也无所谓）                            */
/* ------------------------------------------------------------------ */

export type GroupBy = 'none' | 'category' | 'location' | 'status' | 'tag'
export type SortBy = 'updated' | 'created' | 'name' | 'quantity' | 'location'
export type SortDir = 'asc' | 'desc'

export interface UiPrefs {
  groupBy: GroupBy
  sortBy: SortBy
  sortDir: SortDir
  /** 位置视角：是否包含子孙节点的物品 */
  includeDescendants: boolean
  /** 录入表单记住上次选择 */
  lastLocationId: string | null
  lastCategoryIds: string[]
  lastStatus: ItemStatus
  /** 分类 id → 上次为该分类勾选的属性 id 组合 */
  attrsByCategory: Record<string, string[]>
  /** 列表中被折叠的分组 key */
  collapsedGroups: string[]
  /** 上次导出 JSON 备份的时间 —— 用于在界面上温和提醒该备份了 */
  lastExportAt: string | null
}

export const DEFAULT_UI_PREFS: UiPrefs = {
  groupBy: 'category',
  sortBy: 'updated',
  sortDir: 'desc',
  includeDescendants: true,
  lastLocationId: null,
  lastCategoryIds: [],
  lastStatus: 'active',
  attrsByCategory: {},
  collapsedGroups: [],
  lastExportAt: null,
}
