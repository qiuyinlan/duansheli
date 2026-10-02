/**
 * 全部类型定义 —— 整个应用的数据模型都在这一个文件里。
 * 详见 docs/设计文档.md 第 4 章。
 */

/** 应用标识，写入导出文件用于校验；IndexedDB 数据库名也是它 */
export const APP_ID = 'duansheli'

/**
 * 数据结构版本。
 *
 * v1 → v2：分类从扁平变成不限层级的树（Category 增加 parentId）。
 * 升版本号是为了保护老程序：它拿到 v2 的备份会**明确拒绝**并提示升级，
 * 而不是静默把分类层级丢掉。反过来 v1 的老备份能正常导入 v2 程序，
 * 那些分类会自动变成全是顶层。
 */
export const SCHEMA_VERSION = 2

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
/* 树                                                                  */
/* ------------------------------------------------------------------ */

/**
 * 任何能构成树的东西。
 *
 * 位置和分类都是「不限层级的树」，结构完全一样，
 * 所以抽成这个共用形状 —— 树工具、路径匹配、合并算法都按它写成泛型，
 * 免得两边各写一遍，然后其中一份悄悄长出 bug。
 */
export interface TreeItem {
  id: string
  name: string
  parentId: string | null
  /** 同级手动排序 */
  order: number
}

/* ------------------------------------------------------------------ */
/* 位置（不限层数的树）                                                 */
/* ------------------------------------------------------------------ */

export interface Location extends TreeItem {
  note: string
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

/**
 * 受控词表：你亲手维护的固定清单，回答「这是什么」。
 *
 * 和位置一样是不限层级的树 —— 可以做「化妆品 › 眼妆 › 眼影盘」这种结构。
 * 物品可以挂在**任意层级**上：想细就细，想粗就粗。
 */
export interface Category extends TreeItem {
  /** null = 顶层分类。加这个字段是纯新增，老数据自动变成全是顶层。 */
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
  /** 用户点过「收起」的分组 key */
  collapsedGroups: string[]
  /**
   * 用户点过「展开」的分组 key。
   *
   * 为什么「展开」要单独记一份：树形分组（分类 / 位置）默认是**折叠**的，
   * 所以「没记过」等于折叠；要区分「用户主动展开过」和「默认状态」，
   * 就得把两边分别记下来。
   */
  expandedGroups: string[]
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
  expandedGroups: [],
  lastExportAt: null,
}
