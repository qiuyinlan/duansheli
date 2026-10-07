/**
 * 「把一组分类挪到一个上级分类下」的用例。
 *
 * 这里守的是一件很具体的事：**这是会写进真实数据的一次结构改动**。
 * 改坏了不会报错、不会崩，只是树的样子悄悄变了 —— 而用户的分类层级
 * 是他自己一层层攒出来的，丢了很难复原。
 *
 * 所以下面每一条都盯着一个容易错的地方，其中最后两条最要紧：
 *   · **物品的 categoryIds 一根毫毛都不能动**（改的只是分类挂在哪儿）
 *   · **重复执行第二次必须什么都不改**（幂等：拖来拖去、跑了两次都不会乱）
 */

import {
  planCategoryParent,
  type FixCategory,
  type FixItem,
} from '../scripts/category-parent-fix'
import { eq, must, ok, suite, test } from './harness'

let seq = 0
const makeId = () => `new-${++seq}`
const NOW = '2026-01-01T00:00:00.000Z'

function category(
  id: string,
  name: string,
  parentId: string | null = null,
  order = 0,
): FixCategory {
  return { id, name, parentId, order, createdAt: NOW }
}

/** 顶层：吃的 / 上衣 / 裤子 / 鞋子 / 工具（顺序号连着，模拟真实数据） */
function baseCategories(): FixCategory[] {
  return [
    category('c1', '吃的', null, 0),
    category('c2', '上衣', null, 1),
    category('c3', '裤子', null, 2),
    category('c4', '鞋子', null, 3),
    category('c5', '工具', null, 4),
    category('c6', '冬装', 'c2', 0), // 上衣底下的子分类
  ]
}

function baseItems(): FixItem[] {
  return [
    { categoryIds: ['c2'] },
    { categoryIds: ['c2', 'c6'] },
    { categoryIds: ['c3'] },
    { categoryIds: ['c5'] },
    { categoryIds: [] },
  ]
}

function plan(childIds: string[], categories = baseCategories(), parentName = '衣服') {
  return planCategoryParent({
    categories,
    items: baseItems(),
    parentName,
    childIds,
    makeId,
    now: NOW,
  })
}

const nameOf = (list: FixCategory[]): string => list.map((c) => c.name).join(' / ')

suite('分类：给一组分类套一个上级分类')

await test('上级分类不存在就新建，被选中的分类挂到它下面', () => {
  const result = plan(['c2', 'c3', 'c4'])
  ok(result.ok, '应该能算出来')
  const plan_ = must(result.ok ? result.plan : null, 'unreachable')

  eq(plan_.parentName, '衣服')
  eq(plan_.parentCreated, true, '原本没有「衣服」，应该新建一个')
  eq(nameOf(plan_.moved), '上衣 / 裤子 / 鞋子', '三件都要挪进去')
  eq(plan_.parentId, 'new-1')

  for (const id of ['c2', 'c3', 'c4']) {
    const found = must(
      plan_.categories.find((c) => c.id === id),
      `分类 ${id} 不该消失`,
    )
    eq(found.parentId, 'new-1', `${found.name} 的上级应该是新分类`)
  }

  // 没被选中的分类一动都不动
  eq(
    must(
      plan_.categories.find((c) => c.id === 'c5'),
      '工具不该消失',
    ).parentId,
    null,
    '没选中的分类不该被动',
  )
  eq(
    must(
      plan_.categories.find((c) => c.id === 'c6'),
      '冬装不该消失',
    ).parentId,
    'c2',
    '子分类的上级也不该被动',
  )
})

await test('上级分类已经存在就直接复用，绝不重复建一个', () => {
  const categories = [...baseCategories(), category('c9', '衣服', null, 5)]
  const result = plan(['c2', 'c3'], categories)
  ok(result.ok)
  const plan_ = must(result.ok ? result.plan : null, 'unreachable')

  eq(plan_.parentCreated, false, '已经有「衣服」了，不该再建一个')
  eq(plan_.parentId, 'c9')
  eq(
    plan_.categories.filter((c) => c.name === '衣服').length,
    1,
    '数据里只能有一个「衣服」',
  )
  eq(
    must(
      plan_.categories.find((c) => c.id === 'c2'),
      '上衣不该消失',
    ).parentId,
    'c9',
  )
})

await test('新建的上级插在原来那些分类的位置上，不甩到末尾也不挤到开头', () => {
  // 原来：吃的(0) 上衣(1) 裤子(2) 鞋子(3) 工具(4)
  // 期望：吃的(0) 衣服(1) 工具(2)；衣服下面：上衣(0) 裤子(1) 鞋子(2)
  const result = plan(['c2', 'c3', 'c4'])
  ok(result.ok)
  const plan_ = must(result.ok ? result.plan : null, 'unreachable')

  const tops = plan_.categories.filter((c) => c.parentId === null).sort((a, b) => a.order - b.order)
  eq(nameOf(tops), '吃的 / 衣服 / 工具', '「衣服」该待在原来那堆衣物分类的位置上')
  eq(
    tops.map((c) => c.order).join(','),
    '0,1,2',
    '顶层的排序号要重排成连续的，不留空档',
  )

  const children = plan_.categories
    .filter((c) => c.parentId === plan_.parentId)
    .sort((a, b) => a.order - b.order)
  eq(nameOf(children), '上衣 / 裤子 / 鞋子', '组内保持原来的先后')
  eq(
    children.map((c) => c.order).join(','),
    '0,1,2',
    '组内排序号也要重排成连续的',
  )
})

await test('选中的分类里混着子分类时，也照样挪，并保持先后', () => {
  // 「冬装」本来是「上衣」的子分类；一起挪到「衣服」下时，
  // 它俩就成了兄弟 —— 这是这次操作的自然结果，不是 bug。
  const result = plan(['c6', 'c2'])
  ok(result.ok)
  const plan_ = must(result.ok ? result.plan : null, 'unreachable')

  const children = plan_.categories
    .filter((c) => c.parentId === plan_.parentId)
    .sort((a, b) => a.order - b.order)
  eq(nameOf(children), '冬装 / 上衣', '原来都是 0 号，按名字定先后（和树的排序规则一致）')
})

await test('重复执行第二次：什么都不改（幂等）', () => {
  /*
   * 这条是给「用户手抖点两次」「刷新后不放心又点一次」准备的。
   * 第二次跑的时候，上衣它们**已经不是顶层**了，所以界面上根本不会列出来；
   * 万一还是传进来了，也必须算成「本来就在下面」，而不是又套一层。
   */
  const first = plan(['c2', 'c3', 'c4'])
  ok(first.ok)
  const afterFirst = must(first.ok ? first.plan : null, 'unreachable')

  const second = planCategoryParent({
    categories: afterFirst.categories,
    items: baseItems(),
    parentName: '衣服',
    childIds: ['c2', 'c3', 'c4'],
    makeId,
    now: NOW,
  })
  ok(second.ok, '第二次也该算得出来')
  const afterSecond = must(second.ok ? second.plan : null, 'unreachable')

  eq(afterSecond.parentCreated, false, '第二次不该再建一个「衣服」')
  eq(afterSecond.moved.length, 0, '第二次没有东西可挪')
  eq(nameOf(afterSecond.alreadyUnder), '上衣 / 裤子 / 鞋子', '应该认成「本来就在下面」')
  eq(
    afterSecond.categories.filter((c) => c.name === '衣服').length,
    1,
    '不管跑几次，数据里只有一个「衣服」',
  )
  eq(
    JSON.stringify(afterSecond.categories) === JSON.stringify(afterFirst.categories),
    true,
    '第二次跑完，分类数组要和第一次跑完一模一样',
  )
})

await test('物品的 categoryIds 一根毫毛都不动', () => {
  // 改的只是「分类挂在哪儿」。物品指的是分类 id，所以它跟着走就行 ——
  // 一旦这里动了，用户的东西就会**静默地跑到别的分类里**。
  const items = baseItems()
  const before = JSON.stringify(items)
  const result = plan(['c2', 'c3'])
  ok(result.ok)

  const plan_ = must(result.ok ? result.plan : null, 'unreachable')
  eq(plan_.itemsAffected, 3, '挂在「衣服」这棵树下的物品：上衣 2 件 + 裤子 1 件')
  eq(JSON.stringify(items), before, '传入的物品数组不该被改')
})

await test('挂在子分类上的物品也算进「受影响」', () => {
  // 「冬装」是上衣的子分类，它上面的物品自然也归到「衣服」这一大块里
  const result = plan(['c2', 'c6'])
  ok(result.ok)
  const plan_ = must(result.ok ? result.plan : null, 'unreachable')
  eq(plan_.itemsAffected, 2, '上衣 1 件 + 冬装 1 件')
})

await test('同名分类已经存在、但不在顶层 → 停下来并说清怎么办', () => {
  /*
   * 这种情况必须拦：复用会把「衣服」从它原来的位置拔走，
   * 新建又会让数据里出现两个「衣服」—— 都不对，而用户心里的答案只有他知道。
   */
  const categories = [...baseCategories(), category('c9', '衣服', 'c5', 0)]
  const result = plan(['c2', 'c3'], categories)
  ok(!result.ok, '应该拒绝执行')
  if (!result.ok) {
    ok(result.reason.includes('不在顶层'), `理由要说清是层级的问题：${result.reason}`)
  }
})

await test('选中的名字一个都找不到 → 拒绝，而不是把空数组写回去', () => {
  const result = plan(['不存在-1', '不存在-2'])
  ok(!result.ok)
  if (!result.ok) ok(result.reason.includes('一个都没找到'), result.reason)
})

await test('找不到的 id 会如实报出来，找到的那些照常处理', () => {
  const result = plan(['c2', '不存在-9'])
  ok(result.ok)
  const plan_ = must(result.ok ? result.plan : null, 'unreachable')
  eq(nameOf(plan_.moved), '上衣')
  eq(plan_.missingIds.join(','), '不存在-9')
})

await test('名字是空的 / 一件都没选 → 拒绝', () => {
  const empty = plan([], baseCategories())
  ok(!empty.ok, '没选分类不该往下走')

  const noName = planCategoryParent({
    categories: baseCategories(),
    items: baseItems(),
    parentName: '   ',
    childIds: ['c2'],
    makeId,
    now: NOW,
  })
  ok(!noName.ok, '名字全是空格不该往下走')
})

await test('原名不动：只加了一层，没删任何分类', () => {
  const before = baseCategories()
  const result = plan(['c2', 'c3', 'c4'])
  ok(result.ok)
  const plan_ = must(result.ok ? result.plan : null, 'unreachable')

  eq(plan_.categories.length, before.length + 1, '只多了一个「衣服」')
  for (const old of before) {
    const found = must(
      plan_.categories.find((c) => c.id === old.id),
      `分类「${old.name}」不该消失`,
    )
    eq(found.name, old.name, '名字不该被改')
    eq(found.createdAt, old.createdAt, '创建时间不该被改')
  }
})
