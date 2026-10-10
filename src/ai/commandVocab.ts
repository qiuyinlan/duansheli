/**
 * 输入框旁边那排按钮的**词汇表**：按钮上写的、和插进输入框里的，是同一句话。
 *
 * ── 为什么不放进 i18n 词典 ──────────────────────────────────────
 * 词典里的值是「要显示给人看的文案」；这里是「用户要打进输入框的话」。
 * 两者最大的区别是**谁在消费它**：这些短语是发给模型看的，
 * 所以它必须和 promptText 里教过模型的说法对得上（tests/aiCommands.ts 里
 * 有一条用例守着这件事），而不是「翻得像不像」。
 *
 * 这就是 statusWords.ts 那条白名单理由的同一类东西：中文是要被认出来的
 * **输入**，不是要显示的文案。所以本文件单独进 scripts/audit-i18n.mjs 的白名单。
 *
 * 为什么不做成「整句模板 + 占位符」：
 * 按钮只负责把短语插到光标处，句子是用户接着自己写的。我们在这里替用户
 * 拼好一句完整的话，就等于又写了一个「自然语言解析器」—— 而真正干活的是
 * 模型，多这一层只会让两边的理解悄悄漂开。
 *
 * ── 改这里的规矩 ────────────────────────────────────────────────
 * 中英两份**必须形状一致**（TS 类型管着），而且中英都要在 promptText 的
 * chatSystem 里出现过 —— 按钮插一句模型没见过的说法，就是让它猜。
 */

import { getLang } from '../i18n'

export interface CommandVocab {
  /* ---- 动作短语：按钮的字 = 插进去的字 ---- */

  /** 录一件新东西 */
  item: string
  /** 这件东西放在哪儿 */
  place: string
  /** 归到哪个分类 */
  categorize: string
  /** 几件 */
  quantity: string
  /** 什么时候过期 */
  expiry: string
  /** 额外说明 */
  note: string
  /** 这件东西是什么状态（速录面板用：`状态 备用`） */
  status: string
  /** 闲置（速录面板里当作状态值用；按钮上那句是 markIdle） */
  idle: string
  /** 备用 */
  spare: string

  /** 改成闲置 */
  markIdle: string
  /** 改成备用（特意留着的那种） */
  markSpare: string
  /** 拿出来用（从闲置/备用变回在用） */
  markActive: string
  /** 再录一件：按钮的字和插进去的字不一样，所以要分开写 */
  more: string

  /**
   * 「新建位置」这四个字。
   *
   * 它**没有对应的按钮** —— 光说「新建位置」在这条链路上建不出东西：
   * 位置只能挂在一件物品的「放在」上一起建（或者去位置页点新建）。
   * 留着这个词是为了**认出来并提醒**：用户习惯这么写，而这么写会静默什么
   * 都不发生。剩下那种情况才是真的危险。
   */
  newPlace: string

  /* ---- 连接与分隔 ---- */

  /** 连接符：一句话里两段之间用这个连起来（中文「，」/ 英文 ', '） */
  clauseSeparator: string
  /** 路径分隔符：插进输入框就用它，和提示词里给模型看的写法一致 */
  pathSeparator: string

  /**
   * 触发词和它的值之间的连接词。
   *
   * 用户真实打的句子是「分类**改成**生活用品/游泳」—— 那个「改成」不是值的一部分。
   * 不剥掉的话，补全会拿着「改成生活用品/游」去库里找，预检也会说
   * 「分类「改成生活用品/游泳」库里没有」：**明明写对了却说没对上**，
   * 这种假警报比不提示更糟（用户会开始不信这一行）。
   */
  connectors: string[]

  /** 层数标签：{n} 换成数字（中文「1层」/ 英文 "Level 1"），跟着界面语言走 */
  levelLabel: string

  /* ---- 触发词：光标前出现它们，就弹出对应的补全 ---- */

  placeTriggers: string[]
  categoryTriggers: string[]
  quantityTriggers: string[]
  expiryTriggers: string[]
}

const ZH: CommandVocab = {
  item: '新建物品',
  place: '放在',
  categorize: '分类',
  quantity: '数量',
  expiry: '过期',
  note: '备注',

  status: '状态',
  idle: '闲置',
  spare: '备用',

  markIdle: '改成闲置',
  markSpare: '改成备用',
  markActive: '拿出来用',
  more: '再加一件',

  newPlace: '新建位置',

  clauseSeparator: '，',
  pathSeparator: ' / ',
  /* 多字连接词直接剥；单字那几个只在后面跟着空格时才剥（免得剥掉名字的第一个字） */
  connectors: ['改成', '改为', '变成', '换成', '成', '是', '为'],
  levelLabel: '{n}层',

  placeTriggers: ['放在', '放到', '移到', '位置是'],
  categoryTriggers: ['分类', '归类到', '类别'],
  quantityTriggers: ['数量'],
  expiryTriggers: ['过期', '到期', '有效期'],
}

/*
 * 英文那几条不是逐字翻译：要读起来像英语使用者真会打进去的话，
 * 而且要对得上这个 App 的用法（一个输入框，既能录新的、也能改现有的）。
 * 触发词里的短语（placed in / category / expiry）必须和动作短语自洽 ——
 * 因为插进去的就是它们。
 */
const EN: CommandVocab = {
  item: 'Add item',
  place: 'placed in',
  categorize: 'category',
  quantity: 'quantity',
  expiry: 'expiry',
  note: 'note',

  status: 'status',
  idle: 'idle',
  spare: 'spare',

  markIdle: 'mark it idle',
  markSpare: 'mark it as spare',
  markActive: 'put it back in use',
  more: 'add another',

  newPlace: 'new place',

  clauseSeparator: ', ',
  pathSeparator: ' / ',
  connectors: ['change to', 'to', 'as', 'into', 'is'],
  levelLabel: 'Level {n}',

  placeTriggers: ['placed in', 'located in', 'put in', 'store in'],
  categoryTriggers: ['category', 'categories', 'file under'],
  quantityTriggers: ['quantity'],
  expiryTriggers: ['expiry', 'expires', 'expires on', 'use by'],
}

/**
 * 按当前界面语言取词汇表。
 *
 * 为什么在这里读语言、而不是让调用方传进来：和 promptText() 同一个理由 ——
 * 按钮是在**渲染的那一刻**求值的，读当前语言正好是想要的行为。
 * 组件里有 useT()，语言一变它就会重渲染，于是这排按钮跟着换语言。
 */
export function commandVocab(): CommandVocab {
  return getLang() === 'en' ? EN : ZH
}

/** 只有测试和审计用得上：两份都必须原地能取到 */
export const COMMAND_VOCAB_BY_LANG = { zh: ZH, en: EN }
