/**
 * 两份数据的差异（issue 15 / 16 / 14）。
 *
 * 三件事各自有个用户报上来的说法：
 *   · issue 15「我希望可以就是我选择两个快照，然后帮我对比一下这两个快照
 *     的差别是什么，不然这样我不知道到底要恢复哪个快照」
 *   · issue 16「设置里的快照显示的物品数量有误，我点击回退后发现物品数量
 *     跟上面显示的不一样」
 *   · issue 14「我发现合并反而会让总东西变少，这是一个bug」
 *
 * 这个文件把它们钉成可验证的承诺：
 *   1. 差异算得准（该说的地方一处不少、不该说的地方一处不多）
 *   2. 快照上写的物品数**永远等于**那份快照里真的有几件
 *   3. 合并**只做加法** —— 合并之后物品总数绝不会比原来少
 */

import { mergeAppData } from '../src/data/importData'
import { diffAppData } from '../src/lib/diff'
import { listSnapshots, createSnapshot, clearSnapshots } from '../src/storage/snapshots'
import { createEmptyData, createSeedData } from '../src/storage/seed'
import { fixture, item, eq, ok, suite, test } from './harness'
import type { AppData, Item } from '../src/types'

const UNASSIGNED = '未归位'

/** 只留指定物品、其余照旧的一份数据 */
function withItems(base: AppData, items: Item[]): AppData {
  return { ...base, items }
}

suite('数据差异：算得准（issue 15）')

await test('新增 / 减少 / 改动 / 未变，四种各归各位', () => {
  const base = fixture()
  const before = withItems(base, [
    item({ id: 'a', name: '留下了' }),
    item({ id: 'b', name: '会被删掉' }),
    item({ id: 'c', name: '会被改动', quantity: 1 }),
  ])
  const after = withItems(base, [
    item({ id: 'a', name: '留下了' }),
    item({ id: 'c', name: '会被改动', quantity: 5 }),
    item({ id: 'd', name: '新加进来的' }),
  ])

  const diff = diffAppData(before, after, UNASSIGNED)

  eq(diff.added.length, 1)
  eq(diff.added[0]?.name, '新加进来的')
  eq(diff.removed.length, 1)
  eq(diff.removed[0]?.name, '会被删掉')
  eq(diff.changed.length, 1)
  eq(diff.changed[0]?.name, '会被改动')
  eq(diff.unchanged, 1, '「留下了」一个字没动')
  eq(diff.identical, false)
  eq(diff.leftItemCount, 3)
  eq(diff.rightItemCount, 3)
})

await test('改动的那条要说清「哪个字段从什么变成了什么」', () => {
  const base = fixture()
  const before = withItems(base, [item({ id: 'a', name: '牙膏', quantity: 1, note: '旧的' })])
  const after = withItems(base, [item({ id: 'a', name: '牙膏', quantity: 3, note: '新的' })])

  const diff = diffAppData(before, after, UNASSIGNED)
  const fields = diff.changed[0]?.fields.join(' ') ?? ''

  ok(fields.includes('quantity:1->3'), `要说清数量 1 → 3。实际：${fields}`)
  ok(fields.includes('note:旧的->新的'), `要说清备注的变化。实际：${fields}`)
  ok(!fields.includes('name:'), '名字没变就不该提名字 —— 列一堆没变的东西等于没说')
})

await test('件数合计单独算 —— 「条数没变但东西多了」看得出来', () => {
  const base = fixture()
  const before = withItems(base, [item({ id: 'a', name: '牙膏', quantity: 1 })])
  const after = withItems(base, [item({ id: 'a', name: '牙膏', quantity: 4 })])

  const diff = diffAppData(before, after, UNASSIGNED)
  eq(diff.leftItemCount, 1)
  eq(diff.rightItemCount, 1, '条数一样')
  eq(diff.leftUnitCount, 1)
  eq(diff.rightUnitCount, 4, '但件数从 1 变成 4 —— 光看条数是看不出来的')
})

await test('位置从「有」变成「未归位」也要算一次改动', () => {
  const base = fixture()
  const where = base.locations.find((l) => l.name === '衣柜')
  ok(where !== undefined, '夹具里应该有「衣柜」')

  const before = withItems(base, [item({ id: 'a', name: '毛衣', locationId: where?.id ?? null })])
  const after = withItems(base, [item({ id: 'a', name: '毛衣', locationId: null })])

  const diff = diffAppData(before, after, UNASSIGNED)
  eq(diff.changed.length, 1, '位置丢了也算改动')
  eq(diff.removed.length, 0, '东西还在，不是「少了」')
  ok(
    (diff.changed[0]?.fields.join(' ') ?? '').includes('location:'),
    '要说清位置变了',
  )
})

await test('分类 / 位置的增删也报出来（回退会牵动结构）', () => {
  const before = fixture()
  /*
   * 拿一个**真实存在于树里**的位置名来删 —— 不能写死一个名字：
   * 位置是树，「衣柜」的完整路径是「家 / 衣柜」。
   * 写死名字的测试会随着脚手架的变化莫名其妙地红，而症状离病因很远。
   */
  const victim = before.locations[before.locations.length - 1]
  ok(victim !== undefined, '夹具里应该有位置')

  const after: AppData = {
    ...before,
    categories: [
      ...before.categories,
      {
        id: 'newcat',
        name: '新分类',
        parentId: null,
        order: 99,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    locations: before.locations.filter((l) => l.id !== victim?.id),
  }

  const diff = diffAppData(before, after, UNASSIGNED)
  ok(diff.categories.added.includes('新分类'), '新分类要报出来')
  ok(
    diff.locations.removed.some((path) => path.includes(victim?.name ?? '')),
    `少了「${victim?.name}」要报出来。实际少了：${diff.locations.removed.join('、') || '（一个都没报）'}`,
  )
  eq(diff.identical, false, '结构变了就不算「完全一致」')
})

await test('完全一样时明说「一致」，别摆一堆 0 让人猜', () => {
  const base = fixture()
  const diff = diffAppData(base, { ...base }, UNASSIGNED)
  eq(diff.identical, true)
  eq(diff.added.length + diff.removed.length + diff.changed.length, 0)
})

suite('数据差异：疑似同一件东西（issue 14 的「冲突」）')

await test('★ 名字一样、id 不一样的两条要被标出来', () => {
  /*
   * 用户明确要求「要清楚的展示哪些有冲突」。合并时最要紧的一类冲突就是它：
   * 本地已经有一个「棉签」，导入文件里又有一个 id 不同的「棉签」，
   * 合起来变成两条 —— 到底是不是同一件，只有用户知道。
   */
  const base = fixture()
  const left = withItems(base, [item({ id: 'local-1', name: '棉签', quantity: 1 })])
  const right = withItems(base, [item({ id: 'local-1', name: '棉签', quantity: 1 }), item({ id: 'other-9', name: '棉签', quantity: 3 })])

  const diff = diffAppData(left, right, UNASSIGNED)
  eq(diff.nameConflicts.length, 1, '要认出这一对')
  eq(diff.nameConflicts[0]?.leftId, 'local-1')
  eq(diff.nameConflicts[0]?.rightId, 'other-9')
  ok(
    (diff.nameConflicts[0]?.leftSummary ?? '').includes('×1'),
    '要给出一眼能核对的说明（这边几件）',
  )
  ok(
    (diff.nameConflicts[0]?.rightSummary ?? '').includes('×3'),
    '另一边也要',
  )
})

await test('id 相同的那条不算冲突（它已经配过对了）', () => {
  const base = fixture()
  const left = withItems(base, [item({ id: 'x', name: '牙膏', quantity: 1 })])
  const right = withItems(base, [item({ id: 'x', name: '牙膏', quantity: 2 })])

  const diff = diffAppData(left, right, UNASSIGNED)
  eq(diff.nameConflicts.length, 0, '同一件东西改了个数量，不是「冲突」')
  eq(diff.changed.length, 1)
})

await test('名字里的多余空格和大小写不影响识别', () => {
  const base = fixture()
  const left = withItems(base, [item({ id: 'a', name: 'USB 线' })])
  const right = withItems(base, [item({ id: 'a', name: 'USB 线' }), item({ id: 'b', name: 'usb  线' })])

  const diff = diffAppData(left, right, UNASSIGNED)
  eq(diff.nameConflicts.length, 1, '归一化之后就是同一个名字')
})

suite('快照的物品数必须和内容一致（issue 16）')

await test('★ 快照上的物品数 = 那份快照里真的有几位', async () => {
  /*
   * 用户的原话：「设置里的快照显示的物品数量有误，我点击回退后发现物品数量
   * 跟上面显示的不一样。」
   *
   * 那个数字是决定「回退到哪一份」时唯一的依据，所以它必须能从内容上验证。
   */
  await clearSnapshots()

  const small = withItems(fixture(), [item({ id: 'a', name: '一件' })])
  await createSnapshot(small, 'manual')

  const big = withItems(fixture(), [
    item({ id: 'a', name: '一件' }),
    item({ id: 'b', name: '两件' }),
    item({ id: 'c', name: '三件' }),
  ])
  await createSnapshot(big, 'manual')

  const metas = await listSnapshots()
  eq(metas.length, 2)

  for (const meta of metas) {
    const { getSnapshot } = await import('../src/storage/snapshots')
    const snap = await getSnapshot(meta.id)
    eq(
      meta.itemCount,
      snap?.data.items.length,
      `快照 ${meta.id} 上写的是 ${meta.itemCount} 件，但内容里是 ${snap?.data.items.length} 件`,
    )
  }

  // 而且这两个数字本身不该一样 —— 否则「数对了」无从判断
  const counts = metas.map((m) => m.itemCount).sort((a, b) => a - b)
  eq(counts.join(','), '1,3', '两份快照分别应该是 1 件和 3 件')
})

await test('老快照的 itemCount 和内容对不上时，以内容为准', async () => {
  /*
   * 缓存的那个数字可能是错的（老版本写的、或者被手工改过的备份）。
   * 列表里显示的必须是**内容里的真实件数** —— 一个和内容对不上的数字
   * 会让用户在最重要的那一刻判断错。
   */
  const { STORE_SNAPSHOTS, idbClear, idbPut } = await import('../src/storage/idb')
  await idbClear(STORE_SNAPSHOTS)

  const broken = {
    id: 'broken',
    at: '2026-01-01T00:00:00.000Z',
    reason: 'manual' as const,
    // 故意写错：内容里其实有 2 件
    itemCount: 99,
    data: withItems(createEmptyData(), [item({ id: 'a', name: '甲' }), item({ id: 'b', name: '乙' })]),
  }
  await idbPut(STORE_SNAPSHOTS, broken)

  const metas = await listSnapshots()
  eq(metas[0]?.itemCount, 2, '要以内容为准，而不是那个写错的缓存值')

  await clearSnapshots()
})

suite('合并只做加法（issue 14）')

await test('★ 合并之后物品总数绝不会变少', () => {
  /*
   * 用户的原话：「我发现合并反而会让总东西变少，这是一个bug。」
   * 这条就是那个承诺：合并的定义就是只做加法。
   */
  const local = fixture()
  const incoming = withItems(createSeedData('zh'), [
    item({ id: 'brand-new', name: '导入进来的新东西' }),
  ])

  const { data: merged, report } = mergeAppData(local, incoming)

  ok(
    merged.items.length >= local.items.length,
    `合并后 ${merged.items.length} 件 < 合并前 ${local.items.length} 件 —— 合并绝不许减少东西`,
  )
  eq(report.items.removed, 0, '报告里「少了的东西」必须恒为 0')
  eq(report.items.added, 1, '导入里那一件应该被加进来')
})

await test('★ 导入那份里没有的东西，合并后必须一件不少', () => {
  const local = fixture()
  // 导入的那份**完全没有本地这些物品**（比如是一份很旧的备份）
  const incoming = withItems(createEmptyData(), [])

  const { data: merged, report } = mergeAppData(local, incoming)

  eq(merged.items.length, local.items.length, '本地的东西一件都不能少')
  for (const original of local.items) {
    ok(
      merged.items.some((i) => i.id === original.id),
      `「${original.name}」应该还在`,
    )
  }
  eq(report.items.removed, 0)
  eq(report.items.added, 0)
})

await test('合并同一份数据两次不会变少，也不会翻倍', () => {
  const local = fixture()
  const once = mergeAppData(local, fixture())
  const twice = mergeAppData(once.data, fixture())

  eq(twice.data.items.length, local.items.length, '按 id 合并是幂等的')
  eq(twice.report.items.removed, 0)
})

await test('合并报告里逐项给出「新增 / 更新 / 未变」三个数', () => {
  const local = fixture()
  const target = local.items[0]
  ok(target !== undefined, '夹具应该有东西')

  const incoming = withItems(createSeedData('zh'), [
    // 同一个 id、更新一点 → 算「更新」
    { ...target, name: target.name, updatedAt: '2099-01-01T00:00:00.000Z' },
    // 全新 id → 算「新增」
    item({ id: 'fresh-1', name: '新的一件' }),
  ])

  const { report } = mergeAppData(local, incoming)
  eq(report.strategy, 'merge')
  eq(report.items.added, 1)
  eq(report.items.updated, 1)
  /*
   * `unchanged` 只数**两边都有、逐条比过没变化**的那些。
   * 本地那 4 件导入文件里根本没有 —— 那不是「没变」而是「这份文件里没有它」，
   * 所以不计入任何一栏（而且它们的 updatedAt 一个字都不会被碰）。
   */
  eq(report.items.unchanged, 0)
  eq(report.items.removed, 0)
})

await test('合并后的物品数正好等于「并集」，不会悄悄吞掉重名的那些', () => {
  // 同名但 id 不同：合并会把两条都留着（是不是同一件由用户自己判断），
  // 所以这里预期是「本地 5 件 + 导入里全新的那些」
  const local = fixture()
  const incoming = withItems(createEmptyData(), [
    item({ id: 'dup-a', name: '灰色羊毛衫' }),
    item({ id: 'dup-b', name: '灰色羊毛衫' }),
  ])

  const { data: merged } = mergeAppData(local, incoming)
  eq(merged.items.length, local.items.length + 2, '两条同名的都加进来，不吞不并')
  ok(
    merged.items.filter((i) => i.name === '灰色羊毛衫').length >= 3,
    '本地那件也还在',
  )
})
