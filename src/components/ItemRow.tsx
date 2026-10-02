import type { ReactNode } from 'react'
import type { Item } from '../types'
import type { DerivedContext } from '../store/selectors'
import { statusLabel } from '../store/selectors'
import { daysUntilExpiry } from '../lib/expiry'
import { useAppStore } from '../store/useAppStore'
import { t, tc } from '../i18n'

interface ItemRowProps {
  item: Item
  ctx: DerivedContext
  /** 显示左侧复选框 */
  selectable?: boolean
  selected?: boolean
  onToggleSelect?: (id: string) => void
  /** 点击主区域时触发（通常是进入编辑） */
  onOpen?: (id: string) => void
  /** 插入在数量之后的额外内容（如闲置天数、有效期） */
  extra?: ReactNode
  /** 行尾操作按钮 */
  actions?: ReactNode
}

/**
 * 有效期徽章。
 *
 * 规则：**没设置就不显示任何东西**。
 * 如果给「没填有效期」也画一个灰色小标签，一屏看过去全是标签，
 * 真正要紧的那几条反而被淹掉了。
 */
export function ExpiryBadge({
  expiresAt,
  soonDays,
}: {
  expiresAt: string | null
  /** 不传就用界面偏好里的阈值 */
  soonDays?: number
}) {
  const fromUi = useAppStore((s) => s.ui.expirySoonDays)
  const threshold = soonDays ?? fromUi

  const days = daysUntilExpiry(expiresAt)
  if (days === null) return null

  const tone = days < 0 ? 'expired' : days <= threshold ? 'soon' : 'ok'
  const text =
    days < 0
      ? tc(-days, 'expiry.overdueBy')
      : days === 0
        ? t('expiry.dueToday')
        : days === 1
          ? t('expiry.dueTomorrow')
          : tc(days, 'expiry.dueIn')

  return <span className={`expiry-badge expiry-badge--${tone}`}>{text}</span>
}

export function ItemRow({
  item,
  ctx,
  selectable = false,
  selected = false,
  onToggleSelect,
  onOpen,
  extra,
  actions,
}: ItemRowProps) {
  const locationText = item.locationId
    ? ctx.index.pathString(item.locationId, ' / ')
    : t('status.unassigned')

  const categoryNames = item.categoryIds
    .map((id) => ctx.categoryById.get(id)?.name)
    .filter((n): n is string => Boolean(n))

  const metaParts: string[] = [locationText]
  if (categoryNames.length > 0) metaParts.push(categoryNames.join('、'))
  if (item.tags.length > 0) metaParts.push(item.tags.map((tag) => `#${tag}`).join(' '))

  return (
    <li className={`list-row${selected ? ' list-row--selected' : ''}`}>
      {selectable ? (
        <input
          type="checkbox"
          className="row-checkbox"
          checked={selected}
          aria-label={t('common.selectItemAria', { name: item.name })}
          onChange={() => onToggleSelect?.(item.id)}
        />
      ) : null}

      <button
        type="button"
        className="list-row__main"
        onClick={() => onOpen?.(item.id)}
        disabled={!onOpen}
      >
        <span className="list-row__title">
          {item.name}
          {item.quantity > 1 ? <span className="dim"> ×{item.quantity}</span> : null}
        </span>
        <span className="list-row__meta">
          {item.status !== 'active' ? (
            <span className="badge">{statusLabel(item.status)}</span>
          ) : null}
          <ExpiryBadge expiresAt={item.expiresAt} />
          <span className="truncate">{metaParts.join(' · ')}</span>
        </span>
      </button>

      {extra}

      {actions ? <div className="list-row__actions">{actions}</div> : null}
    </li>
  )
}
