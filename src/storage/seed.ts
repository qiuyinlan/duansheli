import type { AppData, AttributeDef, Category, Location } from '../types'
import { SCHEMA_VERSION } from '../types'
import { uid } from '../lib/id'
import type { Lang } from '../i18n'
import { getLang, tIn } from '../i18n'

/** 一份什么都没有的空数据 —— 不铺任何脚手架，用于「清空所有数据」 */
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

/**
 * 首次使用的起步数据。
 *
 * 只铺「脚手架」——常用分类、属性库、一套居家位置树，以及几个常用标签；
 * **不放任何示例物品**，因为物品列表应该是你自己的东西，从空开始最干净。
 * 这些脚手架都可以在对应管理页里随意改名或删除。
 *
 * ── 关于语言 ────────────────────────────────────────────────────
 * 这些名字会**真的写进数据库**，成为你自己的数据。所以它们按
 * **首次启动时的界面语言**生成一次；之后切换界面语言**不会**去动它们 ——
 * 你花时间改过的分类名被悄悄翻译掉，是最让人恼火的一类 bug。
 * 想换一套，就在管理页里自己命名，或者清空数据重新开始。
 *
 * ── 为什么语言是个参数而不是直接读当前语言 ──────────────────────
 * 因为调用方有时候**必须指定**语言。最典型的是测试夹具：它铺的那套中文脚手架
 * 后面会被一堆断言依赖，如果它跟着「当前语言」走，那么只要前面有人切了英文没切回来，
 * 夹具就会静默变成英文，一堆断言莫名其妙地红，而且看不出原因。
 * 显式传参就把这类跨用例污染从「靠自觉」变成了「不可能」。
 */
export function createSeedData(lang: Lang = getLang()): AppData {
  const now = new Date().toISOString()
  const t = (key: Parameters<typeof tIn>[1]) => tIn(lang, key)

  // 位置树：用「名字 → 父名字」描述结构，父节点总在子节点之前出现。
  // 这里刻意不用 loc()/cat() 那种简写表，因为要保证父子引用不出错 ——
  // 名字写错时下面的代码会如实跳过该节点，而不是造出一个孤儿。
  const LOCATION_TREE: Array<{ name: string; parent: string | null }> = [
    { name: t('seed.home'), parent: null },
    { name: t('seed.bedroom'), parent: t('seed.home') },
    { name: t('seed.livingRoom'), parent: t('seed.home') },
    { name: t('seed.kitchen'), parent: t('seed.home') },
    { name: t('seed.study'), parent: t('seed.home') },
    { name: t('seed.bathroom'), parent: t('seed.home') },
    { name: t('seed.balcony'), parent: t('seed.home') },
    { name: t('seed.storage'), parent: t('seed.home') },
    { name: t('seed.wardrobe'), parent: t('seed.bedroom') },
    { name: t('seed.nightstand'), parent: t('seed.bedroom') },
    { name: t('seed.underBed'), parent: t('seed.bedroom') },
    { name: t('seed.tvStand'), parent: t('seed.livingRoom') },
    { name: t('seed.sideboard'), parent: t('seed.livingRoom') },
    { name: t('seed.shoeCabinet'), parent: t('seed.livingRoom') },
    { name: t('seed.desk'), parent: t('seed.study') },
    { name: t('seed.bookshelf'), parent: t('seed.study') },
    { name: t('seed.cupboard'), parent: t('seed.kitchen') },
    { name: t('seed.fridge'), parent: t('seed.kitchen') },
    { name: t('seed.storageBox'), parent: t('seed.storage') },
    { name: t('seed.shelf'), parent: t('seed.storage') },
  ]

  const CATEGORY_NAMES = [
    t('seed.catClothing'),
    t('seed.catElectronics'),
    t('seed.catBooks'),
    t('seed.catKitchen'),
    t('seed.catDaily'),
    t('seed.catMedicine'),
    t('seed.catStationery'),
    t('seed.catTools'),
    t('seed.catKeepsake'),
    t('seed.catOther'),
  ]

  const ATTRIBUTE_DEFS: Array<Pick<AttributeDef, 'name' | 'type' | 'options' | 'unit'>> = [
    { name: t('seed.attrBrand'), type: 'text', options: [], unit: '' },
    { name: t('seed.attrPurchaseDate'), type: 'date', options: [], unit: '' },
    { name: t('seed.attrPrice'), type: 'number', options: [], unit: t('seed.attrPriceUnit') },
    {
      name: t('seed.attrColor'),
      type: 'select',
      options: [
        t('seed.colorBlack'),
        t('seed.colorWhite'),
        t('seed.colorGrey'),
        t('seed.colorWood'),
        t('seed.colorColorful'),
      ],
      unit: '',
    },
    { name: t('seed.attrSize'), type: 'text', options: [], unit: '' },
  ]

  const TAG_NAMES = [t('seed.tagGiveAway'), t('seed.tagReluctant'), t('seed.tagToRepair')]

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
