/**
 * **AI 新建位置**（用户报的那个：「需要可以新建位置」）。
 *
 * 用户的原话是一段真实对话：
 * > 他：「在 左边小小型一号白色四层收纳/顶层，新建这个位置」
 * > AI：「「新建位置」单独出现时建不了 —— 位置是跟着物品一起产生的。
 * >   你是想把某件东西放进…吗？」
 * > 他：「需要可以新建位置」
 *
 * 那条限制（位置只能跟着物品产生）对「先把架子搭好、再往格子里放东西」的用法
 * 是完全挡路的 —— 而那正是他的用法（他一次要建好几层收纳架）。
 *
 * ── 这一组用例守什么 ────────────────────────────────────────────
 * 位置是**结构**：建错了你只会看到「树变了样子」。所以：
 *   · 「算」的部分（缺哪几级、是不是已经有了）逐条钉死
 *   · 落库是纯函数，能被直接调用
 *   · **不许和分类混**：两个协议的形状一样（都有 kind 和 path），
 *     认错就是把位置建成分类，而界面上一句错话都不会说
 */

import { parseChatResponse } from '../src/ai/parse'
import {
  applyLocationPlan,
  countLocationChanges,
  planLocationChanges,
} from '../src/ai/locationEdit'
import { promptTextEn } from '../src/ai/promptText/en'
import { promptTextZh } from '../src/ai/promptText/zh'
import { createTreeIndex } from '../src/lib/tree'
import { createSeedData } from '../src/storage/seed'
import type { AppData, Location } from '../src/types'
import { contains, eq, must, ok, suite, test } from './harness'

const NOW = '2026-01-01T00:00:00.000Z'

function location(id: string, name: string, parentId: string | null, order: number): Location {
  return { id, name, parentId, order, note: '', createdAt: NOW }
}

/**
 * 夹具照抄用户真实那套位置（他报的原话里的名字）。
 *
 * 「左边小小型一号白色四层收纳」**故意不建** —— 他这次要建的正是它。
 */
function data(): AppData {
  const seed = createSeedData('zh')
  return {
    ...seed,
    locations: [
      location('l-desk', '桌子', null, 0),
      location('l-under', '桌子下', 'l-desk', 0),
      location('l-blue', '蓝色柜', 'l-under', 0),
      location('l-white3', '白色三层收纳', 'l-under', 1),
      location('l-white3-2', '2层', 'l-white3', 0),
    ],
    categories: seed.categories,
    items: [],
  }
}

const fx = data()

/* ------------------------------------------------------------------ */
/* 一、解析（模型给什么形状，认不认）                                   */
/* ------------------------------------------------------------------ */

suite('新建位置：解析模型给的形状')

await test('★ 认得 locationChanges（用户那句原话的形状）', () => {
  const parsed = parseChatResponse({
    reply: '在新收纳架下面建一个顶层',
    locationChanges: [
      { kind: 'create', path: ['左边小小型一号白色四层收纳', '顶层'] },
    ],
  })
  eq(parsed.locationChanges.length, 1)
  eq(parsed.locationChanges[0]?.kind, 'create')
  eq(parsed.locationChanges[0]?.path.join(' / '), '左边小小型一号白色四层收纳 / 顶层')
  eq(parsed.ignoredLocationChanges, 0)
})

await test('中文键名、字符串路径、只给名字都认', () => {
  const parsed = parseChatResponse({
    reply: '建好了',
    位置改动: [{ 操作: '新建', 位置: '客厅 / 电视柜 / 第二层' }],
  })
  eq(parsed.locationChanges[0]?.path.join('/'), '客厅/电视柜/第二层')

  const byName = parseChatResponse({
    reply: '建好了',
    locationChanges: [{ kind: 'create', newName: '顶层', parentPath: ['收纳架'] }],
  })
  eq(byName.locationChanges[0]?.path.join('/'), '顶层', '只给名字时，名字就是路径末级')
  eq(byName.locationChanges[0]?.parentPath?.join('/'), '收纳架')
})

await test('★ 只写「新建位置」那一句也能解析出来（他这次的用法）', () => {
  /* 没有 items、没有 categoryChanges，只有一条位置新建 */
  const parsed = parseChatResponse({
    reply: '好，我把这个位置建出来',
    locationChanges: [{ kind: 'create', path: ['左边小小型一号白色四层收纳', '顶层'] }],
  })
  eq(parsed.noChanges, false, '这不是纯问答 —— 有一件事要做')
  eq(parsed.locationChanges.length, 1)
})

await test('★ 位置新建**绝不能**被当成分类改动', () => {
  /*
   * 两个协议的形状一模一样（都有 kind 和 path）。分类那边有个「兜底扫描」：
   * 名单里没有的键里，只要有个数组看起来像改动，就当成分类改动。
   * 不把 locationChanges 从那个扫描里排除掉，这里就会变成
   * 「新建一个叫『顶层』的分类」—— 树动错了地方，而界面上一句错话都不会说。
   */
  const parsed = parseChatResponse({
    reply: '建好了',
    locationChanges: [{ kind: 'create', path: ['收纳架', '顶层'] }],
  })
  eq(parsed.categoryChanges.length, 0, '位置新建不许变成分类改动')
  eq(parsed.locationChanges.length, 1)
})

await test('不认识的键名：位置那边照实说「我没读懂」', () => {
  const parsed = parseChatResponse({
    reply: '建好了',
    placeDraft: [{ kind: 'create', path: ['收纳架', '顶层'] }],
  })
  eq(parsed.locationChanges.length, 0)
  ok(
    parsed.ignoredLocationChanges > 0,
    '键名看着就是在说位置（place），却一条都没解析出来 —— 必须报出来',
  )
})

await test('改名 / 移动位置这一版不做：不认，也不硬塞进分类', () => {
  const parsed = parseChatResponse({
    reply: '位置现在只能新建',
    locationChanges: [{ kind: 'rename', path: ['收纳架'], newName: '架子' }],
  })
  eq(parsed.locationChanges.length, 0, '没实现的动作不许假装认了')
  eq(parsed.categoryChanges.length, 0, '更不许变成分类改动')
})

/* ------------------------------------------------------------------ */
/* 二、算计划                                                          */
/* ------------------------------------------------------------------ */

suite('新建位置：算计划')

await test('★ 路径里缺的中间层会一起建出来，而且一级一级列出来', () => {
  const plan = planLocationChanges(fx, [
    { kind: 'create', path: ['左边小小型一号白色四层收纳', '顶层'] },
  ])
  const entry = must(plan.entries[0], '应该有一条计划')
  eq(entry.status, 'ok')
  eq(entry.toLabel, '左边小小型一号白色四层收纳 / 顶层')
  eq(
    entry.willCreate.join(' | '),
    '左边小小型一号白色四层收纳 | 顶层',
    '两级都不在库里，两个都要建 —— 界面会把它摆给用户看',
  )
  eq(entry.newParentId, null, '最上面那一级的父级是顶层')
  eq(plan.problems, 0)
})

await test('父级已经有的，就用现成的（不重复建）', () => {
  const plan = planLocationChanges(fx, [
    { kind: 'create', path: ['桌子', '桌子下', '左边小小型一号白色四层收纳'] },
  ])
  const entry = must(plan.entries[0], '应该有一条计划')
  eq(entry.newParentId, 'l-under', '父级对上「桌子下」')
  eq(entry.willCreate.join('|'), '左边小小型一号白色四层收纳', '只建缺的那一级')
})

await test('★ 库里已经有了 → 说「不用建」，不是报错', () => {
  const plan = planLocationChanges(fx, [{ kind: 'create', path: ['桌子', '桌子下', '蓝色柜'] }])
  const entry = must(plan.entries[0], '应该有一条计划')
  eq(entry.status, 'duplicate')
  eq(entry.willCreate.length, 0, '什么都不用建')
  eq(plan.problems, 1, '它要单独说一句，别让用户以为要建')
})

await test('名字大小写 / 空格不同也算同一个（和别处的归一化一致）', () => {
  const plan = planLocationChanges(fx, [{ kind: 'create', path: ['  桌子  ', '桌子下'] }])
  eq(plan.entries[0]?.status, 'duplicate', '去空格之后就是「桌子 / 桌子下」')
})

/* ------------------------------------------------------------------ */
/* 三、落库（纯函数）                                                  */
/* ------------------------------------------------------------------ */

suite('新建位置：落库')

await test('★ 一条计划建出一整条路径，路径连得对', () => {
  const plan = planLocationChanges(fx, [
    { kind: 'create', path: ['左边小小型一号白色四层收纳', '顶层'] },
  ])
  const result = applyLocationPlan(fx, plan.entries, NOW)

  eq(result.created, 2, '两级都要建出来')
  eq(result.data.locations.length, fx.locations.length + 2)

  const index = createTreeIndex(result.data.locations)
  const created = must(
    result.data.locations.find((l) => l.name === '顶层'),
    '应该建出了「顶层」',
  )
  eq(index.pathString(created.id, ' / '), '左边小小型一号白色四层收纳 / 顶层')
})

await test('中间层已经有的，只补缺的那一级', () => {
  const plan = planLocationChanges(fx, [
    { kind: 'create', path: ['桌子', '桌子下', '白色三层收纳', '3层'] },
  ])
  const result = applyLocationPlan(fx, plan.entries, NOW)
  eq(result.created, 1, '「桌子 / 桌子下 / 白色三层收纳」都在，只建「3层」')

  const index = createTreeIndex(result.data.locations)
  const created = must(result.data.locations.find((l) => l.name === '3层'), '应该建出「3层」')
  eq(index.pathString(created.id, ' / '), '桌子 / 桌子下 / 白色三层收纳 / 3层')
})

await test('★ 用户勾掉的条目一条都不建', () => {
  const plan = planLocationChanges(fx, [
    { kind: 'create', path: ['甲架', '1层'] },
    { kind: 'create', path: ['乙架', '1层'] },
  ])
  const entries = plan.entries.map((entry, index) =>
    index === 0 ? entry : { ...entry, include: false },
  )
  const result = applyLocationPlan(fx, entries, NOW)

  /* 「甲架 → 1层」是两级，所以是 2 个位置 */
  eq(result.created, 2)
  ok(!result.data.locations.some((l) => l.name === '乙架'), '勾掉的不许偷偷建')
  ok(result.data.locations.some((l) => l.name === '甲架'))
})

await test('「已经有了」的条目不会被当成失败，也不会多建一个', () => {
  const plan = planLocationChanges(fx, [{ kind: 'create', path: ['桌子', '桌子下', '蓝色柜'] }])
  const result = applyLocationPlan(fx, plan.entries, NOW)
  eq(result.created, 0)
  eq(result.data.locations.length, fx.locations.length, '一个都没多')
})

await test('同级 order 不撞（撞了界面上顺序就随缘了）', () => {
  const plan = planLocationChanges(fx, [
    { kind: 'create', path: ['四层架', '1层'] },
    { kind: 'create', path: ['四层架', '2层'] },
    { kind: 'create', path: ['四层架', '3层'] },
  ])
  const result = applyLocationPlan(fx, plan.entries, NOW)

  const rack = must(result.data.locations.find((l) => l.name === '四层架'), '应该建出四层架')
  const layers = result.data.locations.filter((l) => l.parentId === rack.id)
  eq(layers.length, 3, '三个层都要挂在新架子上')
  const orders = layers.map((l) => l.order)
  eq(new Set(orders).size, orders.length, `order 必须互不相同，实际：${orders.join(',')}`)
})

await test('countLocationChanges 数的是「真会建」的那几条', () => {
  const plan = planLocationChanges(fx, [
    { kind: 'create', path: ['甲架'] },
    { kind: 'create', path: ['桌子', '桌子下', '蓝色柜'] },
  ])
  eq(countLocationChanges(plan.entries), 1, '「已经有了」的那条不算')
})

/* ------------------------------------------------------------------ */
/* 四、提示词（教过没有）                                              */
/* ------------------------------------------------------------------ */

suite('新建位置：提示词里教过')

await test('★ 中英两份都写了 locationChanges，而且说清了「中间缺的层会一起建」', () => {
  for (const [lang, text] of [
    ['zh', promptTextZh.chatSystem],
    ['en', promptTextEn.chatSystem],
  ] as const) {
    contains(text, 'locationChanges', `${lang}：得告诉模型有这个字段`)
    ok(
      text.includes('locationChanges') && /缺的|missing/.test(text),
      `${lang}：要说清「中间哪几级没有也没关系，程序会一起建出来」`,
    )
  }
})

await test('★ 中英两份都不再说「新建位置单独出现时什么也建不了」', () => {
  /*
   * 那句话是上一轮我写进去的（当时还没实现），现在**它变成了错的** ——
   * 留着的话模型会继续拒绝用户的请求，而且拒绝得理直气壮。
   */
  for (const [lang, text] of [
    ['zh', promptTextZh.chatSystem],
    ['en', promptTextEn.chatSystem],
  ] as const) {
    ok(
      !/什么也建不了|creates\s*\n?nothing/.test(text),
      `${lang}：这条过期的说法必须删掉`,
    )
  }
})

await test('提示词里说清了「位置这一版只有新建」', () => {
  ok(
    promptTextZh.chatSystem.includes('只有「新建」') || promptTextZh.chatSystem.includes('只有这一个动作') || promptTextZh.chatSystem.includes('只有「新建」'),
    '中文要说明别的动作没做，免得模型硬塞给分类',
  )
  ok(
    promptTextEn.chatSystem.includes('create only'),
    '英文也要有同一条',
  )
})
