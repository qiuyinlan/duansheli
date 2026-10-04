/**
 * 活动合集（旅行 / 学习 / 搬家）的测试。
 *
 * 挑的都是**错了会真丢东西或真误导人**的地方：
 *   · 删掉一个活动**绝不能删物品**（这是整个功能最容易写错、后果最严重的一条）
 *   · 一件东西可以同时在多个活动里，重复添加要被挡掉
 *   · 导出 → 导入往返（硬门禁，加了实体就必须守住）
 *   · 老备份里没有 collections 字段，要能正常导入
 *   · 悬空的活动引用要被清掉，而不是留一个指向不存在活动的 id
 */

import { buildExportFile } from '../src/data/exportJson'
import { mergeAppData } from '../src/data/importData'
import { parseExportFile } from '../src/data/validate'
import { SCHEMA_VERSION } from '../src/types'
import type { AppData, Collection } from '../src/types'
import {
  collectionsOf,
  countByCollection,
  createDerived,
  itemsInCollection,
  liveItems,
} from '../src/store/selectors'
import { flushWrites, useAppStore } from '../src/store/useAppStore'
import { deepEq, eq, fixture, item, must, mustParse, ok, suite, test } from './harness'

/* ------------------------------------------------------------------ */
/* 1. 存储层                                                           */
/* ------------------------------------------------------------------ */

suite('活动合集：store')

/** 把 store 摆到「数据已加载」的状态 */
function seed(data: AppData): void {
  useAppStore.setState({ status: 'ready', error: null, data, derived: createDerived(data) })
}

await test('新建活动：拿得到 id，名字会被去掉两头空格', async () => {
  seed(fixture())
  const id = useAppStore.getState().addCollection('  旅行  ')
  ok(id !== null, '应该拿到 id')

  const created = must(
    useAppStore.getState().data.collections.find((c) => c.id === id),
    '新建的活动应存在',
  )
  eq(created.name, '旅行')
  eq(created.note, '')
  await flushWrites()
})

await test('同名活动不重复建，直接返回已有的那个', async () => {
  seed(fixture())
  const first = useAppStore.getState().addCollection('旅行')
  const second = useAppStore.getState().addCollection('旅行')
  eq(second, first, '同名应返回同一个 id')
  eq(useAppStore.getState().data.collections.length, 1, '不该建出两个「旅行」')
  await flushWrites()
})

await test('空名字建不出活动', async () => {
  seed(fixture())
  eq(useAppStore.getState().addCollection('   '), null)
  eq(useAppStore.getState().data.collections.length, 0)
})

await test('批量加入活动，重复加不会加两遍', async () => {
  seed(fixture())
  const id = must(useAppStore.getState().addCollection('旅行'), 'id')

  const added = useAppStore.getState().addItemsToCollection(['i1', 'i2'], id)
  eq(added, 2)

  // 再加一次：应该一件都不动
  const again = useAppStore.getState().addItemsToCollection(['i1', 'i2'], id)
  eq(again, 0, '已经在里面的不该重复加')
  const i1 = must(useAppStore.getState().data.items.find((i) => i.id === 'i1'), 'i1')
  deepEq(i1.collectionIds, [id], '不该出现两个相同的活动 id')

  await flushWrites()
})

await test('一件东西可以同时属于多个活动', async () => {
  seed(fixture())
  const travel = must(useAppStore.getState().addCollection('旅行'), '旅行')
  const work = must(useAppStore.getState().addCollection('出差'), '出差')

  useAppStore.getState().addItemsToCollection(['i1'], travel)
  useAppStore.getState().addItemsToCollection(['i1'], work)

  const i1 = must(useAppStore.getState().data.items.find((i) => i.id === 'i1'), 'i1')
  eq(i1.collectionIds.length, 2, '两个活动都该在')
  ok(i1.collectionIds.includes(travel) && i1.collectionIds.includes(work))
  await flushWrites()
})

await test('移出活动只解除关联，物品本身还在', async () => {
  seed(fixture())
  const id = must(useAppStore.getState().addCollection('旅行'), 'id')
  useAppStore.getState().addItemsToCollection(['i1'], id)

  const removed = useAppStore.getState().removeItemsFromCollection(['i1'], id)
  eq(removed, 1)

  const i1 = must(useAppStore.getState().data.items.find((i) => i.id === 'i1'), 'i1')
  eq(i1.name, '灰色羊毛衫', '物品必须还在')
  deepEq(i1.collectionIds, [], '关联该断掉')
  eq(useAppStore.getState().data.items.length, 5, '物品数量不该变')
  await flushWrites()
})

await test('删掉活动，**里面的物品一件都不能少**', async () => {
  // 这是整个功能里最危险的一条：删「旅行」不该把你为了旅行准备的东西也删了
  seed(fixture())
  const id = must(useAppStore.getState().addCollection('旅行'), 'id')
  useAppStore.getState().addItemsToCollection(['i1', 'i2', 'i3'], id)

  const before = useAppStore.getState().data.items.length
  const affected = useAppStore.getState().deleteCollection(id)

  eq(affected, 3, '应该如实报告影响了 3 件')
  eq(useAppStore.getState().data.items.length, before, '物品数量一件都不能变')
  eq(useAppStore.getState().data.collections.length, 0, '活动没了')

  for (const itemId of ['i1', 'i2', 'i3']) {
    const found = must(
      useAppStore.getState().data.items.find((i) => i.id === itemId),
      `${itemId} 不该被删`,
    )
    deepEq(found.collectionIds, [], '关联该断掉')
  }
  await flushWrites()
})

await test('改名：空名字和重名都拒绝，防止列表里出现两个「旅行」', async () => {
  seed(fixture())
  const a = must(useAppStore.getState().addCollection('旅行'), 'a')
  useAppStore.getState().addCollection('学习')

  useAppStore.getState().updateCollection(a, { name: '   ' })
  eq(
    must(useAppStore.getState().data.collections.find((c) => c.id === a), 'a').name,
    '旅行',
    '空名字不该改成功',
  )

  useAppStore.getState().updateCollection(a, { name: '学习' })
  eq(
    must(useAppStore.getState().data.collections.find((c) => c.id === a), 'a').name,
    '旅行',
    '重名不该改成功',
  )

  useAppStore.getState().updateCollection(a, { name: '出差' })
  eq(must(useAppStore.getState().data.collections.find((c) => c.id === a), 'a').name, '出差')
  await flushWrites()
})

await test('备注可以改，也可以清空', async () => {
  seed(fixture())
  const id = must(useAppStore.getState().addCollection('旅行'), 'id')
  useAppStore.getState().updateCollection(id, { note: '三天两夜' })
  eq(
    must(useAppStore.getState().data.collections.find((c) => c.id === id), 'id').note,
    '三天两夜',
  )
  useAppStore.getState().updateCollection(id, { note: '' })
  eq(must(useAppStore.getState().data.collections.find((c) => c.id === id), 'id').note, '')
  await flushWrites()
})

/* ------------------------------------------------------------------ */
/* 2. 选择器                                                           */
/* ------------------------------------------------------------------ */

suite('活动合集：筛选与计数')

await test('按活动取物品；已舍弃的不算', () => {
  const travel = collection('col-travel', '旅行')
  const data: AppData = {
    ...fixture(),
    collections: [travel],
    items: [
      item({ id: 'a', name: '充电宝', collectionIds: [travel.id] }),
      item({ id: 'b', name: '充电线', collectionIds: [travel.id] }),
      item({ id: 'c', name: '旧拖鞋', collectionIds: [travel.id], status: 'discarded' }),
      item({ id: 'd', name: '平底锅', collectionIds: [] }),
    ],
  }

  eq(itemsInCollection(data.items, travel.id).length, 3, '不筛状态时三件都在')
  eq(itemsInCollection(liveItems(data), travel.id).length, 2, '「这个活动里有什么」不该包含已经扔掉的')
})

await test('计数：每个活动各有多少件（不含已舍弃）', () => {
  const travel = collection('c1', '旅行')
  const study = collection('c2', '学习')
  const empty = collection('c3', '搬家')
  const data: AppData = {
    ...fixture(),
    collections: [travel, study, empty],
    items: [
      item({ id: 'a', name: 'a', collectionIds: [travel.id, study.id] }),
      item({ id: 'b', name: 'b', collectionIds: [travel.id] }),
      item({ id: 'c', name: 'c', collectionIds: [study.id], status: 'discarded' }),
    ],
  }

  const rows = countByCollection({ ...data, items: liveItems(data) }, data.collections)
  eq(rows.length, 3, '三个活动都要出现，哪怕其中一个是空的')
  eq(must(rows[0], '旅行').count, 2)
  eq(must(rows[1], '学习').count, 1, '已舍弃的不算')
  eq(must(rows[2], '搬家').count, 0, '空活动显示 0，而不是被藏起来')
})

await test('查一件物品属于哪几个活动，遇到指向不存在的 id 不炸', () => {
  const travel = collection('c1', '旅行')
  const data: AppData = { ...fixture(), collections: [travel] }
  const it = item({
    id: 'a',
    name: 'a',
    collectionIds: [travel.id, '已经删掉的活动'],
  })

  const found = collectionsOf(it, data.collections)
  eq(found.length, 1, '找不到的那个直接跳过')
  eq(must(found[0], '第一个').name, '旅行')
})

/* ------------------------------------------------------------------ */
/* 3. 导出 / 导入                                                      */
/* ------------------------------------------------------------------ */

suite('活动合集：导出与导入')

await test('活动与它们的归属，经导出再导入后逐字段一致', () => {
  const travel = collection('c1', '旅行', '三天两夜')
  const data: AppData = {
    ...fixture(),
    collections: [travel],
    items: [
      item({ id: 'a', name: '充电宝', collectionIds: [travel.id] }),
      item({ id: 'b', name: '平底锅' }),
    ],
  }

  const parsed = mustParse(parseExportFile(JSON.stringify(buildExportFile(data))))
  deepEq(parsed.data.collections, data.collections, '活动本身要原样回来')
  deepEq(
    parsed.data.items.map((i) => i.collectionIds),
    data.items.map((i) => i.collectionIds),
    '归属关系也要原样回来',
  )
})

await test('老备份（v3，没有 collections 字段）能导入，活动为空', () => {
  const raw = JSON.parse(JSON.stringify(buildExportFile(fixture()))) as Record<string, unknown>
  raw.schemaVersion = 3
  const inner = raw.data as Record<string, unknown>
  delete inner.collections
  for (const it of inner.items as Array<Record<string, unknown>>) delete it.collectionIds

  const parsed = mustParse(parseExportFile(JSON.stringify(raw)))
  deepEq(parsed.data.collections, [], '缺字段就当没有活动，不该让导入失败')
  ok(
    parsed.data.items.every((i) => i.collectionIds.length === 0),
    '缺字段就当不属于任何活动',
  )
})

await test('指向不存在的活动 → 清掉引用并如实提示', () => {
  const data: AppData = {
    ...fixture(),
    collections: [],
    items: [item({ id: 'a', name: '充电宝', collectionIds: ['ghost'] })],
  }

  const parsed = mustParse(parseExportFile(JSON.stringify(buildExportFile(data))))
  deepEq(
    must(parsed.data.items[0], '第一条').collectionIds,
    [],
    '悬空引用必须清掉，否则会留下一个指向不存在活动的 id',
  )
  ok(
    parsed.warnings.some((w) => w.includes('活动')),
    `应该有一条关于活动的提示，实际：${parsed.warnings.join(' / ')}`,
  )
})

await test('合并导入：新活动补进来，物品的归属跟着并', () => {
  const travel = collection('c1', '旅行')
  const current: AppData = { ...fixture(), collections: [], items: [] }
  const incoming: AppData = {
    ...fixture(),
    collections: [travel],
    items: [item({ id: 'x', name: '充电宝', collectionIds: [travel.id] })],
  }

  const merged = mergeAppData(current, incoming)
  eq(merged.data.collections.length, 1, '活动该被并进来')
  eq(merged.report.collections.added, 1)
  deepEq(
    must(merged.data.items.find((i) => i.id === 'x'), 'x').collectionIds,
    [travel.id],
    '物品的归属要保住',
  )
})

await test('合并导入：id 相同视为同一个活动，名字保留本地的', () => {
  const local = collection('c1', '旅行')
  const incoming = collection('c1', '旅游') // 同一个 id，用户在另一台设备上改过名
  const current: AppData = { ...fixture(), collections: [local], items: [] }

  const merged = mergeAppData(current, { ...fixture(), collections: [incoming], items: [] })
  eq(merged.data.collections.length, 1, '不该变成两个')
  eq(must(merged.data.collections[0], '第一个').name, '旅行', '本地改过的名字更可信，保留它')
})

await test('数据版本已经升到 4，老版本号仍能导入', () => {
  eq(SCHEMA_VERSION, 4, '加了新实体就该升版本，好让老程序明确拒绝而不是静默丢字段')

  const raw = JSON.parse(JSON.stringify(buildExportFile(fixture()))) as Record<string, unknown>
  raw.schemaVersion = SCHEMA_VERSION - 1
  ok(parseExportFile(JSON.stringify(raw)).ok, '老版本备份要能导入')

  raw.schemaVersion = SCHEMA_VERSION + 1
  ok(!parseExportFile(JSON.stringify(raw)).ok, '更高版本要明确拒绝')
})

/* ------------------------------------------------------------------ */
/* 小工具                                                              */
/* ------------------------------------------------------------------ */

function collection(id: string, name: string, note = ''): Collection {
  return { id, name, note, order: 0, createdAt: '2026-01-01T00:00:00.000Z' }
}
