/**
 * 测试基础设施：极简断言 + 用例框架 + 共享夹具。
 *
 * 刻意不引 node:assert —— 那需要给 tsconfig 加上 @types/node，
 * 会顺带把 Node 全局（process / Buffer 等）暴露给浏览器端代码，掩盖真问题。
 */

import type { ParseOutcome, ParseSuccess } from '../src/data/validate'
import { createSeedData } from '../src/storage/seed'
import type { AppData, Item } from '../src/types'

/* ------------------------------------------------------------------ */
/* 断言                                                                */
/* ------------------------------------------------------------------ */

export function fail(message: string): never {
  throw new Error(message)
}

export function fmt(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value)
  try {
    const text = JSON.stringify(value)
    if (text === undefined) return String(value)
    return text.length > 300 ? `${text.slice(0, 300)}…` : text
  } catch {
    return String(value)
  }
}

export function eq(actual: unknown, expected: unknown, message = '值不相等'): void {
  if (!Object.is(actual, expected)) {
    fail(`${message}\n    实际：${fmt(actual)}\n    期望：${fmt(expected)}`)
  }
}

export function ok(value: unknown, message = '期望为真'): void {
  if (!value) fail(message)
}

/** 取非空值，顺便把类型收窄，省掉满地的 ! */
export function must<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined) fail(message)
  return value
}

/** 断言解析成功 —— 同时完成类型收窄 */
export function mustParse(result: ParseOutcome): ParseSuccess {
  if (!result.ok) fail(`期望解析成功，实际失败：${result.error}`)
  return result
}

function firstDiffPath(a: unknown, b: unknown, path = ''): string | null {
  if (Object.is(a, b)) return null
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    return `${path || '(根)'}：实际 ${fmt(a)} ≠ 期望 ${fmt(b)}`
  }
  if (Array.isArray(a) !== Array.isArray(b)) return `${path || '(根)'}：数组 / 对象类型不一致`

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return `${path}：长度 ${a.length} ≠ ${b.length}`
    for (let i = 0; i < a.length; i++) {
      const found = firstDiffPath(a[i], b[i], `${path}[${i}]`)
      if (found) return found
    }
    return null
  }

  const aKeys = Object.keys(a as Record<string, unknown>)
  const bKeys = Object.keys(b as Record<string, unknown>)
  if (aKeys.length !== bKeys.length) {
    return `${path || '(根)'}：字段数量 ${aKeys.length} ≠ ${bKeys.length}`
  }
  for (const key of aKeys) {
    if (!(key in (b as Record<string, unknown>))) return `${path}.${key}：期望里没有这个字段`
    const found = firstDiffPath(
      (a as Record<string, unknown>)[key],
      (b as Record<string, unknown>)[key],
      path ? `${path}.${key}` : key,
    )
    if (found) return found
  }
  return null
}

export function deepEq(actual: unknown, expected: unknown, message = '深度比较不一致'): void {
  const diff = firstDiffPath(actual, expected)
  if (diff) fail(`${message}\n    首处差异 → ${diff}`)
}

export function match(text: string, pattern: RegExp, message = '文本不匹配'): void {
  if (!pattern.test(text)) fail(`${message}\n    文本：${fmt(text.slice(0, 300))}\n    期望匹配：${pattern}`)
}

export function contains(text: string, needle: string, message = '文本里找不到预期内容'): void {
  if (!text.includes(needle)) {
    fail(`${message}\n    要找：${fmt(needle)}\n    文本：${fmt(text.slice(0, 400))}`)
  }
}

/* ------------------------------------------------------------------ */
/* 用例框架                                                            */
/* ------------------------------------------------------------------ */

let passed = 0
const failures: string[] = []
let currentSuite = ''

export function suite(name: string): void {
  currentSuite = name
  console.log(`\n${name}`)
}

export async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn()
    passed++
    console.log(`  ✓ ${name}`)
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    failures.push(`${currentSuite} › ${name}\n    ${detail.replace(/\n/g, '\n    ')}`)
    console.log(`  ✗ ${name}`)
  }
}

/** 全部跑完后调用；有失败则抛错，让进程以非 0 退出 */
export function finish(): void {
  console.log(`\n${'─'.repeat(56)}`)
  if (failures.length === 0) {
    console.log(`全部通过：${passed} 项\n`)
    return
  }
  console.log(`通过 ${passed} 项，失败 ${failures.length} 项\n`)
  for (const failure of failures) console.log(`  ✗ ${failure}\n`)
  throw new Error(`${failures.length} 项测试未通过`)
}

/* ------------------------------------------------------------------ */
/* 共享夹具                                                            */
/* ------------------------------------------------------------------ */

export const OLD_DATE = new Date(Date.now() - 400 * 24 * 3600 * 1000).toISOString()

export function item(partial: Partial<Item> & { name: string }): Item {
  const now = new Date().toISOString()
  return {
    id: partial.id ?? `id-${partial.name}`,
    name: partial.name,
    categoryIds: partial.categoryIds ?? [],
    locationId: partial.locationId ?? null,
    quantity: partial.quantity ?? 1,
    status: partial.status ?? 'active',
    tags: partial.tags ?? [],
    attrs: partial.attrs ?? {},
    note: partial.note ?? '',
    createdAt: partial.createdAt ?? now,
    updatedAt: partial.updatedAt ?? now,
    idleAt: partial.idleAt ?? null,
    discardedAt: partial.discardedAt ?? null,
    expiresAt: partial.expiresAt ?? null,
  }
}

/** 一份有代表性的数据：多分类、闲置、未归位、未分类、带标签、带属性值 */
export function fixture(): AppData {
  // 显式要中文脚手架。
  //
  // 不传语言的话它跟着「当前界面语言」走，于是这个夹具就变得很脆：
  // 只要前面哪个用例 `setLang('en')` 之后没切回来，这里铺的分类名就变成英文，
  // 而下面一堆 `cat('衣物')` 的查找会直接抛「夹具缺少分类 衣物」——
  // 症状离病因很远，很难查。传死语言，这类污染就不可能发生。
  const seed = createSeedData('zh')
  const cat = (name: string) =>
    must(seed.categories.find((c) => c.name === name), `夹具缺少分类 ${name}`).id
  const loc = (name: string) =>
    must(seed.locations.find((l) => l.name === name), `夹具缺少位置 ${name}`).id
  const brand = must(seed.attributeDefs.find((d) => d.name === '品牌'), '夹具缺少属性 品牌')
  const price = must(seed.attributeDefs.find((d) => d.name === '价格'), '夹具缺少属性 价格')

  const items: Item[] = [
    item({
      id: 'i1',
      name: '灰色羊毛衫',
      categoryIds: [cat('衣物')],
      locationId: loc('衣柜'),
      tags: ['舍不得扔'],
      attrs: { [brand.id]: '某品牌' },
    }),
    item({
      id: 'i2',
      name: '牛仔裤',
      categoryIds: [cat('衣物')],
      locationId: loc('衣柜'),
      quantity: 2,
    }),
    item({
      id: 'i3',
      name: '旧手机',
      categoryIds: [cat('电子')],
      locationId: loc('床头柜'),
      status: 'idle',
      idleAt: OLD_DATE,
      tags: ['想送人'],
    }),
    item({
      id: 'i4',
      name: '平底锅',
      categoryIds: [cat('厨房'), cat('日用品')],
      locationId: loc('橱柜'),
      attrs: { [price.id]: 199 },
    }),
    item({ id: 'i5', name: '不知道放哪的东西' }),
  ]

  return { ...seed, items }
}
