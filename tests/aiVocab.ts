/**
 * AI 认不认识这个工具的词汇。
 *
 * ── 这一组守的是用户报上来的那个 bug ──────────────────────────────
 * 「我在让 ai 助手修改的时候，我说闲置，他给我打了闲置标签，
 *   而不是放到闲置里面」
 *
 * 根本原因不是模型笨，而是**输出格式里根本没有能装「闲置」的地方** ——
 * 于是标签是它唯一能塞的槽。所以修法必须是两层：
 *   1. 给它一个 status 字段（结构化）
 *   2. 明确告诉它这些词在本工具里是什么意思、以及**状态词不许进 tags**
 *
 * 第 2 层没法自动化验证「模型照做了」，但能验证**提示词里确实写了这些规则**
 * （提示词回归），以及**程序这一侧把 status 完整地接住了**（数据通路回归）。
 * 这两层加起来才是完整的：光加字段，模型照样会一边填 status 一边往 tags 里塞。
 */

import { mergeChatResponse, serializeDrafts, previewDraftPayload } from '../src/ai/chat'
import { createMatchContext, draftsFromItems, draftsToApply, toItemDraft } from '../src/ai/convert'
import { parseChatResponse, parseExtraction } from '../src/ai/parse'
import { buildAiContext, buildInventoryDigest, renderContextBlock } from '../src/ai/prompts'
import { promptTextEn } from '../src/ai/promptText/en'
import { promptTextZh } from '../src/ai/promptText/zh'
import { createDerived } from '../src/store/selectors'
import type { AppData } from '../src/types'
import { eq, fixture, item, must, ok, suite, test } from './harness'

/* ------------------------------------------------------------------ */
/* 一、解析：AI 说的状态词要认出来                                      */
/* ------------------------------------------------------------------ */

suite('AI 词汇：状态解析')

/** 造一段 AI 的返回，只关心 items[0] */
function extractOne(entry: Record<string, unknown>) {
  const parsed = parseExtraction({ items: [entry] })
  return must(parsed.items[0], '应该解析出一条')
}

await test('中文状态词认得出：闲置 / 备用 / 在用', () => {
  // 用户原话就是中文的，模型多数时候也照抄中文
  eq(extractOne({ name: '旧手机', status: '闲置' }).status, 'idle')
  eq(extractOne({ name: '备用牙膏', status: '备用' }).status, 'spare')
  eq(extractOne({ name: '牙刷', status: '在用' }).status, 'active')
})

await test('代码值也认得出：idle / spare / active', () => {
  eq(extractOne({ name: 'A', status: 'idle' }).status, 'idle')
  eq(extractOne({ name: 'B', status: 'spare' }).status, 'spare')
  eq(extractOne({ name: 'C', status: 'active' }).status, 'active')
})

await test('切到英文界面时，英文状态词也认得出', () => {
  eq(extractOne({ name: 'A', status: 'In use' }).status, 'active')
  eq(extractOne({ name: 'B', status: 'idle' }).status, 'idle')
  eq(extractOne({ name: 'C', status: 'Spare' }).status, 'spare')
  eq(extractOne({ name: 'D', status: '  SPARE  ' }).status, 'spare', '大小写和空格不该影响')
})

await test('中文键名也认：状态 / 活动', () => {
  // 模型偶尔会用中文键名，parse.ts 一直容忍这类写法
  const parsed = extractOne({ name: '口红', 状态: '闲置', 活动: ['旅行'] })
  eq(parsed.status, 'idle')
  eq(parsed.collections.length, 1)
  eq(parsed.collections[0], '旅行')
})

await test('没提状态就是 null —— 和「在用」是两回事', () => {
  // 这个区别很要紧：改已有物品时 null = 别动它现在的状态。
  // 要是这里退化成 'active'，AI 只改个名字就会把闲置的东西变回在用。
  eq(extractOne({ name: '牙刷' }).status, null)
  eq(extractOne({ name: '牙刷', status: '' }).status, null)
  eq(extractOne({ name: '牙刷', status: '随便什么' }).status, null, '认不出来的当作没提')
})

await test('「已舍弃」单独成一档，不混进那三个状态里', () => {
  // 它要被转成一次删除请求（进回收站），不是塞进物品的字段
  eq(extractOne({ name: '旧拖鞋', status: '已舍弃' }).status, 'discarded')
  eq(extractOne({ name: '旧拖鞋', status: 'discarded' }).status, 'discarded')
})

await test('活动名解析出来，而且**不认「清单」这个词**', () => {
  // 活动（collections）和清单（checklists）是两个不同的东西。
  // 把 AI 说的「清单」当活动，会把它塞进一个完全不同的实体里。
  eq(extractOne({ name: '充电宝', collections: ['旅行', '出差'] }).collections.length, 2)

  const asChecklist = extractOne({ name: '充电宝', 清单: ['周末露营'] })
  eq(asChecklist.collections.length, 0, '「清单」不是活动的别名')
})

await test('loadScope 认 spare —— AI 能把备用那批拉进来', () => {
  const parsed = parseChatResponse({ reply: '好', loadScope: { spare: true } })
  ok(parsed.loadScope !== null)
  eq(parsed.loadScope?.spare, true)
})

/* ------------------------------------------------------------------ */
/* 二、落库：status 一路走到物品上                                      */
/* ------------------------------------------------------------------ */

suite('AI 词汇：状态真的落到物品上')

const fx = fixture()
const ctx = createDerived(fx)
const match = createMatchContext(fx, ctx)

await test('AI 说闲置 → 草稿上是闲置 → 落库后物品就是闲置', () => {
  const draft = toItemDraft(
    {
      name: '旧手机',
      quantity: 1,
      categoryPaths: [],
      location: null,
      tags: [],
      attributes: {},
      note: '',
      expiresAt: null,
      status: 'idle',
      collections: [],
    },
    match,
    ctx,
  )

  eq(draft.status, 'idle')

  const plan = draftsToApply([draft], [], ctx)
  eq(plan.plan.length, 1)
  eq(plan.plan[0]?.status, 'idle', '状态要进落库计划')
})

await test('**状态词不会再跑到标签里**：tags 里只有 AI 给的情境标签', () => {
  // 这是那个 bug 的原样复现：用户说「这个闲置了」。
  // 修好之后，模型有 status 可填，tags 只该留「想送人」这种情境标记。
  const draft = toItemDraft(
    {
      name: '旧手机',
      quantity: 1,
      categoryPaths: [],
      location: null,
      tags: ['想送人'],
      attributes: {},
      note: '',
      expiresAt: null,
      status: 'idle',
      collections: [],
    },
    match,
    ctx,
  )

  eq(draft.status, 'idle')
  eq(draft.tags.length, 1)
  eq(draft.tags[0], '想送人')
  ok(!draft.tags.includes('闲置'), '状态绝不能在标签里')
})

await test('活动只有对得上才留，对不上的如实记下来', () => {
  const data: AppData = {
    ...fx,
    collections: [
      { id: 'col1', name: '旅行', note: '', order: 0, createdAt: '2026-01-01T00:00:00.000Z' },
    ],
  }
  const localCtx = createDerived(data)
  const localMatch = createMatchContext(data, localCtx)

  const draft = toItemDraft(
    {
      name: '充电宝',
      quantity: 1,
      categoryPaths: [],
      location: null,
      tags: [],
      attributes: {},
      note: '',
      expiresAt: null,
      status: null,
      collections: ['旅行', '不存在的活动'],
    },
    localMatch,
    localCtx,
  )

  eq(draft.matchedCollectionIds.length, 1)
  eq(draft.matchedCollectionIds[0], 'col1')
  eq(draft.droppedCollections.length, 1, '对不上的要如实记下来，不能默默丢')
  eq(draft.droppedCollections[0], '不存在的活动')

  const plan = draftsToApply([draft], [], localCtx)
  eq(plan.plan[0]?.collectionIds?.length, 1)
})

/* ------------------------------------------------------------------ */
/* 三、指纹：只改状态也必须算改动                                       */
/* ------------------------------------------------------------------ */

suite('AI 词汇：只改状态也算改动')

await test('只把闲置改成备用，必须被认成「改动过」', () => {
  /*
   * 这一条守的是一个**静默丢改动**的坑，和当年有效期那个一模一样：
   * 用户说「这件改成备用」，AI 乖乖把 status 改对了，别的字段一个没动。
   * 如果指纹里没有 status，就会被判成「没改动」→ 跳过 →
   * 界面上什么都没发生，用户只会觉得 AI 又没听懂。
   */
  const data: AppData = {
    ...fx,
    items: [item({ id: 's1', name: '备用牙膏', quantity: 2, status: 'idle' })],
  }
  const localCtx = createDerived(data)
  const localMatch = createMatchContext(data, localCtx)

  const drafts = draftsFromItems(
    [must(data.items[0], 's1')],
    localMatch,
    localCtx,
  )
  eq(drafts[0]?.status, 'idle', '草稿应该带出物品当前的状态')

  const outcome = mergeChatResponse(
    {
      reply: '已改成备用',
      items: [
        {
          id: 's1',
          name: '备用牙膏',
          quantity: 2,
          categoryPaths: [],
          location: null,
          tags: [],
          attributes: {},
          note: '',
          expiresAt: null,
          status: 'spare',
          collections: [],
          removed: false,
        },
      ],
      removedIds: [],
      loadScope: null,
      noChanges: false,
    },
    drafts,
    localMatch,
    localCtx,
  )

  eq(outcome.updated, 1, '只改了状态，也必须算一次改动')
  eq(outcome.changedKeys.length, 1)
  eq(outcome.drafts[0]?.status, 'spare')
})

await test('AI 没提状态 → 保留原来的（不能悄悄变回在用）', () => {
  const data: AppData = {
    ...fx,
    items: [item({ id: 's1', name: '闲置的东西', status: 'idle' })],
  }
  const localCtx = createDerived(data)
  const localMatch = createMatchContext(data, localCtx)
  const drafts = draftsFromItems([must(data.items[0], 's1')], localMatch, localCtx)

  // AI 只改了个名字，没提状态
  const outcome = mergeChatResponse(
    {
      reply: '改名了',
      items: [
        {
          id: 's1',
          name: '改过名字的东西',
          quantity: 1,
          categoryPaths: [],
          location: null,
          tags: [],
          attributes: {},
          note: '',
          expiresAt: null,
          status: null,
          collections: [],
          removed: false,
        },
      ],
      removedIds: [],
      loadScope: null,
      noChanges: false,
    },
    drafts,
    localMatch,
    localCtx,
  )

  eq(outcome.drafts[0]?.name, '改过名字的东西')
  eq(outcome.drafts[0]?.status, 'idle', '没提状态就该保留闲置，不能变回在用')
})

await test('AI 用 status 说「已舍弃」→ 变成一次删除（进回收站，可恢复）', () => {
  // 忽略它是危险的：用户说「这个扔了吧」，界面上什么都不发生。
  // 直接写进 status 也不对：那会绕过回收站。
  const data: AppData = {
    ...fx,
    items: [item({ id: 'd1', name: '要扔的东西' })],
  }
  const localCtx = createDerived(data)
  const localMatch = createMatchContext(data, localCtx)
  const drafts = draftsFromItems([must(data.items[0], 'd1')], localMatch, localCtx)

  const outcome = mergeChatResponse(
    {
      reply: '已移除',
      items: [
        {
          id: 'd1',
          name: '要扔的东西',
          quantity: 1,
          categoryPaths: [],
          location: null,
          tags: [],
          attributes: {},
          note: '',
          expiresAt: null,
          status: 'discarded',
          collections: [],
          removed: false,
        },
      ],
      removedIds: [],
      loadScope: null,
      noChanges: false,
    },
    drafts,
    localMatch,
    localCtx,
  )

  eq(outcome.removedKeys.length, 1, '应该走删除那条路')
  eq(outcome.removedKeys[0], 'd1')

  const plan = draftsToApply(outcome.drafts, data.items, localCtx, outcome.removedKeys)
  eq(plan.discardIds.length, 1, '落库时是「移入回收站」')
  eq(plan.discardIds[0], 'd1')

  /*
   * 「status 不可能被写成已舍弃」这件事**由类型系统保证**，
   * 不靠运行时断言：`DraftApplyItem.status` 的类型就是
   * 'active' | 'idle' | 'spare'，写 'discarded' 直接编译不过
   * （这里原本想断言一句，TS 直接报了 TS2367「两个类型没有重叠」）。
   *
   * 运行时能验的是另一面：这条**没有**变成一条「更新」，
   * 它走的是删除那条路。
   */
  ok(
    !plan.plan.some((entry) => entry.existingId === 'd1'),
    '已舍弃的物品不该同时生成一条更新计划',
  )
})

/* ------------------------------------------------------------------ */
/* 四、发给 AI 的草稿里必须带着状态和活动                               */
/* ------------------------------------------------------------------ */

suite('AI 词汇：AI 看得到现状')

await test('草稿发出时带着 status 和 collections', () => {
  // 不发的话，AI 看不到「这件现在是闲置」，也就判断不出「改成备用」
  // 是从哪改到哪；而且它改别的字段时也无法把状态原样写回来。
  const data: AppData = {
    ...fx,
    collections: [
      { id: 'col1', name: '旅行', note: '', order: 0, createdAt: '2026-01-01T00:00:00.000Z' },
    ],
    items: [
      item({ id: 's1', name: '备用牙膏', quantity: 2, status: 'spare', collectionIds: ['col1'] }),
    ],
  }
  const localCtx = createDerived(data)
  const localMatch = createMatchContext(data, localCtx)
  const drafts = draftsFromItems([must(data.items[0], 's1')], localMatch, localCtx)

  const payload = previewDraftPayload(serializeDrafts(drafts, localCtx))
  ok(payload.includes('"status":"spare"'), `发出的草稿里应该有状态，实际：${payload}`)
  ok(payload.includes('旅行'), '发出的草稿里应该有活动名')
})

await test('未定状态的草稿不占 token（status 不出现在 JSON 里）', () => {
  const draft = toItemDraft(
    {
      name: '新东西',
      quantity: 1,
      categoryPaths: [],
      location: null,
      tags: [],
      attributes: {},
      note: '',
      expiresAt: null,
      status: null,
      collections: [],
    },
    match,
    ctx,
  )

  const payload = previewDraftPayload(serializeDrafts([draft], ctx))
  ok(!payload.includes('status'), '没定状态就别发这个字段')
})

/* ------------------------------------------------------------------ */
/* 五、提示词：那些规则必须真的写在里面                                 */
/* ------------------------------------------------------------------ */

suite('AI 词汇：提示词里的规则（防回归）')

await test('中文提示词里有一套「这个工具里的词汇」的概念表', () => {
  const vocab = promptTextZh.conceptVocab

  ok(vocab.includes('在用'), '要说清「在用」是什么')
  ok(vocab.includes('闲置'), '要说清「闲置」是什么')
  ok(vocab.includes('备用'), '要说清「备用」是什么')
  ok(vocab.includes('活动'), '要说清「活动」是什么')
  ok(vocab.includes('清单'), '要说清「清单」是另一个东西')
  ok(vocab.includes('tags'), '要点名 tags')
})

await test('**明确禁止把状态词写进标签**（就是那个 bug 的正面修复）', () => {
  const vocab = promptTextZh.conceptVocab
  // 光说「tags 只放情境」不够 —— 必须点名那几个词
  ok(vocab.includes('写进 tags'), '要明确写「不要把状态词写进 tags」')
  ok(
    vocab.includes('「闲置」「备用」') || (vocab.includes('闲置') && vocab.includes('备用')),
    '要点名是哪几个词',
  )
})

await test('说清了备用和闲置不是一回事', () => {
  const vocab = promptTextZh.conceptVocab
  ok(vocab.includes('不是一回事'), '这两个概念必须切开')
  ok(vocab.includes('特意留'), '要给出「特意留着」这个正向定义')
})

await test('说清了活动只能复用、不能自己造', () => {
  ok(promptTextZh.conceptVocab.includes('只能从【已有活动】里挑'), '活动不能新建')
  ok(promptTextEn.conceptVocab.includes('Only pick names from'), '英文版也要有同一条')
})

await test('中英两份提示词的规则条数一致（镜像不能漂）', () => {
  const zh = promptTextZh.extractionSystem
  const en = promptTextEn.extractionSystem
  ok(/11\./.test(zh), '中文抽取规则应该到第 11 条')
  ok(/11\./.test(en), '英文抽取规则也应该到第 11 条')
  ok(zh.includes('status'), '中文要提 status')
  ok(en.includes('status'), '英文要提 status')
  ok(zh.includes('collections'), '中文要提 collections')
  ok(en.includes('collections'), '英文要提 collections')
})

await test('概念表同时进了抽取和对话两个 system —— 不能只教一半', () => {
  /*
   * 查的不是「有没有某个词」，而是**整段概念表在不在**。
   * 这样它跟具体语言无关，而且哪天有人把概念表拆成两半、
   * 只塞进其中一个 system，这条会立刻红。
   *
   * 为什么必须两个都进：抽取那边管「一开始录入时就听懂状态」，
   * 对话那边管「聊到一半让它改状态」。只管一个的话，
   * 用户要么录入时被打了标签，要么对话时被打了标签。
   */
  for (const [name, p] of [
    ['中文', promptTextZh],
    ['英文', promptTextEn],
  ] as const) {
    ok(p.conceptVocab.length > 200, `${name}概念表不能是空壳`)
    ok(p.extractionSystem.includes(p.conceptVocab), `${name}抽取 system 里要整段带上概念表`)
    ok(p.chatSystem.includes(p.conceptVocab), `${name}对话 system 里也要整段带上`)
  }
})

await test('对话提示词要求「改状态就说状态，别动标签」', () => {
  const chat = promptTextZh.chatSystem
  ok(chat.includes('改状态就说状态'), '要有这一条')
  ok(chat.includes('不是标签'), '要点明状态词不是标签')
})

await test('loadScope 的 spare 也写进了提示词', () => {
  ok(promptTextZh.chatSystem.includes('"spare": true'), '中文要列出来')
  ok(promptTextEn.chatSystem.includes('"spare": true'), '英文也要')
})

/* ------------------------------------------------------------------ */
/* 六、上下文块与目录：AI 得知道用户有哪些活动                           */
/* ------------------------------------------------------------------ */

suite('AI 词汇：上下文与目录')

await test('上下文块里列出用户已有的活动', () => {
  const data: AppData = {
    ...fx,
    collections: [
      { id: 'c1', name: '旅行', note: '', order: 0, createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'c2', name: '学习', note: '', order: 1, createdAt: '2026-01-01T00:00:00.000Z' },
    ],
  }
  const localCtx = createDerived(data)
  const block = renderContextBlock(buildAiContext(data, localCtx))

  ok(block.includes('【已有活动】'), '要有这一块')
  ok(block.includes('旅行'), '要列出活动名')
  ok(block.includes('学习'))
})

await test('一个活动都没有时，明说「不要新建活动」', () => {
  const data: AppData = { ...fx, collections: [] }
  const localCtx = createDerived(data)
  const block = renderContextBlock(buildAiContext(data, localCtx))

  ok(block.includes('还没有活动'), '空的时候也要给一句')
  ok(block.includes('一律省略'), '而且要说明这一项就别写')
})

await test('目录里报出备用件数 —— 别把它当闲置劝人处理', () => {
  const data: AppData = {
    ...fx,
    items: [
      item({ id: 'a', name: '在用', status: 'active' }),
      item({ id: 'b', name: '闲置的', status: 'idle' }),
      item({ id: 'c', name: '备用牙膏', quantity: 3, status: 'spare' }),
    ],
  }
  const localCtx = createDerived(data)
  const digest = buildInventoryDigest(data, localCtx)

  eq(digest.idle, 1)
  eq(digest.spare, 1, '备用要单独数，不能并进闲置')

  const block = renderContextBlock(buildAiContext(data, localCtx))
  ok(block.length > 0)
})

await test('活动太多时会截断并如实标注', () => {
  const data: AppData = {
    ...fx,
    collections: Array.from({ length: 5 }, (_, i) => ({
      id: `c${i}`,
      name: `活动${i}`,
      note: '',
      order: i,
      createdAt: '2026-01-01T00:00:00.000Z',
    })),
  }
  const localCtx = createDerived(data)
  const aiCtx = buildAiContext(data, localCtx, {
    categories: 60,
    locations: 250,
    attributes: 30,
    tags: 40,
    collections: 2,
  })

  eq(aiCtx.collections.length, 2)
  eq(aiCtx.truncated, true, '截断了就要标出来')
})
