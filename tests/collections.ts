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
import type { AppData, Checklist, Collection } from '../src/types'
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

await test('数据版本已经升到 6，老版本号仍能导入', () => {
  // 硬编码版本号是**故意的**：每次升版本都得来这里改一次，
  // 那一下就是提醒「你刚才改的是数据结构，确认过老备份还能导入吗」。
  // v5 → v6 的改动是物品状态多了 spare(备用)——那是**校验规则**变了，
  // 老程序读到 'spare' 会认不出来，所以必须让它整份拒绝而不是丢掉那件物品。
  eq(SCHEMA_VERSION, 6, '加了新状态就该升版本，好让老程序明确拒绝而不是静默丢字段')

  const raw = JSON.parse(JSON.stringify(buildExportFile(fixture()))) as Record<string, unknown>
  raw.schemaVersion = SCHEMA_VERSION - 1
  ok(parseExportFile(JSON.stringify(raw)).ok, '老版本备份要能导入')

  raw.schemaVersion = SCHEMA_VERSION + 1
  ok(!parseExportFile(JSON.stringify(raw)).ok, '更高版本要明确拒绝')
})

/* ------------------------------------------------------------------ */
/* 4. 清单（一次性的待办）                                              */
/* ------------------------------------------------------------------ */

suite('清单：从物品或活动建，打钩，编辑，删')

await test('从物品勾选建清单：条目是**快照**，物品后来改名也不影响它', () => {
  seed(fixture())
  const id = must(
    useAppStore.getState().createChecklist({ name: '周六露营', itemIds: ['i1', 'i2'] }),
    '应该拿到 id',
  )

  const created = must(
    useAppStore.getState().data.checklists.find((c) => c.id === id),
    '清单应存在',
  )
  eq(created.entries.length, 2, '勾了两件就该有两条')
  eq(must(created.entries[0], '第一条').name, '灰色羊毛衫', '名字要抄下来')
  eq(must(created.entries[0], '第一条').checked, false, '新建的都是未打钩')
  eq(must(created.entries[1], '第二条').quantity, 2, '数量也要抄下来（牛仔裤是 2 条）')

  // 改物品的名字：清单上还是当时那个名字，这才对（那是当时的决定）
  useAppStore.getState().updateItem('i1', { name: '改过名的毛衣' })
  const after = must(
    useAppStore.getState().data.checklists.find((c) => c.id === id),
    '清单还在',
  )
  eq(must(after.entries[0], '第一条').name, '灰色羊毛衫', '快照不该跟着物品改名而变')
})

await test('从活动建清单：勾选的那几件进来，并记下来源', () => {
  seed(fixture())
  const travel = must(useAppStore.getState().addCollection('旅行'), '旅行')
  useAppStore.getState().addItemsToCollection(['i1', 'i2', 'i3'], travel)

  // 用户在活动里勾了其中两件
  const id = must(
    useAppStore.getState().createChecklist({
      name: '这次的旅行清单',
      itemIds: ['i1', 'i3'],
      fromCollectionId: travel,
    }),
    'id',
  )

  const created = must(
    useAppStore.getState().data.checklists.find((c) => c.id === id),
    '清单',
  )
  eq(created.entries.length, 2, '只勾了两件')
  eq(created.fromCollectionId, travel, '要记下来源')
})

await test('清单是快照：把活动删掉，清单一点不受影响', () => {
  seed(fixture())
  const travel = must(useAppStore.getState().addCollection('旅行'), '旅行')
  useAppStore.getState().addItemsToCollection(['i1'], travel)
  const id = must(
    useAppStore.getState().createChecklist({
      name: '清单',
      itemIds: ['i1'],
      fromCollectionId: travel,
    }),
    'id',
  )

  useAppStore.getState().deleteCollection(travel)

  const after = must(
    useAppStore.getState().data.checklists.find((c) => c.id === id),
    '清单还在',
  )
  eq(after.entries.length, 1, '清单里的条目不该因为活动被删而消失')
  eq(after.fromCollectionId, travel, '来源 id 留着；界面上找不到那个活动就不显示「来自」而已')
})

await test('把物品删掉，清单条目也还在（只是跳不过去了）', async () => {
  seed(fixture())
  const id = must(
    useAppStore.getState().createChecklist({ name: '清单', itemIds: ['i1'] }),
    'id',
  )
  // 从回收站里彻底删掉（真正的物理删除），模拟「用户把东西清掉了」
  useAppStore.getState().purgeItem('i1')

  const after = must(
    useAppStore.getState().data.checklists.find((c) => c.id === id),
    '清单还在',
  )
  eq(after.entries.length, 1, '清单不该变成一片空白')
  eq(must(after.entries[0], '条目').itemId, 'i1', 'itemId 留着，界面上会显示「已不在库里」')
  await flushWrites()
})

await test('打钩与取消打钩', () => {
  seed(fixture())
  const id = must(useAppStore.getState().createChecklist({ name: '清单', itemIds: ['i1'] }), 'id')
  const entryId = must(
    must(useAppStore.getState().data.checklists.find((c) => c.id === id), '清单').entries[0],
    '条目',
  ).id

  useAppStore.getState().toggleChecklistEntry(id, entryId)
  eq(
    must(must(useAppStore.getState().data.checklists.find((c) => c.id === id), '清单').entries[0], '条目')
      .checked,
    true,
  )

  useAppStore.getState().toggleChecklistEntry(id, entryId)
  eq(
    must(must(useAppStore.getState().data.checklists.find((c) => c.id === id), '清单').entries[0], '条目')
      .checked,
    false,
    '再点一次就是取消',
  )

  // 也可以显式指定，用于「全部取消打钩」那种批量场景
  useAppStore.getState().toggleChecklistEntry(id, entryId, true)
  eq(
    must(must(useAppStore.getState().data.checklists.find((c) => c.id === id), '清单').entries[0], '条目')
      .checked,
    true,
  )
})

await test('清单里就地改名和改数量，**不会去动库里的物品**', () => {
  // 这是刻意的：清单是「这次要带什么」的临时记录，
  // 在里面把「充电宝」写成「充电宝（借的）」，不该把库里的物品也改了名
  seed(fixture())
  const id = must(useAppStore.getState().createChecklist({ name: '清单', itemIds: ['i1'] }), 'id')
  const entryId = must(
    must(useAppStore.getState().data.checklists.find((c) => c.id === id), '清单').entries[0],
    '条目',
  ).id

  useAppStore.getState().updateChecklistEntry(id, entryId, { name: '带妈妈送的那件', quantity: 3 })

  const entry = must(
    must(useAppStore.getState().data.checklists.find((c) => c.id === id), '清单').entries[0],
    '条目',
  )
  eq(entry.name, '带妈妈送的那件')
  eq(entry.quantity, 3)

  const item = must(useAppStore.getState().data.items.find((i) => i.id === 'i1'), 'i1')
  eq(item.name, '灰色羊毛衫', '库里的物品不该被改')
  eq(item.quantity, 1, '数量也不该被改')
})

await test('名字不能改成空的', () => {
  seed(fixture())
  const id = must(useAppStore.getState().createChecklist({ name: '清单', itemIds: ['i1'] }), 'id')
  const entryId = must(
    must(useAppStore.getState().data.checklists.find((c) => c.id === id), '清单').entries[0],
    '条目',
  ).id

  useAppStore.getState().updateChecklistEntry(id, entryId, { name: '   ' })
  eq(
    must(must(useAppStore.getState().data.checklists.find((c) => c.id === id), '清单').entries[0], '条目')
      .name,
    '灰色羊毛衫',
    '空名字该被拒绝',
  )
})

await test('可以往清单里加库里没有的东西，也能删掉', () => {
  seed(fixture())
  const id = must(useAppStore.getState().createChecklist({ name: '清单' }), 'id')

  const entryId = must(useAppStore.getState().addChecklistEntry(id, ' 顺路买瓶水 ', 2), '条目 id')
  const entry = must(
    must(useAppStore.getState().data.checklists.find((c) => c.id === id), '清单').entries[0],
    '条目',
  )
  eq(entry.name, '顺路买瓶水', '两头空格要去掉')
  eq(entry.quantity, 2)
  eq(entry.itemId, null, '库里没有对应物品，itemId 就是 null')

  useAppStore.getState().removeChecklistEntry(id, entryId)
  eq(
    must(useAppStore.getState().data.checklists.find((c) => c.id === id), '清单').entries.length,
    0,
  )
})

await test('空名字加不进去', () => {
  seed(fixture())
  const id = must(useAppStore.getState().createChecklist({ name: '清单' }), 'id')
  eq(useAppStore.getState().addChecklistEntry(id, '  '), null)
  eq(must(useAppStore.getState().data.checklists.find((c) => c.id === id), '清单').entries.length, 0)
})

await test('一键清掉已打钩的，只剩没办的', () => {
  seed(fixture())
  const id = must(
    useAppStore.getState().createChecklist({ name: '清单', itemIds: ['i1', 'i2', 'i3'] }),
    'id',
  )
  const entries = must(
    useAppStore.getState().data.checklists.find((c) => c.id === id),
    '清单',
  ).entries
  useAppStore.getState().toggleChecklistEntry(id, must(entries[0], 'e0').id, true)
  useAppStore.getState().toggleChecklistEntry(id, must(entries[2], 'e2').id, true)

  const removed = useAppStore.getState().clearCheckedEntries(id)
  eq(removed, 2)

  const left = must(useAppStore.getState().data.checklists.find((c) => c.id === id), '清单').entries
  eq(left.length, 1, '只剩没打钩的那条')
  eq(must(left[0], '剩下的一条').name, '牛仔裤')

  eq(useAppStore.getState().clearCheckedEntries(id), 0, '没有打钩的就没什么可清')
})

await test('删整份清单：清单没了，物品和活动都不受影响', async () => {
  seed(fixture())
  const travel = must(useAppStore.getState().addCollection('旅行'), '旅行')
  const id = must(
    useAppStore.getState().createChecklist({
      name: '清单',
      itemIds: ['i1', 'i2'],
      fromCollectionId: travel,
    }),
    'id',
  )

  const itemsBefore = useAppStore.getState().data.items.length
  useAppStore.getState().deleteChecklist(id)

  eq(useAppStore.getState().data.checklists.length, 0, '清单没了')
  eq(useAppStore.getState().data.items.length, itemsBefore, '物品一件都不能少')
  eq(useAppStore.getState().data.collections.length, 1, '活动也不受影响')
  await flushWrites()
})

await test('改名：空名字拒绝', () => {
  seed(fixture())
  const id = must(useAppStore.getState().createChecklist({ name: '露营' }), 'id')
  useAppStore.getState().renameChecklist(id, '   ')
  eq(must(useAppStore.getState().data.checklists.find((c) => c.id === id), '清单').name, '露营')

  useAppStore.getState().renameChecklist(id, ' 周六露营 ')
  eq(
    must(useAppStore.getState().data.checklists.find((c) => c.id === id), '清单').name,
    '周六露营',
  )
})

await test('清单完全没名字就建不出来', () => {
  seed(fixture())
  eq(useAppStore.getState().createChecklist({ name: '   ' }), null)
  eq(useAppStore.getState().data.checklists.length, 0)
})

/* ------------------------------------------------------------------ */
/* 5. 清单的导出 / 导入                                                */
/* ------------------------------------------------------------------ */

suite('清单：导出与导入')

await test('清单连打钩状态一起往返', () => {
  const data: AppData = {
    ...fixture(),
    checklists: [
      {
        id: 'list-1',
        name: '周六露营',
        fromCollectionId: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        entries: [
          { id: 'e1', itemId: 'i1', name: '帐篷', quantity: 1, checked: true },
          { id: 'e2', itemId: null, name: '顺路买瓶水', quantity: 2, checked: false },
        ],
      },
    ],
  }

  const parsed = mustParse(parseExportFile(JSON.stringify(buildExportFile(data))))
  deepEq(parsed.data.checklists, data.checklists, '清单要原样回来，包括打钩状态')
})

await test('老备份（v4，没有 checklists）能导入，清单为空', () => {
  const raw = JSON.parse(JSON.stringify(buildExportFile(fixture()))) as Record<string, unknown>
  raw.schemaVersion = 4
  delete (raw.data as Record<string, unknown>).checklists

  const parsed = mustParse(parseExportFile(JSON.stringify(raw)))
  deepEq(parsed.data.checklists, [], '缺字段就当没有清单')
})

await test('清单里坏了一两条：跳过那几条，剩下的照留（不整份丢）', () => {
  // 清单是用户临时攒的，坏一条就整份不要，比丢一条糟得多
  const data: AppData = {
    ...fixture(),
    checklists: [
      {
        id: 'list-1',
        name: '露营',
        fromCollectionId: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        entries: [
          { id: 'e1', itemId: null, name: '帐篷', quantity: 1, checked: false },
          // 名字是空的 → 这条跳过
          { id: 'e2', itemId: null, name: '   ', quantity: 1, checked: false },
          // 条目 id 缺失 → 补一个，而不是丢掉
          { id: '', itemId: null, name: '水', quantity: 1, checked: true },
        ],
      },
    ],
  }

  const parsed = mustParse(parseExportFile(JSON.stringify(buildExportFile(data))))
  const list = must(parsed.data.checklists[0], '清单')
  eq(list.name, '露营', '整份清单要留着')
  eq(list.entries.length, 2, '坏的那条跳过，其余两条都在')
  eq(must(list.entries[0], '第一条').name, '帐篷')
  eq(must(list.entries[1], '第二条').name, '水', '缺 id 的补一个 id，不该被丢掉')
  ok(list.entries[1]?.id !== '', '补出来的 id 不能是空字符串')
  ok(
    parsed.warnings.some((w) => w.includes('露营')),
    `该提示是哪份清单的哪一条坏了：${parsed.warnings.join(' / ')}`,
  )
})

await test('合并导入：清单按 id 去重，撞了就整份保留本地那份', () => {
  // 清单里有「打没打钩」，两边各勾一部分的话怎么合都会丢一半信息，
  // 所以宁可整份保留本地那份 —— 至少是用户上次看到的样子
  const local: Checklist = {
    id: 'list-1',
    name: '周六露营',
    fromCollectionId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    entries: [{ id: 'e1', itemId: null, name: '帐篷', quantity: 1, checked: true }],
  }
  const incoming: Checklist = {
    id: 'list-1',
    name: '周六露营',
    fromCollectionId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    entries: [{ id: 'e1', itemId: null, name: '帐篷', quantity: 1, checked: false }],
  }
  const fresh: Checklist = {
    id: 'list-2',
    name: '这周采购',
    fromCollectionId: null,
    createdAt: '2026-01-02T00:00:00.000Z',
    entries: [],
  }

  const current: AppData = { ...fixture(), checklists: [local] }
  const merged = mergeAppData(current, { ...fixture(), checklists: [incoming, fresh] })

  eq(merged.data.checklists.length, 2, '撞的那个保留，新的补进来')
  eq(must(merged.data.checklists[0], '第一条').id, 'list-1')
  eq(
    must(must(merged.data.checklists[0], '第一条').entries[0], '条目').checked,
    true,
    '本地已打钩的状态要保住',
  )
  eq(merged.report.checklists.added, 1)
  eq(merged.report.checklists.kept, 1)
})

/* ------------------------------------------------------------------ */
/* 小工具                                                              */
/* ------------------------------------------------------------------ */

function collection(id: string, name: string, note = ''): Collection {
  return { id, name, note, order: 0, createdAt: '2026-01-01T00:00:00.000Z' }
}
