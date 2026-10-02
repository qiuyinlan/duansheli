import type { AppData, AttributeDef, Category, Location } from '../types'
import { SCHEMA_VERSION } from '../types'
import { uid } from '../lib/id'

export function createEmptyData(): AppData {
  return {
    schemaVersion: SCHEMA_VERSION,
    items: [],
    categories: [],
    locations: [],
    attributeDefs: [],
    tags: [],
    updatedAt: new Date().toISOString(),
  }
}

/** 首页位置树的定义：家长什么样，用名字描述层级 */
const LOCATION_TREE: Array<{ name: string; parent: string | null }> = [
  { name: '家', parent: null },
  { name: '卧室', parent: '家' },
  { name: '客厅', parent: '家' },
  { name: '厨房', parent: '家' },
  { name: '书房', parent: '家' },
  { name: '卫生间', parent: '家' },
  { name: '阳台', parent: '家' },
  { name: '储物间', parent: '家' },
  { name: '衣柜', parent: '卧室' },
  { name: '床头柜', parent: '卧室' },
  { name: '床下收纳', parent: '卧室' },
  { name: '电视柜', parent: '客厅' },
  { name: '储物柜', parent: '客厅' },
  { name: '鞋柜', parent: '客厅' },
  { name: '书桌', parent: '书房' },
  { name: '书架', parent: '书房' },
  { name: '橱柜', parent: '厨房' },
  { name: '冰箱', parent: '厨房' },
  { name: '收纳箱', parent: '储物间' },
  { name: '货架', parent: '储物间' },
]

const CATEGORY_NAMES = [
  '衣物',
  '电子',
  '书籍',
  '厨房',
  '日用品',
  '药品',
  '文具',
  '工具',
  '纪念品',
  '其他',
]

const ATTRIBUTE_DEFS: Array<Pick<AttributeDef, 'name' | 'type' | 'options' | 'unit'>> = [
  { name: '品牌', type: 'text', options: [], unit: '' },
  { name: '购入日期', type: 'date', options: [], unit: '' },
  { name: '价格', type: 'number', options: [], unit: '元' },
  { name: '颜色', type: 'select', options: ['黑', '白', '灰', '木色', '彩色'], unit: '' },
  { name: '尺寸', type: 'text', options: [], unit: '' },
]

const TAG_NAMES = ['想送人', '舍不得扔', '待维修']

/**
 * 首次使用的起步数据。
 *
 * 只铺「脚手架」——常用分类、属性库、一套居家位置树，以及几个常用标签；
 * **不放任何示例物品**，因为物品列表应该是你自己的东西，从空开始最干净。
 * 这些脚手架都可以在对应管理页里随意改名或删除。
 */
export function createSeedData(): AppData {
  const now = new Date().toISOString()

  const categories: Category[] = CATEGORY_NAMES.map((name, i) => ({
    id: uid(),
    name,
    parentId: null,
    order: i,
    createdAt: now,
  }))

  // 按定义顺序逐层建位置，用名字索引父节点 id。
  // LOCATION_TREE 的排列保证了父节点总在子节点之前出现。
  const locations: Location[] = []
  const idByName = new Map<string, string>()
  const childCount = new Map<string, number>()

  for (const { name, parent } of LOCATION_TREE) {
    let parentId: string | null = null
    if (parent !== null) {
      const found = idByName.get(parent)
      if (found === undefined) continue // 父节点缺失，跳过这个节点而不是崩掉
      parentId = found
    }
    const orderKey = parent ?? '__root__'
    const order = childCount.get(orderKey) ?? 0
    childCount.set(orderKey, order + 1)

    const id = uid()
    locations.push({ id, name, parentId, note: '', order, createdAt: now })
    idByName.set(name, id)
  }

  const attributeDefs: AttributeDef[] = ATTRIBUTE_DEFS.map((def, i) => ({
    id: uid(),
    name: def.name,
    type: def.type,
    options: def.options,
    unit: def.unit,
    showByDefault: false,
    order: i,
    createdAt: now,
  }))

  const tags = TAG_NAMES.map((name) => ({ name, createdAt: now }))

  return {
    schemaVersion: SCHEMA_VERSION,
    items: [],
    categories,
    locations,
    attributeDefs,
    tags,
    updatedAt: now,
  }
}
