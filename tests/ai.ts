/**
 * AI 功能的测试。
 *
 * 重点覆盖两类最容易出错、又最难靠肉眼发现的地方：
 *   1. 模型返回的 JSON 千奇百怪 —— 带代码围栏、带前言、字段类型不对、键名是中文
 *   2. 名称路径 → id 的匹配 —— 匹配错了，物品会挂到不相干的分类或位置上
 *
 * 分类和位置现在都是树，所以两边都要测同一套匹配规则。
 * 网络请求不测（那是在测 DeepSeek），只测我们自己写的那部分。
 */

import type { ParsedChatResponse, RawExtractedItem, RawRevisedItem } from '../src/ai/parse'
import {
  createMatchContext,
  draftsToBulkAddItems,
  draftsToBulkUpdates,
  toItemDraft,
  toTidyDraft,
} from '../src/ai/convert'
import {
  buildChatMessages,
  mergeChatResponse,
  previewDraftPayload,
  serializeDrafts,
  type ChatTurn,
} from '../src/ai/chat'
import { AiError } from '../src/ai/deepseek'
import {
  extractJson,
  parseAssignments,
  parseChatResponse,
  parseExtraction,
} from '../src/ai/parse'
import {
  buildAiContext,
  buildExtractionMessages,
  buildTidyMessages,
  chunkItems,
  renderContextBlock,
  splitIntoChunks,
} from '../src/ai/prompts'
import { buildExportFile } from '../src/data/exportJson'
import { getRepository } from '../src/storage/repository'
import { createDerived } from '../src/store/selectors'
import { flushWrites, useAppStore } from '../src/store/useAppStore'
import type { AppData, Category, Location } from '../src/types'
import { deepEq, eq, fixture, must, ok, suite, test } from './harness'

/* ------------------------------------------------------------------ */
/* 1. 从模型回复里抠 JSON                                              */
/* ------------------------------------------------------------------ */

suite('AI 回复解析：抠出 JSON')

await test('纯粹的 JSON 直接解析', () => {
  deepEq(extractJson('{"items":[]}'), { items: [] })
})

await test('包在 ```json 代码围栏里也能解析', () => {
  const parsed = extractJson('```json\n{"items":[{"name":"毛衣"}]}\n```') as {
    items: Array<{ name: string }>
  }
  eq(parsed.items[0].name, '毛衣')
})

await test('不带语言标记的围栏也能解析', () => {
  const parsed = extractJson('```\n{"items":[{"name":"牛仔裤"}]}\n```') as {
    items: Array<{ name: string }>
  }
  eq(parsed.items[0].name, '牛仔裤')
})

await test('模型加了前言后语时，截取大括号之间的内容', () => {
  const parsed = extractJson('好的，我来帮你整理：\n{"items":[{"name":"平底锅"}]}\n希望有帮助！') as {
    items: Array<{ name: string }>
  }
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

await test('标准结构（分类是路径的数组）', () => {
  const result = parseExtraction({
    items: [
      {
        name: '眼影盘',
        quantity: 1,
        categories: [['化妆品', '眼妆']],
        location: ['家', '卧室', '梳妆台'],
        tags: ['舍不得扔'],
        attributes: { 品牌: '某品牌' },
        note: '',
      },
    ],
  })
  eq(result.items.length, 1)
  deepEq(result.items[0].categoryPaths, [['化妆品', '眼妆']], '分类应该保留层级')
  deepEq(result.items[0].location, ['家', '卧室', '梳妆台'])
})

await test('分类写成平铺名字时，当成单元素路径', () => {
  const result = parseExtraction({ items: [{ name: '毛衣', categories: ['衣物'] }] })
  deepEq(result.items[0].categoryPaths, [['衣物']], '一个名字就是一条单级路径')
})

await test('分类写成「化妆品/眼妆」这种字符串时也能拆开', () => {
  const result = parseExtraction({ items: [{ name: '眼影', categories: ['化妆品/眼妆'] }] })
  deepEq(result.items[0].categoryPaths, [['化妆品', '眼妆']])
})

await test('分类路径之间会去重', () => {
  const result = parseExtraction({
    items: [{ name: 'A', categories: [['化妆品', '眼妆'], ['化妆品', '眼妆']] }],
  })
  eq(result.items[0].categoryPaths.length, 1)
})

await test('顶层直接是数组', () => {
  eq(parseExtraction([{ name: '台灯' }]).items.length, 1)
})

await test('键名是中文时也能认（模型有时会这样）', () => {
  const result = parseExtraction({
    物品: [{ 名称: '电饭煲', 数量: '2', 分类: [['厨房']], 位置: '家 / 厨房' }],
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
    parseExtraction({ items: [{ name: 'A', location: '家 > 书房 > 书架' }] }).items[0].location?.join(
      '/',
    ),
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
    assignments: [
      { id: 'i1', categories: [['化妆品', '眼妆']], location: ['家', '卧室'], reason: '应该归到卧室' },
    ],
  })
  eq(list.length, 1)
  eq(list[0].id, 'i1')
  deepEq(list[0].categoryPaths, [['化妆品', '眼妆']])
  deepEq(list[0].location, ['家', '卧室'])
})

await test('没有 id 的建议被丢弃（不能用）', () => {
  eq(parseAssignments({ assignments: [{ categories: [['衣物']] }, { id: 'ok' }] }).length, 1)
})

/* ------------------------------------------------------------------ */
/* 4. 名称路径 → id 的匹配                                             */
/* ------------------------------------------------------------------ */

suite('名称匹配：位置与分类')

const fx = fixture()
const ctx = createDerived(fx)
const match = createMatchContext(fx, ctx)

function raw(partial: Partial<RawExtractedItem> & { name: string }): RawExtractedItem {
  return {
    name: partial.name,
    quantity: partial.quantity ?? 1,
    categoryPaths: partial.categoryPaths ?? [],
    location: partial.location ?? null,
    tags: partial.tags ?? [],
    attributes: partial.attributes ?? {},
    note: partial.note ?? '',
  }
}

/* ---- 位置 ---- */

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
  const storageShelf = must(fx.locations.find((l) => l.name === '货架'), '种子里应该有货架')
  ok(draft.locationId !== storageShelf.id, '不能匹配到储物间下的那个货架')
  eq(draft.locationId, null)
  deepEq(draft.newLocationPath, ['家', '车库', '货架'])
  eq(draft.locationLabel, '家 / 车库 / 货架（新）')
})

await test('AI 只给了后半段路径时，按后缀唯一匹配上', () => {
  const draft = toItemDraft(raw({ name: '毛衣', location: ['卧室', '衣柜'] }), match, ctx)
  eq(draft.locationId, must(fx.locations.find((l) => l.name === '衣柜'), '找不到衣柜').id)
  eq(draft.newLocationPath, null, '不该被判成新位置')
})

await test('没提到位置就是未归位，绝不瞎猜', () => {
  const draft = toItemDraft(raw({ name: '不知道放哪的东西' }), match, ctx)
  eq(draft.locationId, null)
  eq(draft.newLocationPath, null)
  eq(draft.locationLabel, '未归位')
})

/* ---- 分类（也是树） ---- */

await test('分类按完整路径精确匹配', () => {
  const clothing = must(fx.categories.find((c) => c.name === '衣物'), '找不到衣物')
  const draft = toItemDraft(raw({ name: '毛衣', categoryPaths: [['衣物']] }), match, ctx)
  eq(draft.matchedCategoryIds.length, 1)
  eq(draft.matchedCategoryIds[0], clothing.id)
  deepEq(draft.newCategoryPaths, [])
})

await test('分类的层级路径能精确命中（化妆品 / 眼妆）', () => {
  const { data, derived, matchCtx } = hierarchyFixture()

  const draft = toItemDraft(
    raw({ name: '眼影盘', categoryPaths: [['化妆品', '眼妆']] }),
    matchCtx,
    derived,
  )
  const eyeMakeup = must(data.categories.find((c) => c.name === '眼妆'), '找不到眼妆')
  eq(draft.matchedCategoryIds.length, 1)
  eq(draft.matchedCategoryIds[0], eyeMakeup.id, '应该命中子分类，而不是父分类')
  deepEq(draft.newCategoryPaths, [], '不该产生新分类')
})

await test('物品可以挂在分类的中间层', () => {
  const { data, derived, matchCtx } = hierarchyFixture()
  const draft = toItemDraft(raw({ name: '化妆包', categoryPaths: [['化妆品']] }), matchCtx, derived)
  const cosmetics = must(data.categories.find((c) => c.name === '化妆品'), '找不到化妆品')
  eq(draft.matchedCategoryIds[0], cosmetics.id, '挂在中间层是合法的')
})

await test('分类只给末级名字时按后缀唯一匹配', () => {
  const { data, derived, matchCtx } = hierarchyFixture()
  const draft = toItemDraft(raw({ name: '口红', categoryPaths: [['唇妆']] }), matchCtx, derived)
  const lip = must(data.categories.find((c) => c.name === '唇妆'), '找不到唇妆')
  eq(draft.matchedCategoryIds[0], lip.id)
})

await test('分类路径对不上时标成新分类，默认不采纳', () => {
  const draft = toItemDraft(
    raw({ name: '帐篷', categoryPaths: [['户外', '露营']] }),
    match,
    ctx,
  )
  deepEq(draft.matchedCategoryIds, [])
  deepEq(draft.newCategoryPaths, [['户外', '露营']], '应该保留层级，而不是拍平成一个名字')
  eq(draft.adoptNewCategories, false, '分类是受控词表，必须默认不勾，等用户点头')
})

await test('改名后的分类仍按新名字匹配', () => {
  const data: AppData = {
    ...fx,
    categories: fx.categories.map((c) => (c.name === '衣物' ? { ...c, name: '服装' } : c)),
  }
  const renamed = createDerived(data)
  const renamedMatch = createMatchContext(data, renamed)

  const hit = toItemDraft(raw({ name: '毛衣', categoryPaths: [['服装']] }), renamedMatch, renamed)
  eq(hit.matchedCategoryIds.length, 1, '新名字应该命中')

  const miss = toItemDraft(raw({ name: '毛衣', categoryPaths: [['衣物']] }), renamedMatch, renamed)
  eq(miss.matchedCategoryIds.length, 0, '旧名字不该再命中')
  deepEq(miss.newCategoryPaths, [['衣物']])
})

await test('已有分类和建议的新分类可以并存', () => {
  const draft = toItemDraft(
    raw({ name: '登山杖', categoryPaths: [['工具'], ['户外', '登山']] }),
    match,
    ctx,
  )
  eq(draft.matchedCategoryIds.length, 1)
  deepEq(draft.newCategoryPaths, [['户外', '登山']])
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
  const draft = toItemDraft(raw({ name: '毛衣', categoryPaths: [[' 衣物 ']] }), match, ctx)
  eq(draft.matchedCategoryIds.length, 1)
})

/* ------------------------------------------------------------------ */
/* 5. 草稿 → 写入计划                                                  */
/* ------------------------------------------------------------------ */

suite('草稿转成写入计划')

await test('未采纳的新分类不会进入计划', () => {
  const draft = toItemDraft(
    raw({ name: '帐篷', categoryPaths: [['衣物'], ['户外装备']] }),
    match,
    ctx,
  )
  eq(draft.adoptNewCategories, false, '新分类默认不采纳')
  deepEq(
    draftsToBulkAddItems([draft], match, ctx)[0].categoryPaths,
    [['衣物']],
    '未采纳时只带上已匹配到的那个',
  )
})

await test('采纳后的新分类会带着层级进入计划', () => {
  const draft = {
    ...toItemDraft(raw({ name: '眼影盘', categoryPaths: [['化妆品', '眼妆']] }), match, ctx),
    adoptNewCategories: true,
  }
  const plan = draftsToBulkAddItems([draft], match, ctx)
  deepEq(plan[0].categoryPaths, [['化妆品', '眼妆']], '层级不能被拍平')
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

  const noop = toTidyDraft(
    { id: 'i1', categoryPaths: [['衣物']], location: ['家', '卧室', '衣柜'], reason: '本来就这样' },
    existing,
    match,
    ctx,
  )
  eq(noop, null, '没有变化的建议不该出现在预览里')

  const changed = toTidyDraft(
    { id: 'i1', categoryPaths: [['衣物']], location: ['家', '客厅'], reason: '换个地方' },
    existing,
    match,
    ctx,
  )
  ok(changed !== null, '有变化的应该保留')
  eq(changed?.matchedCategoryIds[0], clothing.id)
})

await test('整理计划只带上要改的字段', () => {
  const existing = must(fx.items.find((i) => i.id === 'i2'), '找不到 i2')
  const draft = toTidyDraft(
    { id: 'i2', categoryPaths: [['衣物']], location: ['家', '客厅', '电视柜'], reason: '移一下' },
    existing,
    match,
    ctx,
  )
  const updates = draftsToBulkUpdates([must(draft, '草稿不该为空')], match, ctx)
  eq(updates.length, 1)
  eq(updates[0].id, 'i2')
  deepEq(updates[0].locationPath, ['家', '客厅', '电视柜'])
  deepEq(updates[0].categoryPaths, [['衣物']])
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
  for (const chunk of chunks) ok(chunk.length <= 80, `每段都比上限大太多：${chunk.length}`)
  eq(chunks.join('\n').replace(/\s/g, ''), text.replace(/\s/g, ''), '拼回来内容不该丢')
})

await test('单独一行超长时硬切开，不会死循环', () => {
  const chunks = splitIntoChunks('字'.repeat(250), 100)
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

await test('把已有分类、位置路径、属性都带上（分类带层级）', () => {
  const { data, derived } = hierarchyFixture()
  const aiCtx = buildAiContext(data, derived)

  ok(
    aiCtx.categoryPaths.some((path) => path.join('/') === '化妆品/眼妆'),
    '子分类要以完整路径出现在上下文里',
  )
  ok(aiCtx.locationPaths.some((path) => path.join('/') === '家/卧室/衣柜'))
  ok(aiCtx.attributes.includes('品牌'))
  eq(aiCtx.truncated, false)
})

await test('渲染出来的上下文块包含关键清单，并说明可以挂任意一级', () => {
  const { data, derived } = hierarchyFixture()
  const block = renderContextBlock(buildAiContext(data, derived))

  ok(block.includes('【已有分类】'))
  ok(block.includes('化妆品 / 眼妆'), '分类要以完整路径出现')
  ok(block.includes('家 / 卧室 / 衣柜'), '位置要以完整路径出现')
  ok(block.includes('任意一级'), '要告诉 AI 物品可以挂在中间层')
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
  eq(trimmed.categoryPaths.length, 2)
  ok(renderContextBlock(trimmed).includes('截断'))
})

/* ------------------------------------------------------------------ */
/* 8. store 批量写入                                                   */
/* ------------------------------------------------------------------ */

suite('批量写入（自动创建分类与位置）')

function seedStore(data: AppData = fx): void {
  useAppStore.setState({
    status: 'ready',
    error: null,
    data,
    derived: createDerived(data),
  })
}

await test('批量录入：多级分类路径被逐层创建', async () => {
  seedStore()
  const before = useAppStore.getState().data.categories.length

  useAppStore.getState().bulkAddItems([
    {
      name: '眼影盘',
      quantity: 1,
      categoryPaths: [['化妆品', '眼妆']],
      locationPath: null,
      tags: [],
      attrs: {},
      note: '',
    },
  ])

  const state = useAppStore.getState()
  eq(state.data.categories.length, before + 2, '化妆品和眼妆两级都该建出来')

  const cosmetics = must(state.data.categories.find((c) => c.name === '化妆品'), '化妆品应存在')
  const eyeMakeup = must(state.data.categories.find((c) => c.name === '眼妆'), '眼妆应存在')
  eq(cosmetics.parentId, null, '化妆品应该是顶层')
  eq(eyeMakeup.parentId, cosmetics.id, '眼妆应该挂在化妆品下')

  const item = must(state.data.items.find((i) => i.name === '眼影盘'), '眼影盘应存在')
  deepEq(item.categoryIds, [eyeMakeup.id])
  await flushWrites()
})

await test('批量录入：同一条路径只建一次', async () => {
  seedStore()
  useAppStore.getState().bulkAddItems([
    {
      name: '口红',
      quantity: 1,
      categoryPaths: [['化妆品', '唇妆']],
      locationPath: null,
      tags: [],
      attrs: {},
      note: '',
    },
    {
      name: '唇釉',
      quantity: 1,
      categoryPaths: [['化妆品', '唇妆']],
      locationPath: null,
      tags: [],
      attrs: {},
      note: '',
    },
  ])

  const state = useAppStore.getState()
  eq(state.data.categories.filter((c) => c.name === '化妆品').length, 1, '化妆品只该有一个')
  eq(state.data.categories.filter((c) => c.name === '唇妆').length, 1, '唇妆只该有一个')
  await flushWrites()
})

await test('批量录入：已有的分类路径直接复用，不会重复建', async () => {
  const { data, derived, matchCtx } = hierarchyFixture()
  seedStore(data)
  const before = useAppStore.getState().data.categories.length

  const draft = toItemDraft(
    raw({ name: '睫毛膏', categoryPaths: [['化妆品', '眼妆']] }),
    matchCtx,
    derived,
  )
  useAppStore.getState().bulkAddItems(draftsToBulkAddItems([draft], matchCtx, derived))

  eq(useAppStore.getState().data.categories.length, before, '不该多出任何分类')
  const eyeMakeup = must(data.categories.find((c) => c.name === '眼妆'), '找不到眼妆')
  const item = must(useAppStore.getState().data.items.find((i) => i.name === '睫毛膏'), '找不到睫毛膏')
  deepEq(item.categoryIds, [eyeMakeup.id])
  await flushWrites()
})

await test('批量录入：位置路径逐层创建，中间层缺失也能补上', async () => {
  seedStore()
  const result = useAppStore.getState().bulkAddItems([
    {
      name: '工具箱',
      quantity: 1,
      categoryPaths: [],
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
  eq(garage.parentId, home.id, '车库应该挂在已有的「家」下')

  const added = must(state.data.items.find((i) => i.name === '工具箱'), '工具箱应存在')
  eq(added.locationId, shelf.id)
  await flushWrites()
})

await test('批量录入：属性名被映射成属性 id；库里没有的属性被忽略', async () => {
  seedStore()
  useAppStore.getState().bulkAddItems([
    {
      name: '毛衣',
      quantity: 1,
      categoryPaths: [],
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
      categoryPaths: [],
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
      categoryPaths: [['衣物']],
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

  const result = useAppStore.getState().bulkUpdateItems([
    { id: 'i5', categoryPaths: [['电子']], locationPath: ['家', '书房', '书桌'] },
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
  useAppStore.getState().bulkUpdateItems([{ id: 'i1', categoryPaths: [], locationPath: null }])
  const after = must(useAppStore.getState().data.items.find((i) => i.id === 'i1'), 'i1 应还在')
  deepEq(after.categoryIds, [])
  eq(after.locationId, null)
  await flushWrites()
})

/* ------------------------------------------------------------------ */
/* 9. AI 分类匹配的歧义保护                                             */
/* ------------------------------------------------------------------ */

suite('分类后缀有歧义时绝不猜')

await test('两个分支下都有「眼妆」时，只给名字不匹配', () => {
  const { data, derived, matchCtx } = ambiguousCategoryFixture()
  const draft = toItemDraft(raw({ name: '眼影', categoryPaths: [['眼妆']] }), matchCtx, derived)
  eq(draft.matchedCategoryIds.length, 0, '两个眼妆，无法判断该挂哪个，不该瞎猜')
  deepEq(draft.newCategoryPaths, [['眼妆']])
  void data
})

await test('给了完整路径就能消歧', () => {
  const { data, derived, matchCtx } = ambiguousCategoryFixture()
  const draft = toItemDraft(
    raw({ name: '眼影', categoryPaths: [['护肤', '眼妆']] }),
    matchCtx,
    derived,
  )
  // 注意：不能只按 name 找 —— 树里有两个「眼妆」，必须连父级一起限定
  const skin = must(data.categories.find((c) => c.name === '护肤'), '找不到护肤')
  const skinEye = must(
    data.categories.find((c) => c.name === '眼妆' && c.parentId === skin.id),
    '找不到护肤下的眼妆',
  )
  eq(draft.matchedCategoryIds[0], skinEye.id, '完整路径应该能唯一定位')
})

/* ------------------------------------------------------------------ */
/* 9. Prompt 的关键约束（防回归）                                       */
/* ------------------------------------------------------------------ */

suite('Prompt 的关键约束')

/**
 * 这组测试守的是一个真实踩过的坑：
 * 最初的指令只写「优先复用已有分类」，结果用户输入「化妆品：口红、眼影」时，
 * 因为分类清单里没有「化妆品」，AI 就近把口红塞进了「日用品」。
 * 指令必须明确：原文自己写的归类名优先级最高，宁可新建也不要硬塞。
 */
await test('抽取指令：原文写了归类名就必须用它，哪怕要新建分类', () => {
  const messages = buildExtractionMessages(buildAiContext(fx, ctx), '化妆品：口红、眼影')
  const system = must(messages[0], '应该有 system 消息').content

  ok(system.includes('原文自己给出了归类名'), '要有「认原文归类名」这条规则')
  ok(system.includes('即使它不在【已有分类】里'), '要明确说清单之外也可以用')
  ok(system.includes('绝对不要为了避开新建分类'), '要禁止为了省事而硬塞')
  ok(system.includes('把「口红」归到「日用品」是错的'), '要给出具体的反例')
  ok(system.includes('不是「必须从中二选一的选项」'), '要说清清单只是候选')
})

await test('上下文块里再强调一遍这条约束', () => {
  const block = renderContextBlock(buildAiContext(fx, ctx))
  ok(block.includes('必须用它'), '上下文里也要提醒')
  ok(
    block.includes('宁可新建一个分类，也不要把东西塞进不相干的已有分类'),
    '光靠 system 一处不够，上下文里再钉一次',
  )
})

await test('整理指令：允许纠正错的分类，该新建就新建', () => {
  const messages = buildTidyMessages(buildAiContext(fx, ctx), [])
  const system = must(messages[0], '应该有 system 消息').content
  ok(system.includes('该新建就新建'), '整理模式也要能纠正错分类')
  ok(system.includes('明显不合适'), '要说明什么情况下该改')
})

await test('抽取指令要求 json 模式（DeepSeek 的硬性要求）', () => {
  const messages = buildExtractionMessages(buildAiContext(fx, ctx), '一件东西')
  const all = messages.map((m) => m.content).join('\n')
  ok(all.includes('json'), 'DeepSeek 的 JSON 模式要求 prompt 里必须出现 json 字样')
})

/* ------------------------------------------------------------------ */
/* 10. API Key 的存放边界                                              */
/* ------------------------------------------------------------------ */

suite('API Key：存在本地，但不外泄')

const SECRET = 'sk-test-this-must-never-be-exported-1234'

await test('Key 会保存到 localStorage —— 这是刻意的，刷新不该丢', () => {
  seedStore()
  useAppStore.getState().setAiApiKey(SECRET)
  eq(
    localStorage.getItem('duansheli:ai-key'),
    SECRET,
    '用户要求存本地，刷新后还能直接用',
  )
  eq(useAppStore.getState().aiApiKey, SECRET)
})

await test('清除后 localStorage 里也一并删掉', () => {
  seedStore()
  useAppStore.getState().setAiApiKey(SECRET)
  useAppStore.getState().setAiApiKey('')

  eq(localStorage.getItem('duansheli:ai-key'), null, '清除要真的删掉，不能只清内存')
  eq(useAppStore.getState().aiApiKey, '')
})

await test('Key 只会存在一个地方，不会散落到别的键上', () => {
  seedStore()
  useAppStore.getState().setAiApiKey(SECRET)

  const holders = Object.keys(localStorage).filter((key) =>
    (localStorage.getItem(key) ?? '').includes(SECRET),
  )
  deepEq(holders, ['duansheli:ai-key'], '只该有一个地方存着它，手动清理时才找得到')
})

await test('Key 绝不会进导出的备份文件', () => {
  seedStore()
  useAppStore.getState().setAiApiKey(SECRET)

  const exported = JSON.stringify(buildExportFile(useAppStore.getState().data))
  ok(
    !exported.includes(SECRET),
    '导出文件是要拿去传网盘 / 换设备的，绝不能把钥匙一起带走',
  )
  ok(!exported.includes('aiApiKey'), '连字段名都不该出现')
})

await test('Key 绝不会进 IndexedDB', async () => {
  seedStore()
  useAppStore.getState().setAiApiKey(SECRET)
  await flushWrites()

  const persisted = JSON.stringify(await getRepository().load())
  ok(!persisted.includes(SECRET), 'Key 不该落进本地数据库')
})

// 收尾：把 Key 清干净。否则它会留在内存和 localStorage 里，
// 影响后面那些「页面上应该显示 Key 输入框」的渲染测试。
useAppStore.getState().setAiApiKey('')

/* ------------------------------------------------------------------ */
/* 11. 对话整理：草稿合并                                              */
/* ------------------------------------------------------------------ */

suite('对话整理：草稿合并')

const chatMatch = createMatchContext(fx, ctx)

function revisedItem(
  partial: Partial<RawRevisedItem> & { id: string; name: string },
): RawRevisedItem {
  return {
    id: partial.id,
    name: partial.name,
    quantity: partial.quantity ?? 1,
    categoryPaths: partial.categoryPaths ?? [],
    location: partial.location ?? null,
    tags: partial.tags ?? [],
    attributes: partial.attributes ?? {},
    note: partial.note ?? '',
    removed: partial.removed ?? false,
  }
}

function botReply(
  items: RawRevisedItem[],
  removedIds: string[] = [],
  reply = '改好了',
): ParsedChatResponse {
  return { reply, items, removedIds, noChanges: false }
}

/* ---- 合并 ---- */

await test('id 命中且内容没变 → 计入 unchanged，草稿不变', () => {
  const base = toItemDraft(raw({ name: '口红', categoryPaths: [['衣物']] }), chatMatch, ctx)
  const outcome = mergeChatResponse(
    botReply([revisedItem({ id: base.key, name: '口红', categoryPaths: [['衣物']] })]),
    [base],
    chatMatch,
    ctx,
  )
  eq(outcome.unchanged, 1)
  eq(outcome.updated, 0)
  eq(outcome.drafts.length, 1)
  eq(outcome.drafts[0].key, base.key, 'id 要保住，下一轮才认得出来')
  deepEq(outcome.changedKeys, [], '没变就不该高亮')
})

await test('id 命中且内容变了 → 计入 updated 并高亮', () => {
  const base = toItemDraft(raw({ name: '口红', categoryPaths: [['衣物']] }), chatMatch, ctx)
  const outcome = mergeChatResponse(
    botReply([
      revisedItem({ id: base.key, name: '长管油口红', categoryPaths: [['化妆品', '唇妆']] }),
    ]),
    [base],
    chatMatch,
    ctx,
  )
  eq(outcome.updated, 1)
  eq(outcome.drafts[0].name, '长管油口红')
  deepEq(outcome.changedKeys, [base.key], '改过的要能高亮出来')
})

await test('AI 新加的物品 → added，并沿用 AI 给的 id', () => {
  const outcome = mergeChatResponse(
    botReply([revisedItem({ id: 'new-1', name: '眼影盘', categoryPaths: [['化妆品']] })]),
    [],
    chatMatch,
    ctx,
  )
  eq(outcome.added, 1)
  eq(outcome.drafts[0].key, 'new-1', '沿用 AI 的 id，下一轮还能对上')
})

await test('removedIds → 真的删掉', () => {
  const base = toItemDraft(raw({ name: '卸妆膏' }), chatMatch, ctx)
  const outcome = mergeChatResponse(botReply([], [base.key]), [base], chatMatch, ctx)
  eq(outcome.removed, 1)
  eq(outcome.drafts.length, 0)
})

await test('单条上的 removed: true 也认（AI 有时会这么写）', () => {
  const base = toItemDraft(raw({ name: '卸妆膏' }), chatMatch, ctx)
  const outcome = mergeChatResponse(
    botReply([revisedItem({ id: base.key, name: '卸妆膏', removed: true })]),
    [base],
    chatMatch,
    ctx,
  )
  eq(outcome.removed, 1)
  eq(outcome.drafts.length, 0)
})

/**
 * 这是整个对话模式最要紧的一条。
 * AI 每轮只返回改动过的条目，其余都没提到 —— 那些**必须原样保留**。
 * 早期版本要求 AI 返回完整列表，漏写就会丢东西。
 */
await test('AI 没提到的条目一律原样保留 —— 绝不静默丢东西', () => {
  const a = toItemDraft(raw({ name: '口红' }), chatMatch, ctx)
  const b = toItemDraft(raw({ name: '眼影盘' }), chatMatch, ctx)
  const c = toItemDraft(raw({ name: '卸妆水' }), chatMatch, ctx)

  // AI 只改了一条，另外两条压根没提
  const outcome = mergeChatResponse(
    botReply([revisedItem({ id: b.key, name: '眼影盘', categoryPaths: [['衣物']] })]),
    [a, b, c],
    chatMatch,
    ctx,
  )

  eq(outcome.drafts.length, 3, '一条都不能少')
  eq(outcome.updated, 1)
  eq(outcome.unchanged, 2, '没被提到的两条要算作未改动')
  deepEq(
    outcome.drafts.map((d) => d.key),
    [a.key, b.key, c.key],
    '顺序也要保持原样，不能每改一次就重排',
  )
})

await test('顺序：改过的就地更新，新增的追加到末尾', () => {
  const a = toItemDraft(raw({ name: 'A' }), chatMatch, ctx)
  const b = toItemDraft(raw({ name: 'B' }), chatMatch, ctx)

  const outcome = mergeChatResponse(
    botReply([
      revisedItem({ id: a.key, name: 'A 改过了' }),
      revisedItem({ id: 'new-1', name: 'C' }),
    ]),
    [a, b],
    chatMatch,
    ctx,
  )

  deepEq(outcome.drafts.map((d) => d.name), ['A 改过了', 'B', 'C'])
})

await test('removedIds 里混进不存在的 id 时，只计数不崩', () => {
  const base = toItemDraft(raw({ name: '口红' }), chatMatch, ctx)
  const outcome = mergeChatResponse(
    botReply([], [base.key, 'ai-编的-id']),
    [base],
    chatMatch,
    ctx,
  )
  eq(outcome.removed, 1)
  eq(outcome.unknownIds, 1, 'AI 编的 id 要如实计数，但不该影响别的')
  eq(outcome.drafts.length, 0)
})

await test('AI 改内容时，用户取消的勾选状态要保留', () => {
  const base = { ...toItemDraft(raw({ name: '口红' }), chatMatch, ctx), include: false }
  const outcome = mergeChatResponse(
    botReply([revisedItem({ id: base.key, name: '口红', categoryPaths: [['衣物']] })]),
    [base],
    chatMatch,
    ctx,
  )
  eq(outcome.drafts[0].include, false, 'AI 改了内容，不该把用户取消的勾选又打开')
})

await test('AI 重复返回同一个 id 时只认第一条，不会造出重复项', () => {
  const base = toItemDraft(raw({ name: '口红' }), chatMatch, ctx)
  const outcome = mergeChatResponse(
    botReply([
      revisedItem({ id: base.key, name: '口红' }),
      revisedItem({ id: base.key, name: '口红的副本' }),
    ]),
    [base],
    chatMatch,
    ctx,
  )
  eq(outcome.drafts.length, 1, '同一个 id 只该有一条')
})

/* ---- 发给 AI 的内容（省 token 相关） ---- */

await test('发给 AI 的草稿用的是人话（名称路径），不是 id', () => {
  const base = toItemDraft(
    raw({ name: '毛衣', categoryPaths: [['衣物']], location: ['家', '卧室'] }),
    chatMatch,
    ctx,
  )
  const serialized = serializeDrafts([base], ctx)
  deepEq(serialized[0].categoryPaths, [['衣物']], '要发名称路径，AI 看不懂 id')
  deepEq(serialized[0].location, ['家', '卧室'])
  eq(serialized[0].id, base.key, '同时要带上 id，AI 才认得出来是哪一条')
})

await test('未采纳的新分类不该发给 AI（否则它会以为已经生效了）', () => {
  const base = toItemDraft(raw({ name: '帐篷', categoryPaths: [['户外装备']] }), chatMatch, ctx)
  eq(base.adoptNewCategories, false)
  eq(serializeDrafts([base], ctx)[0].categoryPaths.length, 0, '没采纳就还是未分类')

  const adopted = { ...base, adoptNewCategories: true }
  deepEq(serializeDrafts([adopted], ctx)[0].categoryPaths, [['户外装备']], '采纳后才该出现')
})

await test('空字段不发出去（省 token）', () => {
  const bare = toItemDraft(raw({ name: '一张纸' }), chatMatch, ctx)
  const payload = previewDraftPayload(serializeDrafts([bare], ctx))

  ok(!payload.includes('"tags"'), '空标签不该发')
  ok(!payload.includes('"attributes"'), '空属性不该发')
  ok(!payload.includes('"note"'), '空备注不该发')
  ok(!payload.includes('"categories"'), '没有分类时不该发')
  ok(!payload.includes('"location"'), '没有位置时不该发')
  ok(!payload.includes('"quantity"'), '数量为 1 时是默认值，不用发')
  ok(payload.includes('"id"') && payload.includes('"name"'), 'id 和名称必须在')

  // 有值的字段还是要发的
  const rich = toItemDraft(
    raw({ name: '毛衣', quantity: 3, categoryPaths: [['衣物']], tags: ['想送人'], note: '妈妈送的' }),
    chatMatch,
    ctx,
  )
  const richPayload = previewDraftPayload(serializeDrafts([rich], ctx))
  ok(richPayload.includes('"quantity":3'), '非默认数量要发')
  ok(richPayload.includes('"想送人"'), '有标签要发')
  ok(richPayload.includes('妈妈送的'), '有备注要发')
})

await test('用户体系放在 system 消息里 —— 这是前缀缓存能生效的前提', () => {
  const context = buildAiContext(fx, ctx)
  const first = buildChatMessages(context, [], [], '第一句')
  const second = buildChatMessages(
    context,
    [
      { role: 'user', content: '第一句' },
      { role: 'assistant', content: '好' },
    ],
    serializeDrafts([toItemDraft(raw({ name: '毛衣' }), chatMatch, ctx)], ctx),
    '第二句',
  )

  eq(must(first[0], '应该有 system').role, 'system')
  eq(
    must(first[0], '应该有 system').content,
    must(second[0], '应该有 system').content,
    'system 必须逐字节一致，否则缓存命中不了',
  )
  ok(
    must(first[0], '应该有 system').content.includes('【已有分类】'),
    '用户体系应该在 system 里',
  )
  ok(
    !must(first[first.length - 1], '应该有最后一条').content.includes('【已有分类】'),
    '用户消息里不该再重复一遍体系',
  )
})

/* ---- 解析 ---- */

await test('解析对话回复：标准结构 / 纯问答 / removedIds / 全不合法', () => {
  const normal = parseChatResponse({
    reply: '改好了',
    items: [{ id: 'a', name: '口红', categories: [['化妆品', '唇妆']] }],
    removedIds: ['b'],
  })
  eq(normal.reply, '改好了')
  eq(normal.items.length, 1)
  eq(normal.noChanges, false)
  deepEq(normal.removedIds, ['b'])
  deepEq(normal.items[0].categoryPaths, [['化妆品', '唇妆']])

  const onlyRemoved = parseChatResponse({ reply: '删掉了', removedIds: ['x'] })
  eq(onlyRemoved.items.length, 0)
  eq(onlyRemoved.removedIds.length, 1)
  eq(onlyRemoved.noChanges, false, '只有删除也算有改动')

  // 只回一句话、没有任何改动 —— 这是允许的，草稿该原样保留
  const chatOnly = parseChatResponse({ reply: '这个我不太确定，你能说得更具体吗？' })
  eq(chatOnly.noChanges, true, '要标记出来，让上层保留原草稿')

  // 既没有说明也没有列表 → 明确报错
  let caught: AiError | null = null
  try {
    parseChatResponse({ 说明: '' })
  } catch (err) {
    caught = err instanceof AiError ? err : null
  }
  ok(caught !== null, '什么都拿不到时应该报错')
})

await test('对话的 history 不会被无限撑大', () => {
  const longHistory: ChatTurn[] = Array.from({ length: 40 }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `第 ${i} 轮`,
  }))
  const messages = buildChatMessages(buildAiContext(fx, ctx), longHistory, [], '继续改')
  const content = messages.map((m) => m.content).join('\n')

  ok(!content.includes('第 0 轮'), '太老的轮次应该被丢掉')
  ok(content.includes('第 39 轮'), '最近几轮要保留')
  ok(messages.length < 16, `消息条数应该有上限，实际 ${messages.length}`)
})

/* ------------------------------------------------------------------ */
/* 夹具                                                                */
/* ------------------------------------------------------------------ */

/** 一个带分类层级的场景：化妆品 › 眼妆 / 唇妆 */
function hierarchyFixture(): {
  data: AppData
  derived: ReturnType<typeof createDerived>
  matchCtx: ReturnType<typeof createMatchContext>
} {
  const base = fixture()
  const now = new Date().toISOString()

  const cosmetics: Category = {
    id: 'cat-cosmetics',
    name: '化妆品',
    parentId: null,
    order: 20,
    createdAt: now,
  }
  const eye: Category = {
    id: 'cat-eye',
    name: '眼妆',
    parentId: cosmetics.id,
    order: 0,
    createdAt: now,
  }
  const lip: Category = {
    id: 'cat-lip',
    name: '唇妆',
    parentId: cosmetics.id,
    order: 1,
    createdAt: now,
  }

  const data: AppData = { ...base, categories: [...base.categories, cosmetics, eye, lip] }
  const derived = createDerived(data)
  return { data, derived, matchCtx: createMatchContext(data, derived) }
}

/** 两个分支下各有一个「眼妆」，用来验证歧义保护 */
function ambiguousCategoryFixture(): {
  data: AppData
  derived: ReturnType<typeof createDerived>
  matchCtx: ReturnType<typeof createMatchContext>
} {
  const { data: base } = hierarchyFixture()
  const now = new Date().toISOString()

  const skin: Category = {
    id: 'cat-skin',
    name: '护肤',
    parentId: null,
    order: 21,
    createdAt: now,
  }
  const skinEye: Category = {
    id: 'cat-skin-eye',
    name: '眼妆',
    parentId: skin.id,
    order: 0,
    createdAt: now,
  }

  const data: AppData = { ...base, categories: [...base.categories, skin, skinEye] }
  const derived = createDerived(data)
  return { data, derived, matchCtx: createMatchContext(data, derived) }
}

/* 让 TS 知道 Location 被用到了（夹具里会用到它的类型） */
export type { Location }
