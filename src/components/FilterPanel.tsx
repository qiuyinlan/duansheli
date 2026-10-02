import { useEffect, useMemo, useState } from 'react'
import type { AttrType, ItemStatus } from '../types'
import { UNASSIGNED_ID, UNCATEGORIZED_ID, UNTAGGED_ID } from '../types'
import type { AttrFilter, AttrOp, DerivedContext, ItemFilter } from '../store/selectors'
import {
  EMPTY_FILTER,
  EXPIRY_STATE_ORDER,
  STATUS_ORDER,
  labelForExpiryState,
  statusLabel,
} from '../store/selectors'
import { useAppStore } from '../store/useAppStore'
import { TreeView } from './TreeView'
import { Button, Modal, Switch } from './ui/primitives'
import type { DictKey } from '../i18n'
import { useT } from '../i18n'

/**
 * 运算符的显示名存的是**词典 key**，不是文字。
 *
 * 这是个模块级常量：在模块加载时调用 t() 会把当时的语言冻进去，之后切语言
 * 它不会变（docs/i18n-约定.md 第 3 条）。所以在渲染时再查表。
 */
const OP_KEYS: Record<AttrOp, DictKey> = {
  contains: 'items.opContains',
  eq: 'items.opEquals',
  gt: 'items.opGreater',
  lt: 'items.opLess',
  isTrue: 'items.opIsTrue',
  isFalse: 'items.opIsFalse',
  hasValue: 'items.opHasValue',
  noValue: 'items.opNoValue',
}

function opsForType(type: AttrType): AttrOp[] {
  switch (type) {
    case 'number':
    case 'date':
      return ['gt', 'lt', 'eq', 'hasValue', 'noValue']
    case 'select':
      return ['eq', 'hasValue', 'noValue']
    case 'bool':
      return ['isTrue', 'isFalse']
    default:
      return ['contains', 'eq', 'hasValue', 'noValue']
  }
}

/** 这个运算符需不需要填值 */
function opNeedsValue(op: AttrOp): boolean {
  return op !== 'hasValue' && op !== 'noValue' && op !== 'isTrue' && op !== 'isFalse'
}

interface FilterPanelProps {
  open: boolean
  onClose: () => void
  filter: ItemFilter
  onApply: (filter: ItemFilter) => void
  ctx: DerivedContext
  counts: Map<string, number>
}

export function FilterPanel({ open, onClose, filter, onApply, ctx, counts }: FilterPanelProps) {
  const categories = useAppStoreCategories()
  const attributeDefs = useAppStoreAttributeDefs()
  const tags = useAppStoreTags()
  // 「即将过期」算多少天以内 —— 有效期状态的显示名要用它
  const soonDays = useAppStore((s) => s.ui.expirySoonDays)

  // useT() 既给 t/tc，也**订阅语言**：语言一换这个面板就重渲染
  const { t, tc } = useT()

  const [draft, setDraft] = useState<ItemFilter>(filter)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  // 每次打开都以当前生效的筛选条件为起点，并提供一份展开好的位置树
  useEffect(() => {
    if (!open) return
    setDraft(filter)
    const set = new Set<string>()
    for (const node of ctx.tree) set.add(node.node.id)
    setExpanded(set)
  }, [open, filter, ctx.tree])

  const toggleIn = (
    key: 'categoryIds' | 'tags' | 'statuses' | 'locationIds' | 'expiryStates',
    value: string,
  ) => {
    setDraft((prev) => {
      const list = prev[key] as string[]
      const next = list.includes(value)
        ? list.filter((v) => v !== value)
        : [...list, value]
      return { ...prev, [key]: next } as ItemFilter
    })
  }

  const setAttrFilter = (defId: string, patch: Partial<AttrFilter> | null) => {
    setDraft((prev) => {
      if (patch === null) {
        return { ...prev, attrFilters: prev.attrFilters.filter((f) => f.defId !== defId) }
      }
      const existing = prev.attrFilters.find((f) => f.defId === defId)
      const attrFilters = existing
        ? prev.attrFilters.map((f) => (f.defId === defId ? { ...f, ...patch } : f))
        : [...prev.attrFilters, { defId, op: 'hasValue' as AttrOp, value: '', ...patch }]
      return { ...prev, attrFilters }
    })
  }

  const attrFilterOf = (defId: string): AttrFilter | undefined =>
    draft.attrFilters.find((f) => f.defId === defId)

  const activeCount = useMemo(() => {
    return (
      draft.categoryIds.length +
      draft.locationIds.length +
      draft.statuses.length +
      draft.expiryStates.length +
      draft.tags.length +
      draft.attrFilters.length
    )
  }, [draft])

  return (
    <Modal
      open={open}
      title={t('items.filter')}
      onClose={onClose}
      maxWidth={560}
      footer={
        <>
          <Button
            onClick={() => setDraft({ ...EMPTY_FILTER, search: draft.search })}
            disabled={activeCount === 0}
          >
            {t('items.resetAll')}
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              onApply(draft)
              onClose()
            }}
          >
            {activeCount > 0
              ? tc(activeCount, 'items.applyWithCount')
              : t('items.apply')}
          </Button>
        </>
      }
    >
      <div className="stack" style={{ gap: 'var(--gap-5)' }}>
        {/* ---------------- 状态 ---------------- */}
        <div className="field">
          <div className="field__label">{t('items.groupStatus')}</div>
          <div className="picker-grid">
            {STATUS_ORDER.map((status: ItemStatus) => {
              const active = draft.statuses.includes(status)
              return (
                <button
                  key={status}
                  type="button"
                  className={`chip${active ? ' is-active' : ''}`}
                  aria-pressed={active}
                  onClick={() => toggleIn('statuses', status)}
                >
                  {statusLabel(status)}
                </button>
              )
            })}
          </div>
        </div>

        {/* ---------------- 有效期 ---------------- */}
        {/* 和状态一样是多选：「已过期 + 即将过期」一起看是最常见的用法。
            `none`（没填有效期）也是可选项 —— 经常想反过来找「哪些还没填」。 */}
        <div className="field">
          <div className="field__label">{t('expiry.filterLabel')}</div>
          <div className="picker-grid">
            {EXPIRY_STATE_ORDER.map((state) => {
              const active = draft.expiryStates.includes(state)
              return (
                <button
                  key={state}
                  type="button"
                  className={`chip${active ? ' is-active' : ''}`}
                  aria-pressed={active}
                  onClick={() => toggleIn('expiryStates', state)}
                >
                  {labelForExpiryState(state, soonDays)}
                </button>
              )
            })}
          </div>
        </div>

        {/* ---------------- 分类 ---------------- */}
        {categories.length > 0 ? (
          <div className="field">
            <div className="field__label">{t('items.groupCategory')}</div>
            <div className="picker-grid">
              {categories.map((cat) => {
                const active = draft.categoryIds.includes(cat.id)
                return (
                  <button
                    key={cat.id}
                    type="button"
                    className={`chip${active ? ' is-active' : ''}`}
                    aria-pressed={active}
                    onClick={() => toggleIn('categoryIds', cat.id)}
                  >
                    {cat.name}
                  </button>
                )
              })}
              <button
                type="button"
                className={`chip${draft.categoryIds.includes(UNCATEGORIZED_ID) ? ' is-active' : ''}`}
                aria-pressed={draft.categoryIds.includes(UNCATEGORIZED_ID)}
                onClick={() => toggleIn('categoryIds', UNCATEGORIZED_ID)}
              >
                {t('status.uncategorized')}
              </button>
            </div>
          </div>
        ) : null}

        {/* ---------------- 位置 ---------------- */}
        <div className="field">
          <div className="field__label">{t('items.groupLocation')}</div>
          <div
            style={{
              border: '1px solid var(--line)',
              borderRadius: 'var(--radius)',
              padding: 'var(--gap-2)',
              maxHeight: 260,
              overflowY: 'auto',
            }}
          >
            <TreeView
              nodes={ctx.tree}
              selectedIds={draft.locationIds}
              onSelect={(id) => toggleIn('locationIds', id === null ? UNASSIGNED_ID : id)}
              counts={counts}
              expanded={expanded}
              onToggle={(id) =>
                setExpanded((prev) => {
                  const next = new Set(prev)
                  if (next.has(id)) next.delete(id)
                  else next.add(id)
                  return next
                })
              }
              virtualRoot={{
                id: UNASSIGNED_ID,
                label: t('status.unassigned'),
                count: counts.get(UNASSIGNED_ID) ?? 0,
              }}
            />
          </div>
          <div className="row-between wrap" style={{ marginTop: 'var(--gap-2)' }}>
            <Switch
              checked={draft.includeDescendants}
              onChange={(v) => setDraft((prev) => ({ ...prev, includeDescendants: v }))}
              label={t('items.includeDescendants')}
            />
            {draft.locationIds.length > 0 ? (
              <button
                type="button"
                className="btn btn--sm btn--ghost"
                onClick={() => setDraft((prev) => ({ ...prev, locationIds: [] }))}
              >
                {t('items.clearLocationFilter', { count: draft.locationIds.length })}
              </button>
            ) : null}
          </div>
        </div>

        {/* ---------------- 标签 ---------------- */}
        {tags.length > 0 ? (
          <div className="field">
            <div className="field__label">{t('items.groupTag')}</div>
            <div className="picker-grid">
              {tags.map((tag) => {
                const active = draft.tags.includes(tag)
                return (
                  <button
                    key={tag}
                    type="button"
                    className={`chip${active ? ' is-active' : ''}`}
                    aria-pressed={active}
                    onClick={() => toggleIn('tags', tag)}
                  >
                    {tag}
                  </button>
                )
              })}
              <button
                type="button"
                className={`chip${draft.tags.includes(UNTAGGED_ID) ? ' is-active' : ''}`}
                aria-pressed={draft.tags.includes(UNTAGGED_ID)}
                onClick={() => toggleIn('tags', UNTAGGED_ID)}
              >
                {t('status.untagged')}
              </button>
            </div>
          </div>
        ) : null}

        {/* ---------------- 属性 ---------------- */}
        <div className="field">
          <div className="field__label">{t('nav.titleAttributes')}</div>
          {attributeDefs.length === 0 ? (
            <div className="dim small">{t('items.noAttributes')}</div>
          ) : (
            <div className="stack-sm">
              {attributeDefs.map((def) => {
                const current = attrFilterOf(def.id)
                const ops = opsForType(def.type)
                const enabled = Boolean(current)

                return (
                  <div key={def.id} className="row" style={{ gap: 'var(--gap-2)' }}>
                    <label className="checkbox" style={{ minWidth: 96 }}>
                      <input
                        type="checkbox"
                        checked={enabled}
                        onChange={() => {
                          if (enabled) {
                            setAttrFilter(def.id, null)
                          } else {
                            setAttrFilter(def.id, { op: opsForType(def.type)[0], value: '' })
                          }
                        }}
                      />
                      <span className="truncate">{def.name}</span>
                    </label>

                    {enabled && current ? (
                      <>
                        <select
                          className="select"
                          style={{ width: 100 }}
                          value={current.op}
                          onChange={(e) =>
                            setAttrFilter(def.id, { op: e.target.value as AttrOp })
                          }
                          aria-label={t('items.attrOpAria', { name: def.name })}
                        >
                          {ops.map((op) => (
                            <option key={op} value={op}>
                              {t(OP_KEYS[op])}
                            </option>
                          ))}
                        </select>

                        {opNeedsValue(current.op) ? (
                          def.type === 'select' ? (
                            <select
                              className="select grow"
                              value={current.value}
                              onChange={(e) => setAttrFilter(def.id, { value: e.target.value })}
                              aria-label={t('items.attrValueAria', { name: def.name })}
                            >
                              <option value="">{t('items.selectPlaceholder')}</option>
                              {def.options.map((opt) => (
                                <option key={opt} value={opt}>
                                  {opt}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <input
                              className="input grow"
                              type={
                                def.type === 'number'
                                  ? 'number'
                                  : def.type === 'date'
                                    ? 'date'
                                    : 'text'
                              }
                              inputMode={def.type === 'number' ? 'decimal' : undefined}
                              placeholder={def.type === 'number' && def.unit ? def.unit : ''}
                              value={current.value}
                              onChange={(e) => setAttrFilter(def.id, { value: e.target.value })}
                              aria-label={t('items.attrValueAria', { name: def.name })}
                            />
                          )
                        ) : (
                          <span className="grow dim small">{t('items.opNoValueHint')}</span>
                        )}
                      </>
                    ) : (
                      <span className="grow dim small">{t('items.notFiltered')}</span>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------------ */
/* 直接在 store 里取数据的小钩子，避免这个文件依赖太多 store 细节        */
/* ------------------------------------------------------------------ */

function useAppStoreCategories() {
  const categories = useAppStore((s) => s.data.categories)
  return useMemo(
    () => [...categories].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'zh-CN')),
    [categories],
  )
}

function useAppStoreAttributeDefs() {
  const defs = useAppStore((s) => s.data.attributeDefs)
  return useMemo(
    () => [...defs].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'zh-CN')),
    [defs],
  )
}

function useAppStoreTags() {
  const tags = useAppStore((s) => s.data.tags)
  return useMemo(() => tags.map((t) => t.name), [tags])
}
