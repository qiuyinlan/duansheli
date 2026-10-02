import { useEffect, useMemo, useState } from 'react'
import type { AttrType, ItemStatus } from '../types'
import { UNASSIGNED_ID, UNCATEGORIZED_ID, UNTAGGED_ID } from '../types'
import type { AttrFilter, AttrOp, DerivedContext, ItemFilter } from '../store/selectors'
import { EMPTY_FILTER, STATUS_LABEL, STATUS_ORDER } from '../store/selectors'
import { useAppStore } from '../store/useAppStore'
import { TreeView } from './TreeView'
import { Button, Modal, Switch } from './ui/primitives'

const OP_LABELS: Record<AttrOp, string> = {
  contains: '包含',
  eq: '等于',
  gt: '大于',
  lt: '小于',
  isTrue: '是',
  isFalse: '否',
  hasValue: '已填写',
  noValue: '未填写',
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

  const toggleIn = (key: 'categoryIds' | 'tags' | 'statuses' | 'locationIds', value: string) => {
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
      draft.tags.length +
      draft.attrFilters.length
    )
  }, [draft])

  return (
    <Modal
      open={open}
      title="筛选"
      onClose={onClose}
      maxWidth={560}
      footer={
        <>
          <Button
            onClick={() => setDraft({ ...EMPTY_FILTER, search: draft.search })}
            disabled={activeCount === 0}
          >
            全部重置
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              onApply(draft)
              onClose()
            }}
          >
            应用{activeCount > 0 ? `（${activeCount} 项条件）` : ''}
          </Button>
        </>
      }
    >
      <div className="stack" style={{ gap: 'var(--gap-5)' }}>
        {/* ---------------- 状态 ---------------- */}
        <div className="field">
          <div className="field__label">状态</div>
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
                  {STATUS_LABEL[status]}
                </button>
              )
            })}
          </div>
        </div>

        {/* ---------------- 分类 ---------------- */}
        {categories.length > 0 ? (
          <div className="field">
            <div className="field__label">分类</div>
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
                未分类
              </button>
            </div>
          </div>
        ) : null}

        {/* ---------------- 位置 ---------------- */}
        <div className="field">
          <div className="field__label">位置</div>
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
                label: '未归位',
                count: counts.get(UNASSIGNED_ID) ?? 0,
              }}
            />
          </div>
          <div className="row-between wrap" style={{ marginTop: 'var(--gap-2)' }}>
            <Switch
              checked={draft.includeDescendants}
              onChange={(v) => setDraft((prev) => ({ ...prev, includeDescendants: v }))}
              label="选中位置时，连同子位置里的物品一起显示"
            />
            {draft.locationIds.length > 0 ? (
              <button
                type="button"
                className="btn btn--sm btn--ghost"
                onClick={() => setDraft((prev) => ({ ...prev, locationIds: [] }))}
              >
                清除位置筛选（{draft.locationIds.length}）
              </button>
            ) : null}
          </div>
        </div>

        {/* ---------------- 标签 ---------------- */}
        {tags.length > 0 ? (
          <div className="field">
            <div className="field__label">标签</div>
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
                未加标签
              </button>
            </div>
          </div>
        ) : null}

        {/* ---------------- 属性 ---------------- */}
        <div className="field">
          <div className="field__label">属性</div>
          {attributeDefs.length === 0 ? (
            <div className="dim small">还没有定义任何属性。</div>
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
                          aria-label={`${def.name} 的判断方式`}
                        >
                          {ops.map((op) => (
                            <option key={op} value={op}>
                              {OP_LABELS[op]}
                            </option>
                          ))}
                        </select>

                        {opNeedsValue(current.op) ? (
                          def.type === 'select' ? (
                            <select
                              className="select grow"
                              value={current.value}
                              onChange={(e) => setAttrFilter(def.id, { value: e.target.value })}
                              aria-label={`${def.name} 的值`}
                            >
                              <option value="">请选择…</option>
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
                              aria-label={`${def.name} 的值`}
                            />
                          )
                        ) : (
                          <span className="grow dim small">无需填值</span>
                        )}
                      </>
                    ) : (
                      <span className="grow dim small">未筛选</span>
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
