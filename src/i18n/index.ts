/**
 * 中英双语。
 *
 * ── 为什么不装 i18next ────────────────────────────────────────────
 * 整个项目只有 4 个运行时依赖，这是刻意维持的。这里需要的东西其实很少：
 * 一份字典、一个查表、一个插值、一个「切换了要重新渲染」的通知。
 * 自己写大约 200 行，读起来还更直白。
 *
 * ── 三层，别搞混 ─────────────────────────────────────────────────
 *   1. **界面文案**（按钮、标题、空状态）→ 翻译，走 t()
 *   2. **用户自己的数据**（物品名、他建的分类名与位置名）→ **绝不翻译**，永远原样显示
 *   3. **AI 的提示词** → 两份（见 src/ai/promptText.ts），跟界面语言走
 *
 * ── 为什么不用 React Context ─────────────────────────────────────
 * 因为有一大半文案在 React 之外：store 里的提示、导入校验的报错、
 * API 客户端的错误映射。那些地方拿不到 context。
 * 所以语言是个**模块级状态**，React 组件通过 useSyncExternalStore 订阅它。
 */

import { useMemo, useSyncExternalStore } from 'react'
import { zh, type Dict, type DictKey, type PluralStem } from './zh'
import { en } from './en'

// 词典的 key 类型在组件里也要用（导航项就是个例子），所以从这里转出去，
// 调用方只需要认识 'src/i18n' 一个入口。
export type { Dict, DictKey, PluralStem }

export type Lang = 'zh' | 'en'

export const LANGS: readonly Lang[] = ['zh', 'en']

const STORAGE_KEY = 'duansheli:lang'

/** 语言的中文/英文自称 —— 切换按钮上显示的是「中文 / English」这种自称，不是翻译 */
export const LANG_LABEL: Record<Lang, string> = {
  zh: '中文',
  en: 'English',
}

/** 每种语言对应的 Intl locale，以及 <html lang> 的值 */
const LOCALE: Record<Lang, string> = {
  zh: 'zh-CN',
  en: 'en',
}

/* ------------------------------------------------------------------ */
/* 字典拍平：查表比 split('.') 走路径快，而且 key 错了能在开发期就发现      */
/* ------------------------------------------------------------------ */

type FlatDict = Record<string, string>

/**
 * 字典的递归形状。
 *
 * 用这个类型而不是 `Dict`，是因为 `flatten` 要往下递归，而 `Dict` 是**具体**
 * 那棵树的类型 —— 把某个子节点断言成整棵 `Dict` 只是自欺欺人，
 * 而且一旦所有命名空间都被填满（不再有空的 `{}` 兜底），
 * 那个断言连编译都过不去。递归类型才是这里真正想表达的东西。
 */
type NestedDict = { readonly [key: string]: string | NestedDict }

function flatten(dict: NestedDict, prefix = '', out: FlatDict = {}): FlatDict {
  for (const [key, value] of Object.entries(dict)) {
    const path = prefix === '' ? key : `${prefix}.${key}`
    if (typeof value === 'string') out[path] = value
    else flatten(value, path, out)
  }
  return out
}

const FLAT: Record<Lang, FlatDict> = {
  zh: flatten(zh),
  en: flatten(en),
}

/**
 * 启动时对一遍两份字典。
 *
 * 类型系统已经能挡住「en 少写了某个 key」，但挡不住运行时被塞进奇怪的东西。
 * 这个检查很便宜，而且一旦漏了会立刻炸在最显眼的地方，比上线后看到
 * 界面上出现 `overview.totalItems` 这种半成品好得多。
 */
function assertParity(): void {
  const zhKeys = Object.keys(FLAT.zh)
  const enKeys = new Set(Object.keys(FLAT.en))
  const missing = zhKeys.filter((k) => !enKeys.has(k))
  if (missing.length > 0) {
    throw new Error(`en 词典缺少这些 key：${missing.slice(0, 10).join(', ')}`)
  }
}

assertParity()

/* ------------------------------------------------------------------ */
/* 语言状态                                                            */
/* ------------------------------------------------------------------ */

function readSaved(): Lang | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    return saved === 'zh' || saved === 'en' ? saved : null
  } catch {
    // 隐私模式下 localStorage 可能直接抛错。读不到就当没存过。
    return null
  }
}

/**
 * 第一次打开时跟浏览器语言走：中文环境给中文，其余给英文。
 *
 * 拿不到任何线索时默认中文 —— 这个项目本身是中文起家的，
 * 而且「不知道给什么」时给中文比给英文更可能对得上。
 */
function detectLang(): Lang {
  const saved = readSaved()
  if (saved) return saved

  let nav = ''
  try {
    nav = typeof navigator === 'undefined' ? '' : (navigator.language ?? '')
  } catch {
    nav = ''
  }
  if (nav === '') return 'zh'
  return /^zh/i.test(nav) ? 'zh' : 'en'
}

let current: Lang = detectLang()

const listeners = new Set<() => void>()

export function getLang(): Lang {
  return current
}

export function setLang(next: Lang): void {
  if (next === current) return
  current = next
  try {
    localStorage.setItem(STORAGE_KEY, next)
  } catch {
    // 存不下就算了，至少这次会话是生效的
  }
  syncDocumentLang()
  for (const fn of [...listeners]) fn()
}

/** 用户手动选过语言没有（用来决定「切换语言」要不要提示数据不会跟着变） */
export function hasSavedLang(): boolean {
  return readSaved() !== null
}

export function subscribeLang(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** 让屏幕阅读器和浏览器知道当前语言（还影响连字符断行、字体回退） */
export function syncDocumentLang(): void {
  if (typeof document === 'undefined') return
  document.documentElement.lang = LOCALE[current]
}

export function localeOf(lang: Lang = current): string {
  return LOCALE[lang]
}

/* ------------------------------------------------------------------ */
/* 查表与插值                                                          */
/* ------------------------------------------------------------------ */

export type VarMap = Record<string, string | number>

/** 把 {name} 换掉。缺变量时保留原样，方便一眼看出是哪条文案没给够数据。 */
function interpolate(template: string, vars?: VarMap): string {
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = vars[name]
    return value === undefined ? whole : String(value)
  })
}

export type TFunction = (key: DictKey, vars?: VarMap) => string

/**
 * 取一条文案。
 *
 * 找不到时**不抛错**，而是把 key 原样返回 —— 界面上出现 `nav.expiry`
 * 这种字样，一看就知道漏翻了，而且不会把整个页面炸掉。
 */
export const t: TFunction = (key, vars) => {
  const template = FLAT[current][key] ?? FLAT.zh[key]
  if (template === undefined) return key
  return interpolate(template, vars)
}

export type TCountFunction = (count: number, stem: PluralStem, vars?: VarMap) => string

const pluralRules = new Map<Lang, Intl.PluralRules>()

function pluralFor(lang: Lang, count: number): Intl.LDMLPluralRule {
  let rules = pluralRules.get(lang)
  if (!rules) {
    rules = new Intl.PluralRules(LOCALE[lang])
    pluralRules.set(lang, rules)
  }
  return rules.select(count)
}

/**
 * 带数量的文案。
 *
 * 中文没有单复数，所以中文词典里 …_one 和 …_other 写的是同一句话 ——
 * 看着有点冗余，但换来的是**两份字典形状完全一致**，
 * 于是就能用 `typeof zh` 把 en 锁死，少一个 key 直接编译不过。
 * 这比「中文省几个字」值钱得多。
 *
 *   t('items.count', { count: 3 })          // 共 3 件
 *   tc(3, 'items.found')                    // 3 items / 3 件
 */
export const tc: TCountFunction = (count, stem, vars) => {
  const category = pluralFor(current, count)
  const withCount = { count: formatNumber(count), ...vars }

  const oneKey = `${stem}_one`
  const otherKey = `${stem}_other`
  const dict = FLAT[current]

  if (category === 'one' && dict[oneKey] !== undefined) {
    return interpolate(dict[oneKey], withCount)
  }
  if (dict[otherKey] !== undefined) return interpolate(dict[otherKey], withCount)
  // 退路：词典里只有不带后缀的那条
  return t(stem as DictKey, withCount)
}

/* ------------------------------------------------------------------ */
/* React 绑定                                                          */
/* ------------------------------------------------------------------ */

export function useLang(): Lang {
  return useSyncExternalStore(subscribeLang, getLang, getLang)
}

/**
 * 组件里用这个。
 *
 * 返回的对象在语言不变时是同一个引用，可以直接放进依赖数组。
 * 它同时负责**订阅**：语言一变，这个组件就会重新渲染。
 */
export function useT(): { t: TFunction; tc: TCountFunction; lang: Lang } {
  const lang = useLang()
  return useMemo(() => ({ t, tc, lang }), [lang])
}

/* ------------------------------------------------------------------ */
/* 数字与日期                                                          */
/* ------------------------------------------------------------------ */

const numberFormats = new Map<Lang, Intl.NumberFormat>()

export function formatNumber(value: number): string {
  let fmt = numberFormats.get(current)
  if (!fmt) {
    fmt = new Intl.NumberFormat(LOCALE[current])
    numberFormats.set(current, fmt)
  }
  return fmt.format(value)
}

/**
 * 本地化的日期，给人看的时候用（比如「2025年1月15日」/「Jan 15, 2025」）。
 * `expiresAt` 是日期串，按本地日期解析，避免时区把日子挪掉一天。
 */
export function formatLocalDate(
  value: string | null | undefined,
  style: 'short' | 'long' = 'short',
): string {
  if (!value) return '—'
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!m) return value
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return new Intl.DateTimeFormat(LOCALE[current], {
    dateStyle: style,
  }).format(date)
}
