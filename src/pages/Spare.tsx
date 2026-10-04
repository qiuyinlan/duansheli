import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { ItemRow } from '../components/ItemRow'
import { LocationPicker } from '../components/pickers'
import { IconTrash } from '../components/ui/icons'
import { Button, ConfirmDialog, EmptyState, Modal } from '../components/ui/primitives'
import { useT, type DictKey } from '../i18n'
import { NEUTRAL_GROUP_COLOR, assignTreeColors, topLevelColorMap } from '../lib/palette'
import {
  groupAndSort,
  spareItems,
  totalUnits,
  type ItemGroupNode,
} from '../store/selectors'
import { useAppStore } from '../store/useAppStore'
import type { Item } from '../types'

/**
 * 备用页 —— 囤着等用的东西。
 *
 * ── 和闲置页的分工（别把这两页混起来）────────────────────────────
 * 闲置页在**推动你处理**：它算「闲置占比」，说「闲置越久越说明它不该留在这里」。
 * 这一页恰恰相反 —— 备用是你**特意留着**的，放两年也完全正常。所以这里：
 *   · 不算闲置占比，不进任何「该处理了」的统计
 *   · 只有两个真动作：**取用**（拿出来用）和**舍弃**（真的不要了）
 *
 * ── 为什么按位置分组，而且**一律展开** ────────────────────────────
 * 备用基本都是收在某个盒子里的，按位置分组后页面上就长成
 * 「药箱 3 种 / 7 件」，和真实的柜子对得上。
 *
 * 物品列表那边树形分组默认是**折叠**的（分类一多全铺开就看不出结构了），
 * 但这一页不折叠：备用本来就少（是「囤的几样」不是「全部家当」），
 * 折叠只会让每次进来都多点一下。所以这里不做折叠 —— 也不去动
 * `ui.collapsedGroups`，免得和物品列表那边的展开状态互相干扰。
 */

/** 拆失败的原因 → 词典 key。写成表而不是拼字符串，拼错了编译期就挡住。 */
const SPLIT_FAILURE_KEY: Record<'notFound' | 'discarded' | 'tooFew', DictKey> = {
  notFound: 'spare.splitNotFound',
  discarded: 'spare.splitDiscarded',
  tooFew: 'spare.splitTooFew',
}

/** 一个分组（含子位置）里一共有几件 */
function unitsUnder(node: ItemGroupNode): number {
  const own = totalUnits(node.items)
  return node.children.reduce((sum, child) => sum + unitsUnder(child), own)
}

export function Spare() {
  const navigate = useNavigate()
  const data = useAppStore((s) => s.data)
  const derived = useAppStore((s) => s.derived)
  const takeSpareOne = useAppStore((s) => s.takeSpareOne)
  const batchSetStatus = useAppStore((s) => s.batchSetStatus)
  const notify = useAppStore((s) => s.notify)

  const { t, tc } = useT()

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmOpen, setConfirmOpen] = useState(false)

  const spares = useMemo(() => spareItems(data), [data])
  const units = useMemo(() => totalUnits(spares), [spares])

  /*
   * 复用物品列表那套分组（按位置、树形、同一份顶层配色）：
   * 层级、颜色、虚拟的「未归位」分组全都一致，用户不用学第二套东西。
   */
  const groups = useMemo(
    () => groupAndSort(spares, 'location', 'name', 'asc', derived),
    [spares, derived],
  )

  const groupColors = useMemo(
    () =>
      assignTreeColors(
        groups,
        topLevelColorMap(derived.flat.filter((n) => n.depth === 0).map((n) => n.node.id)),
      ),
    [groups, derived],
  )

  const selectedIds = useMemo(() => [...selected], [selected])

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

 /** 取用一件：整条数量 −1；只剩一件时整条变成「在用」 */
  const takeOne = (id: string) => {
    const result = takeSpareOne(id)

    if (result.becameActive) {
      notify(t('spare.tookLastToast'), 'success')
      return
    }
    if (result.remaining > 0) {
      notify(tc(result.remaining, 'spare.tookOneToast'), 'success')
      return
    }
    // 既没变成在用、也没剩 —— 说明这条压根不是备用（数据被改过，或者点错了）
    notify(t('spare.tookNoneToast'), 'error')
  }

  const discard = (ids: string[]) => {
    batchSetStatus(ids, 'discarded')
    notify(tc(ids.length, 'spare.discardDoneToast'), 'success')
  }

  if (spares.length === 0) {
    return (
      <>
        <div className="page-header">
          <div>
            <div className="page-header__title">{t('nav.titleSpare')}</div>
            <div className="page-header__sub">{t('spare.subtitleEmpty')}</div>
          </div>
        </div>
        <EmptyState
          title={t('spare.emptyTitle')}
          hint={
            <>
              {t('spare.emptyHintFirst')}
              <br />
              {t('spare.emptyHintSecond')}
            </>
          }
          action={<Button onClick={() => navigate('/items')}>{t('spare.emptyAction')}</Button>}
        />
      </>
    )
  }

  const renderGroup = (node: ItemGroupNode, depth: number): ReactNode => {
    const color = groupColors.get(node.key) ?? NEUTRAL_GROUP_COLOR

    return (
      <div
        key={node.key}
        className={`item-group${depth > 0 ? ' item-group--nested' : ''}`}
        style={{ borderLeftColor: color.bar }}
      >
        <div className="group-head" style={{ background: color.soft }}>
          <span className="group-head__dot" style={{ background: color.bar }} />
          <span className="group-head__label" style={{ color: color.text }}>
            {node.label}
          </span>
          {/* 这一页真正要紧的是「几件」，不是「几种」——所以这里显示件数合计 */}
          <span className="group-head__count numeric">
            {t('spare.highlightUnits', { count: unitsUnder(node) })}
          </span>
          <span className="group-head__line" style={{ background: color.line }} />
        </div>

        <div className="item-group__body">
          {node.children.length > 0 ? (
            <div className="item-group__children">
              {node.children.map((child) => renderGroup(child, depth + 1))}
            </div>
          ) : null}

          {node.items.length > 0 ? (
            <ul className="list item-group__list">
              {node.items.map((item) => (
                <ItemRow
                  key={`${node.key}-${item.id}`}
                  item={item}
                  ctx={derived}
                  selectable
                  selected={selected.has(item.id)}
                  onToggleSelect={toggleSelect}
                  onOpen={(id) => navigate(`/items/${id}`)}
                  extra={
                    <span className="badge">{tc(item.quantity, 'spare.spareCount')}</span>
                  }
                  actions={
                    <>
                      <Button
                        size="sm"
                        title={t('spare.takeOneTitle')}
                        onClick={() => takeOne(item.id)}
                      >
                        {t('spare.takeOne')}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        title={t('spare.discardTitle')}
                        onClick={() => discard([item.id])}
                      >
                        <IconTrash size={14} />
                      </Button>
                    </>
                  }
                />
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-header__title">{t('nav.titleSpare')}</div>
          <div className="page-header__sub">{t('spare.subtitle')}</div>
        </div>
      </div>

      {/*
        顶部这块刻意**不说**「闲置占比」那一套 —— 备用不是待处理的东西，
        引一个「该处理了」的气氛进来就全错了。只说囤了几样、共几件。
      */}
      <div className="idle-highlight" style={{ marginBottom: 'var(--gap-5)' }}>
        <div>
          <div className="idle-highlight__value">{spares.length}</div>
          <div className="tiny dim">{t('spare.highlightKinds')}</div>
        </div>
        <div className="idle-highlight__text">
          {t('spare.highlightUnits', { count: units })}
          <br />
          {t('spare.hint')}
        </div>
      </div>

      <div className="row-between wrap" style={{ marginBottom: 'var(--gap-3)' }}>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={selected.size === spares.length}
            onChange={() =>
              setSelected(
                selected.size === spares.length ? new Set() : new Set(spares.map((i) => i.id)),
              )
            }
          />
          <span className="small muted">{t('spare.selectAll', { count: spares.length })}</span>
        </label>

        {selected.size > 0 ? (
          <div className="row">
            <span className="small muted">
              {t('spare.selectedCount', { count: selected.size })}
            </span>
            <Button
              size="sm"
              title={t('spare.takeAllTitle')}
              onClick={() => {
                batchSetStatus(selectedIds, 'active')
                notify(tc(selectedIds.length, 'spare.takeAllToast'), 'success')
                setSelected(new Set())
              }}
            >
              {t('spare.takeAll')}
            </Button>
            <Button size="sm" onClick={() => setConfirmOpen(true)}>
              {t('spare.discardSelected')}
            </Button>
          </div>
        ) : null}
      </div>

      {groups.map((node) => renderGroup(node, 0))}

      <ConfirmDialog
        open={confirmOpen}
        title={t('spare.discardConfirmTitle')}
        danger
        confirmLabel={t('spare.discardSelected')}
        message={t('spare.discardConfirmBody', { count: selectedIds.length })}
        onConfirm={() => {
          discard(selectedIds)
          setSelected(new Set())
          setConfirmOpen(false)
        }}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  )
}

/* ------------------------------------------------------------------ */
/* 拆出备用                                                            */
/* ------------------------------------------------------------------ */

/**
 * 「买多了 → 拆出备用」。
 *
 * 这是这个功能最要紧的那个入口：一个东西买了 3 件，1 件在用、2 件收起来，
 * 靠这个动作一步完成 —— 而不是让用户自己改数量、自己再建一条。
 *
 * 三个刻意的设计：
 *   · **原处至少留 1 件**。全拆走就不叫「拆出备用」了，那是「整条变成备用」，
 *     是「标记备用」那个按钮的事。上限因此是「数量 − 1」。
 *   · **数量用 − / + 按钮，不用数字输入框**。一是手机上更好按，
 *     二是这个项目在 jsdom 里**没法给输入框派事件**（见 tests/dom.ts），
 *     用按钮才能把这条路径真的测起来。
 *   · **位置会记住**。备用基本都是收在同一个盒子里的，每次重选纯属白费事。
 */
export function SplitToSpareDialog({
  open,
  itemIds,
  locationCounts,
  onClose,
}: {
  open: boolean
  itemIds: string[]
  /** 位置选择器里每个位置的数量提示 —— 和物品列表那边的数字保持一致 */
  locationCounts: Map<string, number>
  onClose: () => void
}) {
  const { t, tc } = useT()
  const data = useAppStore((s) => s.data)
  const derived = useAppStore((s) => s.derived)
  const ui = useAppStore((s) => s.ui)
  const setUi = useAppStore((s) => s.setUi)
  const splitToSpare = useAppStore((s) => s.splitToSpare)
  const notify = useAppStore((s) => s.notify)

  const [counts, setCounts] = useState<Record<string, number>>({})
  /** undefined = 还没动过，用记住的那个盒子 */
  const [locationOverride, setLocationOverride] = useState<string | null | undefined>(undefined)
  const [pickerOpen, setPickerOpen] = useState(false)

  // 每次打开都重置。只依赖 open，免得父组件每次渲染换一个 itemIds 数组
  // 就把用户刚调好的数量冲掉。
  useEffect(() => {
    if (!open) return
    setCounts({})
    setLocationOverride(undefined)
    setPickerOpen(false)
  }, [open])

  const locationId = locationOverride === undefined ? ui.spareLocationId : locationOverride

  const items = useMemo(
    () =>
      itemIds
        .map((id) => data.items.find((existing) => existing.id === id))
        .filter((existing): existing is Item => existing !== undefined),
    [itemIds, data.items],
  )

  /*
   * 只有「数量 > 1 且没被舍弃」的才拆得动。
   * 剩下那些不是报错，而是**没得拆** —— 弹窗里如实说明，别让用户以为按钮坏了。
   */
  const splittable = items.filter((item) => item.status !== 'discarded' && item.quantity > 1)

  const maxFor = (item: Item) => item.quantity - 1
  const countFor = (item: Item) => Math.max(1, Math.min(counts[item.id] ?? 1, maxFor(item)))
  const total = splittable.reduce((sum, item) => sum + countFor(item), 0)

  const step = (item: Item, delta: number) => {
    setCounts((prev) => ({
      ...prev,
      [item.id]: Math.max(1, Math.min((prev[item.id] ?? 1) + delta, maxFor(item))),
    }))
  }

  const confirm = () => {
    if (splittable.length === 0) return

    let created = 0
    let units = 0
    let firstFailure: string | null = null

    for (const item of splittable) {
      const result = splitToSpare(item.id, countFor(item), locationId)
      if (result.ok) {
        created += 1
        units += result.movedCount
      } else if (firstFailure === null) {
        firstFailure = t(SPLIT_FAILURE_KEY[result.reason])
      }
    }

    if (created === 0) {
      notify(firstFailure ?? t('spare.splitNoSpareToMake'), 'error')
      return
    }

    // 记住这次的盒子，下次自动填上
    setUi({ spareLocationId: locationId })
    const where = locationId ? derived.index.pathString(locationId, ' / ') : ''
    notify(
      where === ''
        ? tc(units, 'spare.splitToastNoWhere')
        : tc(units, 'spare.splitToast', { where }),
      'success',
    )
    onClose()
  }

  return (
    <>
      <Modal
        open={open}
        title={t('spare.splitTitle')}
        onClose={onClose}
        maxWidth={520}
        footer={
          <>
            <Button onClick={onClose}>{t('common.cancel')}</Button>
            <Button variant="primary" disabled={splittable.length === 0} onClick={confirm}>
              {t('spare.splitConfirm', { count: total })}
            </Button>
          </>
        }
      >
        <div className="stack">
          <div className="small muted">
            {t('spare.splitDescBefore')}
            <strong>{t('spare.splitDescStrong')}</strong>
            {t('spare.splitDescAfter')}
          </div>

          {splittable.length === 0 ? (
            <div className="dim small">{t('spare.splitNoSpareToMake')}</div>
          ) : (
            <div className="stack-sm">
              {splittable.map((item) => (
                <div key={item.id} className="row-between wrap split-row">
                  <span className="grow truncate">
                    {item.name}
                    <span className="dim small">
                      {' '}
                      {t('spare.splitAvailable', {
                        count: item.quantity,
                        max: maxFor(item),
                      })}
                    </span>
                  </span>
                  <div className="row">
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label="-"
                      disabled={countFor(item) <= 1}
                      onClick={() => step(item, -1)}
                    >
                      −
                    </Button>
                    <span className="numeric split-row__count">{countFor(item)}</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label="+"
                      disabled={countFor(item) >= maxFor(item)}
                      onClick={() => step(item, 1)}
                    >
                      +
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="stack-sm">
            <div className="field__label">{t('spare.splitWhere')}</div>
            <Button size="sm" onClick={() => setPickerOpen(true)}>
              {locationId
                ? derived.index.pathString(locationId, ' / ')
                : t('status.unassigned')}
            </Button>
            <div className="tiny dim">{t('spare.splitWhereHint')}</div>
          </div>
        </div>
      </Modal>

      <LocationPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        value={locationId}
        onSelect={(id) => {
          setLocationOverride(id)
          setPickerOpen(false)
        }}
        ctx={derived}
        counts={locationCounts}
      />
    </>
  )
}
