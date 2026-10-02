import type { ReactNode } from 'react'
import type { Item } from '../types'
import type { DerivedContext } from '../store/selectors'
import { STATUS_LABEL } from '../store/selectors'

interface ItemRowProps {
  item: Item
  ctx: DerivedContext
  /** 显示左侧复选框 */
  selectable?: boolean
  selected?: boolean
  onToggleSelect?: (id: string) => void
  /** 点击主区域时触发（通常是进入编辑） */
  onOpen?: (id: string) => void
  /** 插入在数量之后的额外内容（如闲置天数） */
  extra?: ReactNode
  /** 行尾操作按钮 */
  actions?: ReactNode
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
    : '未归位'

  const categoryNames = item.categoryIds
    .map((id) => ctx.categoryById.get(id)?.name)
    .filter((n): n is string => Boolean(n))

  const metaParts: string[] = [locationText]
  if (categoryNames.length > 0) metaParts.push(categoryNames.join('、'))
  if (item.tags.length > 0) metaParts.push(item.tags.map((t) => `#${t}`).join(' '))

  return (
    <li className={`list-row${selected ? ' list-row--selected' : ''}`}>
      {selectable ? (
        <input
          type="checkbox"
          className="row-checkbox"
          checked={selected}
          aria-label={`选择「${item.name}」`}
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
            <span className="badge">{STATUS_LABEL[item.status]}</span>
          ) : null}
          <span className="truncate">{metaParts.join(' · ')}</span>
        </span>
      </button>

      {extra}

      {actions ? <div className="list-row__actions">{actions}</div> : null}
    </li>
  )
}
