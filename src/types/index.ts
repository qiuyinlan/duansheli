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
 * v2 → v3：物品增加 expiresAt（有效期至）。
 * v3 → v4：新增活动合集（AppData.collections + Item.collectionIds）。
 * v4 → v5：新增清单（AppData.checklists）—— 活动是一次性的实例，
 *          和作为模板的「活动合集」分开存。
 * v5 → v6：物品状态增加 spare(备用)。这是**校验规则**变了：
 *          老程序读到 `status: 'spare'` 会认不出来，所以让它明确拒绝
 *          整份备份比让它默默把那件物品的备用属性丢掉要好。
 *
 * 升版本号是为了保护老程序：它拿到更高版本的备份会**明确拒绝**并提示升级，
 * 而不是静默把不认识的字段丢掉 —— 静默丢字段是最糟的，用户会以为备份是完整的。
 * 反过来老备份能正常导入新程序，缺的字段按默认值补齐
 * （分类全是顶层、有效期为空、不属于任何活动、没有清单）。
 */
export const SCHEMA_VERSION = 6

/* ------------------------------------------------------------------ */
/* 物品                                                                */
/* ------------------------------------------------------------------ */

/**
 * 物品状态。
 *
 *   active(在用) ──标记闲置──> idle(闲置) ──舍弃──> discarded(已舍弃)
 *        ↑                        │                      │
 *        └───────改回在用─────────┘       恢复 ←─────────┘
 *
 *   spare(备用) 是**另一条支线**，不在这条链上：
 *      active/spare 之间可以互相来回（取用 ⇄ 标记备用），
 *      两边都能被舍弃，舍弃后也都能恢复。
 *
 * ── 为什么备用不复用闲置 ──────────────────────────────────────────
 * 两者都是「现在没在用」，但**意思正好相反**：
 *   · 闲置 = 「留着也没用」，闲置页的框架就是「越久越说明它不该留在这里」
 *   · 备用 = 「特意留着的」，放两年也完全正常
 * 合成一个的话，闲置页会跑去劝你扔掉自己特意囤的东西；
 * 而且「闲置占比」是断舍离的核心指标，把备用算进去会把这个数字弄脏。
 */
export type ItemStatus = 'active' | 'idle' | 'spare' | 'discarded'

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
  /**
   * 所属的活动合集 id（旅行 / 学习 这类）。
   *
   * 和 categoryIds 一样是多对多：充电宝既在「旅行」也在「出差」很正常。
   * 删掉一个活动只会把这里的那一项去掉，**不会删物品**。
   */
  collectionIds: string[]
  /** 稀疏字典：key = AttributeDef.id，只存真正填了值的属性 */
  attrs: Record<string, AttrValue>
  note: string
  createdAt: string
  updatedAt: string
  /** 首次标记闲置的时间，用于计算「已闲置天数」 */
  idleAt: string | null
  /** 舍弃时间，用于回收站排序 */
  discardedAt: string | null
  /**
   * 有效期至，**只有日期**（`2026-03-15`），null = 没设置。
   *
   * 为什么只存日期不存时间点：保质期是日历概念，
   * 「今天到期」如果带上时分秒，过了今天 00:00 就变成「已过期 1 天」，很别扭。
   * 所以全程按本地日期的 00:00 比较。
   *
   * 到期**不会**自动改任何别的字段 —— 过期只是个算出来的状态，
   * 不是数据变更。详见 src/lib/expiry.ts。
   */
  expiresAt: string | null
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
/* 活动合集                                                            */
/* ------------------------------------------------------------------ */

/**
 * 活动合集：回答「要做这件事，需要哪些东西」，如 旅行 / 学习 / 搬家。
 *
 * ── 为什么单独立一个实体，而不是拿标签凑合 ────────────────────────
 * 标签是「情境标记」，回答的是「这件东西对我意味着什么」（想送人、舍不得扔），
 * 一件东西身上挂几个都很自然。活动合集是**一份清单**，回答的是
 * 「为了这件事我要凑齐哪些东西」，它自己是一个可以浏览、可以核对的整体。
 *
 * 混在一起的直接坏处：拿标签当活动的话，「旅行」会和「想送人」并排出现在
 * 标签筛选里，两个完全不同性质的维度被压成一层，越用越乱。
 *
 * ── 为什么用 id 而不是名字（标签是用名字的）─────────────────────
 * 因为活动会被改名，而且改名不该牵动物品。用 id 就只是改一个字段；
 * 用名字的话每次改名都得全表扫一遍把旧名字换掉（标签现在就是这么做的）。
 *
 * ── 和分类的关系 ────────────────────────────────────────────────
 * 一件东西可以同时属于多个活动（充电宝既在「旅行」也在「出差」），
 * 和「一件东西可以属于多个分类」是同一个形状。
 */
export interface Collection {
  id: string
  name: string
  /** 自由备注，例如「三天两夜，爬山」 */
  note: string
  /** 手动排序 */
  order: number
  createdAt: string
}

/* ------------------------------------------------------------------ */
/* 清单（一次性的待办）                                                */
/* ------------------------------------------------------------------ */

/**
 * 清单里的一条。
 *
 * ── 和「活动合集」的分工 ────────────────────────────────────────
 * 活动是**模板**（长期）：旅行要带的东西攒一次，以后每次出门都能用。
 * 清单是**本次的实例**（临时）：这一次真要带哪些、打包了没、用完就删。
 *
 * ── 为什么名字 / 数量是**快照**，而不是每次都去查物品 ────────────
 * 清单是「临时的、看完就扔」的东西，它得**自己站得住**：
 *   · 物品后来改了名，清单上还是当时那个名字，这才对（那是当时的决定）
 *   · 物品被删了，清单也不该变成一行空白
 * 而且清单里可以放**库里没有的东西**（顺路买瓶水、借个充电器），
 * 那些条目根本没有 itemId 可查。
 *
 * `itemId` 只是留个链接，用来跳回物品页 —— 它可能是已经删掉的 id，
 * 所以取用前一定要判存在，不能假设它有效。
 */
export interface ChecklistEntry {
  id: string
  /** 关联的物品 id；null = 清单里临时加的，库里没有这件东西 */
  itemId: string | null
  /** 当时的名字（快照，不随后续改名而变） */
  name: string
  quantity: number
  /** 打包/办好了没 */
  checked: boolean
}

/**
 * 一份清单。
 *
 * 它是**可以随便删的** —— 这正是它和活动合集最大的区别：
 * 活动删了要心疼（那份模板是你慢慢攒的），清单删了就删了，本来就是为了这一次。
 */
export interface Checklist {
  id: string
  name: string
  /**
   * 从哪个活动生成的。**只是记个来源**，用来在界面上写「来自「旅行」」；
   * 活动后来被删掉也不影响这份清单（所以它可能指向一个不存在的活动）。
   */
  fromCollectionId: string | null
  entries: ChecklistEntry[]
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
  /** 活动合集（旅行 / 学习 这类） */
  collections: Collection[]
  /** 清单（一次性的待办，可打钩、可删） */
  checklists: Checklist[]
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
    collections: number
    checklists: number
  }
  data: {
    items: Item[]
    categories: Category[]
    locations: Location[]
    attributeDefs: AttributeDef[]
    tags: Tag[]
    collections: Collection[]
    checklists: Checklist[]
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
  collections: { added: number; updated: number }
  /** 清单是按 id 去重、较新的整份覆盖，所以只有这两个数 */
  checklists: { added: number; kept: number }
  /** 合并时因引用缺失而自动补建的位置（给人看的提示） */
  warnings: string[]
}

/* ------------------------------------------------------------------ */
/* 界面偏好（存 localStorage，丢了也无所谓）                            */
/* ------------------------------------------------------------------ */

export type GroupBy = 'none' | 'category' | 'location' | 'status' | 'tag' | 'expiry'
export type SortBy = 'updated' | 'created' | 'name' | 'quantity' | 'location' | 'expiry'
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
  /**
   * 还剩几天算「即将过期」，默认 30。
   *
   * 不同的东西这个数差别很大：鲜奶是 3 天，化妆品是半年。
   * 所以做成可调的，而不是我替你定死。存 localStorage，跟着这台设备走。
   */
  expirySoonDays: number
  /** 有效期页：是否把「还没到期、也不紧急」的也列出来 */
  expiryShowLater: boolean
  /**
   * 物品列表里默认不展示「闲置」的东西，默认 **开**。
   *
   * 为什么默认开：很多人把闲置当成「备用」在用 —— 特意留着的替换品，
   * 统一收在一个盒子里，平时不想在日常清单里看到它们。
   *
   * 三个边界，都是刻意的：
   *   · **只影响物品列表**。概览和位置页照常统计 ——
   *     否则「列表 30 件、概览 34 件」，你会开始怀疑哪个数字是真的
   *   · **用户主动按状态筛选时不藏**。他点了「闲置」那个筛选，就是想看
   *   · **必须有提示条**。悄悄藏数据是最糟的结果，藏了多少、去哪看要一眼看得到
   */
  hideIdle: boolean
  /**
   * 物品列表里默认不展示「备用」的东西，默认 **开**。
   *
   * 和 hideIdle 是同一个道理，但**必须分开两个开关**：
   * 「闲置不该出现在日常清单里」和「备用不该出现在日常清单里」
   * 是两种不同的判断，有人只想要其中一个。
   *
   * 边界和 hideIdle 完全一致：只影响物品列表、主动筛选时不藏、必须有提示条。
   */
  hideSpare: boolean
  /**
   * 拆出备用时，新那条备用默认放进哪个位置，默认 null（未归位）。
   *
   * 为什么值得单独记一个偏好：备用基本都是**收在一个盒子里的**
   * （用户原话：「我一般就把备用的统一放在一个盒子里」）。
   * 每拆一次都要重新选一遍那个盒子，纯属白费事 ——
   * 所以第一次选完就记住，下次自动填上，但**每次都还能改**。
   */
  spareLocationId: string | null
}

export const EXPIRY_SOON_DEFAULT_DAYS = 30

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
  expirySoonDays: EXPIRY_SOON_DEFAULT_DAYS,
  expiryShowLater: false,
  hideIdle: true,
  hideSpare: true,
  spareLocationId: null,
}
