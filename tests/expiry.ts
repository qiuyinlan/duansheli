/**
 * 物品有效期（过期时间）的测试。
 *
 * 挑的都是**错了很难发现**的地方：
 *   · 日期归一的时区陷阱（差一天）
 *   · 「没设置」和「已过期」必须分得开
 *   · 只为改有效期时，AI 那条链路不能把它当成「没改动」而跳过
 *   · 导出 → 导入往返（硬门禁，加了字段就必须守住）
 */

import { buildCsv } from '../src/data/exportCsv'
import { buildExportFile } from '../src/data/exportJson'
import { parseExportFile } from '../src/data/validate'
import {
  EXPIRY_SOON_DEFAULT_DAYS,
  compareExpiry,
  countByExpiryState,
  daysUntilExpiry,
  expiryState,
  isExpired,
  isExpiring,
  normalizeExpiryDate,
} from '../src/lib/expiry'
import {
  EMPTY_FILTER,
  computeStats,
  createDerived,
  filterItems,
  groupAndSort,
  sortItems,
} from '../src/store/selectors'
import { flushWrites, useAppStore } from '../src/store/useAppStore'
import { draftsFromItems, draftsToApply } from '../src/ai/convert'
import { parseExtraction, parseChatResponse } from '../src/ai/parse'
import { buildInventoryDigest, buildAiContext } from '../src/ai/prompts'
import { buildChatMessages, previewDraftPayload, serializeDrafts } from '../src/ai/chat'
import { createMatchContext } from '../src/ai/convert'
import type { Item } from '../src/types'
import { deepEq, eq, fixture, item, match, must, mustParse, ok, suite, test } from './harness'

/* ------------------------------------------------------------------ */
/* 工具：造一个「今天 + n 天」的日期串（本地日，不经 UTC）               */
/* ------------------------------------------------------------------ */

function isoDaysFromToday(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 用固定时刻测试，避免用例在午夜前后跑出不同结果 */
const NOON = new Date(2026, 5, 15, 12, 0, 0).getTime() // 2026-06-15 12:00 本地

/* ------------------------------------------------------------------ */
/* 1. 日期归一                                                         */
/* ------------------------------------------------------------------ */

suite('有效期：日期归一')

await test('认得出常见的几种写法', () => {
  eq(normalizeExpiryDate('2026-03-15'), '2026-03-15')
  eq(normalizeExpiryDate('2026/3/15'), '2026-03-15', '斜杠要认，个位数要补零')
  eq(normalizeExpiryDate('2026.3.15'), '2026-03-15')
  eq(normalizeExpiryDate('20260315'), '2026-03-15', '纯数字八位也要认')
  eq(normalizeExpiryDate('2026年3月15日'), '2026-03-15', '中文写法要认')
  eq(normalizeExpiryDate('  2026-03-15  '), '2026-03-15', '两头空格要吃掉')
})

await test('ISO 时间点只取日期部分，且不因时区把日子挪走一天', () => {
  // 这一条守的是一个很容易踩的坑：如果实现写成 new Date(x) 再取本地日期，
  // 东八区下 2026-03-15T23:00:00Z 会变成 16 号，用户会莫名其妙多一天。
  eq(normalizeExpiryDate('2026-03-15T23:00:00.000Z'), '2026-03-15')
  eq(normalizeExpiryDate('2026-03-15T00:00:00Z'), '2026-03-15')
  eq(normalizeExpiryDate('2026-03-15 08:30'), '2026-03-15')
})

await test('不存在的日期要拒绝，而不是悄悄挪到下个月', () => {
  eq(normalizeExpiryDate('2025-02-30'), null, '2 月没有 30 号')
  eq(normalizeExpiryDate('2026-13-01'), null, '没有 13 月')
  eq(normalizeExpiryDate('2026-00-10'), null)
  eq(normalizeExpiryDate('2026-03-32'), null)
})

await test('认不出来的一律当「没设置」，绝不瞎猜', () => {
  eq(normalizeExpiryDate(''), null)
  eq(normalizeExpiryDate('   '), null)
  eq(normalizeExpiryDate(null), null)
  eq(normalizeExpiryDate(undefined), null)
  eq(normalizeExpiryDate('明年三月'), null, '自然语言不该在这一层被猜')
  eq(normalizeExpiryDate('快过期了'), null)
  eq(normalizeExpiryDate(20260315), null, '数字类型不收，只收字符串')
})

/* ------------------------------------------------------------------ */
/* 2. 剩余天数与四档状态                                                */
/* ------------------------------------------------------------------ */

suite('有效期：剩余天数与四档状态')

await test('今天到期是 0 天，不是 1 天也不是 -1 天', () => {
  eq(daysUntilExpiry('2026-06-15', NOON), 0)
  eq(daysUntilExpiry('2026-06-16', NOON), 1)
  eq(daysUntilExpiry('2026-06-14', NOON), -1)
  eq(daysUntilExpiry(null, NOON), null, '没设置就没有天数')
})

await test('按本地日的零点比较，所以不会出现 ±1 天的漂移', () => {
  // 同一天里的任何时刻都应该算出 0
  const morning = new Date(2026, 5, 15, 0, 1, 0).getTime()
  const night = new Date(2026, 5, 15, 23, 59, 0).getTime()
  eq(daysUntilExpiry('2026-06-15', morning), 0)
  eq(daysUntilExpiry('2026-06-15', night), 0)
})

await test('四档状态：没设置 ≠ 已过期 ≠ 快到期 ≠ 还早', () => {
  const soon = 30
  eq(expiryState(null, soon, NOON), 'none')
  eq(expiryState('2026-06-14', soon, NOON), 'expired')
  eq(expiryState('2026-06-15', soon, NOON), 'soon', '今天到期算「快到期」')
  eq(expiryState('2026-07-15', soon, NOON), 'soon', '正好 30 天算「快到期」')
  eq(expiryState('2026-07-16', soon, NOON), 'ok', '第 31 天就不算急了')
})

await test('阈值可调，因为鲜奶和化妆品差得远', () => {
  eq(expiryState('2026-07-10', 3, NOON), 'ok', '按 3 天算，25 天后到期还早')
  eq(expiryState('2026-07-10', 30, NOON), 'soon', '按 30 天算就快了')
  eq(expiryState('2026-06-10', 3, NOON), 'expired', '过期与阈值无关')
})

await test('isExpired / isExpiring 的边界一致', () => {
  ok(isExpired('2026-06-14', NOON), '昨天到期就是过期')
  ok(!isExpired('2026-06-15', NOON), '今天到期还不算过期')
  ok(!isExpired(null, NOON), '没设置当然不算过期')
  ok(isExpiring('2026-06-15', 30, NOON), '今天到期要算进「要关注」')
  ok(!isExpiring(null, 30, NOON), '没设置不该出现在提醒里')
})

await test('统计四档时跳过已舍弃的', () => {
  const items: Item[] = [
    item({ id: 'a', name: 'a', expiresAt: isoDaysFromToday(-5) }),
    item({ id: 'b', name: 'b', expiresAt: isoDaysFromToday(3) }),
    item({ id: 'c', name: 'c', expiresAt: isoDaysFromToday(400) }),
    item({ id: 'd', name: 'd' }),
    item({ id: 'e', name: 'e', status: 'discarded', expiresAt: isoDaysFromToday(-300) }),
  ]
  const counts = countByExpiryState(items, 30)
  eq(counts.expired, 1, '扔掉的东西不该还在提醒你过期')
  eq(counts.soon, 1)
  eq(counts.ok, 1)
  eq(counts.none, 1)
})

await test('排序时没设置有效期的一律排在后面（升序降序都一样）', () => {
  // 返回正数 = a 排在 b 后面。所以「没设置的排最后」在升序下是：
  // a 有日期、b 没有 → a 在前（-1）；反过来 → 1
  eq(compareExpiry('2026-01-01', null), -1, '有日期的排前面')
  eq(compareExpiry(null, '2026-01-01'), 1, '没设置的排后面')
  eq(compareExpiry(null, null), 0)
  eq(compareExpiry('2026-01-01', '2026-02-01', 'asc'), -1)
  eq(compareExpiry('2026-01-01', '2026-02-01', 'desc'), 1)
})

/* ------------------------------------------------------------------ */
/* 3. 筛选 / 排序 / 分组 / 统计                                         */
/* ------------------------------------------------------------------ */

suite('有效期：筛选、排序、分组、统计')

const fx = fixture()

function mixedFixture() {
  const data = {
    ...fx,
    items: [
      item({ id: 'x1', name: '已过期的药', expiresAt: isoDaysFromToday(-10) }),
      item({ id: 'x2', name: '快过期的面霜', expiresAt: isoDaysFromToday(5) }),
      item({ id: 'x3', name: '还早的罐头', expiresAt: isoDaysFromToday(900) }),
      item({ id: 'x4', name: '没填日期的锅' }),
    ],
  }
  return { data, ctx: createDerived(data, EXPIRY_SOON_DEFAULT_DAYS) }
}

await test('按四档筛选，各自只出对的东西', () => {
  const { data, ctx: c } = mixedFixture()

  const expired = filterItems(data.items, { ...EMPTY_FILTER, expiryStates: ['expired'] }, c)
  deepEq(
    expired.map((i) => i.id),
    ['x1'],
  )

  const soon = filterItems(data.items, { ...EMPTY_FILTER, expiryStates: ['soon'] }, c)
  deepEq(
    soon.map((i) => i.id),
    ['x2'],
  )

  // 「没设置」也要能被单独筛出来 —— 用户经常反过来找「哪些还没填」
  const none = filterItems(data.items, { ...EMPTY_FILTER, expiryStates: ['none'] }, c)
  deepEq(
    none.map((i) => i.id),
    ['x4'],
  )

  const urgent = filterItems(
    data.items,
    { ...EMPTY_FILTER, expiryStates: ['expired', 'soon'] },
    c,
  )
  eq(urgent.length, 2, '两档可以一起选')
})

await test('空数组 = 不按有效期筛，不会把东西全滤掉', () => {
  const { data, ctx: c } = mixedFixture()
  eq(filterItems(data.items, EMPTY_FILTER, c).length, 4)
})

await test('按有效期排序：最急的在最前，没填的在最后', () => {
  const { data, ctx: c } = mixedFixture()
  const sorted = sortItems(data.items, 'expiry', 'asc', c)
  deepEq(
    sorted.map((i) => i.id),
    ['x1', 'x2', 'x3', 'x4'],
    '升序：过期最久的 → 快过期 → 还早 → 没填',
  )

  const desc = sortItems(data.items, 'expiry', 'desc', c)
  eq(must(desc[desc.length - 1], '应该有最后一项').id, 'x4', '倒序时没填的依然在最后')
})

await test('按有效期分组：四档桶齐全，顺序是「最该处理的排最前」', () => {
  const { data, ctx: c } = mixedFixture()
  const groups = groupAndSort(data.items, 'expiry', 'expiry', 'asc', c)
  deepEq(
    groups.map((g) => g.key),
    ['__expired__', '__expiring_soon__', '__expiry_ok__', '__no_expiry__'],
  )
})

await test('统计数字与筛选结果对得上', () => {
  const { data } = mixedFixture()
  const stats = computeStats(data, EXPIRY_SOON_DEFAULT_DAYS)
  eq(stats.expiredCount, 1)
  eq(stats.expiringSoonCount, 1)
  eq(stats.hasExpiryCount, 3, '填过日期的有 3 件（含还早的）')
})

/* ------------------------------------------------------------------ */
/* 4. 导出 → 导入 往返（硬门禁）                                        */
/* ------------------------------------------------------------------ */

suite('有效期：导出与导入')

await test('有效期经导出再导入后逐字段一致', () => {
  const data = { ...fx, items: mixedFixture().data.items }
  const parsed = mustParse(parseExportFile(JSON.stringify(buildExportFile(data))))
  deepEq(
    parsed.data.items.map((i) => i.expiresAt),
    data.items.map((i) => i.expiresAt),
    '有效期必须原样往返，丢了就等于用户的记录没了',
  )
})

await test('老备份（没有 expiresAt 字段）能正常导入，缺的补成 null', () => {
  const file = buildExportFile(fx)
  // 手工模拟一份旧版本导出的文件：把 expiresAt 全删掉
  const raw = JSON.parse(JSON.stringify(file)) as Record<string, unknown>
  const inner = raw.data as { items: Array<Record<string, unknown>> }
  for (const it of inner.items) delete it.expiresAt

  const parsed = mustParse(parseExportFile(JSON.stringify(raw)))
  for (const it of parsed.data.items) {
    eq(it.expiresAt, null, '缺字段不该让导入失败，也不该造出一个假日期')
  }
})

await test('备份里写了坏日期 → 当成「没设置」，而不是拒绝整份文件', () => {
  const raw = JSON.parse(JSON.stringify(buildExportFile(fx))) as Record<string, unknown>
  const inner = raw.data as { items: Array<Record<string, unknown>> }
  const first = must(inner.items[0], '应该有第一条')
  first.expiresAt = '2025-02-30' // 格式对、日期不存在

  const parsed = mustParse(parseExportFile(JSON.stringify(raw)))
  eq(
    must(parsed.data.items[0], '应该有第一条').expiresAt,
    null,
    '一条坏日期不该让用户整份备份都导不进来',
  )
})

await test('CSV 里有有效期这一列，没填就是空格子', () => {
  const data = { ...fx, items: mixedFixture().data.items }
  const csv = buildCsv(data, createDerived(data))
  match(csv, /名称,数量,状态,有效期至,/, '表头里要有有效期至')
  ok(csv.includes(isoDaysFromToday(-10)), '填了的要导出日期')
})

/* ------------------------------------------------------------------ */
/* 5. store：设/清有效期，且不动别的字段                                */
/* ------------------------------------------------------------------ */

suite('有效期：store')

function seedStore(data = fx): void {
  useAppStore.setState({
    status: 'ready',
    error: null,
    data,
    derived: createDerived(data),
  })
}

await test('setExpiry 批量设日期', async () => {
  seedStore()
  useAppStore.getState().setExpiry(['i1', 'i2'], '2026-03-15')
  const state = useAppStore.getState()
  eq(must(state.data.items.find((i) => i.id === 'i1'), 'i1').expiresAt, '2026-03-15')
  eq(must(state.data.items.find((i) => i.id === 'i2'), 'i2').expiresAt, '2026-03-15')
  eq(must(state.data.items.find((i) => i.id === 'i3'), 'i3').expiresAt, null, '没点的不该被改')
  await flushWrites()
})

await test('setExpiry 传 null 是清掉，不是写个空字符串', async () => {
  seedStore()
  useAppStore.getState().setExpiry(['i1'], '2026-03-15')
  useAppStore.getState().setExpiry(['i1'], null)
  eq(must(useAppStore.getState().data.items.find((i) => i.id === 'i1'), 'i1').expiresAt, null)
  await flushWrites()
})

await test('设有效期**不改 status** —— 到期不等于闲置，更不等于要扔', async () => {
  seedStore()
  const before = must(useAppStore.getState().data.items.find((i) => i.id === 'i3'), 'i3')
  eq(before.status, 'idle', '夹具里 i3 是闲置的')

  useAppStore.getState().setExpiry(['i3'], isoDaysFromToday(-100))
  const after = must(useAppStore.getState().data.items.find((i) => i.id === 'i3'), 'i3')
  eq(after.expiresAt, isoDaysFromToday(-100), '日期设上了')
  eq(after.status, 'idle', '但状态一个字节都不该动')
  await flushWrites()
})

await test('录入与更新都能带上有效期，且会归一化', async () => {
  seedStore()
  useAppStore.getState().addItem({ name: '新药', expiresAt: '2027/1/5' })
  const added = must(
    useAppStore.getState().data.items.find((i) => i.name === '新药'),
    '新药应存在',
  )
  eq(added.expiresAt, '2027-01-05', '斜杠写法要归一')

  useAppStore.getState().updateItem(added.id, { expiresAt: '2028年2月29日' })
  eq(
    must(useAppStore.getState().data.items.find((i) => i.id === added.id), '新药').expiresAt,
    '2028-02-29',
    '2028 是闰年，2 月 29 日合法',
  )
  await flushWrites()
})

/* ------------------------------------------------------------------ */
/* 6. AI：能填、能查、且「只改有效期」不会被当成没改动                   */
/* ------------------------------------------------------------------ */

suite('有效期：AI 链路')

await test('AI 回复里的有效期会被解析，格式乱当没写', () => {
  const parsed = parseExtraction({
    items: [
      { name: '感冒药', expiresAt: '2026-03-15' },
      { name: '面霜', 有效期: '2026/3/15' },
      { name: '罐头', 过期时间: '20260315' },
      { name: '说不清的', expiresAt: '明年三月' },
      { name: '没提的' },
    ],
  })
  eq(must(parsed.items[0], '第 1 条').expiresAt, '2026-03-15')
  eq(must(parsed.items[1], '第 2 条').expiresAt, '2026-03-15', '中文键名也要认')
  eq(must(parsed.items[2], '第 3 条').expiresAt, '2026-03-15')
  eq(must(parsed.items[3], '第 4 条').expiresAt, null, '认不出来就是 null，绝不瞎猜')
  eq(must(parsed.items[4], '第 5 条').expiresAt, null)
})

await test('对话回复里的有效期同样能读出来', () => {
  const parsed = parseChatResponse({
    reply: '给感冒药加上了有效期',
    items: [{ id: 'i1', name: '感冒药', expiresAt: '2026-09-01' }],
  })
  eq(must(parsed.items[0], '应该有改动').expiresAt, '2026-09-01')
})

await test('只改有效期也算「改动了」—— 否则用户的修改会被静默丢掉', async () => {
  // 这是整个有效期功能里最危险的一处：草稿与库里的内容做一个「指纹」比较，
  // 指纹没变就跳过不写。如果指纹漏了 expiresAt，那么「AI 只帮我补了有效期」
  // 这种情况会被判成「没改动」，用户看到 AI 说改好了、采纳后却什么也没发生。
  const data = fixture()
  const target = must(data.items.find((i) => i.id === 'i1'), '找不到 i1')
  const c = createDerived(data)
  const match_ = createMatchContext(data, c)

  // 先确认：一模一样时，确实是「没改动」被跳过
  const same = draftsFromItems([target], match_, c)
  const noop = draftsToApply(same, data.items, c)
  eq(noop.untouched, 1, '完全没变时应该跳过')

  // 只加有效期 → 必须判为「有改动」
  const withExpiry = draftsFromItems([target], match_, c).map((d) => ({
    ...d,
    expiresAt: '2026-12-31',
  }))
  const applied = draftsToApply(withExpiry, data.items, c)
  eq(applied.updating, 1, '只改了有效期也必须去更新')
  eq(applied.untouched, 0)
  eq(must(applied.plan[0], '应该有计划').expiresAt, '2026-12-31')
})

await test('清空有效期同样算改动', () => {
  const data = fixture()
  data.items[0] = { ...must(data.items[0], 'i1'), expiresAt: '2026-12-31' }
  const c = createDerived(data)
  const match_ = createMatchContext(data, c)
  const target = must(data.items[0], 'i1')

  const cleared = draftsFromItems([target], match_, c).map((d) => ({ ...d, expiresAt: null }))
  const applied = draftsToApply(cleared, data.items, c)
  eq(applied.updating, 1, '把日期清掉也是改动')
  eq(must(applied.plan[0], '应该有计划').expiresAt, null)
})

await test('有效期会跟着草稿发给 AI；没设置时不占 token', () => {
  const data = fixture()
  const c = createDerived(data)
  const match_ = createMatchContext(data, c)

  // 真正发出去的是「压缩过」的形状（空字段整条不发），不是 serializeDrafts 的全量形状
  const plain = previewDraftPayload(
    serializeDrafts(draftsFromItems([must(data.items[1], 'i2')], match_, c), c),
  )
  ok(!plain.includes('expiresAt'), '没设置就完全不发这个字段')

  const dated = previewDraftPayload(
    serializeDrafts(
      draftsFromItems([must(data.items[0], 'i1')], match_, c).map((d) => ({
        ...d,
        expiresAt: '2026-12-31',
      })),
      c,
    ),
  )
  ok(dated.includes('2026-12-31'), '设置了就要发，AI 得知道现状')
})

await test('loadScope 支持按有效期取数', async () => {
  const { itemsForLoadScope } = await import('../src/ai/convert')
  const data = { ...fixture(), items: mixedFixture().data.items }
  const c = createDerived(data, EXPIRY_SOON_DEFAULT_DAYS)

  const expiring = itemsForLoadScope({ expiring: true }, data, c, EXPIRY_SOON_DEFAULT_DAYS)
  deepEq(
    expiring.map((i) => i.id).sort(),
    ['x1', 'x2'],
    'expiring = 已过期 + 快过期',
  )

  const expired = itemsForLoadScope({ expired: true }, data, c, EXPIRY_SOON_DEFAULT_DAYS)
  deepEq(
    expired.map((i) => i.id),
    ['x1'],
  )

  const hasExpiry = itemsForLoadScope({ hasExpiry: true }, data, c, EXPIRY_SOON_DEFAULT_DAYS)
  eq(hasExpiry.length, 3, '填过有效期的有 3 件，不管过没过期')
})

await test('提示词里写清了 expiresAt 怎么用，且要求「只改有效期也要写回去」', () => {
  const data = fixture()
  const c = createDerived(data)
  const messages = buildChatMessages(
    buildAiContext(data, c),
    buildInventoryDigest(data, c),
    [],
    [],
    '这盒药明年 3 月过期',
  )
  const all = messages.map((m) => m.content).join('\n')
  ok(all.includes('expiresAt'), '要告诉 AI 有这么一个字段')
  ok(all.includes('YYYY-MM-DD'), '要写清格式')
  ok(all.includes('不要自己推算') || all.includes('不要编造'), '禁止它瞎编日期')
})
