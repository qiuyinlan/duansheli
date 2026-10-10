/** 日期与数字格式化工具 */

import { formatLocalDate, formatNumber, t, tc } from '../i18n'

const MS_PER_DAY = 24 * 60 * 60 * 1000

const pad = (n: number) => String(n).padStart(2, '0')

function toDate(iso: string | null | undefined): Date | null {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * 2025-01-15
 *
 * 两种语言都用这个格式，**刻意不做本地化**：
 * 它没有歧义（不会有人把 03-04 读成 4 月 3 日），而且按字符串排序就是按时间排序。
 * 想要「2025年1月15日」那种读法，用 formatDateLong。
 */
export function formatDate(iso: string | null | undefined): string {
  const d = toDate(iso)
  if (!d) return '—'
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 给人读的本地化日期：2025年1月15日 / Jan 15, 2025 */
export function formatDateLong(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = toDate(iso)
  if (!d) return '—'
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'long' }).format(d)
}

/** 2025-01-15 10:30 */
export function formatDateTime(iso: string | null | undefined): string {
  const d = toDate(iso)
  if (!d) return '—'
  return `${formatDate(iso)} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 用于文件名：2025-01-15-1030 */
export function formatForFilename(date = new Date()): string {
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}`
  )
}

/** 今天的日期字符串，用于 <input type="date"> 的默认值 */
export function todayISODate(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * 在 `YYYY-MM-DD` 上加减天数，返回同样格式的串。
 *
 * 用**本地日期**算术（`new Date(y, m, d)`）：绝不能走 `toISOString()`，
 * 那会先把日期当成 UTC 再换算回来，在东八区晚上会差一天。
 * 日期只有「天」没有「时刻」，所以加减也用日期构造器，不碰毫秒。
 *
 * ⚠️ 「多久之后过期」这类按钮（录入表单、AI 输入框旁边的补全）都要用它 ——
 * 以前它只在 ItemEdit 里私有一份，第二处要用的时候必须**搬到这里**，
 * 而不是再抄一份：两份日期算术迟早会漂，而漂了就是差一天这种最难发现的错。
 */
export function addDaysToISODate(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const shifted = new Date(y, m - 1, d + days)
  return `${shifted.getFullYear()}-${pad(shifted.getMonth() + 1)}-${pad(shifted.getDate())}`
}

/** 从某个时间到现在经过了多少天（向下取整，最小 0） */
export function daysSince(iso: string | null | undefined): number {
  const d = toDate(iso)
  if (!d) return 0
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / MS_PER_DAY))
}

/** 3 天前 / 2 个月前 / 1 年前 —— 用于列表里的次要信息 */
export function formatRelative(iso: string | null | undefined): string {
  const days = daysSince(iso)
  if (days === 0) return t('format.today')
  if (days === 1) return t('format.yesterday')
  if (days < 30) return tc(days, 'format.daysAgo')
  const months = Math.floor(days / 30)
  if (months < 12) return tc(months, 'format.monthsAgo')
  return tc(Math.floor(days / 365), 'format.yearsAgo')
}

/** 「已闲置 47 天」里那个数字 */
export function formatDays(days: number): string {
  if (days === 0) return t('format.lessThanOneDay')
  if (days < 365) return tc(days, 'format.days')
  return tc(Math.floor(days / 365), 'format.overYears')
}

/** 件数：1 件 / 3 件；英文会自动变成 1 item / 3 items */
export function formatItemCount(count: number): string {
  return tc(count, 'format.countItems')
}

/** 百分比，保留一位小数；分母为 0 时返回 0 */
export function percent(part: number, total: number): number {
  if (total <= 0) return 0
  return Math.round((part / total) * 1000) / 10
}

export function formatPercent(part: number, total: number): string {
  return `${formatNumber(percent(part, total))}%`
}

/** 导出的 JSON 是给人看也机器读的，这里统一用 formatDate 的口径 */
export { formatLocalDate }
