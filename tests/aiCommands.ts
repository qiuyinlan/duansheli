/**
 * AI 输入框旁边那套东西的**规则**（按钮 / 补全 / 预检）。
 *
 * ── 为什么这些用例非有不可 ──────────────────────────────────────
 * 这一层出的错全部是「静默」的：
 *   · 补全把「白色三层收纳」匹配成隔壁那条 → 用户点一下，东西落到别处去了
 *   · 路径明明在库里、预检说对不上 → 用户以为要新建，多余地勾了「新位置」
 *   · 按钮插了一句提示词里没教过的说法 → 模型只能猜
 * 三种都**不会报错**，只会在几天后变成「怎么又多了一个位置」。
 *
 * 而且 jsdom **没法模拟打字**（见 tests/dom.ts），输入框那条路靠点击测不全 ——
 * 所以规则必须抽成纯函数、在这里钉死。界面上那层（AiQuickBar / AiChatPanel）
 * 只做接线，坏了一眼能看见。
 */

import {
  applyInsert,
  commandChips,
  composeQuickText,
  detectSlot,
  inspectDraft,
  normPathText,
  shouldSuggest,
  splitPathQuery,
  suggestSlot,
  type QuickEntryRow,
} from '../src/ai/commands'
import { COMMAND_VOCAB_BY_LANG, commandVocab } from '../src/ai/commandVocab'
import { createMatchContext } from '../src/ai/convert'
import { promptTextEn } from '../src/ai/promptText/en'
import { promptTextZh } from '../src/ai/promptText/zh'
import { createTreeIndex } from '../src/lib/tree'
import { levelNames, levelsFromName } from '../src/lib/levels'
import { pinRank, pinnedNodes, togglePinned } from '../src/lib/pins'
import { createDerived } from '../src/store/selectors'
import { createSeedData } from '../src/storage/seed'
import type { AppData, Category, Location } from '../src/types'
import { eq, must, ok, suite, test } from './harness'

/* ------------------------------------------------------------------ */
/* 夹具：用户原话里的那套位置和分类                                    */
/* ------------------------------------------------------------------ */

const NOW = new Date('2026-01-01T00:00:00.000Z').toISOString()

function location(id: string, name: string, parentId: string | null, order: number): Location {
  return { id, name, parentId, order, note: '', createdAt: NOW }
}

function category(id: string, name: string, parentId: string | null, order: number): Category {
  return { id, name, parentId, order, createdAt: NOW }
}

/**
 * 位置树照用户真实的那套铺：
 *   桌子 / 桌子下 / 蓝柜 / 黄色盒子
 *   桌子 / 桌子下 / 白色三层收纳 / 1层 · 2层
 *   小型白色四层收纳 / 1层            ← 注意它也叫「1层」，同名不同父
 */
function data(): AppData {
  const seed = createSeedData('zh')
  return {
    ...seed,
    locations: [
      location('l-desk', '桌子', null, 0),
      location('l-under', '桌子下', 'l-desk', 0),
      location('l-blue', '蓝柜', 'l-under', 0),
      location('l-yellow', '黄色盒子', 'l-blue', 0),
      location('l-white3', '白色三层收纳', 'l-under', 1),
      location('l-white3-1', '1层', 'l-white3', 0),
      location('l-white3-2', '2层', 'l-white3', 1),
      location('l-small4', '小型白色四层收纳', null, 1),
      location('l-small4-1', '1层', 'l-small4', 0),
    ],
    categories: [
      category('c-life', '生活用品', null, 0),
      category('c-tool', '工具', 'c-life', 0),
      category('c-wash', '洗护用品', 'c-life', 1),
      category('c-food', '食品饮料', null, 1),
      category('c-eat', '吃的', 'c-food', 0),
      category('c-drink', '喝的', 'c-food', 1),
      category('c-study', '学习用品', null, 2),
    ],
    items: [],
  }
}

const fx = data()
const derived = createDerived(fx)
const matchContext = createMatchContext(fx, derived)

const locationOptions = {
  nodes: fx.locations,
  index: createTreeIndex(fx.locations),
}

function hit(query: string, kind: 'location' | 'category' = 'location') {
  return { kind, from: 0, to: query.length, query } as const
}

/* ------------------------------------------------------------------ */
/* 一、按钮                                                            */
/* ------------------------------------------------------------------ */

suite('AI 输入框：快捷指令按钮')

await test('按钮的字和插进输入框的字是同一句（不能一个叫「新建物品」一个插「加一个」）', () => {
  for (const vocab of [COMMAND_VOCAB_BY_LANG.zh, COMMAND_VOCAB_BY_LANG.en]) {
    for (const chip of commandChips(vocab)) {
      ok(chip.phrase.trim() !== '', `按钮「${chip.label}」没有可插的短语`)
      /* 「再加一件」是唯一例外：按钮上那句是给人看的，插进去的是「新建物品」 */
      if (chip.id !== 'more') eq(chip.phrase, chip.label)
    }
  }
})

await test('★ 按钮插的每一句话，提示词里都教过模型', () => {
  /*
   * 这是这组用例里最要紧的一条。
   *
   * 按钮插的是**发给模型的输入**：插一句它没见过的说法，就是在让它猜 ——
   * 而「猜」在这个项目里是有前科的（用户说过「我说闲置，它给我打了个标签」）。
   * 所以词汇表里每个短语都必须在 chatSystem 里出现过，中英各查一遍。
   */
  const pairs = [
    { lang: 'zh', text: promptTextZh.chatSystem },
    { lang: 'en', text: promptTextEn.chatSystem },
  ] as const

  for (const { lang, text } of pairs) {
    for (const chip of commandChips(COMMAND_VOCAB_BY_LANG[lang])) {
      ok(
        text.includes(chip.phrase),
        `${lang}：按钮「${chip.label}」会插进「${chip.phrase}」，但提示词里没教过这句话`,
      )
    }
  }
})

await test('★ 速录面板和预检也会把词插进输入框 —— 那几个词同样要教过', () => {
  /*
   * 上面那条只查了按钮。还有几个词是**别的路径**插进去的：
   *   · 速录面板拼句子用的是「状态 / 闲置 / 备用」这三个词（`状态 备用`）
   *   · 「新建位置」没有按钮，但用户在输入框里就是这么写的，预检专门认它
   * 它们要是没在提示词里，同样是让模型猜 —— 所以一起查。
   */
  const words = (v: (typeof COMMAND_VOCAB_BY_LANG)['zh']) => [v.status, v.idle, v.spare, v.newPlace]

  for (const { lang, text } of [
    { lang: 'zh', text: promptTextZh.chatSystem },
    { lang: 'en', text: promptTextEn.chatSystem },
  ] as const) {
    for (const word of words(COMMAND_VOCAB_BY_LANG[lang])) {
      ok(text.includes(word), `${lang}：输入框里会出现「${word}」，但提示词里没教过这个词`)
    }
  }

  /* 反过来说：速录面板拼出来的整句话也得是提示词认得的写法 */
  const composed = composeQuickText(
    [row({ name: '内衣液袋装', location: '蓝柜', status: 'spare' })],
    COMMAND_VOCAB_BY_LANG.zh,
  )
  ok(
    promptTextZh.chatSystem.includes('状态 备用'),
    `速录面板会拼出「${composed}」这样的句子，提示词里得有对应的示范`,
  )
})

/* ------------------------------------------------------------------ */
/* 二、插到光标处                                                      */
/* ------------------------------------------------------------------ */

suite('AI 输入框：短语插到光标处')

await test('插在光标处，后面已经写的东西不会被吃掉', () => {
  const result = applyInsert('放在 蓝柜', 0, '新建物品', {
    trailingSpace: true,
    separator: '，',
  })
  eq(result.text, '新建物品 放在 蓝柜')
  eq(result.caret, 5, '光标应该停在新插进来的那几个字后面')
})

await test('前面已经有内容时补一个连接符', () => {
  const result = applyInsert('新建物品 棉签', 7, '放在', {
    leadingSeparator: true,
    trailingSpace: true,
    separator: '，',
  })
  eq(result.text, '新建物品 棉签，放在 ')
  eq(result.caret, result.text.length)
})

await test('前面已经是逗号了就不再补一个（免得出现「，，」）', () => {
  const result = applyInsert('新建物品 棉签，', 8, '放在', {
    leadingSeparator: true,
    trailingSpace: true,
    separator: '，',
  })
  eq(result.text, '新建物品 棉签，放在 ')
})

await test('「再加一件」会先起一行', () => {
  const result = applyInsert('新建物品 棉签', 7, '新建物品', {
    newLineBefore: true,
    trailingSpace: true,
    separator: '，',
  })
  eq(result.text, '新建物品 棉签\n新建物品 ')
})

await test('整段生成时也是起一行，不覆盖已经写好的话', () => {
  const result = applyInsert('新建物品 棉签', 7, '新建物品 开心果', {
    newLineBefore: true,
    separator: '，',
  })
  eq(result.text, '新建物品 棉签\n新建物品 开心果')
})

/* ------------------------------------------------------------------ */
/* 三、光标前那句话是哪个槽位                                          */
/* ------------------------------------------------------------------ */

suite('AI 输入框：认得出光标前是哪个槽位')

await test('「放在」后面那串就是位置', () => {
  const text = '新建物品 棉签，放在 蓝'
  const slot = must(detectSlot(text, text.length), '应该认出这是位置槽位')
  eq(slot.kind, 'location')
  eq(slot.query, '蓝')
  eq(text.slice(slot.from, slot.to), '蓝', '替换区间应该正好是用户打的那几个字')
})

await test('「分类」后面那串是分类', () => {
  const text = '新建物品 棉签，分类 生活用品/工'
  const slot = must(detectSlot(text, text.length), '应该认出这是分类槽位')
  eq(slot.kind, 'category')
  eq(slot.query, '生活用品/工')
})

await test('数量 / 过期也认得出', () => {
  const qty = must(detectSlot('新建物品 棉签，数量 ', 12), '应该认出数量槽位')
  eq(qty.kind, 'quantity')
  eq(qty.query, '')

  const expiry = must(detectSlot('新建物品 棉签，过期 2026-11', 21), '应该认出过期槽位')
  eq(expiry.kind, 'expiry')
  eq(expiry.query, '2026-11')
})

await test('★ 光标在句子中间时，补的是他回头改的那一处，不是句尾', () => {
  /*
   * 场景：整段话已经写好了，他回去把某个位置改一下。
   * 如果补全认的是「整段话里最后一次出现的触发词」，就会在他改的那一处
   * 弹出别的槽位的候选 —— 用户会以为工具瞎了。
   */
  const text = '新建物品 棉签，放在 蓝柜，备注 放在门口那个盒子'
  const caret = text.indexOf('蓝柜') + 2
  const slot = must(detectSlot(text, caret), '应该认出光标所在那一句的槽位')
  eq(slot.kind, 'location')
  eq(slot.query, '蓝柜')
})

await test('触发词和要补的字之间的空格不算内容', () => {
  const text = '新建物品 棉签，放在   蓝柜'
  const slot = must(detectSlot(text, text.length), '应该认出位置槽位')
  eq(slot.query, '蓝柜', '「放在」后面的空格不该混进候选里')
})

await test('数量 / 日期：已经在打字了就别再弹（位置/分类相反，越打越准）', () => {
  ok(shouldSuggest(must(detectSlot('新建物品 棉签，数量 ', 12), '数量槽位')), '还没打字时该弹')
  ok(!shouldSuggest(must(detectSlot('新建物品 棉签，数量 3', 13), '数量槽位')), '打了「3」之后不该再弹')
  ok(shouldSuggest(must(detectSlot('新建物品 棉签，放在 蓝', 14), '位置槽位')), '位置该一直弹')
})

/* ------------------------------------------------------------------ */
/* 四、候选                                                            */
/* ------------------------------------------------------------------ */

suite('AI 输入框：位置候选')

await test('★ 打「白色」列出所有带白色的位置，而且是**完整路径**', () => {
  const result = suggestSlot(hit('白色'), locationOptions)
  const paths = result.candidates.map((candidate) => candidate.pathText)
  ok(paths.includes('桌子 / 桌子下 / 白色三层收纳'), `应该列出它藏在哪一层，实际：${paths.join(' | ')}`)
  ok(paths.includes('小型白色四层收纳'), `另一条也要在，实际：${paths.join(' | ')}`)
  eq(result.resolvedId, null, '「白色」不是一条完整的路径，不该说「已对上」')
})

await test('★ 名字完全对上了，就接着列出它的下一级（点一下继续往下钻）', () => {
  /*
   * 用户实测报回来的：「我选择了独立白色四层收纳架，他没有再跳出 2 层这样的，
   * 我打 / 他才跳出来，按道理点击他会继续往下跳。」
   *
   * 他说得对，这是原来实现的一个真错：只有「以 / 结尾」才算下钻，
   * 于是点完一条分支就停在原地 —— 而他点它的意思往往正是「我要往里放」。
   * 现在：这一串完整对上某一级时，直接把它的子级铺出来（本身那一条不列了，
   * 它已经在输入框里，再点一次是空操作）。
   */
  const branch = suggestSlot(hit('小型白色四层收纳'), locationOptions)
  eq(branch.drillingInto, 'l-small4', '对上的是分支，就该接着列它的子级')
  eq(branch.resolvedId, 'l-small4', '同时仍然要认「这一串对上了」—— 回车照旧是发送')
  eq(
    branch.candidates.map((candidate) => candidate.name).join('|'),
    '1层',
    '列出来的应该是它底下那一级',
  )

  /* 同一件事，用「打 / 」触发也要一样（两条路不能各长一个样） */
  const bySlash = suggestSlot(hit('小型白色四层收纳/'), locationOptions)
  eq(bySlash.drillingInto, 'l-small4')
  eq(bySlash.candidates.length, 1)

  /* 叶子节点没什么可钻的，就老实列它自己 */
  const leaf = suggestSlot(hit('黄色盒子'), locationOptions)
  eq(leaf.drillingInto, null)
  eq(leaf.resolvedId, 'l-yellow')
  eq(leaf.candidates[0]?.name, '黄色盒子')
})

await test('★ 已经有一条完全同名的时候，就不再给「新建」那条', () => {
  /*
   * 之前这里是「没有完全同名就给一条新建」。结果用户打「白色」时，
   * 底下既有「白色三层收纳」、又有一条「白色（会被当成新位置）」——
   * 后者又碍眼又能被误点，点一下库里就多出一个叫「白色」的位置。
   * 想建新名字，把名字打完自然一条都对不上，兜底项那时才出现。
   */
  const partial = suggestSlot(hit('白色'), locationOptions)
  eq(partial.candidates.filter((candidate) => candidate.kind === 'new').length, 0)

  const exact = suggestSlot(hit('蓝柜'), locationOptions)
  eq(
    exact.candidates.filter((candidate) => candidate.kind === 'new').length,
    0,
    '库里就有这一条，绝不能再挂一条「新建蓝柜」',
  )

  const full = suggestSlot(hit('白色收纳盒'), locationOptions)
  eq(full.candidates.length, 1, '库里没有这个名字，就该给那唯一一条兜底')
  eq(full.candidates[0]?.kind, 'new')
})

await test('分支节点标出来，叶子不标', () => {
  /* 钻到「桌子」这一级，它的子级「桌子下」底下还有东西 —— 那条要标成分支 */
  const drilled = suggestSlot(hit('桌子/'), locationOptions)
  const under = must(
    drilled.candidates.find((candidate) => candidate.name === '桌子下'),
    '桌子底下应该有「桌子下」',
  )
  eq(under.isBranch, true, '「桌子下」底下还有一层，得让用户知道点进去还有东西')

  /* 叶子（黄色盒子）不值得再往下钻，标出来免得他白点一下 */
  const leaf = must(
    suggestSlot(hit('蓝柜/'), locationOptions).candidates.find(
      (candidate) => candidate.name === '黄色盒子',
    ),
    '蓝柜底下应该有黄色盒子',
  )
  eq(leaf.isBranch, false)
})

await test('★ 打一个完整路径时逐级对，不是全树乱找', () => {
  const result = suggestSlot(hit('桌子/桌子下/白色'), locationOptions)
  eq(result.candidates.length, 1, '「桌子下」底下的白色只有一条，不该把别处同名的也拉进来')
  eq(result.candidates[0]?.id, 'l-white3')
  eq(result.prefixUnknown, false)
})

await test('★ 已经匹配上的时候不再挂「新建」那条（免得误点多出一个位置）', () => {
  /*
   * 之前这里是「没有完全同名就给一条新建」。结果用户打「白色」时，
   * 底下既有「白色三层收纳」、又有一条「白色（会被当成新位置）」——
   * 后者又碍眼又能被误点，点一下库里就多出一个叫「白色」的位置。
   * 想建新名字，把名字打完自然一条都对不上，兜底项那时才出现。
   */
  const partial = suggestSlot(hit('白色'), locationOptions)
  eq(partial.candidates.filter((candidate) => candidate.kind === 'new').length, 0)

  const full = suggestSlot(hit('白色收纳盒'), locationOptions)
  eq(full.candidates.length, 1, '库里没有这个名字，就该给那唯一一条兜底')
  eq(full.candidates[0]?.kind, 'new')
})

await test('以「/」结尾时列出这一级的直接子级（这就是下钻）', () => {
  const result = suggestSlot(hit('桌子/桌子下/'), locationOptions)
  const names = result.candidates.map((candidate) => candidate.name)
  eq(names.length, 2, `应该只列直接子级，实际：${names.join(' | ')}`)
  ok(names.includes('蓝柜') && names.includes('白色三层收纳'))
  ok(!names.includes('黄色盒子'), '孙子辈不该在这一层铺出来')
  eq(result.resolvedId, 'l-under', '前缀对上了，就说「现在站在桌子下这一级」')
  eq(result.drillingInto, 'l-under', '这一层是钻进去的，界面要说一句「下面这几层可以直接选」')
})

await test('路径前半段对不上时会照实说，而不是硬凑一条', () => {
  const result = suggestSlot(hit('客厅/柜'), locationOptions)
  eq(result.prefixUnknown, true, '「客厅」库里根本没有，必须如实立旗')
  eq(result.resolvedId, null)
})

await test('★ 库里没有的名字给一条「新建」兜底，插的还是他打的那串字', () => {
  const result = suggestSlot(hit('阳台/柜子上层'), locationOptions)
  const created = result.candidates.filter((candidate) => candidate.kind === 'new')
  eq(created.length, 1, '应该正好有一条「库里没有」的兜底')
  eq(created[0]?.pathText, '阳台 / 柜子上层', '插进去的就是他打的路径，不许改写')
  eq(result.candidates.filter((candidate) => candidate.id !== null).length, 0)
})

await test('最近用过 / 用得多的排前面（一阵子集中整理一处地方）', () => {
  const recent = suggestSlot(hit('白色'), { ...locationOptions, recentIds: ['l-small4'] })
  eq(recent.candidates[0]?.id, 'l-small4', '最近用过的应该顶到最前面')

  const used = suggestSlot(hit('白色'), {
    ...locationOptions,
    usage: new Map([['l-white3', 20]]),
  })
  eq(used.candidates[0]?.id, 'l-white3', '用得多（底下东西多）的应该排前面')
})

await test('分类候选走的是同一套规则', () => {
  const result = suggestSlot(hit('洗护', 'category'), {
    nodes: fx.categories,
    index: derived.categoryIndex,
  })
  const paths = result.candidates.map((candidate) => candidate.pathText)
  ok(paths.includes('生活用品 / 洗护用品'), `应该能看到完整路径，实际：${paths.join(' | ')}`)

  const byName = suggestSlot(hit('生活用品', 'category'), {
    nodes: fx.categories,
    index: derived.categoryIndex,
  })
  eq(byName.resolvedId, 'c-life', '完整名字对上了')
})

await test('拆路径：斜杠、全角斜杠、两边带空格都认', () => {
  eq(splitPathQuery('桌子/桌子下').length, 2)
  eq(splitPathQuery('桌子 / 桌子下').length, 2)
  eq(splitPathQuery('桌子／桌子下').length, 2)
  eq(normPathText('桌子 / 桌子下'), '桌子/桌子下')
})

/* ------------------------------------------------------------------ */
/* 四b、置顶那颗星                                                     */
/* ------------------------------------------------------------------ */

/**
 * 用户的原话：「我希望右边可以加一个星星符号，这样我点击就可以置顶，
 * 下次更方便选到我常选择的那个」。
 *
 * 这一组守两件事：
 *   1. 「点一下钉上、再点一下摘掉」这件事本身（纯逻辑，界面上那半在 render 里）
 *   2. 钉了之后**真的排在最前面** —— 压过「最近用过」「用得最多」这些程序猜的规则。
 *      反过来的话，用户点了星星它却没上去，他会直接不再用这个功能。
 */
suite('AI 输入框：置顶那颗星')

await test('点一下钉上、再点一下摘掉，顺序就是他点星星的顺序', () => {
  eq(togglePinned([], 'a').join(','), 'a', '第一次点：加上去')
  eq(togglePinned(['a'], 'a').length, 0, '再点一次：摘掉')
  eq(togglePinned(['a', 'b'], 'c').join(','), 'a,b,c', '新钉的排在后面，不打断他原来的顺序')
  eq(togglePinned(['a'], '').length, 1, '空 id 不能混进清单里')

  eq(pinRank(['a', 'b'], 'b'), 1)
  eq(pinRank(['a'], 'zzz'), -1, '没置顶的返回 -1')
  eq(pinRank(['a'], null), -1, '没有 id 的候选（新位置 / 几层）永远算没置顶')
})

await test('按置顶顺序取节点，已经被删掉的自动跳过（不列点不动的死条目）', () => {
  const nodes = [{ id: 'a', name: '衣柜' }, { id: 'b', name: '书桌' }]
  eq(pinnedNodes(['b', 'a'], nodes).map((n) => n.name).join('、'), '书桌、衣柜')
  eq(pinnedNodes(['gone', 'a'], nodes).map((n) => n.name).join('、'), '衣柜', '删掉的那条跳过')
  eq(pinnedNodes([], nodes).length, 0)
})

await test('★ 置顶的排在候选最前面 —— 压过「最近用过」和「用得最多」', () => {
  const result = suggestSlot(hit('白色'), {
    ...locationOptions,
    /* 这两条都在说「l-white3 更该排前面」，但用户手动钉的是 l-small4 */
    recentIds: ['l-white3'],
    usage: new Map([['l-white3', 20]]),
    pinnedIds: ['l-small4'],
  })
  eq(result.candidates[0]?.id, 'l-small4', '★ 用户自己钉的必须压过程序的推断')
  eq(result.candidates[0]?.pinned, true, '界面上要据此画实心星')
  eq(result.candidates[1]?.pinned, false, '没钉的那些照旧')
})

await test('置顶只在**筛出来的候选**里往前挪，不会把不相干的硬塞进列表', () => {
  const result = suggestSlot(hit('白色'), {
    ...locationOptions,
    pinnedIds: ['l-blue'],
  })
  const ids = result.candidates.map((candidate) => candidate.id)
  ok(!ids.includes('l-blue'), '「蓝柜」不含「白色」，钉了它也不该出现在这次候选里')
})

await test('每次都排在前面（空查询时也一样）—— 这就是「下次更方便选到」的意思', () => {
  const result = suggestSlot(hit(''), {
    ...locationOptions,
    usage: new Map([['l-blue', 99]]),
    pinnedIds: ['l-small4-1'],
  })
  eq(result.candidates[0]?.id, 'l-small4-1', '一打开弹层它就在第一个')
})

await test('★ 下钻那一列（1层 / 2层 / 3层）按数字排，先点了 3层 也一样', () => {
  /*
   * 用户报的「先显示1层，再3，再2」在下钻列表里最显眼：
   * 点开「四层收纳架」，下面就是那几层。库里 order 是创建顺序
   * （他先点了 3层），所以不按编号排就一定是乱的。
   */
  const rack = {
    ...fx,
    locations: [
      location('l-rack', '四层收纳架', null, 0),
      location('l-r1', '1层', 'l-rack', 0),
      location('l-r3', '3层', 'l-rack', 1),
      location('l-r2', '2层', 'l-rack', 2),
    ],
  }
  const options = { nodes: rack.locations, index: createTreeIndex(rack.locations) }
  const names = suggestSlot(hit('四层收纳架/'), options).candidates.map((c) => c.name)
  eq(names.join('、'), '1层、2层、3层', `下钻列表必须按数字排，实际：${names.join('、')}`)

  /* 置顶在下钻列表里也照办 —— 不能一个地方灵、一个地方不灵 */
  const pinned = suggestSlot(hit('四层收纳架/'), {
    ...options,
    pinnedIds: ['l-r3'],
  })
  eq(pinned.candidates[0]?.name, '3层', '钉过的排第一个（同一个规矩）')
})


/* ------------------------------------------------------------------ */
/* 五、发出前预检                                                      */
/* ------------------------------------------------------------------ */

suite('AI 输入框：发出前预检')

await test('位置在库里 → 说它对上了，并给出完整路径', () => {
  const check = inspectDraft('新建物品 拍立得照片，放在 蓝柜/黄色盒子', matchContext, {
    locationPath: (id) => derived.index.pathString(id, ' / '),
    categoryPath: (id) => derived.categoryIndex.pathString(id, ' / '),
    locationIndex: derived.index,
    categoryIndex: derived.categoryIndex,
  })
  eq(check.newItemCount, 1)
  eq(check.places.length, 1)
  eq(check.places[0]?.id, 'l-yellow', '只写了末两级，靠「后缀唯一」对上了')
  eq(
    check.places[0]?.pathText,
    '桌子 / 桌子下 / 蓝柜 / 黄色盒子',
    '说「对上了」时给的是**完整**路径 —— 用户才知道东西到底落在哪一层',
  )
  eq(check.orphanNewPlaces.length, 0)
})

await test('★ 位置库里没有 → 提前说「会被当成新位置」，这是用户最容易踩的一脚', () => {
  const check = inspectDraft('新建物品 收纳箱，放在 阳台/柜子上层', matchContext, {
    locationPath: (id) => derived.index.pathString(id, ' / '),
    categoryPath: (id) => derived.categoryIndex.pathString(id, ' / '),
    locationIndex: derived.index,
    categoryIndex: derived.categoryIndex,
  })
  eq(check.places[0]?.id, null, '库里没有就该是 null，界面据此说「会被当成新位置」')
  eq(check.places[0]?.query, '阳台/柜子上层')
})

await test('分类也一起看', () => {
  const check = inspectDraft('新建物品 内衣液，放在 蓝柜，分类 生活用品/洗护用品', matchContext, {
    locationPath: (id) => derived.index.pathString(id, ' / '),
    categoryPath: (id) => derived.categoryIndex.pathString(id, ' / '),
    locationIndex: derived.index,
    categoryIndex: derived.categoryIndex,
  })
  eq(check.categories[0]?.id, 'c-wash')
  eq(check.places[0]?.id, 'l-blue')
})

await test('「放在新建位置 X」是正常写法：那件东西就把 X 建出来了', () => {
  const check = inspectDraft('新建物品 苏泊尔电煮锅，放在新建位置 桌子/桌子上二层', matchContext, {
    locationPath: (id) => derived.index.pathString(id, ' / '),
    categoryPath: (id) => derived.categoryIndex.pathString(id, ' / '),
    locationIndex: derived.index,
    categoryIndex: derived.categoryIndex,
  })
  eq(check.orphanNewPlaces.length, 0, '有东西放进去了，不算白说')
})

await test('★ 只写「新建位置 X」而没有东西放进去 → 必须提醒（不然它什么都不会发生）', () => {
  /*
   * 这是个真的坑：位置上只能挂在一件物品的 location 上一起建
   * （或者去位置页点「新建位置」）。用户习惯先写一句「新建位置 X」，
   * 如果后面忘了把东西放进去，这条链路上**静默什么也不做** ——
   * 而用户会以为建好了。这一行提示就是拦在那句话前面的。
   */
  const check = inspectDraft('新建位置 阳台/柜子上层\n新建物品 花盆', matchContext, {
    locationPath: (id) => derived.index.pathString(id, ' / '),
    categoryPath: (id) => derived.categoryIndex.pathString(id, ' / '),
    locationIndex: derived.index,
    categoryIndex: derived.categoryIndex,
  })
  eq(check.orphanNewPlaces.length, 1)
  eq(check.orphanNewPlaces[0], '阳台/柜子上层')

  const ok2 = inspectDraft('新建位置 阳台/柜子上层\n新建物品 花盆，放在 阳台/柜子上层', matchContext, {
    locationPath: (id) => derived.index.pathString(id, ' / '),
    categoryPath: (id) => derived.categoryIndex.pathString(id, ' / '),
    locationIndex: derived.index,
    categoryIndex: derived.categoryIndex,
  })
  eq(ok2.orphanNewPlaces.length, 0, '东西放进去了就不该再提醒')
})

await test('一句话里好几件东西都要数出来', () => {
  const check = inspectDraft(
    '新建物品 小风扇，放在 蓝柜/黄色盒子\n新建物品 绿色收纳盒，放在 蓝柜',
    matchContext,
    {
      locationPath: (id) => derived.index.pathString(id, ' / '),
      categoryPath: (id) => derived.categoryIndex.pathString(id, ' / '),
      locationIndex: derived.index,
      categoryIndex: derived.categoryIndex,
    },
  )
  eq(check.newItemCount, 2)
  eq(check.places.length, 2)
})

await test('一段不相干的话（纯提问）不会硬凑出预检内容', () => {
  const check = inspectDraft('我所有的东西都放哪了？帮我看看', matchContext, {
    locationPath: (id) => derived.index.pathString(id, ' / '),
    categoryPath: (id) => derived.categoryIndex.pathString(id, ' / '),
    locationIndex: derived.index,
    categoryIndex: derived.categoryIndex,
  })
  eq(check.newItemCount, 0)
  eq(check.places.length, 0)
  eq(check.categories.length, 0)
  eq(check.orphanNewPlaces.length, 0)
})

/* ------------------------------------------------------------------ */
/* 五之二、用户实测报回来的三个问题                                    */
/* ------------------------------------------------------------------ */

suite('AI 输入框：用户实测报回来的三个问题')

/**
 * 这份夹具**照抄用户真实那套数据**（他贴回来的原话）。
 *
 * 存在的理由：这三个问题全都是「真实数据 + 真实说法」才暴露出来的 ——
 * 我自己的夹具当初用的是「蓝柜」，而他库里那条叫「蓝色柜」，
 * 差的那一个字正是假警报的来源。
 */
function realData(): AppData {
  const seed = createSeedData('zh')
  return {
    ...seed,
    locations: [
      location('r-desk', '桌子', null, 0),
      location('r-under', '桌子下', 'r-desk', 0),
      location('r-blue', '蓝色柜', 'r-under', 0),
      location('r-whitelayer', '桌子下白色三层收纳', 'r-under', 1),
      location('r-whitelayer2', '2层', 'r-whitelayer', 0),
      location('r-rack', '独立白色四层收纳架', null, 1),
    ],
    categories: [
      category('r-life', '生活用品', null, 0),
      category('r-wash', '洗护用品', 'r-life', 0),
      category('r-tool', '工具', 'r-life', 1),
      category('r-food', '食品饮料', null, 1),
      category('r-eat', '吃的', 'r-food', 0),
    ],
    items: [],
  }
}

const real = realData()
const realDerived = createDerived(real)
const realMatch = createMatchContext(real, realDerived)
const realOptions = { nodes: real.locations, index: createTreeIndex(real.locations) }

const inspectReal = (text: string) =>
  inspectDraft(text, realMatch, {
    locationPath: (id) => realDerived.index.pathString(id, ' / '),
    categoryPath: (id) => realDerived.categoryIndex.pathString(id, ' / '),
    locationIndex: realDerived.index,
    categoryIndex: realDerived.categoryIndex,
  })

await test('★ 「分类改成生活用品/游泳」里的「改成」不算值（原来它把整串拿去库里找，说没对上）', () => {
  /*
   * 用户的原话：「当我直接打好的时候，他这个预检没检测出来，不过回复和处理是对的。」
   * 他写的是「分类改成生活用品/游泳」，而预检说的是
   * 「分类「改成生活用品/游泳」库里没有」—— 那个「改成」被当成路径的一部分了。
   */
  const slot = must(detectSlot('分类改成生活用品/游', '分类改成生活用品/游'.length), '这是分类槽位')
  eq(slot.kind, 'category')
  eq(slot.query, '生活用品/游', '连接词不该混进候选要匹配的那串字里')
  eq(
    '分类改成生活用品/游'.slice(slot.from, slot.to),
    '生活用品/游',
    '接受候选时替换的区间也要从值的开头算起',
  )

  const check = inspectReal('新建泳帽泳镜盒，放在蓝柜。\n分类改成生活用品/游泳')
  eq(check.categories.length, 1)
  eq(check.categories[0]?.query, '生活用品/游泳')
})

await test('★ 库里那条叫「蓝色柜」而我打「蓝柜」→ 不许再说「会被当成新位置」，要照实说两边', () => {
  const check = inspectReal('新建泳帽泳镜盒，放在蓝柜')

  eq(check.places[0]?.id, null, '严格按程序那套匹配，确实对不上（这条没变）')
  eq(
    check.places[0]?.near?.pathText,
    '桌子 / 桌子下 / 蓝色柜',
    '但对不上不等于「没关系」—— 库里明显有条很近的，必须说出来',
  )
})

await test('★ 名字里少打了前缀也算接近（白色三层收纳 ↔ 桌子下白色三层收纳）', () => {
  const check = inspectReal('新建物品，杏干，放在 桌子/桌子下/白色三层收纳/2层')
  eq(check.places[0]?.id, null)
  /*
   * 库里那条的路径是 桌子 / 桌子下 / 桌子下白色三层收纳 / 2层 ——
   * 前半段（桌子 / 桌子下）是对得上的，只是中间那级名字少写了「桌子下」。
   * 提示要指到**那一层**（带 / 2层 的完整路径），而不是含糊地说「最接近白色三层收纳」。
   */
  eq(
    check.places[0]?.near?.pathText,
    '桌子 / 桌子下 / 桌子下白色三层收纳 / 2层',
    '提示要指到用户真正在说的那一层',
  )
})

await test('★ 前半段就对不上时，不硬凑一句「最接近的是…」', () => {
  /*
   * 写「客厅 / 柜子 / 2层」而「客厅」库里根本没有时，如果还拿着末级「2层」
   * 去全树找，会指向另一个分支下的「2层」—— 指错地方比不说更糟。
   * 这时候老老实实说「会被当成新位置」就对了。
   */
  const check = inspectReal('新建物品 台灯，放在 客厅/柜子/2层')
  eq(check.places[0]?.id, null)
  eq(check.places[0]?.near, null)
})

await test('★ 中间那一段对不上时，仍然在「他说的那一支」里找（收窄而不是放弃）', () => {
  /* 用户那句就是这个形状：前两段对得上，第三段库里叫「桌子下白色三层收纳」 */
  const check = inspectReal('新建物品，杏干，放在 桌子/桌子下/白色三层收纳/2层')
  eq(check.places[0]?.id, null)
  const nearPath = check.places[0]?.near?.pathText ?? ''
  ok(
    nearPath.startsWith('桌子 / 桌子下 /'),
    `提示要落在用户说的那一支里，实际：${nearPath}`,
  )
})

await test('确实没有相近的，才说「会被当成新的」', () => {
  const check = inspectReal('新建物品 收纳箱，放在 阳台/柜子上层')
  eq(check.places[0]?.id, null)
  eq(check.places[0]?.near, null, '一条都不像的时候不该硬凑一个「最接近」给用户看')
})

await test('分类对得上就说对得上（食品饮料/吃的）', () => {
  const check = inspectReal('新建物品，杏干，分类改成食品饮料/吃的')
  eq(check.categories[0]?.id, 'r-eat')
  eq(check.categories[0]?.near, null)
})

await test('★ 点完一条分支要接着列出它的子级，而不是等我打「/」', () => {
  const suggestion = suggestSlot(hit('独立白色四层收纳架'), realOptions)
  eq(suggestion.resolvedId, 'r-rack')
  /* 库里那一级底下还什么都没有 —— 但名字里写着「四层」，该把那几层给出来 */
  const levels = suggestion.candidates.filter((candidate) => candidate.kind === 'level')
  eq(levels.length, 4, `名字里写着四层，就该给出四层，实际：${levels.map((c) => c.name).join('|')}`)
  eq(levels[0]?.pathText, '独立白色四层收纳架 / 1层')
  eq(levels[3]?.pathText, '独立白色四层收纳架 / 4层')
})

await test('★ 库里已经有那一层的，列出来就是普通的子级', () => {
  const suggestion = suggestSlot(hit('桌子/桌子下/桌子下白色三层收纳'), realOptions)
  eq(suggestion.drillingInto, 'r-whitelayer', '点完就站到这一级上，接着往下钻')
  eq(suggestion.candidates.map((candidate) => candidate.name).join('|'), '2层')
  eq(suggestion.candidates[0]?.kind, 'node', '2层是库里真有的，不是「新建」也不是「几层」')
})

await test('★ 新建「xxx四层xxx」时，把 1-4 层一起列成候选（方便往里放）', () => {
  const suggestion = suggestSlot(hit('独立白色四层收纳架'), realOptions)
  const rows = suggestion.candidates.map((candidate) => `${candidate.kind}:${candidate.pathText}`)
  ok(rows[0]?.startsWith('node:'), `先是库里那条本身，实际：${rows.join(' | ')}`)
  ok(
    rows.some((row) => row === 'level:独立白色四层收纳架 / 2层'),
    `他要的那几层要直接点得到，实际：${rows.join(' | ')}`,
  )
})

await test('名字里没写层数的，不凭空造层级', () => {
  const suggestion = suggestSlot(hit('茶话弄奶茶保温袋'), realOptions)
  eq(suggestion.candidates.filter((candidate) => candidate.kind === 'level').length, 0)
  eq(suggestion.candidates[0]?.kind, 'new')
})

suite('位置名字里的「几层」')

await test('认得出中文数字和阿拉伯数字', () => {
  eq(levelsFromName('白色三层收纳'), 3)
  eq(levelsFromName('独立白色四层收纳架'), 4)
  eq(levelsFromName('小型白色四层收纳'), 4)
  eq(levelsFromName('塑料4层收纳架'), 4)
  eq(levelsFromName('Drawer 4 tiers'), 4)
})

await test('★ 「2层」这种本身就是某一层，不能再给它造子层', () => {
  /*
   * 位置树里子层就叫「1层」「2层」。要是把这类名字也认成层数，
   * 打「2层」就会给出「2层 / 1层」「2层 / 2层」这种荒唐候选 ——
   * 而用户打「2层」的意思明明是「就是这一层」。
   */
  eq(levelsFromName('2层'), null)
  eq(levelsFromName('四层'), null, '以数字开头 = 看着像某一层，不认')
  eq(levelsFromName('桌子'), null)
  eq(levelsFromName('1层'), null)
})

await test('★ 一级的不算「几层」，离谱的大数字也不认', () => {
  eq(levelsFromName('白色一层收纳'), null, '「一层」不叫层数，没有子层可言')
  eq(levelsFromName('塑料99层架'), null, '名字里碰巧带的数字，不该生成 99 个位置')
})

await test('层名跟着界面语言走，但和用户已有的那套命名一致', () => {
  eq(levelNames(3, '{n}层').join('|'), '1层|2层|3层')
  eq(levelNames(2, 'Level {n}').join('|'), 'Level 1|Level 2')
})

suite('AI 输入框：速录面板拼出来的话')

function row(partial: Partial<QuickEntryRow> & { name: string }): QuickEntryRow {
  return {
    name: partial.name,
    location: partial.location ?? '',
    category: partial.category ?? '',
    expiry: partial.expiry ?? '',
    status: partial.status ?? 'active',
  }
}

await test('一行一件，拼成给模型看的正常句子', () => {
  const text = composeQuickText([
    row({
      name: '开心果',
      location: '小型白色四层收纳/1层',
      category: '食品饮料/吃的',
      expiry: '2026-12-01',
    }),
  ])
  eq(
    text,
    '新建物品 开心果，放在 小型白色四层收纳 / 1层，分类 食品饮料 / 吃的，过期 2026-12-01',
  )
})

await test('状态只在不是「在用」时才写出来（没提就是在用）', () => {
  const spare = composeQuickText([row({ name: '内衣液袋装', location: '蓝柜', status: 'spare' })])
  eq(spare, '新建物品 内衣液袋装，放在 蓝柜，状态 备用')

  const active = composeQuickText([row({ name: '牙刷', location: '蓝柜' })])
  eq(active, '新建物品 牙刷，放在 蓝柜')
})

await test('没填名字的行直接跳过（用户点了「加一行」又没写，不该多出一条空的）', () => {
  const text = composeQuickText([
    row({ name: '   ' }),
    row({ name: '茶话弄奶茶保温袋', location: '蓝柜' }),
  ])
  eq(text, '新建物品 茶话弄奶茶保温袋，放在 蓝柜')
})

await test('多行之间用换行分开 —— 一行一件，模型和人都好读', () => {
  const text = composeQuickText([
    row({ name: '小风扇', location: '蓝柜/黄色盒子' }),
    row({ name: '绿色收纳盒', location: '蓝柜' }),
  ])
  eq(text.split('\n').length, 2)
})

await test('中英两套词汇都能拼（英文界面下发的就是英文）', () => {
  const text = composeQuickText(
    [row({ name: 'Fan', location: 'Desk / Drawer', category: 'Tools', status: 'spare' })],
    COMMAND_VOCAB_BY_LANG.en,
  )
  eq(text, 'Add item Fan, placed in Desk / Drawer, category Tools, status spare')
})

await test('词汇表按语言取，中文界面拿到的是中文那套', () => {
  eq(commandVocab().item, COMMAND_VOCAB_BY_LANG.zh.item)
})
