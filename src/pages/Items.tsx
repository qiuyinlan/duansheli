import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { FilterPanel } from '../components/FilterPanel'
import { ItemRow } from '../components/ItemRow'
import { AddToCollectionDialog } from './Collections'
import { CreateChecklistDialog } from './Checklists'
import { SplitToSpareDialog } from './Spare'
import { LocationPicker, TagInput } from '../components/pickers'
import { IconChevronRight, IconIdle, IconSpare, IconTrash } from '../components/ui/icons'
import { Button, ConfirmDialog, EmptyState, Modal, SearchInput } from '../components/ui/primitives'
import {
  EMPTY_FILTER,
  countByLocationIncludingDescendants,
  filterItems,
  groupAndSort,
  isGroupExpanded,
  labelForExpiryState,
  liveItems,
  statusLabel,
  type ItemFilter,
  type ItemGroupNode,
} from '../store/selectors'
import { useAppStore } from '../store/useAppStore'
import { assignTreeColors, topLevelColorMap, NEUTRAL_GROUP_COLOR } from '../lib/palette'
import type { GroupBy, ItemStatus, SortBy, SortDir } from '../types'
import { UNASSIGNED_ID } from '../types'
import type { DictKey } from '../i18n'
import { useT } from '../i18n'

/* ------------------------------------------------------------------ */
/* URL 参数 → 筛选条件                                                 */
/* ------------------------------------------------------------------ */

/**
 * 分组 / 排序的备选值。
 *
 * 存的是**词典 key**，不是显示文字：这两个数组是模块级常量，
 * 在模块加载时调用 t() 会把当时的语言冻进去，之后切语言它们不变
 * （docs/i18n-约定.md 第 3 条说的就是这件事）。
 */
const GROUP_OPTIONS: Array<{ value: GroupBy; labelKey: DictKey }> = [
  { value: 'category', labelKey: 'items.groupCategory' },
  { value: 'location', labelKey: 'items.groupLocation' },
  { value: 'tag', labelKey: 'items.groupTag' },
  { value: 'status', labelKey: 'items.groupStatus' },
  { value: 'expiry', labelKey: 'expiry.filterLabel' },
  { value: 'none', labelKey: 'items.groupNone' },
]

const SORT_OPTIONS: Array<{ value: SortBy; labelKey: DictKey }> = [
  { value: 'updated', labelKey: 'items.sortUpdated' },
  { value: 'created', labelKey: 'items.sortCreated' },
  { value: 'name', labelKey: 'items.sortName' },
  { value: 'quantity', labelKey: 'items.sortQuantity' },
  { value: 'location', labelKey: 'items.sortLocation' },
  { value: 'expiry', labelKey: 'expiry.sortLabel' },
]

const VALID_STATUSES: ItemStatus[] = ['active', 'idle', 'discarded']

function splitParam(params: URLSearchParams, key: string): string[] {
  const raw = params.get(key)
  if (!raw) return []
  return raw.split(',').map((s) => s.trim()).filter(Boolean)
}

function readParams(params: URLSearchParams): { filter: ItemFilter; groupBy: GroupBy | null } {
  const groupRaw = params.get('group')
  const groupBy = GROUP_OPTIONS.some((o) => o.value === groupRaw)
    ? (groupRaw as GroupBy)
    : null

  const statuses = splitParam(params, 'status').filter((s): s is ItemStatus =>
    VALID_STATUSES.includes(s as ItemStatus),
  )

  return {
    filter: {
      ...EMPTY_FILTER,
      search: params.get('q') ?? '',
      categoryIds: splitParam(params, 'cat'),
      locationIds: splitParam(params, 'loc'),
      statuses,
      tags: splitParam(params, 'tag'),
      attrFilters: [],
      includeDescendants: true,
    },
    groupBy,
  }
}

/* ------------------------------------------------------------------ */
/* 页面                                                                */
/* ------------------------------------------------------------------ */

export function Items() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const data = useAppStore((s) => s.data)
  const derived = useAppStore((s) => s.derived)
  const ui = useAppStore((s) => s.ui)
  const setUi = useAppStore((s) => s.setUi)
  const setGroupExpanded = useAppStore((s) => s.setGroupExpanded)
  const setIdle = useAppStore((s) => s.setIdle)
  const markDiscarded = useAppStore((s) => s.markDiscarded)
  const batchSetStatus = useAppStore((s) => s.batchSetStatus)
  const batchMoveToLocation = useAppStore((s) => s.batchMoveToLocation)
  const batchAddTag = useAppStore((s) => s.batchAddTag)
  const addItemsToCollection = useAppStore((s) => s.addItemsToCollection)
  const createChecklist = useAppStore((s) => s.createChecklist)
  const notify = useAppStore((s) => s.notify)

  // useT() 一方面给 t/tc，另一方面**订阅语言**：语言一换这个组件就重渲染。
  // lang 还要进下面各个 useMemo 的依赖 —— 分组标题是 selectors 里查表得到的，
  // 不显式依赖 lang 的话切语言后分组标题会停在旧语言。
  const { t, tc, lang } = useT()

  const [filter, setFilter] = useState<ItemFilter>(EMPTY_FILTER)
  const [groupBy, setGroupBy] = useState<GroupBy>(ui.groupBy)
  const [sortBy, setSortBy] = useState<SortBy>(ui.sortBy)
  const [sortDir, setSortDir] = useState<SortDir>(ui.sortDir)

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [filterOpen, setFilterOpen] = useState(false)
  const [moveOpen, setMoveOpen] = useState(false)
  const [tagOpen, setTagOpen] = useState(false)
  const [batchTagDraft, setBatchTagDraft] = useState<string[]>([])
  const [collectionOpen, setCollectionOpen] = useState(false)
  const [checklistOpen, setChecklistOpen] = useState(false)
  const [splitOpen, setSplitOpen] = useState(false)
  const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false)

  // URL 是「从别处跳进来」时的唯一真源；之后再手动改筛选不会写回 URL，
  // 所以这里不会和用户的输入互相打架。
  useEffect(() => {
    const parsed = readParams(searchParams)
    setFilter(parsed.filter)
    if (parsed.groupBy) setGroupBy(parsed.groupBy)
  }, [searchParams])

  // 筛选条件变了，之前选中的条目可能已经不在列表里，清空更不容易误操作
  useEffect(() => {
    setSelected(new Set())
  }, [filter, groupBy])

  const source = useMemo(
    () => (filter.statuses.includes('discarded') ? data.items : liveItems(data)),
    [data, filter.statuses],
  )

  /*
   * 「闲置」默认不展示（设置里可关，默认开）。
   *
   * 很多人把闲置当成「备用」在用 —— 特意留着的替换品，统一收在一个盒子里，
   * 平时不想在日常清单里看到。所以这里把它们摘掉。
   *
   * 三条边界：
   *   · **用户主动按状态筛选时不摘**。他点了「闲置」那个筛选，就是想看，
   *     这时候再藏就是跟他对着干
   *   · 只影响这一页。概览和位置页照常统计 ——
   *     否则「列表 30 件、概览 34 件」，他会开始怀疑哪个数字是真的
   *   · 摘掉多少必须显示出来（下面那条 hiddenIdleCount 的提示）
   */
  const idleHidden = ui.hideIdle && !filter.statuses.includes('idle')
  /*
   * 备用同理，但它是**独立的一个开关和一条提示**。
   * 「闲置别碍事」和「备用别碍事」是两种不同的判断，有人只想要其中一个；
   * 合成一条的话，关掉其中一个就没法只留另一个。
   */
  const spareHidden = ui.hideSpare && !filter.statuses.includes('spare')

  const visible = useMemo(
    () =>
      source.filter((item) => {
        if (idleHidden && item.status === 'idle') return false
        if (spareHidden && item.status === 'spare') return false
        return true
      }),
    [source, idleHidden, spareHidden],
  )

  const hiddenIdleCount = idleHidden
    ? source.filter((item) => item.status === 'idle').length
    : 0

  const hiddenSpareCount = spareHidden
    ? source.filter((item) => item.status === 'spare').length
    : 0

  const filtered = useMemo(
    () => filterItems(visible, filter, derived),
    [visible, filter, derived],
  )

  const groups = useMemo(
    () => groupAndSort(filtered, groupBy, sortBy, sortDir, derived),
    [filtered, groupBy, sortBy, sortDir, derived, lang],
  )

  const locationCounts = useMemo(
    () => countByLocationIncludingDescendants(liveItems(data), derived),
    [data, derived],
  )

  /*
   * 顶层分组的配色表。
   *
   * key 列表刻意取**完整的顶层节点**（含没有内容的），而不是「这次渲染出来的那些组」——
   * 因为避让规则依赖整个 key 列表，而概览图表只画有数量的分类。
   * 两边都按这份完整规范列表算，颜色才必然一致
   * （否则列表里只显示 3 个分类、图表显示 5 个，同一批 key 会算出不同结果）。
   */
  const topColors = useMemo(() => {
    if (groupBy === 'category') {
      return topLevelColorMap(
        derived.categoryFlat.filter((n) => n.depth === 0).map((n) => n.node.id),
      )
    }
    if (groupBy === 'location') {
      return topLevelColorMap(derived.flat.filter((n) => n.depth === 0).map((n) => n.node.id))
    }
    return undefined
  }, [groupBy, derived])

  // 分组配色：**只有顶层拿独立色相，子级继承所属顶层并逐层变淡**。
  //
  // 以前是给每个节点各自哈希，结果一个一级标题下面子分类各是各的颜色，
  // 一块里五彩斑斓 —— 颜色的作用本来是「把大块分开」，
  // 用在同一块的内部只会添乱。现在缩进表达层级、深浅表达远近、
  // 颜色只回答「这是哪一大块」。
  const groupColors = useMemo(
    () => assignTreeColors(groups, topColors),
    [groups, topColors],
  )

  const activeConditionCount =
    filter.categoryIds.length +
    filter.locationIds.length +
    filter.statuses.length +
    filter.expiryStates.length +
    filter.tags.length +
    filter.attrFilters.length

  const allVisibleIds = useMemo(() => filtered.map((i) => i.id), [filtered])
  const allSelected = allVisibleIds.length > 0 && allVisibleIds.every((id) => selected.has(id))

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectAll = () => {
    setSelected(allSelected ? new Set() : new Set(allVisibleIds))
  }

  const selectedIds = useMemo(() => [...selected], [selected])
  const tagSuggestions = useMemo(() => data.tags.map((tag) => tag.name), [data.tags])

  const changeGroupBy = (value: GroupBy) => {
    setGroupBy(value)
    setUi({ groupBy: value })
  }

  const changeSort = (value: SortBy, dir: SortDir) => {
    setSortBy(value)
    setSortDir(dir)
    setUi({ sortBy: value, sortDir: dir })
  }

  const runBatchStatus = (status: ItemStatus) => {
    batchSetStatus(selectedIds, status)
    notify(
      tc(selectedIds.length, 'items.batchStatus', { status: statusLabel(status) }),
      'success',
    )
    setSelected(new Set())
  }

  /* ---------------- 渲染 ---------------- */

  if (data.items.length === 0) {
    return (
      <>
        <div className="page-header">
          <div>
            <div className="page-header__title">{t('nav.titleItems')}</div>
          </div>
        </div>
        <EmptyState
          title={t('items.emptyTitle')}
          hint={t('items.emptyHint')}
          action={
            <Button variant="primary" onClick={() => navigate('/items/new')}>
              {t('items.addItem')}
            </Button>
          }
        />
      </>
    )
  }

  /**
   * 递归渲染一个分组。
   *
   * 分类和位置是树，所以分组也一层层往下展开 ——
   * 默认只看到一级标题（分类一多，全铺开根本看不出结构），
   * 点开一层才看到子分类，子分类还能再点开。展开状态会记住。
   *
   * 子分组渲染在父分组的框里，父级那条彩色竖条就把整棵子树括起来了。
   */
  const renderGroupNode = (node: ItemGroupNode, depth: number): ReactNode => {
    const expanded = isGroupExpanded(
      node.key,
      node.children.length > 0,
      groupBy,
      ui.expandedGroups,
      ui.collapsedGroups,
    )
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
                {node.children.map((child) => renderGroupNode(child, depth + 1))}
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
                    actions={
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setIdle(item.id, item.status !== 'idle')}
                        >
                          {item.status === 'idle' ? t('items.backToActive') : t('items.markIdle')}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          title={t('items.discardTitle')}
                          onClick={() => {
                            markDiscarded(item.id)
                            notify(t('items.discardedToast'), 'success')
                          }}
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
        ) : null}
      </div>
    )
  }

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-header__title">{t('nav.titleItems')}</div>
          <div className="page-header__sub">
            {t('items.headerTotal')}{' '}
            <span className="numeric">{liveItems(data).length}</span>{' '}
            {t('items.headerBetween')} <span className="numeric">{filtered.length}</span>{' '}
            {t('items.headerAfter')}
          </div>
        </div>
        <div className="page-header__actions">
          <Button onClick={() => navigate('/ai')}>{t('items.aiEntry')}</Button>
          <Button variant="primary" onClick={() => navigate('/items/new')}>
            {t('items.addItem')}
          </Button>
        </div>
      </div>

      {/*
        隐藏提示条。
        只要有一件闲置被摘掉了就必须显示 —— 悄悄藏数据是最糟的结果：
        用户会以为「我明明录过那个，怎么不见了」，然后开始怀疑数据丢了。
        所以这里不只说藏了几件，还给一个直接去看的入口。
      */}
      {hiddenIdleCount > 0 ? (
        <div className="hidden-notice">
          <span className="hidden-notice__icon">
            <IconIdle size={14} />
          </span>
          <span className="grow small">{tc(hiddenIdleCount, 'items.idleHidden')}</span>
          <Button size="sm" variant="ghost" onClick={() => navigate('/idle')}>
            {t('items.idleHiddenGo')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setFilter((prev) => ({ ...prev, statuses: ['idle'] }))}
          >
            {t('items.idleHiddenShow')}
          </Button>
        </div>
      ) : null}

      {/*
        备用被收起时的提示。理由和上面闲置那条完全一样：
        光说「收了几件」不够，必须给出去哪看的入口 ——
        否则用户会以为「我明明录过那个，怎么不见了」。
      */}
      {hiddenSpareCount > 0 ? (
        <div className="hidden-notice">
          <span className="hidden-notice__icon">
            <IconSpare size={14} />
          </span>
          <span className="grow small">{tc(hiddenSpareCount, 'items.spareHidden')}</span>
          <Button size="sm" variant="ghost" onClick={() => navigate('/spare')}>
            {t('items.spareHiddenGo')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setFilter((prev) => ({ ...prev, statuses: ['spare'] }))}
          >
            {t('items.spareHiddenShow')}
          </Button>
        </div>
      ) : null}

      {/* ---------------- 工具条 ---------------- */}
      <div className="toolbar">
        <SearchInput
          value={filter.search}
          onValueChange={(value) => setFilter((prev) => ({ ...prev, search: value }))}
          placeholder={t('items.searchPlaceholder')}
          aria-label={t('items.searchAria')}
        />

        <div className="toolbar__row">
          <span className="toolbar__label">{t('items.groupLabel')}</span>
          <div className="segmented">
            {GROUP_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={`segmented__item${groupBy === opt.value ? ' is-active' : ''}`}
                onClick={() => changeGroupBy(opt.value)}
              >
                {t(opt.labelKey)}
              </button>
            ))}
          </div>
        </div>

        <div className="toolbar__row">
          <span className="toolbar__label">{t('items.sortLabel')}</span>
          <select
            className="select"
            style={{ width: 130 }}
            value={sortBy}
            onChange={(e) => changeSort(e.target.value as SortBy, sortDir)}
            aria-label={t('items.sortAria')}
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {t(opt.labelKey)}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            onClick={() => changeSort(sortBy, sortDir === 'asc' ? 'desc' : 'asc')}
            title={sortDir === 'asc' ? t('items.sortAscTitle') : t('items.sortDescTitle')}
          >
            {sortDir === 'asc' ? t('items.sortAsc') : t('items.sortDesc')}
          </Button>

          <span className="spacer" />

          <Button onClick={() => setFilterOpen(true)}>
            {activeConditionCount > 0
              ? t('items.filterWithCount', { count: activeConditionCount })
              : t('items.filter')}
          </Button>
        </div>

        {activeConditionCount > 0 ? (
          <div className="row wrap">
            {filter.categoryIds.map((id) => (
              <span key={`cat-${id}`} className="badge">
                {derived.categoryById.get(id)?.name ?? t('status.uncategorized')}
                <button
                  type="button"
                  className="chip__remove"
                  aria-label={t('items.removeCondition')}
                  onClick={() =>
                    setFilter((prev) => ({
                      ...prev,
                      categoryIds: prev.categoryIds.filter((x) => x !== id),
                    }))
                  }
                >
                  ×
                </button>
              </span>
            ))}
            {filter.locationIds.map((id) => (
              <span key={`loc-${id}`} className="badge">
                {id === UNASSIGNED_ID ? t('status.unassigned') : derived.index.pathString(id)}
                <button
                  type="button"
                  className="chip__remove"
                  aria-label={t('items.removeCondition')}
                  onClick={() =>
                    setFilter((prev) => ({
                      ...prev,
                      locationIds: prev.locationIds.filter((x) => x !== id),
                    }))
                  }
                >
                  ×
                </button>
              </span>
            ))}
            {filter.tags.map((tag) => (
              <span key={`tag-${tag}`} className="badge">
                {tag}
                <button
                  type="button"
                  className="chip__remove"
                  aria-label={t('items.removeCondition')}
                  onClick={() =>
                    setFilter((prev) => ({ ...prev, tags: prev.tags.filter((x) => x !== tag) }))
                  }
                >
                  ×
                </button>
              </span>
            ))}
            {filter.statuses.map((status) => (
              <span key={`status-${status}`} className="badge">
                {statusLabel(status)}
                <button
                  type="button"
                  className="chip__remove"
                  aria-label={t('items.removeCondition')}
                  onClick={() =>
                    setFilter((prev) => ({
                      ...prev,
                      statuses: prev.statuses.filter((x) => x !== status),
                    }))
                  }
                >
                  ×
                </button>
              </span>
            ))}
            {filter.expiryStates.map((state) => (
              <span key={`expiry-${state}`} className="badge">
                {labelForExpiryState(state, ui.expirySoonDays)}
                <button
                  type="button"
                  className="chip__remove"
                  aria-label={t('items.removeCondition')}
                  onClick={() =>
                    setFilter((prev) => ({
                      ...prev,
                      expiryStates: prev.expiryStates.filter((x) => x !== state),
                    }))
                  }
                >
                  ×
                </button>
              </span>
            ))}
            <button
              type="button"
              className="btn btn--sm btn--ghost"
              onClick={() => setFilter((prev) => ({ ...EMPTY_FILTER, search: prev.search }))}
            >
              {t('items.clearAll')}
            </button>
          </div>
        ) : null}
      </div>

      {/* ---------------- 批量操作条 ---------------- */}
      {selected.size > 0 ? (
        <div className="selection-bar">
          <span>{t('items.selectedCount', { count: selected.size })}</span>
          <span className="spacer" />
          <Button size="sm" onClick={() => runBatchStatus('idle')}>
            {t('items.markIdleBatch')}
          </Button>
          <Button size="sm" onClick={() => runBatchStatus('spare')}>
            {t('items.markSpareBatch')}
          </Button>
          <Button size="sm" onClick={() => setSplitOpen(true)}>
            {t('items.splitToSpare')}
          </Button>
          <Button size="sm" onClick={() => runBatchStatus('active')}>
            {t('items.backToActive')}
          </Button>
          <Button size="sm" onClick={() => setMoveOpen(true)}>
            {t('items.moveLocation')}
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setBatchTagDraft([])
              setTagOpen(true)
            }}
          >
            {t('items.addTags')}
          </Button>
          <Button size="sm" onClick={() => setCollectionOpen(true)}>
            {t('items.addToCollection')}
          </Button>
          <Button size="sm" onClick={() => setChecklistOpen(true)}>
            {t('items.makeChecklist')}
          </Button>
          <Button size="sm" onClick={() => setConfirmDiscardOpen(true)}>
            {t('items.discard')}
          </Button>
          <Button size="sm" onClick={() => setSelected(new Set())}>
            {t('common.cancel')}
          </Button>
        </div>
      ) : (
        filtered.length > 1 ? (
          <div className="row" style={{ marginBottom: 'var(--gap-3)' }}>
            <label className="checkbox">
              <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} />
              <span className="small muted">
                {t('items.selectAllShown', { count: filtered.length })}
              </span>
            </label>
          </div>
        ) : null
      )}

      {/* ---------------- 列表 ---------------- */}
      {filtered.length === 0 ? (
        <EmptyState
          title={t('items.noMatch')}
          hint={t('items.noMatchHint')}
          action={
            <Button
              onClick={() => setFilter((prev) => ({ ...EMPTY_FILTER, search: prev.search }))}
            >
              {t('items.clearFilters')}
            </Button>
          }
        />
      ) : (
        groups.map((node) => renderGroupNode(node, 0))
      )}

      {/* ---------------- 弹窗 ---------------- */}
      <FilterPanel
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        filter={filter}
        onApply={setFilter}
        ctx={derived}
        counts={locationCounts}
      />

      <LocationPicker
        open={moveOpen}
        onClose={() => setMoveOpen(false)}
        value={null}
        onSelect={(locationId) => {
          batchMoveToLocation(selectedIds, locationId)
          notify(tc(selectedIds.length, 'items.movedToast'), 'success')
          setSelected(new Set())
          setMoveOpen(false)
        }}
        ctx={derived}
        counts={locationCounts}
      />

      <Modal
        open={tagOpen}
        title={tc(selectedIds.length, 'items.addTagsTitle')}
        onClose={() => setTagOpen(false)}
        footer={
          <>
            <Button onClick={() => setTagOpen(false)}>{t('common.cancel')}</Button>
            <Button
              variant="primary"
              disabled={batchTagDraft.length === 0}
              onClick={() => {
                for (const tag of batchTagDraft) batchAddTag(selectedIds, tag)
                notify(tc(batchTagDraft.length, 'items.taggedToast'), 'success')
                setSelected(new Set())
                setTagOpen(false)
              }}
            >
              {t('common.add')}
            </Button>
          </>
        }
      >
        <TagInput
          value={batchTagDraft}
          onChange={setBatchTagDraft}
          suggestions={tagSuggestions}
        />
      </Modal>

      <AddToCollectionDialog
        open={collectionOpen}
        itemCount={selectedIds.length}
        onClose={() => setCollectionOpen(false)}
        onPick={(collection) => {
          const added = addItemsToCollection(selectedIds, collection.id)
          const skipped = selectedIds.length - added
          notify(
            added === 0
              ? t('collections.alreadyAll', { count: skipped, name: collection.name })
              : skipped > 0
                ? t('collections.addPartial', {
                    added,
                    skipped,
                    name: collection.name,
                  })
                : t('collections.addedToast', { count: added, name: collection.name }),
            added === 0 ? 'info' : 'success',
          )
          setSelected(new Set())
          setCollectionOpen(false)
        }}
      />

      <CreateChecklistDialog
        open={checklistOpen}
        itemCount={selectedIds.length}
        defaultName={t('checklists.defaultName')}
        onClose={() => setChecklistOpen(false)}
        onConfirm={(name) => {
          const created = createChecklist({ name, itemIds: selectedIds })
          setChecklistOpen(false)
          if (created === null) return
          notify(
            t('checklists.createdToast', { name, count: selectedIds.length }),
            'success',
          )
          setSelected(new Set())
          // 直接进新清单 —— 建它就是为了马上打钩
          navigate(`/checklists/${created}`)
        }}
      />

      <SplitToSpareDialog
        open={splitOpen}
        itemIds={selectedIds}
        locationCounts={locationCounts}
        onClose={() => {
          setSplitOpen(false)
          // 拆完这些物品的数量/状态都变了，选中态留着只会让人误操作下一次
          setSelected(new Set())
        }}
      />

      <ConfirmDialog
        open={confirmDiscardOpen}
        title={t('items.confirmDiscardTitle')}
        danger
        confirmLabel={t('items.discard')}
        message={
          <>
            {t('items.confirmDiscardLine1', { count: selectedIds.length })}
            <br />
            {t('items.confirmDiscardLine2')}
          </>
        }
        onConfirm={() => {
          runBatchStatus('discarded')
          setConfirmDiscardOpen(false)
        }}
        onCancel={() => setConfirmDiscardOpen(false)}
      />
    </>
  )
}
