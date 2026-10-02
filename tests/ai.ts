/**
 * AI 功能的测试。
 *
 * 重点覆盖两类最容易出错、又最难靠肉眼发现的地方：
 *   1. 模型返回的 JSON 千奇百怪 —— 带代码围栏、带前言、字段类型不对、键名是中文
 *   2. 名称 → id 的匹配 —— 匹配错了，物品会挂到不相干的位置或分类上
 *
 * 网络请求不测（那是在测 DeepSeek），只测我们自己写的那部分。
 */

import type { RawExtractedItem } from '../src/ai/parse'
import {
  createMatchContext,
  draftsToBulkAddItems,
  draftsToBulkUpdates,
  toItemDraft,
  toTidyDraft,
} from '../src/ai/convert'
import { AiError } from '../src/ai/deepseek'
import { extractJson, parseAssignments, parseExtraction } from '../src/ai/parse'
import { buildAiContext, chunkItems, renderContextBlock, splitIntoChunks } from '../src/ai/prompts'
import { buildExportFile } from '../src/data/exportJson'
import { createDerived } from '../src/store/selectors'
import { getRepository } from '../src/storage/repository'
import { flushWrites, useAppStore } from '../src/store/useAppStore'
import { deepEq, eq, fixture, must, ok, suite, test } from './harness'

/* ------------------------------------------------------------------ */
/* 1. 从模型回复里抠 JSON                                              */
/* ------------------------------------------------------------------ */

suite('AI 回复解析：抠出 JSON')

await test('纯粹的 JSON 直接解析', () => {
  deepEq(extractJson('{"items":[]}'), { items: [] })
})

await test('包在 ```json 代码围栏里也能解析', () => {
  const raw = '```json\n{"items":[{"name":"毛衣"}]}\n```'
  const parsed = extractJson(raw) as { items: Array<{ name: string }> }
  eq(parsed.items[0].name, '毛衣')
})

await test('不带语言标记的围栏也能解析', () => {
  const raw = '```\n{"items":[{"name":"牛仔裤"}]}\n```'
  const parsed = extractJson(raw) as { items: Array<{ name: string }> }
  eq(parsed.items[0].name, '牛仔裤')
})

await test('模型加了前言后语时，截取大括号之间的内容', () => {
  const raw = '好的，我来帮你整理：\n{"items":[{"name":"平底锅"}]}\n希望有帮助！'
  const parsed = extractJson(raw) as { items: Array<{ name: string }> }
  eq(parsed.items[0].name, '平底锅')
})

await test('顶层直接是数组也能解析', () => {
  const parsed = extractJson('[{"name":"台灯"}]') as Array<{ name: string }>
  eq(parsed[0].name, '台灯')
})

await test('完全不是 JSON 时抛出带原文片段的错误', () => {
  let caught: unknown = null
  try {
    extractJson('抱歉，我无法处理这个请求。')
  } catch (err) {
    caught = err
  }
  ok(caught instanceof AiError, '应该抛 AiError')
  ok(
    caught instanceof AiError && caught.message.includes('抱歉'),
    '错误信息里应该带上原文片段，方便排查',
  )
})

await test('空回复抛出明确错误', () => {
  let caught: AiError | null = null
  try {
    extractJson('   ')
  } catch (err) {
    caught = err instanceof AiError ? err : null
  }
  ok(caught !== null, '应该抛 AiError')
  ok(caught !== null && caught.message.includes('空内容'))
})

/* ------------------------------------------------------------------ */
/* 2. 批量抽取结果的解析与降级                                          */
/* ------------------------------------------------------------------ */

suite('AI 回复解析：物品列表')

await test('标准结构', () => {
  const result = parseExtraction({
    items: [
      {
        name: '灰色羊毛衫',
        quantity: 1,
        categories: ['衣物'],
        location: ['家', '卧室', '衣柜'],
        tags: ['舍不得扔'],
        attributes: { 品牌: '某品牌' },
        note: '妈妈送的',
      },
    ],
  })
  eq(result.items.length, 1)
  eq(result.items[0].name, '灰色羊毛衫')
  deepEq(result.items[0].location, ['家', '卧室', '衣柜'])
  eq(result.items[0].attributes['品牌'], '某品牌')
})

await test('顶层直接是数组', () => {
  eq(parseExtraction([{ name: '台灯' }]).items.length, 1)
})

await test('键名是中文时也能认（模型有时会这样）', () => {
  const result = parseExtraction({
    物品: [{ 名称: '电饭煲', 数量: '2', 分类: ['厨房'], 位置: '家 / 厨房' }],
  })
  eq(result.items.length, 1)
  eq(result.items[0].name, '电饭煲')
  eq(result.items[0].quantity, 2, '字符串数量应被转成数字')
  deepEq(result.items[0].location, ['家', '厨房'], '斜杠分隔的位置应被拆成数组')
})

await test('没有名称的条目被丢弃并计数', () => {
  const result = parseExtraction({ items: [{ name: '正常物品' }, { quantity: 3 }, { name: '   ' }] })
  eq(result.items.length, 1)
  eq(result.dropped, 2)
})

await test('中文数字数量能被识别', () => {
  eq(parseExtraction({ items: [{ name: '袜子', quantity: '三' }] }).items[0].quantity, 3)
  eq(parseExtraction({ items: [{ name: '筷子', quantity: '两' }] }).items[0].quantity, 2)
})

await test('数量缺失或非法时降级为 1，而不是崩掉', () => {
  eq(parseExtraction({ items: [{ name: 'A' }] }).items[0].quantity, 1)
  eq(parseExtraction({ items: [{ name: 'A', quantity: -5 }] }).items[0].quantity, 1)
  eq(parseExtraction({ items: [{ name: 'A', quantity: '很多' }] }).items[0].quantity, 1)
})

await test('位置写成字符串时按分隔符拆开', () => {
  eq(
    parseExtraction({ items: [{ name: 'A', location: '家 > 书房 > 书架' }] }).items[0].location
      ?.join('/'),
    '家/书房/书架',
  )
})

await test('空字符串位置被当成「没提到位置」', () => {
  eq(parseExtraction({ items: [{ name: 'A', location: '' }] }).items[0].location, null)
  eq(parseExtraction({ items: [{ name: 'A', location: [] }] }).items[0].location, null)
})

await test('属性里值为空的项被丢掉', () => {
  const parsed = parseExtraction({
    items: [{ name: 'A', attributes: { 品牌: '某品牌', 颜色: '', 尺寸: null } }],
  })
  deepEq(parsed.items[0].attributes, { 品牌: '某品牌' })
})

await test('标签会去重', () => {
  const parsed = parseExtraction({ items: [{ name: 'A', tags: ['想送人', '想送人', '待维修'] }] })
  deepEq(parsed.items[0].tags, ['想送人', '待维修'])
})

await test('完全找不到列表时报错', () => {
  let caught: AiError | null = null
  try {
    parseExtraction({ 说明: '这段文字里没有物品' })
  } catch (err) {
    caught = err instanceof AiError ? err : null
  }
  ok(caught !== null, '应该抛错')
})

/* ------------------------------------------------------------------ */
/* 3. 整理建议的解析                                                   */
/* ------------------------------------------------------------------ */

suite('AI 回复解析：整理建议')

await test('标准结构', () => {
  const list = parseAssignments({
    assignments: [{ id: 'i1', categories: ['衣物'], location: ['家', '卧室'], reason: '应该归到卧室' }],
  })
  eq(list.length, 1)
  eq(list[0].id, 'i1')
  deepEq(list[0].location, ['家', '卧室'])
})

await test('没有 id 的建议被丢弃（不能用）', () => {
  eq(parseAssignments({ assignments: [{ categories: ['衣物'] }, { id: 'ok' }] }).length, 1)
})

/* ------------------------------------------------------------------ */
/* 4. 名称 → id 的匹配                                                 */
/* ------------------------------------------------------------------ */

suite('名称匹配：位置与分类')

const fx = fixture()
const ctx = createDerived(fx)
const match = createMatchContext(fx, ctx)

function raw(partial: Partial<RawExtractedItem> & { name: string }): RawExtractedItem {
  return {
    name: partial.name,
    quantity: partial.quantity ?? 1,
    categories: partial.categories ?? [],
    location: partial.location ?? null,
    tags: partial.tags ?? [],
    attributes: partial.attributes ?? {},
    note: partial.note ?? '',
  }
}

await test('位置按完整路径精确匹配', () => {
  const draft = toItemDraft(raw({ name: '毛衣', location: ['家', '卧室', '衣柜'] }), match, ctx)
  eq(draft.locationId, must(fx.locations.find((l) => l.name === '衣柜'), '找不到衣柜').id)
  eq(draft.newLocationPath, null, '不该产生新位置')
  eq(draft.locationLabel, '家 / 卧室 / 衣柜')
})

await test('AI 只给了末级名称时，按唯一名称匹配', () => {
  const draft = toItemDraft(raw({ name: '毛衣', location: ['衣柜'] }), match, ctx)
  eq(draft.locationId, must(fx.locations.find((l) => l.name === '衣柜'), '找不到衣柜').id)
  eq(draft.newLocationPath, null)
})

await test('路径对不上时，绝不按末级名称去别的分支上找同名的', () => {
  // 种子里已经有「家 / 储物间 / 货架」。AI 说的是「家 / 车库 / 货架」——
  // 如果实现退化成按末级名称匹配，东西就会被悄悄挪到储物间去。
  const draft = toItemDraft(raw({ name: '工具箱', location: ['家', '车库', '货架'] }), match, ctx)
  const storageShelf = must(
    fx.locations.find((l) => l.name === '货架'),
    '种子里应该有货架',
  )
  ok(draft.locationId !== storageShelf.id, '不能匹配到储物间下的那个货架')
  eq(draft.locationId, null)
  deepEq(draft.newLocationPath, ['家', '车库', '货架'])
  eq(draft.locationLabel, '家 / 车库 / 货架（新）')
})

await test('只有单个名字时才按名称匹配（没有层级上下文可用）', () => {
  const draft = toItemDraft(raw({ name: '工具', location: ['货架'] }), match, ctx)
  eq(draft.locationId, must(fx.locations.find((l) => l.name === '货架'), '找不到货架').id)
  eq(draft.newLocationPath, null)
})

await test('AI 只给了后半段路径时，按后缀唯一匹配上', () => {
  // 「卧室/衣柜」不是完整路径（完整的是 家/卧室/衣柜），但在全树里唯一
  const draft = toItemDraft(raw({ name: '毛衣', location: ['卧室', '衣柜'] }), match, ctx)
  eq(draft.locationId, must(fx.locations.find((l) => l.name === '衣柜'), '找不到衣柜').id)
  eq(draft.newLocationPath, null, '不该被判成新位置')
})

await test('后缀有歧义时绝不猜，一律标成新位置', () => {
  // 造一棵树，两个分支下各有一个「衣柜」
  const seed = fixture()
  const homeId = must(seed.locations.find((l) => l.parentId === null), '找不到顶层').id
  const now = new Date().toISOString()
  const ambiguous = {
    ...seed,
    locations: [
      ...seed.locations,
      { id: 'guest-room', name: '客房', parentId: homeId, note: '', order: 50, createdAt: now },
      { id: 'guest-wardrobe', name: '衣柜', parentId: 'guest-room', note: '', order: 0, createdAt: now },
    ],
  }
  const ambiguousCtx = createDerived(ambiguous)
  const ambiguousMatch = createMatchContext(ambiguous, ambiguousCtx)

  const draft = toItemDraft(raw({ name: '毛衣', location: ['衣柜'] }), ambiguousMatch, ambiguousCtx)
  eq(draft.locationId, null, '两个衣柜，无法判断该挂哪个，不该瞎猜')
  deepEq(draft.newLocationPath, ['衣柜'])
})

await test('没提到位置就是未归位，绝不瞎猜', () => {
  const draft = toItemDraft(raw({ name: '不知道放哪的东西' }), match, ctx)
  eq(draft.locationId, null)
  eq(draft.newLocationPath, null)
  eq(draft.locationLabel, '未归位')
})

await test('分类精确匹配到已有分类', () => {
  const draft = toItemDraft(raw({ name: '毛衣', categories: ['衣物'] }), match, ctx)
  eq(draft.matchedCategoryIds.length, 1)
  eq(draft.matchedCategoryIds[0], must(fx.categories.find((c) => c.name === '衣物'), '找不到衣物').id)
  deepEq(draft.newCategoryNames, [])
})

await test('没有的分类被标为「新分类」，默认不采纳', () => {
  const draft = toItemDraft(raw({ name: '帐篷', categories: ['户外装备'] }), match, ctx)
  deepEq(draft.matchedCategoryIds, [])
  deepEq(draft.newCategoryNames, ['户外装备'])
  eq(draft.adoptNewCategories, false, '分类是受控词表，必须默认不勾，等用户点头')
})

await test('已有分类和建议的新分类可以并存', () => {
  const draft = toItemDraft(raw({ name: '登山杖', categories: ['工具', '户外装备'] }), match, ctx)
  eq(draft.matchedCategoryIds.length, 1)
  deepEq(draft.newCategoryNames, ['户外装备'])
})

await test('属性名匹配到已有属性；本地没有的属性被丢掉并如实记录', () => {
  const draft = toItemDraft(
    raw({
      name: '毛衣',
      attributes: { 品牌: '某品牌', 购入日期: '2024-01-01', 洗涤方式: '手洗' },
    }),
    match,
    ctx,
  )
  eq(draft.attrs['品牌'], '某品牌')
  eq(draft.attrs['购入日期'], '2024-01-01')
  eq(draft.attrs['洗涤方式'], undefined, '本地没有这个属性，不该写进去')
  deepEq(draft.droppedAttrs, ['洗涤方式'], '但要在界面上如实告知')
})

await test('AI 用简称时也能对上（大小写与空格不敏感）', () => {
  const draft = toItemDraft(raw({ name: '毛衣', categories: [' 衣物 '] }), match, ctx)
  eq(draft.matchedCategoryIds.length, 1)
})

/* ------------------------------------------------------------------ */
/* 5. 草稿 → 写入计划                                                  */
/* ------------------------------------------------------------------ */

suite('草稿转成写入计划')

await test('未采纳的新分类不会进入计划', () => {
  const draft = toItemDraft(raw({ name: '帐篷', categories: ['衣物', '户外装备'] }), match, ctx)
  const plan = draftsToBulkAddItems([draft], match, ctx)
  deepEq(plan[0].categoryNames, ['衣物'], '只带上已匹配到的那个')
})

await test('采纳后的新分类会进入计划', () => {
  const draft = {
    ...toItemDraft(raw({ name: '帐篷', categories: ['衣物', '户外装备'] }), match, ctx),
    adoptNewCategories: true,
  }
  const plan = draftsToBulkAddItems([draft], match, ctx)
  deepEq(plan[0].categoryNames, ['衣物', '户外装备'])
})

await test('未采纳的新位置 → 未归位', () => {
  const draft = toItemDraft(raw({ name: '工具箱', location: ['家', '车库'] }), match, ctx)
  eq(draftsToBulkAddItems([draft], match, ctx)[0].locationPath, null)
})

await test('采纳后的新位置会带着完整路径进入计划', () => {
  const draft = {
    ...toItemDraft(raw({ name: '工具箱', location: ['家', '车库'] }), match, ctx),
    adoptNewLocation: true,
  }
  deepEq(draftsToBulkAddItems([draft], match, ctx)[0].locationPath, ['家', '车库'])
})

await test('取消勾选的条目不进入计划', () => {
  const draft = { ...toItemDraft(raw({ name: '不要这个' }), match, ctx), include: false }
  eq(draftsToBulkAddItems([draft], match, ctx).length, 0)
})

await test('整理建议：完全没变化的条目被丢弃', () => {
  const existing = must(fx.items.find((i) => i.id === 'i1'), '找不到 i1')
  const clothing = must(fx.categories.find((c) => c.name === '衣物'), '找不到衣物')
  const wardrobe = must(fx.locations.find((l) => l.name === '衣柜'), '找不到衣柜')

  const noop = toTidyDraft(
    {
      id: 'i1',
      categories: ['衣物'],
      location: ['家', '卧室', '衣柜'],
      reason: '本来就这样',
    },
    existing,
    match,
    ctx,
  )
  eq(noop, null, '没有变化的建议不该出现在预览里')

  const changed = toTidyDraft(
    { id: 'i1', categories: ['衣物'], location: ['家', '客厅'], reason: '换个地方' },
    existing,
    match,
    ctx,
  )
  ok(changed !== null, '有变化的应该保留')
  eq(changed?.matchedCategoryIds[0], clothing.id)
  ok(changed?.locationId !== wardrobe.id)
})

await test('整理计划只带上要改的字段', () => {
  const existing = must(fx.items.find((i) => i.id === 'i2'), '找不到 i2')
  const draft = toTidyDraft(
    { id: 'i2', categories: ['衣物'], location: ['家', '客厅', '电视柜'], reason: '移一下' },
    existing,
    match,
    ctx,
  )
  ok(draft !== null)
  const updates = draftsToBulkUpdates([must(draft, '草稿不该为空')], match, ctx)
  eq(updates.length, 1)
  eq(updates[0].id, 'i2')
  deepEq(updates[0].locationPath, ['家', '客厅', '电视柜'])
})

/* ------------------------------------------------------------------ */
/* 6. 分批                                                             */
/* ------------------------------------------------------------------ */

suite('长文本分批')

await test('短文本不切', () => {
  eq(splitIntoChunks('就一行', 100).length, 1)
})

await test('按行切分，每段不超过上限', () => {
  const text = Array.from({ length: 20 }, (_, i) => `第 ${i} 行物品描述，稍微写长一点点`).join('\n')
  const chunks = splitIntoChunks(text, 60)
  ok(chunks.length > 1, '应该被切成多段')
  for (const chunk of chunks) {
    ok(chunk.length <= 60 + 20, `每段都比上限大太多：${chunk.length}`)
  }
  eq(chunks.join('\n').replace(/\s/g, ''), text.replace(/\s/g, ''), '拼回来内容不该丢')
})

await test('单独一行超长时硬切开，不会死循环', () => {
  const text = '字'.repeat(250)
  const chunks = splitIntoChunks(text, 100)
  eq(chunks.length, 3)
  eq(chunks.join('').length, 250)
})

await test('空文本返回空数组', () => {
  eq(splitIntoChunks('   \n  ', 100).length, 0)
})

await test('物品按批大小切开', () => {
  const items = Array.from({ length: 95 }, (_, i) => i)
  eq(chunkItems(items, 40).length, 3)
  eq(chunkItems(items, 40)[2].length, 15)
})

/* ------------------------------------------------------------------ */
/* 7. 上下文注入                                                       */
/* ------------------------------------------------------------------ */

suite('发给 AI 的上下文')

await test('把已有分类、位置路径、属性都带上', () => {
  const aiCtx = buildAiContext(fx, ctx)
  ok(aiCtx.categories.includes('衣物'))
  ok(aiCtx.locationPaths.some((path) => path.join('/') === '家/卧室/衣柜'))
  ok(aiCtx.attributes.includes('品牌'))
  eq(aiCtx.truncated, false)
})

await test('渲染出来的上下文块包含关键清单', () => {
  const block = renderContextBlock(buildAiContext(fx, ctx))
  ok(block.includes('【已有分类】'))
  ok(block.includes('家 / 卧室 / 衣柜'), '位置要以完整路径出现')
  ok(block.includes('【已有属性】'))
})

await test('清单太长时截断并如实标注', () => {
  const trimmed = buildAiContext(fx, ctx, {
    categories: 2,
    locations: 3,
    attributes: 1,
    tags: 1,
  })
  eq(trimmed.truncated, true)
  eq(trimmed.categories.length, 2)
  ok(renderContextBlock(trimmed).includes('截断'))
})

/* ------------------------------------------------------------------ */
/* 8. store 批量写入                                                   */
/* ------------------------------------------------------------------ */

suite('批量写入（自动创建分类与位置）')

function seedStore(): void {
  const data = fx
  useAppStore.setState({
    status: 'ready',
    error: null,
    data,
    derived: createDerived(data),
  })
}

await test('批量录入：新分类只创建一次，即使多件物品都用它', async () => {
  seedStore()
  const before = useAppStore.getState().data.categories.length

  const result = useAppStore.getState().bulkAddItems([
    {
      name: '帐篷',
      quantity: 1,
      categoryNames: ['户外装备'],
      locationPath: null,
      tags: [],
      attrs: {},
      note: '',
    },
    {
      name: '登山杖',
      quantity: 2,
      categoryNames: ['户外装备'],
      locationPath: null,
      tags: [],
      attrs: {},
      note: '',
    },
  ])

  eq(result.items, 2)
  eq(result.createdCategories, 1, '同名分类只该创建一次')
  eq(useAppStore.getState().data.categories.length, before + 1)
  await flushWrites()
})

await test('批量录入：位置路径逐层创建，中间层缺失也能补上', async () => {
  seedStore()
  const result = useAppStore.getState().bulkAddItems([
    {
      name: '工具箱',
      quantity: 1,
      categoryNames: [],
      locationPath: ['家', '车库', '货架'],
      tags: [],
      attrs: {},
      note: '',
    },
  ])

  eq(result.createdLocations, 2, '车库和货架两层都该建出来')

  const state = useAppStore.getState()
  const garage = must(state.data.locations.find((l) => l.name === '车库'), '车库应存在')
  // 注意：种子里另有一个「货架」（在储物间下），所以这里要按父节点定位
  const shelf = must(
    state.data.locations.find((l) => l.name === '货架' && l.parentId === garage.id),
    '车库下应该有一个新的货架',
  )

  const home = must(state.data.locations.find((l) => l.name === '家'), '家应存在')
  eq(garage.parentId, home.id, '车库应该挂在已有的「家」下，而不是新建一个「家」')

  const added = must(state.data.items.find((i) => i.name === '工具箱'), '工具箱应存在')
  eq(added.locationId, shelf.id, '物品应该挂在新建出来的那个货架上')
  await flushWrites()
})

await test('批量录入：属性名被映射成属性 id；库里没有的属性被忽略', async () => {
  seedStore()
  useAppStore.getState().bulkAddItems([
    {
      name: '毛衣',
      quantity: 1,
      categoryNames: [],
      locationPath: null,
      tags: ['想送人'],
      attrs: { 品牌: '某品牌', 不存在的属性: '值' },
      note: '备注',
    },
  ])

  const state = useAppStore.getState()
  const added = must(state.data.items.find((i) => i.name === '毛衣'), '毛衣应存在')
  const brand = must(state.data.attributeDefs.find((d) => d.name === '品牌'), '找不到品牌属性')

  eq(added.attrs[brand.id], '某品牌')
  eq(Object.keys(added.attrs).length, 1, '不存在的属性不该被写进去')
  deepEq(added.tags, ['想送人'])
  await flushWrites()
})

await test('批量录入：标签表会被补齐', async () => {
  seedStore()
  useAppStore.getState().bulkAddItems([
    {
      name: '新东西',
      quantity: 1,
      categoryNames: [],
      locationPath: null,
      tags: ['临时想到的标签'],
      attrs: {},
      note: '',
    },
  ])
  ok(
    useAppStore.getState().data.tags.some((t) => t.name === '临时想到的标签'),
    '标签表必须补齐，否则标签页会漏掉',
  )
  await flushWrites()
})

await test('批量录入：真的落盘了', async () => {
  seedStore()
  const countBefore = useAppStore.getState().data.items.length

  useAppStore.getState().bulkAddItems([
    {
      name: '落盘测试物品',
      quantity: 1,
      categoryNames: ['衣物'],
      locationPath: ['家', '卧室', '衣柜'],
      tags: [],
      attrs: {},
      note: '',
    },
  ])
  await flushWrites()

  const persisted = must(await getRepository().load(), '应该能读回持久化数据')
  eq(persisted.items.length, countBefore + 1)

  const saved = must(persisted.items.find((i) => i.name === '落盘测试物品'), '应该能在磁盘上找到它')
  const wardrobe = must(fx.locations.find((l) => l.name === '衣柜'), '找不到衣柜')
  eq(saved.locationId, wardrobe.id, '位置也应该正确落盘')
})

await test('批量更新：把一批物品改到新分类和新位置', async () => {
  seedStore()
  const electronics = must(fx.categories.find((c) => c.name === '电子'), '找不到电子')
  const before = useAppStore.getState().data.items.find((i) => i.id === 'i5')
  ok(before !== undefined, 'i5 应该存在')

  const result = useAppStore.getState().bulkUpdateItems([
    { id: 'i5', categoryNames: ['电子'], locationPath: ['家', '书房', '书桌'] },
  ])

  eq(result.items, 1)
  const after = must(useAppStore.getState().data.items.find((i) => i.id === 'i5'), 'i5 应还在')
  eq(after.categoryIds[0], electronics.id)
  const desk = must(useAppStore.getState().data.locations.find((l) => l.name === '书桌'), '书桌应存在')
  eq(after.locationId, desk.id)
  await flushWrites()
})

await test('批量更新：空数组表示清空分类，null 表示清空位置', async () => {
  seedStore()
  useAppStore.getState().bulkUpdateItems([{ id: 'i1', categoryNames: [], locationPath: null }])
  const after = must(useAppStore.getState().data.items.find((i) => i.id === 'i1'), 'i1 应还在')
  deepEq(after.categoryIds, [])
  eq(after.locationId, null)
  await flushWrites()
})

/* ------------------------------------------------------------------ */
/* 9. API Key 的安全边界                                               */
/* ------------------------------------------------------------------ */

suite('API Key 只存在内存里')

const SECRET = 'sk-test-this-must-never-be-persisted-1234'

await test('Key 不会被写进导出的备份文件', () => {
  seedStore()
  useAppStore.getState().setAiApiKey(SECRET)

  const exported = JSON.stringify(buildExportFile(useAppStore.getState().data))
  ok(!exported.includes(SECRET), 'Key 绝不能出现在导出文件里 —— 那等于把钥匙一起备份出去')
  ok(!exported.includes('aiApiKey'), '连字段名都不该出现')
})

await test('Key 不会被写进 IndexedDB', async () => {
  seedStore()
  useAppStore.getState().setAiApiKey(SECRET)
  await flushWrites()

  const persisted = JSON.stringify(await getRepository().load())
  ok(!persisted.includes(SECRET), 'Key 不该落进本地数据库')
})

await test('Key 不会被写进 localStorage', () => {
  seedStore()
  useAppStore.getState().setAiApiKey(SECRET)

  const dump = Object.keys(localStorage)
    .map((key) => localStorage.getItem(key) ?? '')
    .join('|')
  ok(!dump.includes(SECRET), 'Key 不该落进 localStorage')
})

await test('Key 只在 store 的内存字段里，清除后立刻消失', () => {
  seedStore()
  useAppStore.getState().setAiApiKey(SECRET)
  eq(useAppStore.getState().aiApiKey, SECRET, '设置后内存里应该能读到')

  useAppStore.getState().setAiApiKey('')
  eq(useAppStore.getState().aiApiKey, '', '清除后应该立刻没了')
})
