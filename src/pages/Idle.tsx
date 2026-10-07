import { useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { DiscardPickerDialog } from '../components/DiscardPickerDialog'
import { ItemRow } from '../components/ItemRow'
import { IconChevronRight, IconTrash } from '../components/ui/icons'
import { Button, EmptyState } from '../components/ui/primitives'
import { daysSince, formatDays, percent } from '../lib/format'
import { NEUTRAL_GROUP_COLOR, assignTreeColors, topLevelColorMap } from '../lib/palette'
import { useT } from '../i18n'
import {
  computeStats,
  groupItemsTree,
  liveItems,
  sortByIdleDuration,
  type ItemGroupNode,
} from '../store/selectors'
import { useAppStore } from '../store/useAppStore'
import type { Item } from '../types'

export function Idle() {
  const navigate = useNavigate()
  const data = useAppStore((s) => s.data)
  const derived = useAppStore((s) => s.derived)
  const ui = useAppStore((s) => s.ui)
  const setGroupExpanded = useAppStore((s) => s.setGroupExpanded)
  const setIdle = useAppStore((s) => s.setIdle)
  const batchSetStatus = useAppStore((s) => s.batchSetStatus)
  const notify = useAppStore((s) => s.notify)

  // useT() 一方面是拿 t/tc，另一方面是**订阅语言**：语言一换这个页面就会重新渲染。
  // lang 还要进分组那个 useMemo 的依赖 —— 分组的标签（「未分类」）是在 selectors
  // 里现查词典得到的，不显式依赖 lang 的话，切语言后它会停在旧语言上。
  const { t, tc, lang } = useT()

  const [selected, setSelected] = useState<Set<string>>(new Set())
  /*
   * 删除走勾选列表（issue 3），不再是「点一下就走」。
   * preselect 是批量删除时把已经勾好的那些带进去。
   */
  const [discardPick, setDiscardPick] = useState<{ preselect: string[] } | null>(null)

  const stats = useMemo(() => computeStats(data), [data])
  const idleItems = useMemo(
    () => sortByIdleDuration(data.items.filter((i) => i.status === 'idle')),
    [data.items],
  )

  /*
   * 按分类分组。
   *
   * 为什么闲置页也要分组：这一页的用法是「从头看一遍，挑该处理的」，
   * 而闲置的东西是**散的** —— 衣服、电子、药品混在一条按天数排的长队里，
   * 看的人得自己一件件回想「这堆是什么」。
   * 按分类分成块之后，一眼能看出「原来闲置的主要是电子产品」，
   * 而「越久越靠前」这条规矩并没有丢，它变成了**组内**的排序。
   */
  const groups = useMemo(
    () => groupItemsTree(idleItems, 'category', derived),
    [idleItems, derived, lang],
  )

  /*
   * 顶层分类的配色表取**完整**的顶层列表（含一个闲置的都没有的分类），
   * 和物品列表页、概览图表共用同一份规范 key 列表 ——
   * 各处都按同一份算，颜色才必然一致（否则「列表里是蓝的、图表里是绿的」）。
   */
  const topColors = useMemo(
    () =>
      topLevelColorMap(derived.categoryFlat.filter((n) => n.depth === 0).map((n) => n.node.id)),
    [derived],
  )

  // 子级继承所属顶层的色相并逐层变淡：颜色只回答「这是哪一大块」
  const groupColors = useMemo(() => assignTreeColors(groups, topColors), [groups, topColors])

  const liveCount = useMemo(() => liveItems(data).length, [data])
  const idlePercent = percent(stats.idleCount, liveCount)

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectedIds = useMemo(() => [...selected], [selected])
  const allSelected = idleItems.length > 0 && idleItems.every((i) => selected.has(i.id))

  const oldestDays = idleItems.length
    ? daysSince(idleItems[0].idleAt ?? idleItems[0].updatedAt)
    : 0

  /**
   * 这一页的分组**默认全部展开**。
   *
   * 和物品列表页正好相反（那边一级标题默认折叠，因为「分类一多，全铺开看不出结构」）。
   * 这里的清单本来就是从全部物品里挑出来的一小部分，而且这一页存在的意义就是
   * 「从头看一遍、能扔的挑出来」—— 把东西折叠起来正好和这个目的作对。
   * 用户点过的折叠照样尊重（和列表页共用同一份展开状态，同一个分类在两页里是一回事）。
   */
  const isExpanded = (key: string) => !ui.collapsedGroups.includes(key)

  /** 一行闲置物品：天数徽章 + 「改回在用 / 已处理」两个动作 */
  const renderIdleRow = (item: Item) => {
    const days = daysSince(item.idleAt ?? item.updatedAt)
    return (
      <ItemRow
        key={item.id}
        item={item}
        ctx={derived}
        selectable
        selected={selected.has(item.id)}
        onToggleSelect={toggleSelect}
        onOpen={(id) => navigate(`/items/${id}`)}
        extra={
          <span className={`idle-row__days${days >= 180 ? ' idle-row__days--long' : ''}`}>
            {formatDays(days)}
          </span>
        }
        actions={
          <>
            <Button size="sm" variant="ghost" onClick={() => setIdle(item.id, false)}>
              {t('idle.markActive')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              title={t('idle.discardTitle')}
              /*
               * 单击直接进回收站 —— 在这一行上点垃圾桶，指的就是这一件，
               * 没有歧义。弹一张全库清单让用户重选一遍纯属折腾。
               * 勾选列表留给「批量处理」（上面那条工具栏）。
               */
              onClick={() => {
                batchSetStatus([item.id], 'discarded')
                notify(t('idle.discardedToast'), 'success')
              }}
            >
              <IconTrash size={14} />
            </Button>
          </>
        }
      />
    )
  }

  /**
   * 递归渲染一个分类分组。
   *
   * 结构和物品列表页共用同一套样式（`.item-group` / `.group-head`），
   * 所以两页的分组看起来是一回事：父级那条彩色竖条把整棵子树括起来，
   * 子分类缩进一层、颜色淡一档。
   */
  const renderGroup = (node: ItemGroupNode, depth: number): ReactNode => {
    const expanded = isExpanded(node.key)
    const color = groupColors.get(node.key) ?? NEUTRAL_GROUP_COLOR

    return (
      <div
        key={node.key}
        className={`item-group${depth > 0 ? ' item-group--nested' : ''}`}
        style={{ borderLeftColor: color.bar }}
      >
        <button
          type="button"
          className="group-head"
          style={{ background: color.soft }}
          onClick={() => setGroupExpanded(node.key, !expanded)}
          aria-expanded={expanded}
        >
          <span className={`group-head__caret${expanded ? ' is-open' : ''}`}>
            <IconChevronRight size={10} />
          </span>
          <span className="group-head__dot" style={{ background: color.bar }} />
          <span className="group-head__label" style={{ color: color.text }}>
            {node.label}
          </span>
          <span className="group-head__count numeric">{tc(node.total, 'format.countItems')}</span>
          <span className="group-head__line" style={{ background: color.line }} />
        </button>

        {expanded ? (
          <div className="item-group__body">
            {/* 先列子分类（结构），再列直接挂在这一层的东西 */}
            {node.children.length > 0 ? (
              <div className="item-group__children">
                {node.children.map((child) => renderGroup(child, depth + 1))}
              </div>
            ) : null}

            {node.items.length > 0 ? (
              <ul className="list item-group__list">{node.items.map(renderIdleRow)}</ul>
            ) : null}
          </div>
        ) : null}
      </div>
    )
  }

  if (idleItems.length === 0) {
    return (
      <>
        <div className="page-header">
          <div>
            <div className="page-header__title">{t('nav.titleIdle')}</div>
            <div className="page-header__sub">{t('idle.subtitleEmpty')}</div>
          </div>
        </div>
        <EmptyState
          title={t('idle.emptyTitle')}
          hint={
            <>
              {t('idle.emptyHintFirst')}
              <br />
              {t('idle.emptyHintSecond')}
            </>
          }
          action={<Button onClick={() => navigate('/items')}>{t('idle.emptyAction')}</Button>}
        />
      </>
    )
  }

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-header__title">{t('nav.titleIdle')}</div>
          <div className="page-header__sub">{t('idle.subtitle')}</div>
        </div>
      </div>

      <div className="idle-highlight" style={{ marginBottom: 'var(--gap-5)' }}>
        <div>
          <div className="idle-highlight__value">{idleItems.length}</div>
          <div className="tiny dim">{t('idle.highlightLabel')}</div>
        </div>
        <div className="idle-highlight__text">
          {oldestDays > 0
            ? t('idle.shareOldest', { percent: idlePercent, days: formatDays(oldestDays) })
            : t('idle.share', { percent: idlePercent })}
          <br />
          {t('idle.hint')}
        </div>
      </div>

      <div className="row-between wrap" style={{ marginBottom: 'var(--gap-3)' }}>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={() => setSelected(allSelected ? new Set() : new Set(idleItems.map((i) => i.id)))}
          />
          <span className="small muted">{t('idle.selectAll', { count: idleItems.length })}</span>
        </label>

        {selected.size > 0 ? (
          <div className="row">
            <span className="small muted">{t('idle.selectedCount', { count: selected.size })}</span>
            <Button
              size="sm"
              onClick={() => {
                batchSetStatus(selectedIds, 'active')
                notify(t('idle.markedActiveToast', { count: selectedIds.length }), 'success')
                setSelected(new Set())
              }}
            >
              {t('idle.markActive')}
            </Button>
            <Button size="sm" onClick={() => setDiscardPick({ preselect: selectedIds })}>
              {t('idle.discard')}
            </Button>
          </div>
        ) : null}
      </div>

      {groups.map((node) => renderGroup(node, 0))}

      {/* 删除前的勾选（issue 3）—— **只有批量处理走这里** */}
      <DiscardPickerDialog
        open={discardPick !== null}
        onClose={() => setDiscardPick(null)}
        items={idleItems}
        ctx={derived}
        preselect={discardPick?.preselect}
        hint={tc(idleItems.length, 'idle.discardPickerHint')}
        onConfirm={(ids) => {
          batchSetStatus(ids, 'discarded')
          notify(t('idle.handledToast', { count: ids.length }), 'success')
          setSelected(new Set())
          setDiscardPick(null)
        }}
      />
    </>
  )
}
