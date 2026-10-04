/**
 * 生成人工验收测试用的示例数据。
 *
 * 关键点：**用真实的导出代码生成，再用真实的导入校验代码读回来对比**。
 * 这样交到用户手里的文件一定能被导入 —— 而不是"我手工写了个 JSON 看起来差不多"。
 *
 * 数据刻意覆盖了各种情况：闲置（且闲置时长各不相同，方便验证排序）、
 * 未归位、未分类、已舍弃、多分类、带标签、带属性值。
 */

import { buildExportFile } from '../src/data/exportJson'
import { parseExportFile } from '../src/data/validate'
import { createSeedData } from '../src/storage/seed'
import type {
  AppData,
  AttrValue,
  Category,
  Checklist,
  Collection,
  Item,
  ItemStatus,
} from '../src/types'

const DAY = 24 * 60 * 60 * 1000

function daysAgo(days: number): string {
  return new Date(Date.now() - days * DAY).toISOString()
}

/** 有效期是纯日期（YYYY-MM-DD），按本地日算，好让「还有 N 天」符合直觉 */
function daysFromNow(days: number): string {
  const d = new Date(Date.now() + days * DAY)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * 种子里只有 10 个扁平分类。这里再补一棵小的分类树，
 * 好让示例数据能演示「分类也支持不限层级」这件事。
 * parent 为 null 表示顶层。
 */
const EXTRA_CATEGORIES: Array<{ name: string; parent: string | null }> = [
  { name: '化妆品', parent: null },
  { name: '眼妆', parent: '化妆品' },
  { name: '唇妆', parent: '化妆品' },
  { name: '护肤', parent: '化妆品' },
  { name: '底妆', parent: '化妆品' },
  { name: '数码配件', parent: null },
  { name: '数据线', parent: '数码配件' },
]

/* ------------------------------------------------------------------ */
/* 活动合集（示例数据用）                                              */
/* ------------------------------------------------------------------ */

const SAMPLE_COLLECTIONS = ['旅行', '学习', '搬家']

interface Spec {
  name: string
  quantity?: number
  /** 分类**名称路径**，例如 '化妆品/眼妆' 或 '衣物' */
  categories?: string[]
  location?: string
  status?: ItemStatus
  idleDays?: number
  tags?: string[]
  attrs?: Record<string, string | number>
  note?: string
  /** 有效期还有几天。负数表示已经过期了。不填 = 没设置有效期 */
  expiresInDays?: number
  /** 所属活动合集的**名字**（SAMPLE_COLLECTIONS 里的） */
  collections?: string[]
}

/**
 * 物品清单。location 用「父/子」这样的名字路径表示，
 * 找不到就当未归位 —— 生成时会如实报告，避免我写错名字还不知道。
 */
const ITEMS: Spec[] = [
  // ---- 衣物 ----
  {
    name: '灰色羊毛衫',
    categories: ['衣物'],
    location: '卧室/衣柜',
    tags: ['舍不得扔'],
    attrs: { 品牌: 'MUJI', 颜色: '灰' },
    note: '妈妈送的，起球了但还能穿',
  },
  { name: '牛仔裤', quantity: 2, categories: ['衣物'], location: '卧室/衣柜', attrs: { 颜色: '彩色' } },
  { name: '羽绒服', categories: ['衣物'], location: '卧室/衣柜', attrs: { 品牌: '优衣库', 购入日期: '2022-11-20' } },

  // ---- 电子 ----
  {
    name: '旧手机',
    categories: ['电子'],
    location: '卧室/床头柜',
    status: 'idle',
    idleDays: 420,
    tags: ['想送人'],
    note: '屏幕有划痕，还能开机',
  },
  { name: '蓝牙耳机', categories: ['电子'], location: '书房/书桌', attrs: { 品牌: '索尼', 价格: 899 } },
  {
    name: '充电宝',
    categories: ['电子'],
    location: '书房/书桌',
    status: 'idle',
    idleDays: 190,
    attrs: { 价格: 129 },
  },
  { name: '台灯', categories: ['电子'], location: '书房/书桌', attrs: { 品牌: '小米', 价格: 199 } },

  // ---- 书籍 ----
  { name: '《人类简史》', categories: ['书籍'], location: '书房/书架', attrs: { 购入日期: '2021-06-01' }, collections: ['学习'] },
  { name: '《设计中的设计》', categories: ['书籍'], location: '书房/书架' },

  // ---- 厨房 ----
  { name: '平底锅', categories: ['厨房'], location: '厨房/橱柜', attrs: { 价格: 199 } },
  { name: '电饭煲', categories: ['厨房'], location: '厨房/橱柜', attrs: { 品牌: '美的', 价格: 399 }, expiresInDays: 900 },
  { name: '保温杯', categories: ['日用品'], location: '厨房/橱柜', status: 'idle', idleDays: 95, attrs: { 颜色: '黑' } },

  // ---- 日用品 / 药品（未归位，用来验证「未归位」这个视角） ----
  { name: '洗发水', categories: ['日用品'], expiresInDays: 20 },
  { name: '感冒药', categories: ['药品'], attrs: { 购入日期: '2024-12-01' }, expiresInDays: 45 },
  { name: '创可贴', categories: ['药品'], status: 'idle', idleDays: 300, expiresInDays: -200 },

  // ---- 文具 / 工具 ----
  { name: '中性笔', quantity: 5, categories: ['文具'], location: '书房/书桌', collections: ['学习'] },
  { name: '螺丝刀套装', categories: ['工具'], location: '储物间/收纳箱', attrs: { 品牌: '博世' } },
  { name: '锤子', categories: ['工具'], location: '储物间/收纳箱' },

  // ---- 纪念品 ----
  {
    name: '演唱会门票存根',
    categories: ['纪念品'],
    location: '储物间/收纳箱',
    tags: ['舍不得扔'],
    note: '2019 年那场',
  },
  { name: '老照片', categories: ['纪念品'], location: '储物间/收纳箱', status: 'idle', idleDays: 500 },

  // ---- 边界情况 ----
  { name: '折叠椅', location: '阳台', note: '还没想好归到哪一类', collections: ['旅行'] }, // 未分类 + 属于活动
  { name: '户外帐篷', categories: ['工具', '纪念品'], location: '储物间/货架', attrs: { 价格: 680 }, collections: ['旅行'] }, // 多分类 + 活动
  { name: '旧拖鞋', categories: ['日用品'], status: 'discarded', note: '已经扔了，留个记录' }, // 进回收站
  { name: '只剩一只的手套', categories: ['衣物'], status: 'idle', idleDays: 620, tags: ['想送人'] },

  // ---- 多级分类：化妆品 › 眼妆 / 唇妆 / 护肤 / 底妆 ----
  { name: '大地色眼影盘', categories: ['化妆品/眼妆'], attrs: { 品牌: '某品牌', 价格: 268 }, note: '用了两年，还剩一半' },
  { name: '睫毛膏', categories: ['化妆品/眼妆'], attrs: { 价格: 89 }, expiresInDays: -30 },
  { name: '正红色口红', categories: ['化妆品/唇妆'], attrs: { 品牌: 'MAC', 价格: 190 } },
  { name: '润唇膏', categories: ['化妆品/唇妆'], attrs: { 价格: 39 }, expiresInDays: 7 },
  { name: '保湿面霜', categories: ['化妆品/护肤'], status: 'idle', idleDays: 150, attrs: { 价格: 320 }, note: '开了没用完', expiresInDays: 12 },
  { name: '粉底液', categories: ['化妆品/底妆'], attrs: { 价格: 450 } },
  { name: '化妆包', categories: ['化妆品'], note: '挂在中间层 —— 它算不上眼妆也算不上唇妆' },

  // ---- 多级分类：数码配件 › 数据线 ----
  { name: 'USB-C 数据线', quantity: 3, categories: ['数码配件/数据线'], location: '书房/书桌', attrs: { 价格: 29 }, collections: ['旅行', '学习'] },
  { name: 'Lightning 数据线', categories: ['数码配件/数据线'], location: '书房/书桌', status: 'idle', idleDays: 260 },
]

export interface SampleBackupResult {
  json: string
  itemCount: number
  warnings: string[]
}

export function buildSampleBackup(): SampleBackupResult {
  const seed = createSeedData()
  const warnings: string[] = []
  const now = new Date().toISOString()

  /* ---------------- 先补出多级分类 ---------------- */

  const categories: Category[] = seed.categories.map((c) => ({ ...c }))
  const idByPath = new Map<string, string>()

  /** 算出某个分类的完整名称路径 */
  const pathOf = (id: string): string[] => {
    const names: string[] = []
    const seen = new Set<string>()
    let current = categories.find((c) => c.id === id)
    while (current && !seen.has(current.id)) {
      seen.add(current.id)
      names.unshift(current.name)
      const parentId: string | null = current.parentId
      current = parentId ? categories.find((c) => c.id === parentId) : undefined
    }
    return names
  }

  const rebuildIndex = () => {
    idByPath.clear()
    for (const category of categories) idByPath.set(pathOf(category.id).join('/'), category.id)
  }
  rebuildIndex()

  for (const spec of EXTRA_CATEGORIES) {
    const parentId = spec.parent ? idByPath.get(spec.parent) : null
    if (spec.parent && !parentId) {
      warnings.push(`分类「${spec.parent}」不存在，已跳过子分类「${spec.name}」`)
      continue
    }

    const path = spec.parent ? `${spec.parent}/${spec.name}` : spec.name
    if (idByPath.has(path)) continue

    categories.push({
      id: `sample-cat-${path.replace(/\//g, '-')}`,
      name: spec.name,
      parentId: parentId ?? null,
      order: categories.filter((c) => (c.parentId ?? null) === (parentId ?? null)).length,
      createdAt: now,
    })
    rebuildIndex()
  }

  /*
   * 活动合集：示例数据里给两个，好让「活动」页一导入就有东西可看。
   *
   * 种子数据（首次启动那套脚手架）里**故意不放**这些东西 ——
   * 给不旅行的人塞一个「旅行」只是噪音。但示例数据是**演示用**的，
   * 该把功能的用法直接摆出来。
   */
  const collections: Collection[] = SAMPLE_COLLECTIONS.map((name, index) => ({
    id: `sample-collection-${index + 1}`,
    name,
    note: '',
    order: index,
    createdAt: now,
  }))

  /* ---------------- 再解析物品里的引用 ---------------- */

  /** 按名称路径找分类，例如 '化妆品/眼妆' */
  const categoryId = (path: string): string | null => {
    const key = path
      .split('/')
      .map((part) => part.trim())
      .filter(Boolean)
      .join('/')
    const found = idByPath.get(key)
    if (!found) {
      warnings.push(`分类「${path}」找不到，该物品会变成未分类`)
      return null
    }
    return found
  }

  /** 算出一个位置的完整名称路径，例如 ['家','卧室','衣柜'] */
  const fullPathOf = (id: string): string[] => {
    const names: string[] = []
    const seen = new Set<string>()
    let current = seed.locations.find((l) => l.id === id)
    while (current && !seen.has(current.id)) {
      seen.add(current.id)
      names.unshift(current.name)
      const parentId: string | null = current.parentId
      current = parentId ? seed.locations.find((l) => l.id === parentId) : undefined
    }
    return names
  }

  /**
   * 按名称路径找位置，**允许只写后半段**：
   * 写「卧室/衣柜」也能对上完整路径「家/卧室/衣柜」。
   * 匹配到多个就报歧义，绝不随便挑一个。
   */
  const locationId = (path: string): string | null => {
    const wanted = path
      .split('/')
      .map((part) => part.trim())
      .filter(Boolean)

    const matches = seed.locations.filter((location) => {
      const full = fullPathOf(location.id)
      if (full.length < wanted.length) return false
      const tail = full.slice(full.length - wanted.length)
      return tail.every((name, index) => name === wanted[index])
    })

    if (matches.length === 1) return matches[0].id
    if (matches.length === 0) {
      warnings.push(`位置「${path}」在种子里找不到，该物品会变成未归位`)
    } else {
      warnings.push(
        `位置「${path}」匹配到 ${matches.length} 个节点（有歧义），该物品会变成未归位`,
      )
    }
    return null
  }

  const attributeId = (name: string): string | null => {
    const found = seed.attributeDefs.find((d) => d.name === name)
    if (!found) {
      warnings.push(`属性「${name}」在种子里不存在，已忽略`)
      return null
    }
    return found.id
  }

  const collectionId = (name: string): string | null => {
    const found = collections.find((c) => c.name === name)
    if (!found) {
      warnings.push(`活动「${name}」在示例数据里没定义，已忽略`)
      return null
    }
    return found.id
  }

  const items: Item[] = ITEMS.map((spec, index) => {
    const createdAt = daysAgo(ITEMS.length - index + 1)
    const status: ItemStatus = spec.status ?? 'active'

    const attrs: Record<string, AttrValue> = {}
    for (const [name, value] of Object.entries(spec.attrs ?? {})) {
      const id = attributeId(name)
      if (id) attrs[id] = value
    }

    return {
      id: `sample-item-${String(index + 1).padStart(2, '0')}`,
      name: spec.name,
      quantity: spec.quantity ?? 1,
      categoryIds: (spec.categories ?? [])
        .map(categoryId)
        .filter((id): id is string => id !== null),
      locationId: spec.location ? locationId(spec.location) : null,
      status,
      tags: spec.tags ?? [],
      attrs,
      note: spec.note ?? '',
      collectionIds: (spec.collections ?? [])
        .map(collectionId)
        .filter((id): id is string => id !== null),
      createdAt,
      updatedAt: createdAt,
      idleAt: status === 'idle' ? daysAgo(spec.idleDays ?? 30) : null,
      discardedAt: status === 'discarded' ? daysAgo(3) : null,
      // 示例数据里刻意留几件带有效期的，好让「有效期」页一导入就有内容可看
      expiresAt: spec.expiresInDays === undefined ? null : daysFromNow(spec.expiresInDays),
    }
  })

  /*
   * 清单：给一份演示用的。
   *
   * 内容是**从「旅行」抄一份快照** —— 正好演示清单和活动的分工：
   * 活动是模板（长期攒的），清单是这次的实例（打钩、用完就删）。
   * 刻意只勾上一部分，好让进度条不是 0% 也不是 100%。
   * 另外放一条库里没有的，演示「顺路要买的可以直接写进来」。
   */
  const travelCollection = collections.find((c) => c.name === '旅行')
  const travelItems =
    travelCollection === undefined
      ? []
      : items.filter((it) => it.collectionIds.includes(travelCollection.id))

  const checklists: Checklist[] =
    travelCollection === undefined
      ? []
      : [
          {
            id: 'sample-checklist-1',
            name: '周末露营',
            fromCollectionId: travelCollection.id,
            createdAt: now,
            entries: [
              ...travelItems.map((entry, index) => ({
                id: `sample-entry-${index + 1}`,
                itemId: entry.id,
                name: entry.name,
                quantity: entry.quantity,
                checked: index === 0,
              })),
              {
                id: 'sample-entry-buy',
                itemId: null,
                name: '顺路买瓶水',
                quantity: 2,
                checked: false,
              },
            ],
          },
        ]

  const data: AppData = { ...seed, categories, collections, checklists, items }

  // 生成之后立刻用真实的导入校验读回来对比 —— 不通过就说明这份示例数据是坏的，
  // 宁可当场炸掉，也不要把一个导不进去的文件交给用户。
  const json = JSON.stringify(buildExportFile(data), null, 2)
  const parsed = parseExportFile(json)
  if (!parsed.ok) {
    throw new Error(`生成的示例数据无法被导入：${parsed.error}`)
  }
  if (parsed.data.items.length !== items.length) {
    throw new Error(
      `往返后物品数量对不上：生成 ${items.length} 条，读回来 ${parsed.data.items.length} 条`,
    )
  }
  for (const warning of parsed.warnings) warnings.push(`导入校验提示：${warning}`)

  return { json, itemCount: items.length, warnings }
}
