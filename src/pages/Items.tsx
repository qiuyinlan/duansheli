import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { FilterPanel } from '../components/FilterPanel'
import { ItemRow } from '../components/ItemRow'
import { LocationPicker, TagInput } from '../components/pickers'
import { IconChevronRight, IconTrash } from '../components/ui/icons'
import { Button, ConfirmDialog, EmptyState, Modal, SearchInput } from '../components/ui/primitives'
import { EMPTY_FILTER, countByLocationIncludingDescendants, filterItems, groupAndSort, liveItems, type ItemFilter } from '../store/selectors'
import { useAppStore } from '../store/useAppStore'
import { assignGroupColors, NEUTRAL_GROUP_COLOR } from '../lib/palette'
import type { GroupBy, ItemStatus, SortBy, SortDir } from '../types'
import { UNASSIGNED_ID } from '../types'

/* ------------------------------------------------------------------ */
/* URL 参数 → 筛选条件                                                 */
/* ------------------------------------------------------------------ */

const GROUP_OPTIONS: Array<{ value: GroupBy; label: string }> = [
  { value: 'category', label: '分类' },
  { value: 'location', label: '位置' },
  { value: 'tag', label: '标签' },
  { value: 'status', label: '状态' },
  { value: 'none', label: '不分组' },
]

const SORT_OPTIONS: Array<{ value: SortBy; label: string }> = [
  { value: 'updated', label: '最近修改' },
  { value: 'created', label: '最近添加' },
  { value: 'name', label: '名称' },
  { value: 'quantity', label: '数量' },
  { value: 'location', label: '位置' },
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
  const toggleGroupCollapsed = useAppStore((s) => s.toggleGroupCollapsed)
  const setIdle = useAppStore((s) => s.setIdle)
  const markDiscarded = useAppStore((s) => s.markDiscarded)
  const batchSetStatus = useAppStore((s) => s.batchSetStatus)
  const batchMoveToLocation = useAppStore((s) => s.batchMoveToLocation)
  const batchAddTag = useAppStore((s) => s.batchAddTag)
  const notify = useAppStore((s) => s.notify)

  const [filter, setFilter] = useState<ItemFilter>(EMPTY_FILTER)
  const [groupBy, setGroupBy] = useState<GroupBy>(ui.groupBy)
  const [sortBy, setSortBy] = useState<SortBy>(ui.sortBy)
  const [sortDir, setSortDir] = useState<SortDir>(ui.sortDir)

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [filterOpen, setFilterOpen] = useState(false)
  const [moveOpen, setMoveOpen] = useState(false)
  const [tagOpen, setTagOpen] = useState(false)
  const [batchTagDraft, setBatchTagDraft] = useState<string[]>([])
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

  const filtered = useMemo(
    () => filterItems(source, filter, derived),
    [source, filter, derived],
  )

  const groups = useMemo(
    () => groupAndSort(filtered, groupBy, sortBy, sortDir, derived),
    [filtered, groupBy, sortBy, sortDir, derived],
  )

  const locationCounts = useMemo(
    () => countByLocationIncludingDescendants(liveItems(data), derived),
    [data, derived],
  )

  // 每个分组一种颜色，方便一眼区分；同一个分类的颜色是稳定的（由 key 哈希决定）
  const groupColors = useMemo(
    () => assignGroupColors(groups.map((group) => group.key)),
    [groups],
  )

  const activeConditionCount =
    filter.categoryIds.length +
    filter.locationIds.length +
    filter.statuses.length +
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
  const tagSuggestions = useMemo(() => data.tags.map((t) => t.name), [data.tags])

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
      `已把 ${selectedIds.length} 件物品标记为「${
        status === 'idle' ? '闲置' : status === 'discarded' ? '已舍弃' : '在用'
      }」`,
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
            <div className="page-header__title">物品</div>
          </div>
        </div>
        <EmptyState
          title="还没有任何物品"
          hint="从最想整理的那个抽屉开始，一件一件录进来。"
          action={
            <Button variant="primary" onClick={() => navigate('/items/new')}>
              录入物品
            </Button>
          }
        />
      </>
    )
  }

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-header__title">物品</div>
          <div className="page-header__sub">
            共 <span className="numeric">{liveItems(data).length}</span> 件，当前显示{' '}
            <span className="numeric">{filtered.length}</span> 件
          </div>
        </div>
        <div className="page-header__actions">
          <Button onClick={() => navigate('/ai')}>AI 录入</Button>
          <Button variant="primary" onClick={() => navigate('/items/new')}>
            录入物品
          </Button>
        </div>
      </div>

      {/* ---------------- 工具条 ---------------- */}
      <div className="toolbar">
        <SearchInput
          value={filter.search}
          onValueChange={(value) => setFilter((prev) => ({ ...prev, search: value }))}
          placeholder="搜索名称、备注、标签、属性值…"
          aria-label="搜索物品"
        />

        <div className="toolbar__row">
          <span className="toolbar__label">分组</span>
          <div className="segmented">
            {GROUP_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={`segmented__item${groupBy === opt.value ? ' is-active' : ''}`}
                onClick={() => changeGroupBy(opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="toolbar__row">
          <span className="toolbar__label">排序</span>
          <select
            className="select"
            style={{ width: 130 }}
            value={sortBy}
            onChange={(e) => changeSort(e.target.value as SortBy, sortDir)}
            aria-label="排序方式"
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            onClick={() => changeSort(sortBy, sortDir === 'asc' ? 'desc' : 'asc')}
            title={sortDir === 'asc' ? '当前升序' : '当前降序'}
          >
            {sortDir === 'asc' ? '升序 ↑' : '降序 ↓'}
          </Button>

          <span className="spacer" />

          <Button onClick={() => setFilterOpen(true)}>
            筛选
            {activeConditionCount > 0 ? `（${activeConditionCount}）` : ''}
          </Button>
        </div>

        {activeConditionCount > 0 ? (
          <div className="row wrap">
            {filter.categoryIds.map((id) => (
              <span key={`cat-${id}`} className="badge">
                {derived.categoryById.get(id)?.name ?? '未分类'}
                <button
                  type="button"
                  className="chip__remove"
                  aria-label="移除这个条件"
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
                {id === UNASSIGNED_ID ? '未归位' : derived.index.pathString(id)}
                <button
                  type="button"
                  className="chip__remove"
                  aria-label="移除这个条件"
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
                  aria-label="移除这个条件"
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
                {status === 'active' ? '在用' : status === 'idle' ? '闲置' : '已舍弃'}
                <button
                  type="button"
                  className="chip__remove"
                  aria-label="移除这个条件"
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
            <button
              type="button"
              className="btn btn--sm btn--ghost"
              onClick={() => setFilter((prev) => ({ ...EMPTY_FILTER, search: prev.search }))}
            >
              全部清除
            </button>
          </div>
        ) : null}
      </div>

      {/* ---------------- 批量操作条 ---------------- */}
      {selected.size > 0 ? (
        <div className="selection-bar">
          <span>已选 {selected.size} 件</span>
          <span className="spacer" />
          <Button size="sm" onClick={() => runBatchStatus('idle')}>
            标记闲置
          </Button>
          <Button size="sm" onClick={() => runBatchStatus('active')}>
            改回在用
          </Button>
          <Button size="sm" onClick={() => setMoveOpen(true)}>
            移动位置
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setBatchTagDraft([])
              setTagOpen(true)
            }}
          >
            加标签
          </Button>
          <Button size="sm" onClick={() => setConfirmDiscardOpen(true)}>
            舍弃
          </Button>
          <Button size="sm" onClick={() => setSelected(new Set())}>
            取消
          </Button>
        </div>
      ) : (
        filtered.length > 1 ? (
          <div className="row" style={{ marginBottom: 'var(--gap-3)' }}>
            <label className="checkbox">
              <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} />
              <span className="small muted">全选当前 {filtered.length} 件</span>
            </label>
          </div>
        ) : null
      )}

      {/* ---------------- 列表 ---------------- */}
      {filtered.length === 0 ? (
        <EmptyState
          title="没有匹配的物品"
          hint="试试放宽筛选条件，或者换个搜索词。"
          action={
            <Button
              onClick={() => setFilter((prev) => ({ ...EMPTY_FILTER, search: prev.search }))}
            >
              清除筛选条件
            </Button>
          }
        />
      ) : (
        groups.map((group) => {
          const collapsed = ui.collapsedGroups.includes(group.key)
          const color = groupColors.get(group.key) ?? NEUTRAL_GROUP_COLOR
          const showItems = !collapsed || groupBy === 'none'

          return (
            <div key={group.key} className="item-group" style={{ borderLeftColor: color.bar }}>
              <button
                type="button"
                className="group-head"
                style={{ background: color.soft }}
                onClick={() => toggleGroupCollapsed(group.key)}
                aria-expanded={showItems}
              >
                {groupBy !== 'none' ? (
                  <span className={`group-head__caret${collapsed ? '' : ' is-open'}`}>
                    <IconChevronRight size={10} />
                  </span>
                ) : null}
                <span className="group-head__dot" style={{ background: color.bar }} />
                <span className="group-head__label" style={{ color: color.text }}>
                  {group.label}
                </span>
                {group.sublabel && group.sublabel !== group.label ? (
                  <span className="group-head__count">{group.sublabel}</span>
                ) : null}
                <span className="group-head__count numeric">{group.items.length} 件</span>
                <span className="group-head__line" style={{ background: color.line }} />
              </button>

              {showItems ? (
                <ul className="list item-group__list">
                  {group.items.map((item) => (
                    <ItemRow
                      key={`${group.key}-${item.id}`}
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
                            {item.status === 'idle' ? '改回在用' : '闲置'}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            title="舍弃（可在设置里找回）"
                            onClick={() => {
                              markDiscarded(item.id)
                              notify('已移入「已舍弃」，可在设置里找回', 'success')
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
          )
        })
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
          notify(`已把 ${selectedIds.length} 件物品移动到新位置`, 'success')
          setSelected(new Set())
          setMoveOpen(false)
        }}
        ctx={derived}
        counts={locationCounts}
      />

      <Modal
        open={tagOpen}
        title={`给 ${selectedIds.length} 件物品加标签`}
        onClose={() => setTagOpen(false)}
        footer={
          <>
            <Button onClick={() => setTagOpen(false)}>取消</Button>
            <Button
              variant="primary"
              disabled={batchTagDraft.length === 0}
              onClick={() => {
                for (const tag of batchTagDraft) batchAddTag(selectedIds, tag)
                notify(`已添加 ${batchTagDraft.length} 个标签`, 'success')
                setSelected(new Set())
                setTagOpen(false)
              }}
            >
              添加
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

      <ConfirmDialog
        open={confirmDiscardOpen}
        title="舍弃这些物品？"
        danger
        confirmLabel="舍弃"
        message={
          <>
            将把选中的 {selectedIds.length} 件物品标记为「已舍弃」。
            <br />
            它们不会真的消失，可以在「设置 → 已舍弃回收站」里找回或彻底删除。
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
