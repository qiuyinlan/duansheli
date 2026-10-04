/**
 * 备用（spare）的用例。
 *
 * 这一组守的核心是**数量守恒**：备用功能说到底是在挪「件数」——
 * 从在用的那条身上挪几件到备用那条身上。这类算术一旦错，
 * 表现是「东西总数悄悄变了」，而不是报错，所以必须逐条钉死。
 *
 * 另外两条边界也一样重要：
 *   · 「取用一件」必须是「刚好一件」进出，不能多也不能少
 *   · 备用绝不能混进「闲置占比」——那样会跑去劝用户扔掉自己特意囤的东西
 */

import { buildExportFile } from '../src/data/exportJson'
import { parseExportFile } from '../src/data/validate'
import { SCHEMA_VERSION } from '../src/types'
import type { AppData, Item } from '../src/types'
import { computeStats, countByStatus, spareItems, totalUnits } from '../src/store/selectors'
import { useAppStore } from '../src/store/useAppStore'
import { createSeedData } from '../src/storage/seed'
import { eq, item, ok, suite, test } from './harness'

/* ------------------------------------------------------------------ */
/* 小工具                                                              */
/* ------------------------------------------------------------------ */

/** 摆一份干净的数据进 store：一条在用 ×3、一条闲置、一条已舍弃 */
function seedSpareFixture(): void {
  const data: AppData = {
    ...createSeedData('zh'),
    items: [
      item({ id: 'main', name: '牙膏', quantity: 3 }),
      item({ id: 'box', name: '备用纸巾', quantity: 2, status: 'spare' }),
      item({ id: 'old', name: '旧毛巾', status: 'idle' }),
      item({ id: 'gone', name: '扔掉的', status: 'discarded' }),
    ],
  }
  useAppStore.setState({ status: 'ready', data, error: null, toasts: [], ui: { ...useAppStore.getState().ui, spareLocationId: null } })
}

function items(): Item[] {
  return useAppStore.getState().data.items
}

function byId(id: string): Item {
  const found = items().find((i) => i.id === id)
  if (found === undefined) throw new Error(`找不到物品 ${id}`)
  return found
}

/** 全库件数 —— 拆分/取用前后必须相等（取用除外，那是有意减少一件） */
function allUnits(): number {
  return items().reduce((sum, i) => sum + i.quantity, 0)
}

/* ------------------------------------------------------------------ */
/* 拆出备用：数量守恒                                                  */
/* ------------------------------------------------------------------ */

suite('备用：拆出备用')

await test('拆出 2 件：原条变 ×1，新建一条 ×2 的备用', () => {
  seedSpareFixture()
  const before = allUnits()

  const result = useAppStore.getState().splitToSpare('main', 2)
  ok(result.ok, '应该拆分成功')
  if (!result.ok) return

  eq(result.movedCount, 2)
  eq(result.leftCount, 1)
  eq(byId('main').quantity, 1, '原处留 1 件')
  eq(byId('main').status, 'active', '原条状态不变')

  const spare = byId(result.spareId)
  eq(spare.quantity, 2)
  eq(spare.status, 'spare')
  eq(spare.name, '牙膏', '备用的名字照抄')

  eq(allUnits(), before, '总件数不能变 —— 这只是把东西挪了个地方')
})

await test('原条的身份信息全部保留，只是数量变少', () => {
  seedSpareFixture()
  const before = byId('main')

  const result = useAppStore.getState().splitToSpare('main', 1)
  ok(result.ok)

  const after = byId('main')
  eq(after.id, before.id, '原条的 id 不能变')
  eq(after.name, before.name)
  eq(after.status, before.status)
  eq(after.locationId, before.locationId, '位置也不动')
  eq(after.quantity, before.quantity - 1)
})

await test('拆出来的那条带上同款的分类、标签、属性和有效期', () => {
  const data: AppData = {
    ...createSeedData('zh'),
    items: [
      item({
        id: 'main',
        name: '洗发水',
        quantity: 4,
        categoryIds: ['c1'],
        tags: ['囤货'],
        attrs: { a1: '某品牌' },
        note: '大瓶',
        expiresAt: '2027-01-01',
        collectionIds: ['col1'],
      }),
    ],
  }
  useAppStore.setState({ status: 'ready', data, error: null, ui: { ...useAppStore.getState().ui, spareLocationId: null } })

  const result = useAppStore.getState().splitToSpare('main', 3)
  ok(result.ok)
  if (!result.ok) return

  const spare = byId(result.spareId)
  eq(spare.categoryIds.length, 1, '分类照抄')
  eq(spare.tags[0], '囤货')
  eq(spare.attrs.a1, '某品牌')
  eq(spare.note, '大瓶')
  eq(spare.expiresAt, '2027-01-01', '同一批货，有效期一样')
  eq(spare.collectionIds[0], 'col1')
})

await test('最多只能拆到「留 1 件」：要 99 件也只会拆走 2', () => {
  seedSpareFixture()

  const result = useAppStore.getState().splitToSpare('main', 99)
  ok(result.ok)
  if (!result.ok) return

  eq(result.movedCount, 2, '上限是数量 − 1')
  eq(byId('main').quantity, 1, '原处一定还得留一件')
  eq(allUnits(), 3 + 2 + 1 + 1, '总数仍然守恒')
})

await test('数量只有 1 时拆不动，并说明该用「标记备用」', () => {
  seedSpareFixture()

  // 'old'（旧毛巾）数量就是 1 —— 没有「多出来的」可以拆
  const result = useAppStore.getState().splitToSpare('old', 1)
  eq(result.ok, false, '只有 1 件，没有「多出来的」可拆')
  if (!result.ok) eq(result.reason, 'tooFew')

  eq(byId('old').quantity, 1, '失败时不能改动任何东西')
  eq(items().length, 4, '也不该新建记录')
})

await test('数量 2 的能拆，而且最多只能拆走 1 件（原处一定留住 1 件）', () => {
  seedSpareFixture()

  const result = useAppStore.getState().splitToSpare('box', 99)
  ok(result.ok, '2 件是可以拆的')
  if (!result.ok) return

  eq(result.movedCount, 1, '上限是 2 − 1')
  eq(result.leftCount, 1, '原处留住 1 件')
  eq(byId('box').quantity, 1)
  eq(byId('box').status, 'spare', '原条本来就是备用，拆完还是备用')
})

await test('已舍弃的物品拆不动', () => {
  seedSpareFixture()

  const result = useAppStore.getState().splitToSpare('gone', 1)
  eq(result.ok, false)
  if (!result.ok) eq(result.reason, 'discarded')

  eq(byId('gone').status, 'discarded', '状态不能被改动')
})

await test('id 不存在时给 notFound 而不是抛错', () => {
  seedSpareFixture()

  const result = useAppStore.getState().splitToSpare('根本没这个 id', 1)
  eq(result.ok, false)
  if (!result.ok) eq(result.reason, 'notFound')
})

await test('默认放进记住的那个备用盒子；传 null 就是未归位', () => {
  seedSpareFixture()
  useAppStore.getState().setUi({ spareLocationId: 'box-location' })

  const first = useAppStore.getState().splitToSpare('main', 1)
  ok(first.ok)
  if (first.ok) eq(byId(first.spareId).locationId, 'box-location', '应该用记住的位置')

  const second = useAppStore.getState().splitToSpare('main', 1, null)
  ok(second.ok)
  // 显式传 null = 「我就是要未归位」，不该被偏好覆盖掉
  if (second.ok) eq(byId(second.spareId).locationId, null, '显式 null 要尊重')
})

/* ------------------------------------------------------------------ */
/* 取用：刚好一件进出                                                  */
/* ------------------------------------------------------------------ */

suite('备用：取用一件')

await test('还有存货时只是少一件，剩下的继续待在备用区', () => {
  seedSpareFixture()

  const result = useAppStore.getState().takeSpareOne('box')

  eq(result.becameActive, false)
  eq(result.remaining, 1)
  eq(byId('box').status, 'spare', '还是备用')
  eq(byId('box').quantity, 1)
  eq(allUnits(), 3 + 1 + 1 + 1, '总数少了一件 —— 那件被拿去用了')
})

await test('最后一件：整条变成「在用」（用户要的就是这个）', () => {
  seedSpareFixture()
  useAppStore.getState().takeSpareOne('box') // 2 → 1

  const result = useAppStore.getState().takeSpareOne('box')

  eq(result.becameActive, true, '这是最后一件')
  eq(result.remaining, 0)
  eq(byId('box').status, 'active', '整条离开备用区')
  eq(byId('box').quantity, 1, '数量还是 1 —— 取用不改数量，只改「是不是备用」')
  eq(byId('box').discardedAt, null)
})

await test('取用**不会**把东西送进回收站（用户特意问过这件事）', () => {
  seedSpareFixture()
  useAppStore.getState().takeSpareOne('box')
  useAppStore.getState().takeSpareOne('box')

  eq(byId('box').status, 'active')
  const discarded = items().filter((i) => i.status === 'discarded').map((i) => i.id)
  eq(discarded.length, 1, '回收站里还是原来那一件，取用没往里加东西')
  eq(discarded[0], 'gone')
})

await test('对不是备用的东西取用是无操作，并且如实报告', () => {
  seedSpareFixture()
  const before = allUnits()

  const result = useAppStore.getState().takeSpareOne('main') // 在用

  eq(result.becameActive, false)
  eq(result.remaining, 0, '既没变成在用也没剩 —— 调用方据此说「这条不是备用」')
  eq(byId('main').quantity, 3, '不能改动它')
  eq(allUnits(), before)
})

await test('取用一条闲置的也不行 —— 闲置不是备用', () => {
  seedSpareFixture()

  const result = useAppStore.getState().takeSpareOne('old')

  eq(result.becameActive, false)
  eq(result.remaining, 0)
  eq(byId('old').status, 'idle', '闲置状态不能被误改')
})

/* ------------------------------------------------------------------ */
/* 统计：备用不能被算成闲置                                            */
/* ------------------------------------------------------------------ */

suite('备用：不进闲置统计')

await test('闲置占比的分母含备用，但分子绝不含', () => {
  seedSpareFixture()
  const stats = computeStats(useAppStore.getState().data)

  eq(stats.activeCount, 1, '在用的只有「牙膏」')
  eq(stats.idleCount, 1, '闲置只有「旧毛巾」')
  eq(stats.spareCount, 1, '备用单独算 —— 绝不能并进 idleCount')
  eq(stats.discardedCount, 1)
  eq(stats.totalItems, 3, '在用 + 闲置 + 备用 = 「我的东西」（不含已舍弃）')
})

await test('备用算进「我的东西」，但界面上的闲置条里不会冒出来', () => {
  seedSpareFixture()
  const data = useAppStore.getState().data

  const bars = countByStatus(data.items)
  const spareBar = bars.find((b) => b.key === 'spare')
  ok(spareBar !== undefined, '状态分布里要能看到备用这一条')
  eq(spareBar?.value, 1)

  const idleBar = bars.find((b) => b.key === 'idle')
  eq(idleBar?.value, 1, '闲置那一格的数字里不能混进备用')
})

await test('spareItems / totalUnits 只数备用，而且数的是件数', () => {
  seedSpareFixture()
  const data = useAppStore.getState().data

  eq(spareItems(data).length, 1, '一种备用')
  eq(totalUnits(spareItems(data)), 2, '两件备用')
})

/* ------------------------------------------------------------------ */
/* 备份往返                                                            */
/* ------------------------------------------------------------------ */

suite('备用：导出与导入')

await test('备用状态能原样往返，而且版本号是 6', () => {
  seedSpareFixture()
  const file = buildExportFile(useAppStore.getState().data)
  eq(file.schemaVersion, SCHEMA_VERSION)

  const parsed = parseExportFile(JSON.stringify(file))
  ok(parsed.ok, '自己导出的备份必须能导回来')
  if (!parsed.ok) return

  const spare = parsed.data.items.find((i) => i.id === 'box')
  ok(spare !== undefined, '备用那条要在')
  eq(spare?.status, 'spare', 'spare 是个合法状态，不能被校验吞掉')
  eq(spare?.quantity, 2)
})

await test('认不出来的状态会退回「在用」，而不是整条丢掉', () => {
  // 这条守的是「别人手改过的备份」这种情况：状态写错了，
  // 那件物品本身还有名字、还有位置 —— 为了一个状态词把它整条扔掉太狠了。
  seedSpareFixture()
  const raw = JSON.parse(
    JSON.stringify(buildExportFile(useAppStore.getState().data)),
  ) as { data: { items: Array<Record<string, unknown>> } }

  const target = raw.data.items.find((i) => i.id === 'box')
  if (target === undefined) throw new Error('夹具里应该有 box')
  target.status = '这个状态不存在'

  const parsed = parseExportFile(JSON.stringify(raw))
  ok(parsed.ok, '不该因为一个坏状态就拒绝整份备份')
  if (!parsed.ok) return

  const restored = parsed.data.items.find((i) => i.id === 'box')
  ok(restored !== undefined, '物品本身要留下')
  eq(restored?.status, 'active', '认不出来的状态退回在用')
})

/* ------------------------------------------------------------------ */
/* 隐藏开关                                                            */
/* ------------------------------------------------------------------ */

suite('备用：默认从物品列表里收起来')

await test('hideSpare 默认开，和 hideIdle 是两个独立的开关', () => {
  const prefs = useAppStore.getState().ui
  eq(prefs.hideSpare, true, '默认收起 —— 备用是特意囤的，不该混在日常清单里')
  eq(prefs.hideIdle, true)

  // 两个偏好必须能分别设置：关掉一个不能连带关掉另一个
  useAppStore.getState().setUi({ hideSpare: false })
  eq(useAppStore.getState().ui.hideSpare, false)
  eq(useAppStore.getState().ui.hideIdle, true, '关备用不能把闲置也放出来')
  useAppStore.getState().setUi({ hideSpare: true })
})
