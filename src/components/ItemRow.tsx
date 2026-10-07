import type { DragEvent, ReactNode } from 'react'
import type { Item } from '../types'
import type { DerivedContext } from '../store/selectors'
import { statusLabel } from '../store/selectors'
import { daysUntilExpiry } from '../lib/expiry'
import { useAppStore } from '../store/useAppStore'
import { t, tc } from '../i18n'
import { IconGrip } from './ui/icons'

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

  /*
   * 拖拽（目前只有位置页用：把物品拖到左边的位置上改归位）。
   *
   * 这里只负责「能被拎起来」和画个把手，**不负责** 拖的是什么、能放到哪儿 ——
   * 那是页面的事。行组件收一个 onDragStart，往里塞什么数据、什么 MIME 类型
   * 由调用方决定，这样别处想复用这套拖拽也不用改这里。
   */
  draggable?: boolean
  /** 正被拖着的那一行：淡下去，好让人看清手上的东西是从哪儿拿的 */
  dragging?: boolean
  onDragStart?: (event: DragEvent<HTMLLIElement>) => void
  onDragEnd?: (event: DragEvent<HTMLLIElement>) => void
  /** 把手的悬停提示（也是这个把手唯一的说明） */
  dragHandleTitle?: string
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
  draggable = false,
  dragging = false,
  onDragStart,
  onDragEnd,
  dragHandleTitle,
}: ItemRowProps) {
  /*
   * 物品行里的位置就是**普通文字**（用户明确要求）。
   *
   * 之前这里试过给每一层目录上色，用户看了以后说：
   * 「我只是要展示的目录层级颜色改变，正常物品那里正常展示颜色就可以了。」
   * 说得对 —— 物品行是「读一条记录」，位置在这里只是一个次要信息，
   * 给它上色等于让每条记录的元信息都在抢注意力。颜色留给真正的目录树。
   */
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
    <li
      className={`list-row${selected ? ' list-row--selected' : ''}${
        dragging ? ' list-row--dragging' : ''
      }`}
      // 不拖的时候**不写** draggable：写 false 是「明确声明不可拖」，
      // 而这里想要的是「没这回事」，属性干脆别出现。
      draggable={draggable || undefined}
      onDragStart={draggable ? onDragStart : undefined}
      onDragEnd={draggable ? onDragEnd : undefined}
    >
      {/*
        把手是「这里能拖」的信号。它自己也带 draggable，为的是兜住一条路：
        整行虽然可拖，但行里那个 <button> 在个别浏览器上会把起拖吃掉，
        而按住把手往下拖一定起得来。
      */}
      {draggable ? (
        <span className="list-row__grip" draggable title={dragHandleTitle}>
          <IconGrip size={14} />
        </span>
      ) : null}

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
            /*
              状态徽章带上语义色。
              以前三种状态是同一档灰边徽章，扫一眼分不出「闲置」和「备用」——
              而这两个词在业务上正好相反（一个劝你处理，一个是你特意留的）。
              颜色跟着语义走，能少读一次字。用色和 lib/palette.ts 那套状态色一致。
            */
            <span className={`badge badge--status-${item.status}`}>{statusLabel(item.status)}</span>
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
