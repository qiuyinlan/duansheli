/**
 * AI 整理分类（用户要的新能力）。
 *
 * 用户的原话：「我希望 ai 可以编辑分类，我可以让它帮我整理已有的分类。」
 *
 * ── 为什么这一组用例特别要紧 ────────────────────────────────────
 * 分类是**结构**，动它比动一件物品危险得多：
 *   · 改名会牵动所有挂在它下面的物品
 *   · 移动会把一整棵子树搬走
 *   · 删除更狠 —— 子分类和物品都可能变成孤儿
 * 而结构改错了**没法用眼睛验**：界面上只会看到树变了样子，
 * 看不出哪里错了。所以这一层「算」的部分全部由用例钉死，
 * 落库那一头（store）只负责搬运。
 *
 * 这和 docs/设计文档.md 第 31 章那次一次性整理是同一个思路 ——
 * 那次的用例真的抓到了两个会**静默毁数据**的 bug。
 */

import {
  applyCategoryPlan,
  countEffectiveCategoryChanges,
  planCategoryChanges,
  type CategoryChange,
  type CategoryPlanEntry,
} from '../src/ai/categoryEdit'
import type { AppData, Category } from '../src/types'
import { parseChatResponse } from '../src/ai/parse'
import { promptTextEn } from '../src/ai/promptText/en'
import { promptTextZh } from '../src/ai/promptText/zh'
import { contains, deepEq, eq, fixture, must, ok, suite, test } from './harness'

/** 顶层分类的 id */
function catId(data: AppData, name: string): string {
  const found = data.categories.find((c) => c.name === name && c.parentId === null)
  return must(found, `夹具里应该有顶层分类「${name}」`).id
}

/** 某个分类的名称路径 */
function pathOf(data: AppData, id: string): string {
  const byId = new Map(data.categories.map((c) => [c.id, c]))
  const names: string[] = []
  let current = byId.get(id)
  while (current) {
    names.unshift(current.name)
    current = current.parentId ? byId.get(current.parentId) : undefined
  }
  return names.join(' / ')
}

/** 造一份带两级分类的数据，用来测层级操作 */
function treeData(): AppData {
  const base = fixture()
  const clothes = catId(base, '衣物')
  const daily = catId(base, '日用品')

  const extra: Category[] = [
    { id: 'c-top', name: '上衣', parentId: clothes, order: 0, createdAt: '2026-01-01T00:00:00.000Z' },
    { id: 'c-pants', name: '裤子', parentId: clothes, order: 1, createdAt: '2026-01-01T00:00:00.000Z' },
    { id: 'c-shoe', name: '鞋子', parentId: null, order: 50, createdAt: '2026-01-01T00:00:00.000Z' },
    { id: 'c-sleep', name: '睡衣', parentId: null, order: 51, createdAt: '2026-01-01T00:00:00.000Z' },
    { id: 'c-misc', name: '杂项', parentId: null, order: 52, createdAt: '2026-01-01T00:00:00.000Z' },
    { id: 'c-misc-child', name: '旧杂物', parentId: 'c-misc', order: 0, createdAt: '2026-01-01T00:00:00.000Z' },
    { id: 'c-misc-daily', name: '临时日用', parentId: 'c-misc', order: 1, createdAt: '2026-01-01T00:00:00.000Z' },
  ]

  return {
    ...base,
    categories: [...base.categories, ...extra],
    // 让「杂项」下挂两件东西，用来验「删分类绝不删物品」
    items: base.items.map((item, index) =>
      index < 2 ? { ...item, categoryIds: [...item.categoryIds, 'c-misc'] } : item,
    ),
    // 「日用品」原来是顶层，这里顺带留个引用避免 lint 抱怨
    _daily: daily,
  } as unknown as AppData
}

suite('AI 整理分类：算计划（一行数据都不碰）')

await test('改名：给完整路径就能对上是哪一个', () => {
  const data = treeData()
  const changes: CategoryChange[] = [
    { kind: 'rename', path: ['衣物', '上衣'], newName: '上装' },
  ]
  const plan = planCategoryChanges(data, changes)

  eq(plan.entries.length, 1)
  const entry = must(plan.entries[0], '第一条')
  eq(entry.status, 'ok')
  eq(entry.kind, 'rename')
  eq(entry.targetId, 'c-top')
  eq(entry.toLabel, '衣物 / 上装')
  eq(plan.problems, 0)
})

await test('★ 算计划绝不改数据（纯函数）', () => {
  const data = treeData()
  const before = JSON.stringify(data.categories)
  planCategoryChanges(data, [{ kind: 'delete', path: ['杂项'] }])
  eq(JSON.stringify(data.categories), before, 'planCategoryChanges 一个字节都不该改')
})

await test('目标路径对不上 → missing，如实报出来（不猜）', () => {
  const data = treeData()
  const plan = planCategoryChanges(data, [
    { kind: 'rename', path: ['根本没有这个分类'], newName: '改名' },
  ])
  eq(plan.entries[0]?.status, 'missing')
  eq(plan.entries[0]?.targetId, null)
  eq(plan.problems, 1, '要有问题的条数，界面上必须提示')
})

await test('改名撞上同级已有的名字 → duplicate（不硬改）', () => {
  const data = treeData()
  const plan = planCategoryChanges(data, [
    { kind: 'rename', path: ['衣物'], newName: '电子' },
  ])
  eq(plan.entries[0]?.status, 'duplicate', '顶层已经有一个「电子」了')
  eq(plan.problems, 1)
})

await test('改名成它自己现在的名字 → noop（本来就是这样，不必动）', () => {
  const data = treeData()
  const plan = planCategoryChanges(data, [{ kind: 'rename', path: ['衣物'], newName: '衣物' }])
  eq(plan.entries[0]?.status, 'noop')
  eq(countEffectiveCategoryChanges(plan.entries), 0, 'noop 不该算进「会改几条」')
})

await test('新建：挂到指定父级下', () => {
  const data = treeData()
  const plan = planCategoryChanges(data, [
    { kind: 'create', path: ['衣物', '外套'], newName: '外套', parentPath: ['衣物'] },
  ])
  const entry = must(plan.entries[0], '第一条')
  eq(entry.status, 'ok')
  eq(entry.newName, '外套')
  eq(entry.newParentId, catId(data, '衣物'))
  eq(entry.toLabel, '衣物 / 外套')
})

await test('新建：同级已经有同名的 → duplicate', () => {
  const data = treeData()
  const plan = planCategoryChanges(data, [
    { kind: 'create', path: ['鞋子'], newName: '鞋子', parentPath: [] },
  ])
  eq(plan.entries[0]?.status, 'duplicate')
})

await test('把顶层分类挪到另一个分类下面', () => {
  const data = treeData()
  const plan = planCategoryChanges(data, [
    { kind: 'move', path: ['鞋子'], newParentPath: ['衣物'] },
    { kind: 'move', path: ['睡衣'], newParentPath: ['衣物'] },
  ])
  eq(plan.entries.length, 2)
  eq(plan.entries[0]?.status, 'ok')
  eq(plan.entries[0]?.newParentId, catId(data, '衣物'))
  eq(plan.entries[0]?.toLabel, '衣物 / 鞋子')
  eq(plan.problems, 0)
})

await test('挪到顶层：newParentPath 给空数组才算「明确要求」', () => {
  const data = treeData()

  // 给空数组 = 我就是要它变成顶层
  const explicit = planCategoryChanges(data, [
    { kind: 'move', path: ['衣物', '上衣'], newParentPath: [] },
  ])
  eq(explicit.entries[0]?.status, 'ok')
  eq(explicit.entries[0]?.newParentId, null)
  eq(explicit.entries[0]?.toLabel, '上衣')

  /*
   * 不给 = 没提这件事 → 整个请求不算数。
   * 这两个混起来的话，AI 想说「提到顶层」的那个请求会变成什么都不做 ——
   * 而用户看到的是「它说改了、界面上没变」。
   */
  const omitted = planCategoryChanges(data, [{ kind: 'move', path: ['衣物', '上衣'] }])
  eq(omitted.entries.length, 0, '没提 newParentPath 就不该产生条目')
})

await test('∴ 挪到自己子孙下面 → cycle，绝不能做（子树会从界面上消失）', () => {
  /*
   * 树一旦成环，那棵子树会被 buildTree 当成不可达节点 ——
   * 界面上它们**整个消失**，用户会以为分类被删了。
   * 所以这条必须在算计划的阶段就挡住。
   */
  const data = treeData()
  const plan = planCategoryChanges(data, [
    { kind: 'move', path: ['衣物'], newParentPath: ['衣物', '上衣'] },
  ])
  eq(plan.entries[0]?.status, 'cycle')
  eq(plan.problems, 1)
})

await test('挪到自己下面也算 cycle', () => {
  const data = treeData()
  const plan = planCategoryChanges(data, [{ kind: 'move', path: ['衣物'], newParentPath: ['衣物'] }])
  eq(plan.entries[0]?.status, 'cycle')
})

await test('删除：把连带的子分类数和物品数一起报出来', () => {
  const data = treeData()
  const plan = planCategoryChanges(data, [{ kind: 'delete', path: ['杂项'] }])
  const entry = must(plan.entries[0], '第一条')
  eq(entry.status, 'ok')
  eq(entry.childCount, 2, '「杂项」下面有两个子分类')
  eq(entry.itemCount, 2, '还有两件物品挂在它上面')
  eq(entry.toLabel, '', '顶层分类删掉之后没有父级')
})

await test('路径只给末级名字也能对上（后缀唯一时）', () => {
  const data = treeData()
  const plan = planCategoryChanges(data, [{ kind: 'rename', path: ['上衣'], newName: '上装' }])
  eq(plan.entries[0]?.status, 'ok')
  eq(plan.entries[0]?.targetId, 'c-top')
})

suite('AI 整理分类：落库')

await test('★ 新建 + 挪：一次做完用户要的「把这几个收进一个衣服下面」', () => {
  /*
   * 这正是用户的核心诉求：一堆平铺的顶层，想收进一个上级里。
   * 注意分两步做（AI 先建、用户采纳；下一轮再挪）——
   * 计划里的每条都是照着**当时那份数据**解析的，所以一步里既建又挪
   * 是解析不到的。这在提示词里写清楚了：让 AI 分开提。
   */
  const data = treeData()

  // 第一步：新建「衣服」
  const plan1 = planCategoryChanges(data, [
    { kind: 'create', path: ['衣服'], newName: '衣服', parentPath: [] },
  ])
  const applied1 = applyCategoryPlan(data, plan1.entries)
  eq(applied1.created, 1, '新建了一个分类')

  const clothesWear = must(
    applied1.data.categories.find((c) => c.name === '衣服'),
    '「衣服」应该真的建出来了',
  )
  eq(clothesWear.parentId, null, '是顶层')

  // 第二步：把鞋子和睡衣挪进去
  const plan2 = planCategoryChanges(applied1.data, [
    { kind: 'move', path: ['鞋子'], newParentPath: ['衣服'] },
    { kind: 'move', path: ['睡衣'], newParentPath: ['衣服'] },
  ])
  const applied2 = applyCategoryPlan(applied1.data, plan2.entries)
  eq(applied2.moved, 2)

  eq(
    pathOf(applied2.data, 'c-shoe'),
    '衣服 / 鞋子',
    '★ 用户要的就是这个：鞋子被收进衣服下面了',
  )
  eq(pathOf(applied2.data, 'c-sleep'), '衣服 / 睡衣')
})

await test('★ 删分类绝不删物品，子分类也不留孤儿', () => {
  const data = treeData()
  const itemCountBefore = data.items.length
  const miscItems = data.items.filter((i) => i.categoryIds.includes('c-misc')).length
  eq(miscItems, 2, '先确认夹具里有两件东西挂在「杂项」上')

  const plan = planCategoryChanges(data, [{ kind: 'delete', path: ['杂项'] }])
  const result = applyCategoryPlan(data, plan.entries)

  eq(result.deleted, 1)
  eq(result.data.items.length, itemCountBefore, '★ 物品一件都不能少')
  eq(result.affectedItems, 2, '受影响的是 2 件物品的分类归属')
  eq(result.reparentedChildren, 2, '两个子分类被挂到父级去')

  // 分类没了
  ok(!result.data.categories.some((c) => c.id === 'c-misc'), '「杂项」应该被删掉')

  // 子分类提升为顶层（因为「杂项」本来就是顶层）
  eq(
    must(result.data.categories.find((c) => c.id === 'c-misc-child'), '旧杂物还在').parentId,
    null,
    '★ 子分类不能留下指向不存在父级的孤儿 —— 那样它会从界面上消失',
  )

  // 那两件物品只是失去了这一个分类归属
  for (const item of result.data.items) {
    ok(!item.categoryIds.includes('c-misc'), '不该再引用被删掉的分类')
  }
  ok(
    result.data.items.some((i) => i.categoryIds.length > 0),
    '它们别的分类归属要留着',
  )
})

await test('删中间的层级：子分类挂到祖父那一级（不是变成顶层）', () => {
  const data = treeData()
  // 再造一层：衣物 › 上衣 › 圆领
  const deep: AppData = {
    ...data,
    categories: [
      ...data.categories,
      {
        id: 'c-round',
        name: '圆领',
        parentId: 'c-top',
        order: 0,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ],
  }

  const plan = planCategoryChanges(deep, [{ kind: 'delete', path: ['衣物', '上衣'] }])
  const result = applyCategoryPlan(deep, plan.entries)

  eq(result.reparentedChildren, 1)
  eq(
    must(result.data.categories.find((c) => c.id === 'c-round'), '圆领还在').parentId,
    catId(deep, '衣物'),
    '★ 应该挂到祖父「衣物」下面，而不是提到顶层',
  )
})

await test('改名会跟着改到路径上（子分类的完整路径一起变）', () => {
  const data = treeData()
  const plan = planCategoryChanges(data, [{ kind: 'rename', path: ['衣物'], newName: '穿戴' }])
  const result = applyCategoryPlan(data, plan.entries)

  eq(pathOf(result.data, 'c-top'), '穿戴 / 上衣', '父级改了名，子级的路径跟着变')
  eq(pathOf(result.data, 'c-pants'), '穿戴 / 裤子')
})

await test('用户取消勾选的那条不做', () => {
  const data = treeData()
  const plan = planCategoryChanges(data, [
    { kind: 'rename', path: ['衣物'], newName: '穿戴' },
    { kind: 'rename', path: ['电子'], newName: '数码' },
  ])
  eq(countEffectiveCategoryChanges(plan.entries), 2)

  const skipped: CategoryPlanEntry[] = plan.entries.map((entry) =>
    entry.toLabel.includes('穿戴') ? { ...entry, include: false } : entry,
  )
  const result = applyCategoryPlan(data, skipped)

  eq(result.renamed, 1, '只改了勾上的那一条')
  eq(countEffectiveCategoryChanges(skipped), 1)
  ok(
    result.data.categories.some((c) => c.name === '衣物'),
    '被取消的那条要一个字都不动',
  )
  ok(result.data.categories.some((c) => c.name === '数码'))
})

await test('有问题的那几条（missing/duplicate/cycle）**一条都不执行**', () => {
  const data = treeData()
  const plan = planCategoryChanges(data, [
    { kind: 'rename', path: ['不存在的分类'], newName: '随便' },
    { kind: 'rename', path: ['衣物'], newName: '电子' },
    { kind: 'move', path: ['衣物'], newParentPath: ['衣物', '上衣'] },
    { kind: 'rename', path: ['鞋子'], newName: '鞋类' },
  ])

  eq(plan.problems, 3)
  eq(countEffectiveCategoryChanges(plan.entries), 1)

  const result = applyCategoryPlan(data, plan.entries)
  eq(result.renamed, 1, '只有那条 ok 的被执行')
  eq(result.moved, 0, 'cycle 那条绝对不能执行')
  ok(
    result.data.categories.some((c) => c.name === '鞋类'),
    '唯一合法的那条要生效',
  )
  ok(
    result.data.categories.some((c) => c.name === '电子' && c.parentId === null),
    '「电子」不该被改名',
  )
})

await test('★ 计划算完之后数据变了（别人改过）→ 落库时再挡一次，绝不硬改', () => {
  /*
   * 计划是照着**当时那份数据**算的。这中间用户完全可能自己在分类页
   * 新建了一个同名的 —— 那时候再改名就会撞出两个「上装」，
   * 界面上分不清哪个是哪个。所以落库时要再挡一次。
   */
  const data = treeData()
  const plan = planCategoryChanges(data, [
    { kind: 'rename', path: ['衣物', '上衣'], newName: '上装' },
  ])
  eq(plan.entries[0]?.status, 'ok', '算的时候是没问题的')

  // 用户在这中间自己建了一个「上装」
  const changed: AppData = {
    ...data,
    categories: [
      ...data.categories,
      {
        id: 'c-new',
        name: '上装',
        parentId: catId(data, '衣物'),
        order: 9,
        createdAt: '2026-01-02T00:00:00.000Z',
      },
    ],
  }

  const result = applyCategoryPlan(changed, plan.entries)
  eq(result.renamed, 0, '★ 撞车了就跳过，不硬改')
  ok(
    result.data.categories.some((c) => c.id === 'c-top' && c.name === '上衣'),
    '原来那条要原样留着',
  )
})

await test('什么都不做时，返回的是**同一份**数据（不产生无意义的新对象）', () => {
  const data = treeData()
  const result = applyCategoryPlan(data, [])
  ok(result.data === data, '没有任何改动时就该原样返回')
  eq(result.created + result.renamed + result.moved + result.deleted, 0)
})

await test('幂等：同一份计划跑两次，第二次什么都不改', () => {
  const data = treeData()
  const plan = planCategoryChanges(data, [
    { kind: 'create', path: ['衣服'], newName: '衣服', parentPath: [] },
    { kind: 'rename', path: ['鞋子'], newName: '鞋类' },
  ])

  const once = applyCategoryPlan(data, plan.entries)
  eq(once.created, 1)
  eq(once.renamed, 1)

  /*
   * 再跑一次要按**新数据**重新算计划（这才是真实流程：每次都是
   * 「照着现在的数据算一份新计划」）。直接拿旧计划套新数据是不对的 ——
   * 那等于拿一张过期的地图开车。这里验的是「重新算 + 再落库」不会
   * 重复制造东西。
   */
  const plan2 = planCategoryChanges(once.data, [
    { kind: 'create', path: ['衣服'], newName: '衣服', parentPath: [] },
    { kind: 'rename', path: ['鞋子'], newName: '鞋类' },
  ])
  const twice = applyCategoryPlan(once.data, plan2.entries)

  eq(twice.data.categories.length, once.data.categories.length, '分类数不该变')
  eq(plan2.entries[0]?.status, 'duplicate', '第二次算的时候「衣服」已经存在了')
  eq(plan2.entries[1]?.status, 'missing', '「鞋子」已经改名成「鞋类」，旧路径找不到了')
})

await test('分类总数守恒：新建 +n、删除 -n，别的一件不少', () => {
  const data = treeData()
  const before = data.categories.length

  const plan = planCategoryChanges(data, [
    { kind: 'create', path: ['新甲'], newName: '新甲', parentPath: [] },
    { kind: 'create', path: ['新乙'], newName: '新乙', parentPath: [] },
    { kind: 'delete', path: ['杂项'] },
  ])
  const result = applyCategoryPlan(data, plan.entries)

  eq(result.created, 2)
  eq(result.deleted, 1)
  eq(result.data.categories.length, before + 1, '净增 1 个')
})

await test('改名之后，物品对分类的引用还是同一个 id（改名不牵动物品）', () => {
  const data = treeData()
  const plan = planCategoryChanges(data, [{ kind: 'rename', path: ['衣物'], newName: '穿戴' }])
  const result = applyCategoryPlan(data, plan.entries)

  deepEq(
    result.data.items.map((i) => i.categoryIds),
    data.items.map((i) => i.categoryIds),
    '★ 物品的 categoryIds 一根毫毛都不该动（改的只是分类的名字）',
  )
})

/* ------------------------------------------------------------------ */
/* 从模型回复里解析出分类改动                                          */
/* ------------------------------------------------------------------ */

suite('AI 整理分类：解析模型输出')

await test('标准结构能解析出来', () => {
  const parsed = parseChatResponse({
    reply: '把鞋子收进衣服下面',
    categoryChanges: [
      { kind: 'create', path: ['衣服'], newName: '衣服', parentPath: [] },
      { kind: 'move', path: ['鞋子'], newParentPath: ['衣服'] },
    ],
  })

  eq(parsed.categoryChanges.length, 2)
  eq(parsed.categoryChanges[0]?.kind, 'create')
  eq(parsed.categoryChanges[0]?.newName, '衣服')
  /*
   * 注意：解析层**不产出** `parentPath` —— 新建挂在哪个父级下这件事，
   * 由 `planCategoryChanges` 按「path 的末级是名字、前面几段是父级」
   * 这个约定去解释。这样解析层只管形状，业务判断只有一处。
   */
  deepEq(parsed.categoryChanges[0]?.path, ['衣服'])
  eq(parsed.categoryChanges[1]?.kind, 'move')
  deepEq(parsed.categoryChanges[1]?.newParentPath, ['衣服'])
  eq(parsed.noChanges, false)
})

await test('★ 只改分类、不动物品时，不能被当成「纯问答」', () => {
  /*
   * 漏了这一项的话，「只整理分类」那一轮会被判成 noChanges，
   * 界面上只会显示一句话，**分类改动被默默丢掉** ——
   * 用户看到的是「AI 说改好了、但树没变」。
   */
  const parsed = parseChatResponse({
    reply: '我建议把「其他穿戴」改成「穿戴」',
    categoryChanges: [{ kind: 'rename', path: ['其他穿戴'], newName: '穿戴' }],
  })

  eq(parsed.noChanges, false, '★ 有分类改动就不是「什么都没做」')
  eq(parsed.categoryChanges.length, 1)
  eq(parsed.items.length, 0)
})

await test('路径写成 "衣物 / 眼妆" 这种字符串也认', () => {
  const parsed = parseChatResponse({
    reply: '改名',
    categoryChanges: [{ kind: 'rename', path: '衣物 / 眼妆', newName: '眼妆和唇妆' }],
  })
  deepEq(parsed.categoryChanges[0]?.path, ['衣物', '眼妆'])
})

await test('中文键名也认（模型有时会这么写）', () => {
  const parsed = parseChatResponse({
    reply: '建一个新的',
    categoryChanges: [{ 操作: '新建', 路径: ['衣服'], 新名字: '衣服' }],
  })
  eq(parsed.categoryChanges[0]?.kind, 'create')
  eq(parsed.categoryChanges[0]?.newName, '衣服')
})

await test('新建时只给名字不给路径 → 当作顶层新建', () => {
  const parsed = parseChatResponse({
    reply: '建一个',
    categoryChanges: [{ kind: 'create', newName: '衣服' }],
  })
  deepEq(parsed.categoryChanges[0]?.path, ['衣服'])
})

await test('★ 父级给空数组 vs 没给，必须区分开', () => {
  /*
   * 这个区分决定「提到顶层」这条请求会不会被执行。
   * 混起来的表现是：AI 说「已经把鞋子提出来了」，而树里没动 ——
   * 用户看到的是「它说改了但没变」。
   */
  const explicit = parseChatResponse({
    reply: '提到顶层',
    categoryChanges: [{ kind: 'move', path: ['衣物', '上衣'], newParentPath: [] }],
  })
  deepEq(explicit.categoryChanges[0]?.newParentPath, [], '明确要求提到顶层（空数组要保留）')

  const omitted = parseChatResponse({
    reply: '只说了挪，没说挪到哪',
    categoryChanges: [{ kind: 'move', path: ['衣物', '上衣'] }],
  })
  eq(omitted.categoryChanges[0]?.newParentPath, undefined, '没给就是没提')
})

await test('认不出来的条目整条丢掉，不产生半截坏对象', () => {
  const parsed = parseChatResponse({
    reply: '乱七八糟',
    categoryChanges: [
      { kind: '这不是个动作', path: ['衣物'] },
      { kind: 'rename' }, // 没有 path 也没有 newName
      'string 不是对象',
      { kind: 'rename', path: ['衣物'], newName: '穿戴' },
    ],
  })
  eq(parsed.categoryChanges.length, 1, '只留下那条合法的')
  eq(parsed.categoryChanges[0]?.newName, '穿戴')
})

await test('没有 categoryChanges 字段时是空数组（不是 undefined）', () => {
  const parsed = parseChatResponse({ reply: '好的', items: [] })
  deepEq(parsed.categoryChanges, [], '必须是空数组 —— undefined 会让界面上每一处都要防一手')
})

await test('prompt 里确实教了它这件事（防回归）', () => {
  // 提示词是 AI 质量的地基，少了这段它就永远不会输出 categoryChanges
  for (const text of [promptTextZh.chatSystem, promptTextEn.chatSystem]) {
    contains(text, 'categoryChanges', '两个语言的 system 都要教它这个字段')
    contains(text, 'newParentPath', '父级字段也要教')
    for (const kind of ['create', 'rename', 'move', 'delete']) {
      contains(text, kind, `四种动作「${kind}」都要在提示词里`)
    }
  }
})
