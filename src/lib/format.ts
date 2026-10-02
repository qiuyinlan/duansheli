/** 日期与数字格式化工具 */

const MS_PER_DAY = 24 * 60 * 60 * 1000

const pad = (n: number) => String(n).padStart(2, '0')

function toDate(iso: string | null | undefined): Date | null {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d
}

/** 2025-01-15 */
export function formatDate(iso: string | null | undefined): string {
  const d = toDate(iso)
  if (!d) return '—'
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
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

/** 从某个时间到现在经过了多少天（向下取整，最小 0） */
export function daysSince(iso: string | null | undefined): number {
  const d = toDate(iso)
  if (!d) return 0
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / MS_PER_DAY))
}

/** 3 天前 / 2 个月前 / 1 年前 —— 用于列表里的次要信息 */
export function formatRelative(iso: string | null | undefined): string {
  const days = daysSince(iso)
  if (days === 0) return '今天'
  if (days === 1) return '昨天'
  if (days < 30) return `${days} 天前`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months} 个月前`
  return `${Math.floor(days / 365)} 年前`
}

/** 「已闲置 47 天」里那个数字 */
export function formatDays(days: number): string {
  if (days === 0) return '不到 1 天'
  if (days < 365) return `${days} 天`
  return `${Math.floor(days / 365)} 年多`
}

/** 百分比，保留一位小数；分母为 0 时返回 0 */
export function percent(part: number, total: number): number {
  if (total <= 0) return 0
  return Math.round((part / total) * 1000) / 10
}

export function formatPercent(part: number, total: number): string {
  return `${percent(part, total)}%`
}
