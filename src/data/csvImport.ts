/**
 * 从 CSV 物品清单里恢复数据。
 *
 * ── 为什么要有这个 ───────────────────────────────────────────────
 * CSV 本来是**只能看、不能拿来恢复**的（`exportCsv.ts` 顶部写着理由）。
 * 但真实情况是：有人手里只剩下这一份 CSV 了。
 * 那时候「格式不完整」和「数据全没了」之间，前者显然好得多 ——
 * 所以补上这条路，但**必须在界面上说清它补不回什么**。
 *
 * ── 设计：CSV → 一份完整的 AppData → 复用现有的导入流程 ──────────
 * 这是整个模块最要紧的决定。转换出来的是**标准 AppData**，
 * 于是快照、预览、覆盖/合并、悬空引用修复、导入报告全部自动继承，
 * 不需要为 CSV 另起一套写入口。
 *
 * 所以这个文件是**纯函数**：进字符串、出一份数据 + 说明，
 * 不碰 store、不碰 IndexedDB、不弹任何东西。因此也特别好测。
 *
 * ── 补不回来的东西（会在界面上如实列出）────────────────────────
 *   · **活动合集**：CSV 里完全没有这一列
 *   · **清单**：同上
 *   · **分类的层级**：CSV 只写分类**名字**，父子关系丢了；
 *     而且多个分类是用「 / 」拼的，所以「化妆品 / 修容」到底是
 *     两条分类还是一层路径，**从文件里读不出来** —— 这里按「两条分类」处理
 *   · **属性定义的类型**：CSV 只有值，没有类型 / 选项 / 是否默认勾选，
 *     一律按文本建，单位从表头的括号里取
 *   · 物品 id（重新生成）、闲置/舍弃的具体时间点
 */

import type {
  AppData,
  AttributeDef,
  Category,
  Item,
  ItemStatus,
  Location,
  Tag,
} from '../types'
import { SCHEMA_VERSION } from '../types'
import { normalizeExpiryDate } from '../lib/expiry'
import { uid } from '../lib/id'
import { statusFromWords } from '../lib/statusWords'
import { t, tc } from '../i18n'

/* ------------------------------------------------------------------ */
/* CSV 解析（RFC 4180）                                                */
/* ------------------------------------------------------------------ */

/**
 * 把 CSV 文本切成二维数组。
 *
 * 手写而不是引依赖：整个项目只有 4 个运行时依赖，而这里要处理的规则其实很少
 * （引号包裹、引号内逗号、引号内换行、引号转义、CRLF）。
 * 引依赖的代价比这段代码大。
 */
export function parseCsv(text: string): string[][] {
  // 导出的文件带 BOM（给 Excel 认 UTF-8 用的），先去掉，否则第一个表头会多一个字符
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text

  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false
  let i = 0

  const endCell = () => {
    row.push(cell)
    cell = ''
  }
  const endRow = () => {
    endCell()
    rows.push(row)
    row = []
  }

  while (i < src.length) {
    const ch = src[i] as string

    if (inQuotes) {
      if (ch === '"') {
        // 连着两个引号 = 一个字面引号
        if (src[i + 1] === '"') {
          cell += '"'
          i += 2
          continue
        }
        inQuotes = false
        i += 1
        continue
      }
      cell += ch
      i += 1
      continue
    }

    if (ch === '"') {
      inQuotes = true
      i += 1
      continue
    }
    if (ch === ',') {
      endCell()
      i += 1
      continue
    }
    if (ch === '\r') {
      // CRLF 和单独的 CR 都当换行
      endRow()
      i += src[i + 1] === '\n' ? 2 : 1
      continue
    }
    if (ch === '\n') {
      endRow()
      i += 1
      continue
    }

    cell += ch
    i += 1
  }

  // 收尾：最后一行可能没有换行符
  if (cell !== '' || row.length > 0) endRow()

  // 丢掉完全空白的行（Excel 存盘时经常在末尾留一行）
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

/* ------------------------------------------------------------------ */
/* 表头                                                                */
/* ------------------------------------------------------------------ */

type ColumnKey =
  | 'name'
  | 'quantity'
  | 'status'
  | 'expiresAt'
  | 'categories'
  | 'location'
  | 'tags'
  | 'note'
  | 'createdAt'
  | 'updatedAt'

/**
 * 表头 → 字段。
 *
 * 中英都要认：CSV 是**导出时按当时的界面语言**写的表头，
 * 所以英文界面导出来的文件表头是 Name / Quantity / …
 * 另外留了几个常见变体，因为用户可能自己用 Excel 加过列。
 */
const HEADER_ALIASES: Record<string, ColumnKey> = {
  // 中文（导出时的原文）
  名称: 'name',
  数量: 'quantity',
  状态: 'status',
  有效期至: 'expiresAt',
  分类: 'categories',
  位置: 'location',
  标签: 'tags',
  备注: 'note',
  创建时间: 'createdAt',
  最后修改: 'updatedAt',
  // 英文
  name: 'name',
  quantity: 'quantity',
  qty: 'quantity',
  status: 'status',
  expires: 'expiresAt',
  expiry: 'expiresAt',
  'expires at': 'expiresAt',
  categories: 'categories',
  category: 'categories',
  place: 'location',
  location: 'location',
  tags: 'tags',
  tag: 'tags',
  note: 'note',
  notes: 'note',
  created: 'createdAt',
  'created at': 'createdAt',
  'last updated': 'updatedAt',
  updated: 'updatedAt',
}

function normalizeHeader(raw: string): string {
  return raw.replace(/^\ufeff/, '').trim().replace(/\s+/g, ' ').toLowerCase()
}

/** 表头里可能带单位，如「价格(元)」「Length (cm)」—— 拆出来 */
function splitUnit(header: string): { name: string; unit: string } {
  const m = /^(.*?)\s*[(（]([^)）]*)[)）]\s*$/.exec(header.trim())
  if (m === null) return { name: header.trim(), unit: '' }
  const name = (m[1] ?? '').trim()
  const unit = (m[2] ?? '').trim()
  // 「(元)」这种才算单位；表头整体是括号里的东西时不拆
  if (name === '') return { name: header.trim(), unit: '' }
  return { name, unit }
}

/* ------------------------------------------------------------------ */
/* 时间                                                                */
/* ------------------------------------------------------------------ */

/**
 * 把导出时写的「2026-10-02 20:30」还原成 ISO。
 *
 * 导出用的是 `formatDateTime`，格式就是 `YYYY-MM-DD HH:mm`。
 * 认不出来就用兜底值 —— **不要瞎猜一个时间**（那会让「最近修改」排序失真），
 * 直接用现在的时刻，同时让调用方记一条说明。
 */
function parseDateTime(value: string, fallback: string): string {
  const text = value.trim()
  if (text === '') return fallback

  const m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(text)
  if (m === null) return fallback

  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  const hour = m[4] === undefined ? 0 : Number(m[4])
  const minute = m[5] === undefined ? 0 : Number(m[5])
  const second = m[6] === undefined ? 0 : Number(m[6])
  if (month < 1 || month > 12 || day < 1 || day > 31) return fallback

  // 按**本地时间**构造，因为导出时写的也是本地时间
  const d = new Date(year, month - 1, day, hour, minute, second)
  if (Number.isNaN(d.getTime())) return fallback
  return d.toISOString()
}

/* ------------------------------------------------------------------ */
/* 转换                                                                */
/* ------------------------------------------------------------------ */

export interface CsvImportStats {
  items: number
  /** 因为没有名称被跳过的行数 */
  skipped: number
  categories: number
  locations: number
  attributes: number
  tags: number
}

export interface CsvImportSuccess {
  ok: true
  data: AppData
  /** 界面上必须原样展示：这份文件补不回什么 */
  warnings: string[]
  stats: CsvImportStats
  /** 文件里物品最多的那一行的时间，用来当导出的「时间点」 */
  exportedAt: string | null
}

export interface CsvImportFailure {
  ok: false
  error: string
}

export type CsvImportOutcome = CsvImportSuccess | CsvImportFailure

/** 判断一段文本像不像 CSV（而不是 JSON） */
export function looksLikeCsv(text: string): boolean {
  const head = text.replace(/^\ufeff/, '').trimStart()
  if (head.startsWith('{') || head.startsWith('[')) return false
  const firstLine = head.split(/\r?\n/, 1)[0] ?? ''
  return firstLine.includes(',')
}

/**
 * 把 CSV 物品清单转成一份完整的 AppData。
 *
 * 纯函数：不碰 store、不碰 IndexedDB。
 */
export function parseCsvToAppData(text: string): CsvImportOutcome {
  const rows = parseCsv(text)
  if (rows.length === 0) return { ok: false, error: t('data.csv.empty') }

  const headerRow = rows[0] as string[]
  const body = rows.slice(1)

  // 表头 → 列下标；认不出来的列当作属性列
  const columns = new Map<number, ColumnKey>()
  const attrColumns: Array<{ index: number; name: string; unit: string }> = []

  headerRow.forEach((raw, index) => {
    const key = HEADER_ALIASES[normalizeHeader(raw)]
    if (key !== undefined) {
      // 同一个字段出现两次时只认第一个，避免后面的空列把前面的冲掉
      if (![...columns.values()].includes(key)) columns.set(index, key)
      return
    }
    const header = raw.trim()
    if (header === '') return
    const { name, unit } = splitUnit(header)
    if (name === '') return
    attrColumns.push({ index, name, unit })
  })

  const indexOf = (key: ColumnKey): number => {
    for (const [index, value] of columns) if (value === key) return index
    return -1
  }

  const nameIndex = indexOf('name')
  if (nameIndex === -1) {
    return { ok: false, error: t('data.csv.noNameColumn') }
  }

  const cell = (row: string[], index: number): string =>
    index === -1 ? '' : ((row[index] ?? '') as string).trim()

  const now = new Date().toISOString()

  /* ---------------- 先建受控词表 ---------------- */

  const categories: Category[] = []
  const categoryByName = new Map<string, string>()

  const locations: Location[] = []
  /** 位置路径（'家/卧室'）→ id */
  const locationByPath = new Map<string, string>()

  const attributeDefs: AttributeDef[] = []
  const attrsByName = new Map<string, AttributeDef>()
  attrColumns.forEach((column, order) => {
    const existing = attrsByName.get(column.name)
    if (existing !== undefined) return
    const def: AttributeDef = {
      id: uid(),
      name: column.name,
      // CSV 里只有值，没有类型 —— 一律按文本建，别猜
      type: 'text',
      options: [],
      unit: column.unit,
      showByDefault: false,
      order,
      createdAt: now,
    }
    attributeDefs.push(def)
    attrsByName.set(column.name, def)
  })

  const tags: Tag[] = []
  const tagNames = new Set<string>()

  /* ---------------- 逐行转换 ---------------- */

  const items: Item[] = []
  let skipped = 0
  let latestUpdate = ''

  for (const row of body) {
    const name = (row[nameIndex] ?? '').trim()
    if (name === '') {
      skipped++
      continue
    }

    // 分类：CSV 里是**分类名用「 / 」拼起来的**。
    // 按「多条顶层分类」处理 —— 层级信息在导出时就丢了，这里补不回来。
    const categoryIds: string[] = []
    for (const rawName of cell(row, indexOf('categories')).split(' / ')) {
      const categoryName = rawName.trim()
      if (categoryName === '') continue
      let id = categoryByName.get(categoryName)
      if (id === undefined) {
        const created: Category = {
          id: uid(),
          name: categoryName,
          parentId: null,
          order: categories.length,
          createdAt: now,
        }
        categories.push(created)
        categoryByName.set(categoryName, created.id)
        id = created.id
      }
      if (!categoryIds.includes(id)) categoryIds.push(id)
    }

    // 位置：这一列是**完整路径**（导出用的是 pathString），所以能逐层还原
    const locationText = cell(row, indexOf('location'))
    let locationId: string | null = null
    const isUnassigned =
      locationText === '' ||
      locationText === t('status.unassigned') ||
      locationText === 'No place'
    if (!isUnassigned) {
      const parts = locationText
        .split(' / ')
        .map((p) => p.trim())
        .filter((p) => p !== '')
      let parentId: string | null = null
      let path = ''
      for (const part of parts) {
        path = path === '' ? part : `${path}/${part}`
        let id = locationByPath.get(path)
        if (id === undefined) {
          const created: Location = {
            id: uid(),
            name: part,
            parentId,
            order: locations.filter((l) => l.parentId === parentId).length,
            note: '',
            createdAt: now,
          }
          locations.push(created)
          locationByPath.set(path, created.id)
          id = created.id
        }
        parentId = id
      }
      locationId = parentId
    }

    // 状态：导出写的是界面上的词（在用/闲置/备用/已舍弃），认不出来就当在用
    const status: ItemStatus = statusFromWords(cell(row, indexOf('status'))) ?? 'active'

    // 标签：导出时用「 / 」拼的
    const rowTags: string[] = []
    for (const rawTag of cell(row, indexOf('tags')).split(' / ')) {
      const tagName = rawTag.trim()
      if (tagName === '') continue
      if (!tagNames.has(tagName)) {
        tagNames.add(tagName)
        tags.push({ name: tagName, createdAt: now })
      }
      if (!rowTags.includes(tagName)) rowTags.push(tagName)
    }

    const attrs: Record<string, string> = {}
    for (const column of attrColumns) {
      const def = attrsByName.get(column.name)
      if (def === undefined) continue
      const value = (row[column.index] ?? '').trim()
      // 空单元格不写进去 —— 属性是稀疏字典
      if (value !== '') attrs[def.id] = value
    }

    const createdAt = parseDateTime(cell(row, indexOf('createdAt')), now)
    const updatedAt = parseDateTime(cell(row, indexOf('updatedAt')), createdAt)
    if (updatedAt > latestUpdate) latestUpdate = updatedAt

    const quantityRaw = cell(row, indexOf('quantity'))
    const quantity = Math.max(1, Math.round(Number(quantityRaw) || 1))

    items.push({
      id: uid(),
      name,
      quantity,
      categoryIds,
      locationId,
      status,
      tags: rowTags,
      attrs,
      note: cell(row, indexOf('note')),
      collectionIds: [],
      createdAt,
      updatedAt,
      // 闲置/舍弃的具体时间点在 CSV 里没有，只能给一个近似值：
      // 用最后修改时间，至少「闲置了多久」不会算成 0 天
      idleAt: status === 'idle' ? updatedAt : null,
      discardedAt: status === 'discarded' ? updatedAt : null,
      expiresAt: normalizeExpiryDate(cell(row, indexOf('expiresAt'))),
    })
  }

  if (items.length === 0) {
    return { ok: false, error: t('data.csv.noItems') }
  }

  /* ---------------- 说明：补不回什么 ---------------- */

  const warnings: string[] = [
    t('data.csv.warnNotABackup'),
    t('data.csv.warnCollections'),
    t('data.csv.warnLists'),
    t('data.csv.warnCategoryTree'),
    t('data.csv.warnAttrTypes'),
  ]
  if (skipped > 0) warnings.push(tc(skipped, 'data.csv.warnSkipped'))

  return {
    ok: true,
    data: {
      schemaVersion: SCHEMA_VERSION,
      items,
      categories,
      locations,
      attributeDefs,
      tags,
      // CSV 里没有这两样，只能是空的 —— 界面上会说清楚
      collections: [],
      checklists: [],
      updatedAt: latestUpdate === '' ? now : latestUpdate,
    },
    warnings,
    stats: {
      items: items.length,
      skipped,
      categories: categories.length,
      locations: locations.length,
      attributes: attributeDefs.length,
      tags: tags.length,
    },
    exportedAt: latestUpdate === '' ? null : latestUpdate,
  }
}
