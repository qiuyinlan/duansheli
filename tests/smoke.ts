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
import { buildTree, canReparent, createTreeIndex, flattenTree } from '../src/lib/tree'
import { SECTION_THEMES, themeForPath } from '../src/lib/sections'
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
  sortByIdleDuration,
} from '../src/store/selectors'
import { flushWrites, useAppStore } from '../src/store/useAppStore'
import { SCHEMA_VERSION, UNCATEGORIZED_ID } from '../src/types'
import type { AppData } from '../src/types'
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

await test('禁止把位置移动到它自己的子孙下', () => {
  const seed = createSeedData()
  const index = createTreeIndex(seed.locations)
  const home = must(seed.locations.find((l) => l.name === '家'), '找不到家')
  const wardrobe = must(seed.locations.find((l) => l.name === '衣柜'), '找不到衣柜')

  eq(canReparent(index, home.id, wardrobe.id).ok, false, '不能移动到自己的子孙下')
  eq(canReparent(index, home.id, home.id).ok, false, '不能移动到自己下面')
  eq(canReparent(index, wardrobe.id, home.id).ok, true, '正常的父子关系应该允许')
  eq(canReparent(index, wardrobe.id, null).ok, true, '提升为顶层应该允许')
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

await test('按位置分组时用完整路径做次要标题', () => {
  const wardrobeId = must(fx.locations.find((l) => l.name === '衣柜'), '找不到衣柜').id
  const groups = groupAndSort(fx.items, 'location', 'name', 'asc', ctx)
  const group = must(groups.find((g) => g.key === wardrobeId), '找不到衣柜分组')
  eq(group.sublabel, '家 / 卧室 / 衣柜')
  eq(group.items.length, 2)
})

await test('未归位的物品被单独归集', () => {
  const groups = groupAndSort(fx.items, 'location', 'name', 'asc', ctx)
  const unassigned = must(groups.find((g) => g.label === '未归位'), '找不到未归位分组')
  eq(unassigned.items.length, 1)
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
  const csv = buildCsv(data, createDerived(data))

  eq(csv.charCodeAt(0), 0xfeff, '开头必须是 BOM，否则 Excel 打开中文乱码')
  match(csv, /名称,数量,状态,分类,位置,标签,备注/, '表头不对')
  match(csv, /品牌/, '自定义属性应成为一列')
  match(csv, /家 \/ 卧室 \/ 衣柜/, '位置应输出完整路径')
  match(csv, /"带,逗号 和 ""引号"""/, '含逗号和引号的值应按 RFC 4180 转义')
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

await test('导出的数据能原样导入回来', () => {
  const data = useAppStore.getState().data
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
  for (const theme of Object.values(SECTION_THEMES)) {
    match(theme.accent, /^#[0-9a-f]{6}$/i, `${theme.label} 缺 accent`)
    match(theme.accentText, /^#[0-9a-f]{6}$/i, `${theme.label} 缺 accentText`)
    match(theme.accentSoft, /^#[0-9a-f]{6}$/i, `${theme.label} 缺 accentSoft`)
  }
})
