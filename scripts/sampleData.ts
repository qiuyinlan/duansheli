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
import type { AppData, AttrValue, Item, ItemStatus } from '../src/types'

const DAY = 24 * 60 * 60 * 1000

function daysAgo(days: number): string {
  return new Date(Date.now() - days * DAY).toISOString()
}

interface Spec {
  name: string
  quantity?: number
  categories?: string[]
  location?: string
  status?: ItemStatus
  idleDays?: number
  tags?: string[]
  attrs?: Record<string, string | number>
  note?: string
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
  { name: '《人类简史》', categories: ['书籍'], location: '书房/书架', attrs: { 购入日期: '2021-06-01' } },
  { name: '《设计中的设计》', categories: ['书籍'], location: '书房/书架' },

  // ---- 厨房 ----
  { name: '平底锅', categories: ['厨房'], location: '厨房/橱柜', attrs: { 价格: 199 } },
  { name: '电饭煲', categories: ['厨房'], location: '厨房/橱柜', attrs: { 品牌: '美的', 价格: 399 } },
  { name: '保温杯', categories: ['日用品'], location: '厨房/橱柜', status: 'idle', idleDays: 95, attrs: { 颜色: '黑' } },

  // ---- 日用品 / 药品（未归位，用来验证「未归位」这个视角） ----
  { name: '洗发水', categories: ['日用品'] },
  { name: '感冒药', categories: ['药品'], attrs: { 购入日期: '2024-12-01' } },
  { name: '创可贴', categories: ['药品'], status: 'idle', idleDays: 300 },

  // ---- 文具 / 工具 ----
  { name: '中性笔', quantity: 5, categories: ['文具'], location: '书房/书桌' },
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
  { name: '折叠椅', location: '阳台', note: '还没想好归到哪一类' }, // 未分类
  { name: '户外帐篷', categories: ['工具', '纪念品'], location: '储物间/货架', attrs: { 价格: 680 } }, // 多分类
  { name: '旧拖鞋', categories: ['日用品'], status: 'discarded', note: '已经扔了，留个记录' }, // 进回收站
  { name: '只剩一只的手套', categories: ['衣物'], status: 'idle', idleDays: 620, tags: ['想送人'] },
]

export interface SampleBackupResult {
  json: string
  itemCount: number
  warnings: string[]
}

export function buildSampleBackup(): SampleBackupResult {
  const seed = createSeedData()
  const warnings: string[] = []

  const categoryId = (name: string): string | null => {
    const found = seed.categories.find((c) => c.name === name)
    if (!found) {
      warnings.push(`分类「${name}」在种子里不存在，已忽略`)
      return null
    }
    return found.id
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
      createdAt,
      updatedAt: createdAt,
      idleAt: status === 'idle' ? daysAgo(spec.idleDays ?? 30) : null,
      discardedAt: status === 'discarded' ? daysAgo(3) : null,
    }
  })

  const data: AppData = { ...seed, items }

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
