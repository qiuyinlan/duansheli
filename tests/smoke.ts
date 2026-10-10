/**
 * 逻辑冒烟测试 —— 覆盖最容易悄悄出错、且一旦出错就会丢数据的那些逻辑：
 *   1. 位置树良构与防环
 *   2. 导出 → 导入 数据完全一致（这是硬指标）
 *   3. 损坏 / 非本程序文件的拒绝
 *   4. 合并算法（id 去重、悬空引用补建）
 *   5. 筛选 / 分组 / 统计
 *   6. IndexedDB 存取、快照节流与淘汰
 *   7. store 端到端：录入 → 落盘 → 导出 → 清空 → 回退
 *
 * 用 fake-indexeddb 在 Node 里模拟浏览器存储，所以跑的是一条真实的持久化链路。
 * 运行：npm test
 */

import { buildCsv } from '../src/data/exportCsv'
import { buildExportFile } from '../src/data/exportJson'
import { mergeAppData } from '../src/data/importData'
import { parseExportFile } from '../src/data/validate'
import { buildTree, canReparent, createTreeIndex, expandAncestorsOf, filterTreeByIds, flattenTree, searchTreeIds } from '../src/lib/tree'
import { SECTION_THEMES, themeForPath } from '../src/lib/sections'
import { NEUTRAL_GROUP_COLOR, assignGroupColors, assignTreeColors, colorForKey, mixWithWhite, topLevelColorMap } from '../src/lib/palette'
import { LocalRepository } from '../src/storage/localRepository'
import { getRepository } from '../src/storage/repository'
import { createSeedData } from '../src/storage/seed'
import {
  clearSnapshots,
  createSnapshot,
  listSnapshots,
  pruneSnapshots,
} from '../src/storage/snapshots'
import {
  EMPTY_FILTER,
  computeStats,
  countByCategory,
  countByTopLocation,
  createDerived,
  filterItems,
  groupAndSort,
  isGroupExpanded,
  findGroupNode,
  liveItems,
  sortByIdleDuration,
} from '../src/store/selectors'
import { flushWrites, useAppStore } from '../src/store/useAppStore'
import { SCHEMA_VERSION, UNASSIGNED_ID, UNCATEGORIZED_ID, UNTAGGED_ID } from '../src/types'
import type { AppData, Category } from '../src/types'
import { OLD_DATE, deepEq, eq, fixture, item, match, must, mustParse, ok, suite, test } from './harness'

/* ------------------------------------------------------------------ */
/* 1. 位置树                                                           */
/* ------------------------------------------------------------------ */

suite('位置树')

await test('所有位置都能从顶层到达（无孤儿、无环）', () => {
  const seed = createSeedData()
  const flat = flattenTree(buildTree(seed.locations))
  eq(flat.length, seed.locations.length, '每个位置都应该出现在树里')
})

await test('路径按层级正确拼接', () => {
  const seed = createSeedData()
  const index = createTreeIndex(seed.locations)
  const wardrobe = must(seed.locations.find((l) => l.name === '衣柜'), '找不到衣柜')
  eq(index.pathString(wardrobe.id, ' / '), '家 / 卧室 / 衣柜')
  eq(index.depthOf(wardrobe.id), 2)
})

await test('数据里即使有环，也不会死循环或让节点消失', () => {
  const seed = createSeedData()
  const root = must(seed.locations.find((l) => l.parentId === null), '找不到顶层位置')
  const child = must(seed.locations.find((l) => l.parentId === root.id), '找不到顶层位置的子节点')
  const broken = seed.locations.map((l) => (l.id === root.id ? { ...l, parentId: child.id } : l))

  const flat = flattenTree(buildTree(broken))
  eq(flat.length, broken.length, '环被拆掉之后节点数应保持不变')
})

await test('★ 搜「衣柜」能直接定位到它，而且要把祖先带出来', () => {
  /*
   * 用户的原话：「这么多折叠层级，怎么看最清晰呢」。
   * 层级一深，最有效的一招是**直接跳过去**，而不是让眼睛顺着一棵树爬 ——
   * 所以位置页加了搜索（用的是分类页/选择器那**同一套**函数）。
   *
   * 这一条验的是那套函数在位置树上的行为：命中 + **祖先必须跟着留**。
   * 祖先掉了的话，被搜出来的节点会显示成顶层（`buildTree` 会把找不到父级的
   * 当根），用户会以为它是第一层，从而归错地方。
   */
  const seed = createSeedData()
  const index = createTreeIndex(seed.locations)
  const wardrobe = must(
    seed.locations.find((location) => location.name === '衣柜'),
    '找不到衣柜',
  )
  eq(index.pathNames(wardrobe.id).join('/'), '家/卧室/衣柜', '前提：它在第三层')

  const matched = searchTreeIds(seed.locations, '衣柜')
  eq(matched.has(wardrobe.id), true, '搜名字要命中它')

  const view = filterTreeByIds(seed.locations, matched)
  eq(view.keptIds.size, 3, '命中它自己 + 家 + 卧室，一共三条')
  eq(view.roots.length, 1, '留在树里之后仍然只有「家」一个根')
  eq(view.roots[0]?.node.name, '家')

  /* 搜索时自动展开的是**祖先**，命中项自己不动（它底下没命中的不该铺开） */
  const expanded = expandAncestorsOf(seed.locations, matched)
  eq(expanded.size, 2, '家 + 卧室')
  eq(expanded.has(wardrobe.id), false, '命中的那个不算「祖先」，不该被自动展开')
})

await test('搜索匹配的是节点自己的名字，不是整条路径（和分类页同一口径）', () => {
  const seed = createSeedData()
  /* 「家」在每一条路径里都出现，但只有顶层那个节点自己叫「家」 */
  const matched = searchTreeIds(seed.locations, '家')
  eq(matched.size, 1, `只有名字真的含这两个字的那一条，实际 ${matched.size} 条`)
})

await test('禁止把位置移动到它自己的子孙下', () => {  const seed = createSeedData()
  const index = createTreeIndex(seed.locations)
  const home = must(seed.locations.find((l) => l.name === '家'), '找不到家')
  const wardrobe = must(seed.locations.find((l) => l.name === '衣柜'), '找不到衣柜')

  eq(canReparent(index, home.id, wardrobe.id).ok, false, '不能移动到自己的子孙下')
  eq(canReparent(index, home.id, home.id).ok, false, '不能移动到自己下面')
  eq(canReparent(index, wardrobe.id, home.id).ok, true, '正常的父子关系应该允许')
  eq(canReparent(index, wardrobe.id, null).ok, true, '提升为顶层应该允许')
})

/* ------------------------------------------------------------------ */
/* 1b. 兄弟的显示顺序                                                  */
/* ------------------------------------------------------------------ */

/**
 * 用户报的原话：「我发现位置顺序，没有按照123这样的次序来，是先显示1层，再3，再2」。
 *
 * 根因是 `order` 只是**创建顺序**：他先点了「3层」、后来又补上「2层」，
 * 库里就是 1层(order 0)、3层(order 1)、2层(order 2)，整棵树照着 order 排，
 * 于是显示成 1、3、2 —— 名字本身已经把顺序写清楚了，程序却在跟它作对。
 * 所以：**名字里只有编号不同的兄弟，按编号排。**
 */
suite('位置树：兄弟的显示顺序')

function node(id: string, name: string, parentId: string | null, order: number) {
  return { id, name, parentId, order }
}

await test('★ 只有编号不同的兄弟按数字排（先建 3层、后来又补 2层，也必须是 1、2、3）', () => {
  const flat = flattenTree(
    buildTree([
      node('rack', '四层收纳架', null, 0),
      node('r1', '1层', 'rack', 0),
      node('r3', '3层', 'rack', 1),
      node('r2', '2层', 'rack', 2),
    ]),
  )
  const names = flat.filter((n) => n.node.parentId === 'rack').map((n) => n.node.name)
  eq(names.join('、'), '1层、2层、3层', `编号兄弟必须按数字排，实际：${names.join('、')}`)
})

await test('★ 十层排在二层后面（数字当数字比，不是按字符一个一个比）', () => {
  const flat = flattenTree(
    buildTree([
      node('rack', '收纳架', null, 0),
      node('r10', '10层', 'rack', 0),
      node('r2', '2层', 'rack', 1),
    ]),
  )
  const names = flat.filter((n) => n.node.parentId === 'rack').map((n) => n.node.name)
  eq(names.join('、'), '2层、10层', `「10」要排在「2」后面，实际：${names.join('、')}`)
})

await test('名字里没有编号的兄弟，仍然按 order 排（不能把用户排的顺序推翻）', () => {
  const flat = flattenTree(
    buildTree([
      node('wardrobe', '衣柜', null, 0),
      node('desk', '书桌', null, 1),
    ]),
  )
  eq(flat.map((n) => n.node.name).join('、'), '衣柜、书桌', 'order 说了算的时候不能被名字顶掉')
})

await test('只有编号差、但前后缀不一样的，不算同一组（1层 和 1楼 不该互相比数字）', () => {
  const flat = flattenTree(
    buildTree([
      node('f1', '1层', null, 0),
      node('f2', '2楼', null, 1),
      node('f3', '3号', null, 2),
    ]),
  )
  eq(flat.map((n) => n.node.name).join('、'), '1层、2楼、3号', '不同名字的东西按 order 排，别硬凑成一组')
})

/* ------------------------------------------------------------------ */
/* 2. 导出 → 导入 往返                                                 */
/* ------------------------------------------------------------------ */

suite('导出 → 导入 往返一致（硬指标）')

await test('完整数据集往返后逐字段相同', () => {
  const data = fixture()
  const text = JSON.stringify(buildExportFile(data), null, 2)

  const parsed = mustParse(parseExportFile(text))

  deepEq(parsed.data.items, data.items, '物品不一致')
  deepEq(parsed.data.categories, data.categories, '分类不一致')
  deepEq(parsed.data.locations, data.locations, '位置不一致')
  deepEq(parsed.data.attributeDefs, data.attributeDefs, '属性不一致')
  deepEq(parsed.data.tags, data.tags, '标签不一致')
  eq(parsed.data.schemaVersion, SCHEMA_VERSION)
})

await test('往返两次的结果依然相同（幂等）', () => {
  const data = fixture()
  const once = mustParse(parseExportFile(JSON.stringify(buildExportFile(data))))
  const twice = mustParse(parseExportFile(JSON.stringify(buildExportFile(once.data))))
  deepEq(twice.data.items, once.data.items)
  deepEq(twice.data.locations, once.data.locations)
})

await test('空值属性在往返中被丢弃（保证数据干净）', () => {
  const seed = createSeedData()
  const brand = must(seed.attributeDefs.find((d) => d.name === '品牌'), '找不到品牌属性')
  const data: AppData = {
    ...seed,
    items: [item({ name: '空属性测试', attrs: { [brand.id]: '' } })],
  }
  const parsed = mustParse(parseExportFile(JSON.stringify(buildExportFile(data))))
  deepEq(parsed.data.items[0].attrs, {}, '空字符串的属性值不该被存下来')
})

/* ------------------------------------------------------------------ */
/* 3. 拒绝坏文件                                                       */
/* ------------------------------------------------------------------ */

suite('拒绝损坏 / 无关文件')

await test('空文件被拒绝', () => {
  eq(parseExportFile('   ').ok, false)
})

await test('不是 JSON 时给出明确原因', () => {
  const r = parseExportFile('这不是 json')
  eq(r.ok, false)
  if (!r.ok) match(r.error, /JSON/)
})

await test('是 JSON 但不是本程序的备份', () => {
  const r = parseExportFile(JSON.stringify({ hello: 'world' }))
  eq(r.ok, false)
  if (!r.ok) match(r.error, /断舍离/)
})

await test('来自更新版本的数据结构被拒绝，而不是硬塞进来', () => {
  const r = parseExportFile(
    JSON.stringify({ format: 'duansheli', schemaVersion: 999, data: { items: [] } }),
  )
  eq(r.ok, false)
  if (!r.ok) match(r.error, /更新版本/)
})

await test('悬空引用被修复并给出提示', () => {
  const r = mustParse(
    parseExportFile(
      JSON.stringify({
        format: 'duansheli',
        schemaVersion: 1,
        data: {
          items: [
            item({ id: 'x1', name: '孤儿物品', locationId: '不存在的位置', categoryIds: ['也没有'] }),
          ],
          locations: [],
          categories: [],
          attributeDefs: [],
          tags: [],
        },
      }),
    ),
  )
  eq(r.data.items[0].locationId, null, '悬空位置应变成未归位')
  deepEq(r.data.items[0].categoryIds, [], '无效分类引用应被移除')
  ok(r.warnings.length > 0, '应该给出提示')
})

/* ------------------------------------------------------------------ */
/* 4. 合并算法                                                         */
/* ------------------------------------------------------------------ */

suite('合并导入')

await test('按 id 去重，updatedAt 较新的一条胜出', () => {
  const older = new Date(Date.now() - 100000).toISOString()
  const newer = new Date().toISOString()

  const current: AppData = {
    ...createSeedData(),
    items: [item({ id: 'same', name: '较新的版本', updatedAt: newer })],
  }
  const incoming: AppData = {
    ...createSeedData(),
    items: [item({ id: 'same', name: '较旧的版本', updatedAt: older })],
  }

  const forward = mergeAppData(current, incoming)
  eq(forward.data.items.length, 1, '同 id 不该产生两条')
  eq(forward.data.items[0].name, '较新的版本', '应保留 updatedAt 较新的那条')
  eq(forward.report.items.unchanged, 1)

  const backward = mergeAppData(incoming, current)
  eq(backward.data.items[0].name, '较新的版本')
  eq(backward.report.items.updated, 1, '被覆盖的应计入 updated')
})

await test('两端各自录入的物品会合并在一起', () => {
  const a: AppData = { ...createSeedData(), items: [item({ id: 'a', name: '手机上的记录' })] }
  const b: AppData = { ...createSeedData(), items: [item({ id: 'b', name: '电脑上的记录' })] }

  const { data, report } = mergeAppData(a, b)
  eq(data.items.length, 2, '两边的物品都应该在')
  eq(report.items.added, 1)
})

await test('导入数据引用的位置本地没有时，按名称路径对齐（而不是造出重复位置）', () => {
  const current = createSeedData()
  const other = createSeedData()
  const otherWardrobe = must(other.locations.find((l) => l.name === '衣柜'), '找不到衣柜')
  const localWardrobe = must(current.locations.find((l) => l.name === '衣柜'), '找不到衣柜')
  ok(otherWardrobe.id !== localWardrobe.id, '两份独立数据的位置 id 应该不同')

  const incoming: AppData = {
    ...other,
    items: [item({ id: 'n1', name: '跨设备录的衣服', locationId: otherWardrobe.id })],
  }

  const { data } = mergeAppData(current, incoming)
  eq(data.items[0].locationId, localWardrobe.id, '应按名称路径对齐到本地已有位置')
  eq(data.locations.length, current.locations.length, '不该多出重复的位置')
})

await test('本地完全没有的位置会被补建，物品不会掉成未归位', () => {
  const current = createSeedData()
  const base = createSeedData()
  const now = new Date().toISOString()

  const incoming: AppData = {
    ...base,
    locations: [
      ...base.locations,
      { id: 'garage-id', name: '车库', parentId: null, note: '', order: 99, createdAt: now },
      { id: 'shelf-id', name: '货架', parentId: 'garage-id', note: '', order: 0, createdAt: now },
    ],
    items: [item({ id: 'g1', name: '工具箱', locationId: 'shelf-id' })],
  }

  const { data, report } = mergeAppData(current, incoming)
  const created = must(data.locations.find((l) => l.name === '车库'), '车库应该被补建')
  eq(created.parentId, null)
  ok(data.items[0].locationId !== null, '物品不该丢掉位置归属')
  ok(report.locations.created >= 2, '车库和货架都该被计入补建')
  ok(report.warnings.some((w) => w.includes('车库')), '补建的位置应该在报告里列出')
})

await test('合并后标签表会补齐物品上用到的标签', () => {
  const current = createSeedData()
  const incoming: AppData = {
    ...createSeedData(),
    tags: [],
    items: [item({ id: 't1', name: '带标签的物品', tags: ['临时想到的标签'] })],
  }
  const { data } = mergeAppData(current, incoming)
  ok(
    data.tags.some((t) => t.name === '临时想到的标签'),
    '标签表必须补齐，否则标签管理页会漏掉它',
  )
})

/* ------------------------------------------------------------------ */
/* 5. 筛选 / 分组 / 统计                                               */
/* ------------------------------------------------------------------ */

suite('筛选、分组与统计')

const fx = fixture()
const ctx = createDerived(fx)

/** 带两级分类的场景：化妆品 › 眼妆 / 唇妆（都不挂东西，用来验证树的形状） */
function nestedCategories(): { data: AppData; derived: ReturnType<typeof createDerived> } {
  const base = fixture()
  const now = new Date().toISOString()
  const cosmetics: Category = {
    id: 'c-cos',
    name: '化妆品',
    parentId: null,
    order: 20,
    createdAt: now,
  }
  const eye: Category = {
    id: 'c-eye',
    name: '眼妆',
    parentId: 'c-cos',
    order: 0,
    createdAt: now,
  }
  const lip: Category = {
    id: 'c-lip',
    name: '唇妆',
    parentId: 'c-cos',
    order: 1,
    createdAt: now,
  }

  const data: AppData = { ...base, categories: [...base.categories, cosmetics, eye, lip] }
  return { data, derived: createDerived(data) }
}

await test('按分类筛选', () => {
  const clothing = must(fx.categories.find((c) => c.name === '衣物'), '找不到衣物分类').id
  const result = filterItems(fx.items, { ...EMPTY_FILTER, categoryIds: [clothing] }, ctx)
  eq(result.length, 2)
})

await test('按「未分类」筛选', () => {
  const result = filterItems(fx.items, { ...EMPTY_FILTER, categoryIds: [UNCATEGORIZED_ID] }, ctx)
  eq(result.length, 1)
  eq(result[0].name, '不知道放哪的东西')
})

await test('按位置筛选默认包含子位置', () => {
  const bedroom = must(fx.locations.find((l) => l.name === '卧室'), '找不到卧室').id
  const withChildren = filterItems(
    fx.items,
    { ...EMPTY_FILTER, locationIds: [bedroom], includeDescendants: true },
    ctx,
  )
  const onlySelf = filterItems(
    fx.items,
    { ...EMPTY_FILTER, locationIds: [bedroom], includeDescendants: false },
    ctx,
  )
  eq(withChildren.length, 3, '卧室 + 衣柜 + 床头柜 里的东西')
  eq(onlySelf.length, 0, '卧室本身没有直接放东西')
})

await test('按状态筛选出闲置', () => {
  const result = filterItems(fx.items, { ...EMPTY_FILTER, statuses: ['idle'] }, ctx)
  eq(result.length, 1)
  eq(result[0].name, '旧手机')
})

await test('按标签筛选', () => {
  const result = filterItems(fx.items, { ...EMPTY_FILTER, tags: ['想送人'] }, ctx)
  eq(result.length, 1)
})

await test('搜索会覆盖名称、标签与属性值', () => {
  eq(filterItems(fx.items, { ...EMPTY_FILTER, search: '羊毛' }, ctx).length, 1, '搜名称')
  eq(filterItems(fx.items, { ...EMPTY_FILTER, search: '某品牌' }, ctx).length, 1, '搜属性值')
  eq(filterItems(fx.items, { ...EMPTY_FILTER, search: '想送人' }, ctx).length, 1, '搜标签')
  eq(filterItems(fx.items, { ...EMPTY_FILTER, search: '不存在的东西' }, ctx).length, 0)
})

await test('按属性筛选：价格大于 100', () => {
  const price = must(fx.attributeDefs.find((d) => d.name === '价格'), '找不到价格属性')
  const result = filterItems(
    fx.items,
    { ...EMPTY_FILTER, attrFilters: [{ defId: price.id, op: 'gt', value: '100' }] },
    ctx,
  )
  eq(result.length, 1)
  eq(result[0].name, '平底锅')
})

await test('一件物品属于两个分类时，两个分组里都会出现', () => {
  const groups = groupAndSort(fx.items, 'category', 'name', 'asc', ctx)
  const kitchen = must(groups.find((g) => g.label === '厨房'), '找不到厨房分组')
  const daily = must(groups.find((g) => g.label === '日用品'), '找不到日用品分组')
  ok(kitchen.items.some((i) => i.name === '平底锅'))
  ok(daily.items.some((i) => i.name === '平底锅'))
})

await test('位置分组是树：顶层只有顶层位置，子位置嵌在父级下面', () => {
  const groups = groupAndSort(fx.items, 'location', 'name', 'asc', ctx)

  // 顶层应该只有「家」和「未归位」两类，不会把 卧室 / 衣柜 这些平铺出来
  deepEq(
    [...groups.map((g) => g.label)].sort(),
    ['未归位', '家'].sort(),
    '顶层不该出现子位置',
  )

  const home = must(
    groups.find((g) => g.label === '家'),
    '找不到「家」',
  )
  eq(home.total, 4, '「家」含子孙共 4 件')
  ok(home.children.length > 0, '「家」下面应该有子位置')

  // 衣柜嵌在卧室下面，不该自己占一个顶层分组
  const wardrobe = must(fx.locations.find((l) => l.name === '衣柜'), '找不到衣柜')
  ok(!groups.some((g) => g.key === wardrobe.id), '衣柜不该出现在顶层')
  const nested = must(findGroupNode(groups, wardrobe.id), '衣柜应该嵌在树里')
  eq(nested.items.length, 2)
  eq(nested.total, 2)
})

await test('未归位的物品单独成组，不带子级', () => {
  const groups = groupAndSort(fx.items, 'location', 'name', 'asc', ctx)
  const unassigned = must(
    groups.find((g) => g.label === '未归位'),
    '找不到未归位分组',
  )
  eq(unassigned.items.length, 1)
  eq(unassigned.children.length, 0)
})

await test('分类分组也是树：子分类嵌在父分类下', () => {
  const { data } = nestedCategories()
  const eye = must(data.categories.find((c) => c.name === '眼妆'), '找不到眼妆')
  const lip = must(data.categories.find((c) => c.name === '唇妆'), '找不到唇妆')

  const withItems: AppData = {
    ...data,
    items: [
      ...data.items,
      item({ id: 'e1', name: '眼影盘', categoryIds: [eye.id] }),
      item({ id: 'e2', name: '睫毛膏', categoryIds: [eye.id] }),
      item({ id: 'l1', name: '口红', categoryIds: [lip.id] }),
    ],
  }
  const ctx2 = createDerived(withItems)
  const groups = groupAndSort(liveItems(withItems), 'category', 'name', 'asc', ctx2)

  const cosmetics = must(withItems.categories.find((c) => c.name === '化妆品'), '找不到化妆品')
  const node = must(findGroupNode(groups, cosmetics.id), '化妆品应该是一级分组')
  eq(node.total, 3, '含子分类共 3 件')
  eq(node.items.length, 0, '没有东西直接挂在「化妆品」上')
  eq(node.children.length, 2, '下面应该有眼妆和唇妆两组')

  ok(
    !groups.some((g) => g.key === eye.id),
    '眼妆不该出现在顶层',
  )
})

await test('空分类不占地方', () => {
  const { data, derived } = nestedCategories()
  const groups = groupAndSort(liveItems(data), 'category', 'name', 'asc', derived)
  const cosmetics = must(data.categories.find((c) => c.name === '化妆品'), '找不到化妆品')
  eq(
    findGroupNode(groups, cosmetics.id),
    undefined,
    '一件东西都没有的分类不该显示出来',
  )
})
await test('父分类的合计含子分类，同一子树里不重复计', () => {
  const { data } = nestedCategories()
  const eye = must(data.categories.find((c) => c.name === '眼妆'), '找不到眼妆')
  const lip = must(data.categories.find((c) => c.name === '唇妆'), '找不到唇妆')

  // 一件东西同时挂在同一棵子树的两个节点上
  const withItems: AppData = {
    ...data,
    items: [item({ id: 'both', name: '彩妆盘', categoryIds: [eye.id, lip.id] })],
  }
  const ctx2 = createDerived(withItems)
  const groups = groupAndSort(liveItems(withItems), 'category', 'name', 'asc', ctx2)

  const cosmetics = must(withItems.categories.find((c) => c.name === '化妆品'), '找不到化妆品')
  eq(must(findGroupNode(groups, eye.id), '找不到眼妆').total, 1)
  eq(must(findGroupNode(groups, lip.id), '找不到唇妆').total, 1)
  eq(
    must(findGroupNode(groups, cosmetics.id), '找不到化妆品').total,
    1,
    '同一件东西挂在同一棵子树的两个节点上，父级只该算一次',
  )
})

await test('默认展开规则：有子级的折叠，叶子展开', () => {
  eq(isGroupExpanded('x', false, 'category', [], []), true, '叶子没有结构可钻，直接展开')
  eq(isGroupExpanded('x', true, 'category', [], []), false, '有子级的先折叠，要看细的再点开')
  eq(isGroupExpanded('x', false, 'location', [], []), true)
  eq(isGroupExpanded('x', true, 'location', [], []), false)
  eq(isGroupExpanded('x', false, 'tag', [], []), true, '平铺分组本来就只有一层')
})

await test('用户点过的选择优先于默认值', () => {
  eq(isGroupExpanded('x', true, 'category', ['x'], []), true, '展开过就展开，哪怕默认是折叠')
  eq(isGroupExpanded('x', false, 'category', [], ['x']), false, '折叠过就折叠，哪怕默认是展开')
  eq(isGroupExpanded('x', true, 'category', ['x'], ['x']), false, '两份都记着时以折叠为准')
})

await test('统计数字正确', () => {
  const stats = computeStats(fx)
  eq(stats.totalItems, 5, '总数不含已舍弃')
  eq(stats.idleCount, 1)
  eq(stats.activeCount, 4)
  eq(stats.unassignedCount, 1)
  eq(stats.discardedCount, 0)
})

await test('顶层位置统计会把子位置的物品算进去', () => {
  const bars = countByTopLocation(fx.items, ctx)
  const home = must(bars.find((b) => b.label === '家'), '找不到「家」这一条')
  eq(home.value, 4, '除未归位那件，其余都在「家」下面')
  ok(bars.some((b) => b.label === '未归位' && b.value === 1), '未归位应单独列一条')
})

await test('分类统计中「未分类」被单独列出', () => {
  const bars = countByCategory(fx.items, ctx)
  ok(bars.some((b) => b.label === '未分类' && b.value === 1))
})

await test('闲置物品按闲置时长倒序 —— 最久没动的排最前', () => {
  const list = [
    item({ id: 'recent', name: '最近闲置', status: 'idle', idleAt: new Date().toISOString() }),
    item({ id: 'ancient', name: '闲置很久', status: 'idle', idleAt: OLD_DATE }),
  ]
  eq(sortByIdleDuration(list)[0].id, 'ancient')
})

/* ------------------------------------------------------------------ */
/* 6. 存储层                                                           */
/* ------------------------------------------------------------------ */

suite('IndexedDB 存储层')

await test('LocalRepository 能存、能取、能清空', async () => {
  const repo = new LocalRepository()
  await repo.clear()
  eq(await repo.load(), null, '清空后应读到 null')

  const data = fixture()
  await repo.save(data)
  const loaded = must(await repo.load(), '写入后应该能读回来')
  deepEq(loaded.items, data.items)
  deepEq(loaded.locations, data.locations)

  await repo.clear()
  eq(await repo.load(), null)
})

await test('同一分钟内的多次自动快照只保留一份（防止连续录入刷爆存储）', async () => {
  await clearSnapshots()
  const data = fixture()

  const first = await createSnapshot(data, 'auto')
  const second = await createSnapshot(data, 'auto')
  ok(first !== null, '第一份应该创建成功')
  eq(second, null, '同一分钟内的第二份应被节流跳过')
  eq((await listSnapshots()).length, 1)
})

await test('导入前 / 删除前的快照不受节流限制', async () => {
  await clearSnapshots()
  const data = fixture()
  await createSnapshot(data, 'import')
  await createSnapshot(data, 'import')
  await createSnapshot(data, 'destructive')
  eq((await listSnapshots()).length, 3, '重要快照一份都不能少')
})

await test('快照总数被限制在 30 份以内', async () => {
  await clearSnapshots()
  const data = fixture()
  for (let i = 0; i < 40; i++) await createSnapshot(data, 'manual')

  const remaining = await listSnapshots()
  ok(remaining.length <= 30, `应 ≤ 30 份，实际 ${remaining.length}`)
  eq(await pruneSnapshots(), 0, '已经在上限内，无需再淘汰')
})

await test('快照按时间从新到旧排列', async () => {
  const list = await listSnapshots()
  for (let i = 1; i < list.length; i++) {
    ok(list[i - 1].at >= list[i].at, '快照应按时间倒序')
  }
})

await clearSnapshots()

/* ------------------------------------------------------------------ */
/* 7. CSV 导出                                                         */
/* ------------------------------------------------------------------ */

suite('CSV 导出')

await test('带 BOM、含自定义属性列、值被正确转义', () => {
  const data = fixture()
  data.items[0].note = '带,逗号 和 "引号"'
  data.items[0].expiresAt = '2026-03-15'
  const csv = buildCsv(data, createDerived(data))

  eq(csv.charCodeAt(0), 0xfeff, '开头必须是 BOM，否则 Excel 打开中文乱码')
  match(csv, /名称,数量,状态,有效期至,分类,位置,标签,备注/, '表头不对')
  match(csv, /品牌/, '自定义属性应成为一列')
  match(csv, /家 \/ 卧室 \/ 衣柜/, '位置应输出完整路径')
  match(csv, /2026-03-15/, '有效期要导出成一列')
  match(csv, /"带,逗号 和 ""引号"""/, '含逗号和引号的值应按 RFC 4180 转义')
})

await test('没设置有效期的物品，那一格是空的（不要写「—」，表格软件里空着才好筛）', () => {
  const data = fixture()
  const csv = buildCsv(data, createDerived(data))
  // 这里能放心用 split(',')：夹具里的值都不含逗号（含逗号的转义那条另有用例守）
  const rows = csv.split('\r\n')
  const header = must(rows[0], '应该有表头').split(',')
  const expiryIndex = header.indexOf('有效期至')
  ok(expiryIndex >= 0, '表头里应该有有效期至这一列')

  const firstRow = must(rows[1], '应该有一行数据').split(',')
  eq(firstRow[expiryIndex], '', '没填就应该是空格子')
  ok(!csv.includes('—'), '整份 CSV 里不该出现「—」这种占位符')
})

/* ------------------------------------------------------------------ */
/* 8. store 端到端                                                     */
/* ------------------------------------------------------------------ */

suite('store 端到端：录入 → 落盘 → 导出 → 清空 → 回退')

await test('首次启动会铺好脚手架（有分类和位置，但没有物品）', async () => {
  await getRepository().clear()
  await useAppStore.getState().init()

  const state = useAppStore.getState()
  eq(state.status, 'ready')
  eq(state.data.items.length, 0, '起步不该塞示例物品')
  ok(state.data.categories.length > 0, '应该有分类脚手架')
  ok(state.data.locations.length > 0, '应该有位置脚手架')
  ok(state.data.attributeDefs.length > 0, '应该有属性脚手架')
})

await test('录入的物品真的写进了 IndexedDB', async () => {
  const store = useAppStore.getState()
  const wardrobe = must(store.data.locations.find((l) => l.name === '衣柜'), '找不到衣柜')

  store.addItem({ name: '测试毛衣', locationId: wardrobe.id, quantity: 3 })
  store.addItem({ name: '测试手机', status: 'idle' })
  await flushWrites()

  const persisted = must(await getRepository().load(), '应该能读回持久化数据')
  eq(persisted.items.length, 2)
  eq(persisted.items[0].name, '测试毛衣')
  eq(persisted.items[0].quantity, 3)
  eq(persisted.items[1].status, 'idle')
  ok(persisted.items[1].idleAt !== null, '标为闲置时应记录闲置起始时间')
})

await test('★ 新建位置时可以把 1~N 层一起建好（用户要的「方便我后续存东西」）', () => {
  /*
   * 用户的原话：「我输入 xxx4层xxx 这个新位置，那么就可以自动建立子位置，
   * 自动有对应的 1-4 层位置，这个逻辑，方便我后续存东西。」
   *
   * 层数从名字里认（`lib/levels.ts`），层名叫什么由界面给（跟着界面语言，
   * 但和用户自己那套「1层/2层」一致）。这里验的是**落库那一半**：
   * 一次调用之后库里真有一棵树，而不是只有一个空名字。
   */
  const store = useAppStore.getState()
  const before = store.data.locations.length

  const result = must(
    store.addLocationWithLevels('独立白色四层收纳架', null, ['1层', '2层', '3层', '4层']),
    '应该建得出来',
  )

  const after = useAppStore.getState()
  eq(after.data.locations.length, before + 5, '四个层 + 它自己，一个都不能少')
  eq(result.levels.length, 4)

  const index = createDerived(after.data).index
  eq(index.pathString(result.created.id, ' / '), '独立白色四层收纳架')
  eq(index.pathString(result.levels[0]?.id ?? '', ' / '), '独立白色四层收纳架 / 1层')
  eq(index.pathString(result.levels[3]?.id ?? '', ' / '), '独立白色四层收纳架 / 4层')

  /* 同级的 order 不能撞：撞了界面上顺序就随缘了 */
  const orders = result.levels.map((l) => l.order)
  eq(new Set(orders).size, 4, `四个层的 order 必须互不相同，实际：${orders.join(',')}`)
})

await test('导出的数据能原样导入回来', () => {  const data = useAppStore.getState().data
  const parsed = mustParse(parseExportFile(JSON.stringify(buildExportFile(data))))
  deepEq(parsed.data.items, data.items)
  deepEq(parsed.data.locations, data.locations)
  deepEq(parsed.data.categories, data.categories)
})

await test('清空所有数据后，能从快照回退回来', async () => {
  const beforeItemCount = useAppStore.getState().data.items.length
  ok(beforeItemCount > 0, '前置条件：应该有物品')

  await useAppStore.getState().clearEverything()
  eq(useAppStore.getState().data.items.length, 0)
  eq(useAppStore.getState().data.locations.length, 0)

  const snapshots = await listSnapshots()
  const recoverable = must(
    snapshots.find((s) => s.reason === 'destructive'),
    '清空前应留下一份可回退的快照',
  )

  eq(await useAppStore.getState().restoreFromSnapshot(recoverable.id), true, '回退应成功')
  eq(useAppStore.getState().data.items.length, beforeItemCount, '物品应该回来了')
  ok(useAppStore.getState().data.locations.length > 0, '位置也应该回来了')

  const persisted = must(await getRepository().load(), '磁盘上也应该是回退后的版本')
  eq(persisted.items.length, beforeItemCount)
})

await test('主动清空后重新打开，会保持空白（不会又冒出脚手架）', async () => {
  await useAppStore.getState().clearEverything()
  await flushWrites()
  await useAppStore.getState().init()

  const state = useAppStore.getState()
  eq(state.status, 'ready')
  eq(state.data.items.length, 0)
  eq(state.data.locations.length, 0, '用户主动清空过，就不该把种子数据变回来')
  eq(state.data.categories.length, 0)
})

/* ------------------------------------------------------------------ */
/* 9. 板块配色                                                         */
/* ------------------------------------------------------------------ */

suite('板块配色')

await test('每条路由都能落到某个板块，拿到合法主色', () => {
  const paths = [
    '/',
    '/items',
    '/items/new',
    '/items/abc-123',
    '/locations',
    '/idle',
    '/ai',
    '/categories',
    '/attributes',
    '/tags',
    '/settings',
    '/more',
  ]
  for (const path of paths) {
    const theme = themeForPath(path)
    ok(theme !== undefined, `${path} 没拿到主题`)
    match(theme.accent, /^#[0-9a-f]{6}$/i, `${path} 的主色不是合法的十六进制颜色`)
  }
})

await test('九个板块的主色互不相同', () => {
  const keys = [
    'overview',
    'items',
    'locations',
    'idle',
    'ai',
    'categories',
    'attributes',
    'tags',
    'settings',
  ]
  const accents = new Set(keys.map((key) => SECTION_THEMES[key].accent))
  eq(accents.size, keys.length, '如果两个板块撞色，用户就分不出来')
})

await test('子路由继承父板块的颜色', () => {
  eq(themeForPath('/items/new').key, 'items')
  eq(themeForPath('/items/abc123').key, 'items')
})

await test('未知路由回落到默认色，而不是 undefined', () => {
  eq(themeForPath('/这个路径不存在').accent, SECTION_THEMES.overview.accent)
})

await test('每个板块的三个色阶都齐全且合法', () => {
  // 用 key 当标签，不用主题里那个已被删掉的 label 字段 ——
  // 板块名现在只存在词典里，主题只管颜色。
  for (const [key, theme] of Object.entries(SECTION_THEMES)) {
    match(theme.accent, /^#[0-9a-f]{6}$/i, `${key} 缺 accent`)
    match(theme.accentText, /^#[0-9a-f]{6}$/i, `${key} 缺 accentText`)
    match(theme.accentSoft, /^#[0-9a-f]{6}$/i, `${key} 缺 accentSoft`)
  }
})

/* ------------------------------------------------------------------ */
/* 10. 分组配色                                                        */
/* ------------------------------------------------------------------ */

suite('分组配色')

const HEX = /^#[0-9a-f]{6}$/i

/* 给「色相」「明度」两个断言用的小工具：不想为了几个数引一整套颜色库 */

/** 粗略的 HSV 色相（0–360）。只是用来判断「是不是同一个色系」，不需要多精确 */
function hexHue(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16)
  const r = ((n >> 16) & 0xff) / 255
  const g = ((n >> 8) & 0xff) / 255
  const b = (n & 0xff) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  if (d === 0) return 0
  let h: number
  if (max === r) h = ((g - b) / d) % 6
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  return ((h * 60) % 360 + 360) % 360
}

/** 感知亮度（0–255），只用来比大小：越大越浅 */
function hexLuma(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16)
  const r = (n >> 16) & 0xff
  const g = (n >> 8) & 0xff
  const b = n & 0xff
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

await test('同一个 key 的基础颜色是稳定的（刷新、换筛选都不变）', () => {
  eq(colorForKey('cat-clothing').bar, colorForKey('cat-clothing').bar)
  eq(colorForKey('家 / 卧室 / 衣柜').bar, colorForKey('家 / 卧室 / 衣柜').bar)
  eq(colorForKey('想送人').bar, colorForKey('想送人').bar)
})

await test('分配一批分组颜色时，相邻两组绝不撞色', () => {
  const keys = Array.from({ length: 24 }, (_, i) => `cat-${i}`)
  const colors = assignGroupColors(keys)

  for (let i = 1; i < keys.length; i++) {
    const current = must(colors.get(keys[i]), `第 ${i} 组没拿到颜色`).bar
    const previous = must(colors.get(keys[i - 1]), `第 ${i - 1} 组没拿到颜色`).bar
    ok(current !== previous, `第 ${i} 组和上一组撞色了：${current}`)
  }
})

await test('同样的输入得到同样的结果（可重复，不能用随机）', () => {
  const keys = ['a', 'b', 'c', 'd']
  const first = assignGroupColors(keys)
  const second = assignGroupColors(keys)
  for (const key of keys) deepEq(first.get(key), second.get(key))
})

await test('虚拟分组用中性灰，不跟真实分类抢眼', () => {
  eq(colorForKey(UNCATEGORIZED_ID).bar, NEUTRAL_GROUP_COLOR.bar, '未分类')
  eq(colorForKey(UNASSIGNED_ID).bar, NEUTRAL_GROUP_COLOR.bar, '未归位')
  eq(colorForKey(UNTAGGED_ID).bar, NEUTRAL_GROUP_COLOR.bar, '未加标签')
  eq(colorForKey('__all__').bar, NEUTRAL_GROUP_COLOR.bar, '不分组时的「全部」')
  eq(colorForKey('__others__').bar, NEUTRAL_GROUP_COLOR.bar, '图表里的「其他」')
})

await test('状态分组用固定语义色，不走哈希', () => {
  eq(colorForKey('idle').bar, '#d97706', '闲置应该是琥珀色，和「闲置」板块一致')
  eq(colorForKey('active').bar, '#059669', '在用是绿色')
  ok(colorForKey('active').bar !== colorForKey('idle').bar)
})

await test('每个配色都包含四个合法色阶', () => {
  const keys = Array.from({ length: 20 }, (_, i) => `key-${i}`)
  for (const key of keys) {
    const color = colorForKey(key)
    match(color.bar, HEX, `${key} 的 bar`)
    match(color.text, HEX, `${key} 的 text`)
    match(color.soft, HEX, `${key} 的 soft`)
    match(color.line, HEX, `${key} 的 line`)
  }
})

await test('示例数据的分类分下来，相邻不撞色且大部分互不相同', () => {
  const names = createSeedData().categories.map((c) => c.name)
  const colors = assignGroupColors(names)
  const bars = names.map((name) => must(colors.get(name), `${name} 没拿到颜色`).bar)

  for (let i = 1; i < bars.length; i++) {
    ok(bars[i] !== bars[i - 1], `${names[i]} 和 ${names[i - 1]} 撞色了`)
  }
  ok(new Set(bars).size >= 8, `10 个分类只分出了 ${new Set(bars).size} 种颜色，太少了`)
})

await test('相邻两组不只是色值不同，色相也要拉开（色板里有三个绿）', () => {
  // 色板 12 个色里有三个绿（#059669 绿 / #65a30d 黄绿 / #0d9488 青绿）、
  // 两个橙、两个红。只挡「色值完全相同」不够 —— 挨着的两组一个是绿一个是青绿，
  // 看起来照样像同一组。所以相邻要按**色相距离**判断。
  const keys = Array.from({ length: 30 }, (_, i) => `k-${i}`)
  const colors = assignGroupColors(keys)

  for (let i = 1; i < keys.length; i++) {
    const current = must(colors.get(keys[i]), `${keys[i]} 没颜色`).bar
    const previous = must(colors.get(keys[i - 1]), `${keys[i - 1]} 没颜色`).bar
    const d = Math.abs(hexHue(current) - hexHue(previous))
    const gap = Math.min(d, 360 - d)
    ok(gap >= 28, `第 ${i} 组和上一组色相只差 ${gap.toFixed(1)}°，看起来会像同一组`)
  }
})

await test('灰色虚拟分组夹在中间，不该把后面的颜色带偏', () => {
  // 虚拟分组是中性灰（没有色相），拿它当「上一组」去比色相毫无意义，
  // 所以比较只发生在有色分组之间
  const colors = assignGroupColors(['cat-a', '__uncategorized__', 'cat-b'])
  ok(
    must(colors.get('cat-a'), 'a').bar !== must(colors.get('cat-b'), 'b').bar ||
      hexHue(must(colors.get('cat-a'), 'a').bar) !== 0,
    '两个真实分类不该因为是灰色隔开就随便同色',
  )
  eq(must(colors.get('__uncategorized__'), 'x').bar, NEUTRAL_GROUP_COLOR.bar, '灰色的还是灰的')
})

await test('撞色兜底不会死循环（色板绕完一圈就认了）', () => {
  // 极端情况：如果色板里根本找不到满足距离的颜色，也得能返回
  const keys = Array.from({ length: 200 }, (_, i) => `many-${i}`)
  const colors = assignGroupColors(keys)
  eq(colors.size, 200, '200 个 key 都要拿到颜色，不能卡住')
  for (const key of keys) match(must(colors.get(key), key).bar, HEX, `${key} 的颜色不是合法色值`)
})

/* ---- 树形配色：只有顶层拿独立色相，子级继承并变淡 ---- */

await test('往白里混：0 是原色、1 是纯白、输出仍是合法十六进制', () => {
  eq(mixWithWhite('#2563eb', 0), '#2563eb')
  eq(mixWithWhite('#2563eb', 1), '#ffffff')
  // 一半：#2563eb 的分量是 37 / 99 / 235，各加 (255-x)*0.5 → 146 / 177 / 245
  eq(mixWithWhite('#2563eb', 0.5), '#92b1f5')
  match(mixWithWhite('#000000', 0.3), HEX, '黑色混出来也要是合法色值')
  // 认不出来的输入原样返回，不抛错
  eq(mixWithWhite('not-a-color', 0.5), 'not-a-color')
})

await test('同一棵一级标题下的子分组，颜色跟父级同一个色相（不再是彩虹）', () => {
  // 这是这次改动的核心：以前每个节点各自哈希，一个一级标题下面五颜六色
  const tree = [
    {
      key: 'cat-cosmetics',
      children: [
        { key: 'cat-eye', children: [] },
        { key: 'cat-lip', children: [] },
        { key: 'cat-skin', children: [] },
      ],
    },
  ]
  const colors = assignTreeColors(tree)
  const parent = must(colors.get('cat-cosmetics'), '父级没拿到颜色')
  const parentHue = hexHue(parent.bar)

  for (const childKey of ['cat-eye', 'cat-lip', 'cat-skin']) {
    const child = must(colors.get(childKey), `${childKey} 没拿到颜色`)
    const hue = hexHue(child.bar)
    // 混白不改变色相（rgb 等比插值到白，色相基本不变，允许一点取整误差）
    ok(
      Math.abs(hue - parentHue) <= 3,
      `${childKey} 的色相 ${hue} 和父级 ${parentHue} 差太多，说明没继承父级颜色`,
    )
    // 但要比父级浅 —— 否则层级看不出来
    ok(
      hexLuma(child.bar) > hexLuma(parent.bar),
      `${childKey} 的竖条没有比父级浅，层级表达不出来`,
    )
  }
})

await test('子级的标题文字保持父级颜色 —— 小字号再变浅就看不清了', () => {
  const tree = [{ key: 'cat-a', children: [{ key: 'cat-b', children: [{ key: 'cat-c', children: [] }] }] }]
  const colors = assignTreeColors(tree)
  const parentText = must(colors.get('cat-a'), 'a').text

  eq(must(colors.get('cat-b'), 'b').text, parentText, '第二层文字色不该变')
  eq(must(colors.get('cat-c'), 'c').text, parentText, '第三层也是')
})

await test('最深的那一刀只切两档：第三层不会淡到看不见', () => {
  const tree = [
    { key: 'r', children: [{ key: 'd1', children: [{ key: 'd2', children: [{ key: 'd3', children: [] }] }] }] },
  ]
  const colors = assignTreeColors(tree)
  // 第二层和第三层用同一档，否则第四层几乎只剩白色
  deepEq(must(colors.get('d2'), 'd2').bar, must(colors.get('d3'), 'd3').bar)
  ok(
    must(colors.get('d1'), 'd1').bar !== must(colors.get('d2'), 'd2').bar,
    '第一层和第二层要分得开',
  )
})

await test('顶层之间仍然互不相同（相邻不撞色这条规则只作用在顶层）', () => {
  const tree = Array.from({ length: 10 }, (_, i) => ({
    key: `top-${i}`,
    children: [{ key: `sub-${i}`, children: [] }],
  }))
  const colors = assignTreeColors(tree)
  const bars = tree.map((n) => must(colors.get(n.key), n.key).bar)
  for (let i = 1; i < bars.length; i++) {
    ok(bars[i] !== bars[i - 1], `第 ${i} 个顶层分组和上一个撞色了`)
  }
})

await test('虚拟分组下的子级从灰色出发，不会突然出现彩色', () => {
  const tree = [{ key: '__uncategorized__', children: [{ key: 'child', children: [] }] }]
  const colors = assignTreeColors(tree)
  eq(must(colors.get('__uncategorized__'), 'x').bar, NEUTRAL_GROUP_COLOR.bar)
  eq(
    hexHue(must(colors.get('child'), 'child').bar),
    hexHue(NEUTRAL_GROUP_COLOR.bar),
    '中性灰的子级也该是灰的',
  )
})

await test('图表和列表用同一张顶层色表 —— 同一个分类两处必须一个色', () => {
  // 分组列表按树的显示顺序算，图表也必须按同一个顺序算，
  // 否则「相邻不撞色」会让两边算出不同的结果，
  // 出现「列表里化妆品是蓝的、图表里是绿的」这种对不上的事。
  const keys = ['cat-a', 'cat-b', 'cat-c', 'cat-d']
  const listSide = assignTreeColors(keys.map((k) => ({ key: k, children: [] })))
  const chartSide = topLevelColorMap(keys)

  for (const key of keys) {
    deepEq(
      must(chartSide.get(key), `${key} 图表侧没颜色`),
      must(listSide.get(key), `${key} 列表侧没颜色`),
      `${key} 在图表和列表里颜色不一致`,
    )
  }
})
