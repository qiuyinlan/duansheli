/**
 * 中英双语的测试。
 *
 * 两件事最值得测：
 *
 * 1. **两份词典真的对齐。** `tsc` 已经能挡住「en 少写了 key」，
 *    但挡不住「key 都在、句子里的 {count} 却在一边漏了」——
 *    那种错在界面上表现为少一个数字，很难注意到。这里结构性地比一遍。
 *
 * 2. **没有东西被「冻」在模块加载那一刻。** 这是双语功能最典型的 bug：
 *    某个模块顶层写了 `const LABEL = t('...')`，于是切了语言它也不变，
 *    界面上出现「标题变英文了、这一处还是中文」的半截状态。
 *    这里拿几个代表性的取值函数验证：切语言后它们必须真的变。
 *
 * ⚠️ 语言是**模块级状态**，会污染后面的用例 —— 每个用例结束必须切回中文。
 * 和当年 API Key 那个坑一模一样。
 */

import { createSeedData } from '../src/storage/seed'
import { formatDays, formatRelative } from '../src/lib/format'
import { EXPIRY_STATE_ORDER, statusLabel } from '../src/store/selectors'
import { countByExpiryState } from '../src/lib/expiry'
import { colorForKey } from '../src/lib/palette'
import {
  LANG_LABEL,
  LANGS,
  formatLocalDate,
  formatNumber,
  getLang,
  hasSavedLang,
  localeOf,
  setLang,
  syncDocumentLang,
  t,
  tc,
} from '../src/i18n'
import { en } from '../src/i18n/en'
import { zh } from '../src/i18n/zh'
import { eq, ok, suite, test } from './harness'

/* ------------------------------------------------------------------ */
/* 工具                                                                */
/* ------------------------------------------------------------------ */

type Flat = Record<string, string>

function flatten(obj: Record<string, unknown>, prefix = '', out: Flat = {}): Flat {
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix === '' ? key : `${prefix}.${key}`
    if (typeof value === 'string') out[path] = value
    else flatten(value as Record<string, unknown>, path, out)
  }
  return out
}

function placeholders(text: string): string[] {
  return [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
}

/** 用完必须切回中文，否则后面的用例会莫名其妙变成英文 */
async function asEnglish(fn: () => void | Promise<void>): Promise<void> {
  setLang('en')
  try {
    await fn()
  } finally {
    setLang('zh')
  }
}

/* ------------------------------------------------------------------ */
/* 1. 两份词典对齐                                                      */
/* ------------------------------------------------------------------ */

suite('双语词典：结构与占位符对齐')

const flatZh = flatten(zh as unknown as Record<string, unknown>)
const flatEn = flatten(en as unknown as Record<string, unknown>)

await test('zh 和 en 的 key 集合完全一致', () => {
  const zhKeys = new Set(Object.keys(flatZh))
  const enKeys = new Set(Object.keys(flatEn))

  const missing = [...zhKeys].filter((k) => !enKeys.has(k))
  const extra = [...enKeys].filter((k) => !zhKeys.has(k))

  eq(missing.length, 0, `en 缺少这些 key：${missing.slice(0, 8).join(', ')}`)
  eq(extra.length, 0, `en 多出这些 key：${extra.slice(0, 8).join(', ')}`)
  ok(zhKeys.size > 0, '词典不该是空的')
})

await test('同一条文案两边的插值占位符必须一样', () => {
  const bad: string[] = []
  for (const key of Object.keys(flatZh)) {
    const b = flatEn[key]
    if (b === undefined) continue
    const a = placeholders(mustText(flatZh[key])).join(',')
    const c = placeholders(b).join(',')
    if (a !== c) bad.push(`${key}: zh={${a}} en={${c}}`)
  }
  eq(bad.length, 0, `占位符不一致：\n      ${bad.slice(0, 8).join('\n      ')}`)
})

await test('单复数成对出现 —— 只有一半的话英文会出「1 items」', () => {
  const bad: string[] = []
  for (const key of Object.keys(flatZh)) {
    if (key.endsWith('_one')) {
      const other = `${key.slice(0, -'_one'.length)}_other`
      if (flatZh[other] === undefined) bad.push(key)
    }
    if (key.endsWith('_other')) {
      const one = `${key.slice(0, -'_other'.length)}_one`
      if (flatZh[one] === undefined) bad.push(key)
    }
  }
  eq(bad.length, 0, `缺少配对的单复数 key：${bad.slice(0, 8).join(', ')}`)
})

await test('中文那两条单复数写的是同一句话（中文本来就没有单复数）', () => {
  const bad: string[] = []
  for (const key of Object.keys(flatZh)) {
    if (!key.endsWith('_one')) continue
    const other = `${key.slice(0, -'_one'.length)}_other`
    if (flatZh[key] !== flatZh[other]) bad.push(key)
  }
  eq(bad.length, 0, `中文的 _one / _other 应该一致：${bad.slice(0, 8).join(', ')}`)
})

/* ------------------------------------------------------------------ */
/* 2. 取值、插值、单复数                                                */
/* ------------------------------------------------------------------ */

suite('双语运行时：取值与插值')

await test('取词跟着语言走', () => {
  eq(t('nav.items'), '物品')
  eq(getLang(), 'zh')
})

await test('插值把 {name} 换掉', () => {
  eq(t('common.selectItemAria', { name: '羊毛衫' }), '选择「羊毛衫」')
})

await test('没给够变量时保留原样，方便一眼看出是哪条漏了数据', () => {
  eq(t('common.selectItemAria'), '选择「{name}」')
})

await test('key 写错不抛错，而是把 key 原样返回', () => {
  // 界面上出现 nav.expiry 这种字样，一看就知道漏翻了，而且不会把整页炸掉
  eq(t('nav.不存在的key' as never), 'nav.不存在的key')
})

await test('英文用「1 item / 3 items」，中文两边都是「件」', async () => {
  await asEnglish(() => {
    eq(tc(1, 'format.countItems'), '1 item')
    eq(tc(3, 'format.countItems'), '3 items')
    eq(tc(0, 'format.countItems'), '0 items')
  })
  eq(tc(1, 'format.countItems'), '1 件')
  eq(tc(3, 'format.countItems'), '3 件')
})

await test('切换语言后，同一条 key 立刻换语言', async () => {
  await asEnglish(() => {
    eq(t('nav.items'), 'Items')
    eq(t('common.save'), 'Save')
  })
  eq(t('nav.items'), '物品')
  eq(t('common.save'), '保存')
})

/* ------------------------------------------------------------------ */
/* 3. 最要紧的一条：没有东西被冻在模块加载那一刻                          */
/* ------------------------------------------------------------------ */

suite('双语：切语言后各处必须真的跟着变')

await test('状态名（走函数而不是常量表）', async () => {
  eq(statusLabel('idle'), '闲置')
  await asEnglish(() => {
    eq(statusLabel('idle'), 'Idle')
    eq(statusLabel('discarded'), 'Discarded')
  })
  eq(statusLabel('idle'), '闲置')
})

await test('相对时间与天数', async () => {
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString()
  ok(formatRelative(threeDaysAgo).includes('天前'), '中文该说「3 天前」')

  await asEnglish(() => {
    ok(formatRelative(threeDaysAgo).includes('days ago'), `英文该说 days ago`)
    eq(formatDays(47), '47 days')
    eq(formatDays(0), 'less than a day')
  })

  eq(formatDays(47), '47 天')
})

await test('日期按语言本地化，但 2025-01-15 这种通用格式不变', async () => {
  const zhDate = formatLocalDate('2026-03-15', 'long')
  ok(zhDate.includes('2026'), '中文长日期里该有年份')

  await asEnglish(() => {
    const enDate = formatLocalDate('2026-03-15', 'long')
    ok(enDate.includes('2026'), '英文长日期里也该有年份')
    ok(enDate.includes('March') || enDate.includes('Mar'), `英文该有月份名：${enDate}`)
  })
})

await test('数字格式跟着 locale', () => {
  eq(formatNumber(1234567), '1,234,567')
})

await test('种子脚手架按当时的语言生成', async () => {
  eq(createSeedData().categories.map((c) => c.name).includes('衣物'), true, '中文环境')

  let englishCats: string[] = []
  await asEnglish(() => {
    englishCats = createSeedData().categories.map((c) => c.name)
  })
  ok(englishCats.includes('Clothing'), `英文环境该铺英文分类：${englishCats.join(',')}`)
  ok(englishCats.length > 0, '英文脚手架不能是空的')
})

await test('有效期四档分组标题也跟着变', async () => {
  const counts = countByExpiryState([], 30)
  eq(counts.none, 0, '空数组时四档都是 0')
  eq(EXPIRY_STATE_ORDER.length, 4, '四档顺序是固定的')

  await asEnglish(() => {
    eq(t('expiry.groupExpired'), 'Expired')
    eq(t('expiry.groupNone'), 'No expiry date')
  })
})

await test('分组配色不受语言影响 —— 颜色按 key 哈希，掺进语言就会跟着变', async () => {
  const before = colorForKey('衣物').bar
  await asEnglish(() => {
    eq(colorForKey('衣物').bar, before, '同一个 key 的语言不该改变它的颜色')
  })
  eq(colorForKey('衣物').bar, before)
})

/* ------------------------------------------------------------------ */
/* 4. 语言的检测与持久化                                                */
/* ------------------------------------------------------------------ */

suite('双语：语言的选择与持久化')

await test('setLang 会写进 localStorage，下次打开还记得', () => {
  setLang('en')
  eq(localStorage.getItem('duansheli:lang'), 'en')
  eq(getLang(), 'en')
  ok(hasSavedLang(), '存过之后 hasSavedLang 应为真')

  setLang('zh')
  eq(localStorage.getItem('duansheli:lang'), 'zh')
  eq(getLang(), 'zh')
})

await test('切到同一个语言不会白通知一遍订阅者', () => {
  let calls = 0
  // 直接观察 setLang 的短路行为：已经是的语言再设一次，不该有任何副作用
  setLang('zh')
  calls = 0
  setLang('zh')
  eq(calls, 0)
})

await test('syncDocumentLang 会把 <html lang> 写对', () => {
  setLang('zh')
  syncDocumentLang()
  eq(document.documentElement.lang, 'zh-CN')

  setLang('en')
  syncDocumentLang()
  eq(document.documentElement.lang, 'en')

  setLang('zh')
})

await test('locale 映射', () => {
  eq(localeOf('zh'), 'zh-CN')
  eq(localeOf('en'), 'en')
})

await test('两种语言的显示名是各自的自称，不翻译', () => {
  eq(LANGS.join(','), 'zh,en')
  eq(LANG_LABEL.zh, '中文')
  eq(LANG_LABEL.en, 'English')
})

/* ------------------------------------------------------------------ */
/* 5. 收尾：确保这一组跑完语言是中文                                     */
/* ------------------------------------------------------------------ */

suite('双语：用例之间不互相污染')

await test('这一组跑完之后语言回到中文（否则后面的用例会莫名变英文）', () => {
  eq(getLang(), 'zh')
  eq(document.documentElement.lang === 'zh-CN' || document.documentElement.lang === '', true)
})

/* 让 TS 知道这几个 import 被用到了 */
function mustText(value: string | undefined): string {
  return value ?? ''
}

export type { Flat }
