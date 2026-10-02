/**
 * 有效期（过期时间）。
 *
 * 三条设计决定，都写在代码里免得以后自己忘了为什么：
 *
 * 1. **只按日期算，不按时间点。** `expiresAt` 存的是 `YYYY-MM-DD`，
 *    比较时两边都取本地日的 00:00。这样「今天到期」永远是「还有 0 天」，
 *    不会因为过了零点就突然跳成「已过期 1 天」。
 *
 * 2. **到期不改数据。** 没有定时任务、没有自动标闲置、没有自动进回收站。
 *    过期是个**算出来的状态**，每次渲染现算（`expiryState`）。
 *    如果自动改写数据，用户哪天觉得某个东西还能用，数据已经被悄悄动过了 ——
 *    这和整个项目「只有你点了才写入」的原则冲突。
 *
 * 3. **没设置就是没设置。** `null` 和「已过期」是两回事，
 *    界面上不能把「没填有效期」显示成任何警告色，否则一眼看去全是红的。
 */

import type { Item } from '../types'
import { EXPIRY_SOON_DEFAULT_DAYS } from '../types'

// 阈值本身定义在 types 里（挨着 DEFAULT_UI_PREFS），这里转出去方便调用方
// 只 import 一个模块。反过来让 types 依赖 lib 会形成循环，所以只能这个方向。
export { EXPIRY_SOON_DEFAULT_DAYS }

const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * 有效期的四种状态。
 *
 * - `expired` 已经过了那一天
 * - `soon`    还有 `soonDays` 天以内（含今天，也就是 0 天）
 * - `ok`      还早
 * - `none`    没设置 —— 注意这个**不是**「正常」，界面上要区分开
 */
export type ExpiryState = 'expired' | 'soon' | 'ok' | 'none'

/** 合法的日期串：YYYY-MM-DD，且真的是个存在的日期（挡住 2025-02-30） */
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

function parseParts(raw: string): { y: number; m: number; d: number } | null {
  const m = DATE_RE.exec(raw.trim())
  if (!m) return null
  const y = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  if (month < 1 || month > 12) return null
  if (day < 1 || day > 31) return null
  // 用 UTC 造一次再回读，能挡掉 2 月 30 日这种「格式对但日期不存在」的输入
  const probe = new Date(Date.UTC(y, month - 1, day))
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    return null
  }
  return { y, m: month, d: day }
}

/**
 * 把各种写法归一成 `YYYY-MM-DD`，不合法返回 null。
 *
 * 需要它是因为日期有三个来源：人手工填的、AI 从自然语言里抽的、别人给的备份文件。
 * 三种都不可信，所以最后都过一遍这里。
 *
 * 认这几种：
 *   `2026-03-15` · `2026/3/15` · `2026.3.15` · `20260315`
 *   `2026-03-15T00:00:00.000Z`（ISO 时间点，只取日期部分）
 *   `2026年3月15日`
 */
export function normalizeExpiryDate(input: unknown): string | null {
  if (input === null || input === undefined) return null
  if (typeof input !== 'string') return null

  let raw = input.trim()
  if (raw === '') return null

  // ISO 时间点：截到 T 之前。注意**不能** new Date() 再取本地日期 ——
  // `2026-03-15T23:00:00Z` 在东八区会变成 16 号，用户会莫名其妙多一天。
  const tIndex = raw.search(/[T ]\d/)
  if (tIndex > 0) raw = raw.slice(0, tIndex)

  // 中文写法
  raw = raw.replace(/年|月/g, '-').replace(/日/g, '')

  // 纯数字 20260315
  if (/^\d{8}$/.test(raw)) {
    raw = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
  } else {
    // 分隔符统一成 -
    raw = raw.replace(/[/.]/g, '-')
    // 补齐 2026-3-5
    const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(raw)
    if (m) raw = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  }

  return parseParts(raw) ? raw : null
}

/** 今天的本地 00:00 毫秒数 */
function startOfToday(now: number): number {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/**
 * 距离到期还有几天。已过期为负数，没设置为 null。
 *
 * 0 = 今天到期。用本地日 00:00 相减，所以没有时区偏移带来的 ±1 天误差。
 */
export function daysUntilExpiry(
  expiresAt: string | null | undefined,
  now: number = Date.now(),
): number | null {
  if (!expiresAt) return null
  const parts = parseParts(expiresAt)
  if (!parts) return null
  const target = new Date(parts.y, parts.m - 1, parts.d).getTime()
  return Math.round((target - startOfToday(now)) / MS_PER_DAY)
}

/** 算状态。这是全站唯一判断过期的地方，视图层不要再自己比大小。 */
export function expiryState(
  expiresAt: string | null | undefined,
  soonDays: number,
  now: number = Date.now(),
): ExpiryState {
  const days = daysUntilExpiry(expiresAt, now)
  if (days === null) return 'none'
  if (days < 0) return 'expired'
  if (days <= soonDays) return 'soon'
  return 'ok'
}

export function isExpired(
  expiresAt: string | null | undefined,
  now: number = Date.now(),
): boolean {
  const days = daysUntilExpiry(expiresAt, now)
  return days !== null && days < 0
}

/** 需要你关注一下的（已过期，或快到期了）—— 「即将过期 N 件」那句统计用这个 */
export function isExpiring(
  expiresAt: string | null | undefined,
  soonDays: number,
  now: number = Date.now(),
): boolean {
  const state = expiryState(expiresAt, soonDays, now)
  return state === 'expired' || state === 'soon'
}

/** 只在算统计时用：把一批物品按状态分桶，跳过已舍弃的 */
export function countByExpiryState(
  items: readonly Item[],
  soonDays: number,
  now: number = Date.now(),
): Record<ExpiryState, number> {
  const out: Record<ExpiryState, number> = { expired: 0, soon: 0, ok: 0, none: 0 }
  for (const item of items) {
    if (item.status === 'discarded') continue
    out[expiryState(item.expiresAt, soonDays, now)]++
  }
  return out
}

/**
 * 排序用：没设置有效期的一律排在后面（不管是升序还是降序）。
 *
 * 为什么不能让它们当成 0 或无穷大参与比较：那样「按有效期排序」时
 * 一大片没填的东西会挤在最前面，把真正要看的冲散。
 */
export function compareExpiry(
  a: string | null | undefined,
  b: string | null | undefined,
  dir: 'asc' | 'desc' = 'asc',
): number {
  const av = normalizeExpiryDate(a ?? null)
  const bv = normalizeExpiryDate(b ?? null)
  if (av === null && bv === null) return 0
  if (av === null) return 1
  if (bv === null) return -1
  return dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
}
