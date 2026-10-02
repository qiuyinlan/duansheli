import { useEffect, useMemo, useState } from 'react'
import type { AttributeDef } from '../types'
import { UNASSIGNED_ID } from '../types'
import type { DerivedContext } from '../store/selectors'
import { countByCategoryIncludingDescendants, liveItems } from '../store/selectors'
import { useAppStore } from '../store/useAppStore'
import { TreeView } from './TreeView'
import { IconClose, IconPlus } from './ui/icons'
import { Button, Modal } from './ui/primitives'

/* ------------------------------------------------------------------ */
/* 位置选择器                                                          */
/* ------------------------------------------------------------------ */

interface LocationPickerProps {
  open: boolean
  onClose: () => void
  value: string | null
  onSelect: (id: string | null) => void
  ctx: DerivedContext
  counts: Map<string, number>
  allowUnassigned?: boolean
}

export function LocationPicker({
  open,
  onClose,
  value,
  onSelect,
  ctx,
  counts,
  allowUnassigned = true,
}: LocationPickerProps) {
  // 打开时展开顶层 + 当前选中项的祖先路径，让人一眼看到自己在哪
  const initialExpanded = useMemo(() => {
    const set = new Set<string>()
    for (const node of ctx.tree) set.add(node.node.id)

    if (value) {
      const guard = new Set<string>()
      let current = ctx.index.byId.get(value)
      while (current?.parentId && !guard.has(current.id)) {
        guard.add(current.id)
        set.add(current.parentId)
        current = ctx.index.byId.get(current.parentId)
      }
    }
    return set
  }, [ctx, value])

  const [expanded, setExpanded] = useState<Set<string>>(initialExpanded)

  useEffect(() => {
    if (open) setExpanded(initialExpanded)
  }, [open, initialExpanded])

  const currentPath = value ? ctx.index.pathString(value, ' / ') : '未归位'

  return (
    <Modal
      open={open}
      title="选择位置"
      onClose={onClose}
      footer={<Button onClick={onClose}>关闭</Button>}
    >
      <div className="dim small" style={{ marginBottom: 'var(--gap-3)' }}>
        当前：{currentPath}
      </div>

      <TreeView
        nodes={ctx.tree}
        selectedIds={value ? [value] : [UNASSIGNED_ID]}
        onSelect={(id) => {
          onSelect(id)
          onClose()
        }}
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
        virtualRoot={
          allowUnassigned
            ? { id: UNASSIGNED_ID, label: '未归位', count: counts.get(UNASSIGNED_ID) ?? 0 }
            : null
        }
        emptyText="还没有位置，可以在「位置」页面里创建。"
      />
    </Modal>
  )
}

/* ------------------------------------------------------------------ */
/* 分类选择器（树形多选）                                              */
/* ------------------------------------------------------------------ */

interface CategoryPickerProps {
  open: boolean
  onClose: () => void
  selectedIds: string[]
  onChange: (ids: string[]) => void
}

export function CategoryPicker({ open, onClose, selectedIds, onChange }: CategoryPickerProps) {
  const data = useAppStore((s) => s.data)
  const derived = useAppStore((s) => s.derived)
  const addCategory = useAppStore((s) => s.addCategory)
  const notify = useAppStore((s) => s.notify)

  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [newName, setNewName] = useState('')

  // 分类树一般不大，打开时全展开
  useEffect(() => {
    if (!open) return
    setExpanded(new Set(derived.categoryFlat.map((node) => node.node.id)))
  }, [open, derived.categoryFlat])

  const counts = useMemo(
    () => countByCategoryIncludingDescendants(liveItems(data), derived),
    [data, derived],
  )

  const toggle = (id: string) => {
    onChange(
      selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id],
    )
  }

  const createTopLevel = () => {
    const name = newName.trim()
    if (name === '') return
    const created = addCategory(name, null)
    if (!created) {
      notify(`顶层已经有一个叫「${name}」的分类了`, 'error')
      return
    }
    onChange([...selectedIds, created.id])
    setNewName('')
  }

  return (
    <Modal
      open={open}
      title="选择分类"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>关闭</Button>
          <Button variant="primary" onClick={onClose}>
            确定（已选 {selectedIds.length}）
          </Button>
        </>
      }
    >
      <div className="dim small" style={{ marginBottom: 'var(--gap-3)' }}>
        点分类名切换选中，可以选多个。分类是多级的，物品挂在哪一级都可以。
      </div>

      <div
        style={{
          border: '1px solid var(--line)',
          borderRadius: 'var(--radius)',
          padding: 'var(--gap-2)',
          maxHeight: 320,
          overflowY: 'auto',
        }}
      >
        <TreeView
          nodes={derived.categoryTree}
          selectedIds={selectedIds}
          onSelect={(id) => {
            if (id) toggle(id)
          }}
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
          emptyText="还没有分类，在下面新建一个。"
        />
      </div>

      <div className="field" style={{ marginTop: 'var(--gap-4)' }}>
        <label className="field__label" htmlFor="new-category-name">
          新建顶层分类
        </label>
        <div className="row">
          <input
            id="new-category-name"
            className="input grow"
            placeholder="例如：化妆品"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                createTopLevel()
              }
            }}
          />
          <Button onClick={createTopLevel} disabled={newName.trim() === ''}>
            <IconPlus size={13} />
            新建
          </Button>
        </div>
        <div className="field__hint">
          想建子分类（比如「化妆品 › 眼妆」）请到「分类」页面，那里可以建任意层级。
        </div>
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------------ */
/* 标签输入                                                            */
/* ------------------------------------------------------------------ */

interface TagInputProps {
  value: string[]
  onChange: (tags: string[]) => void
  /** 数据里已经用过的标签 */
  suggestions: string[]
}

export function TagInput({ value, onChange, suggestions }: TagInputProps) {
  const [draft, setDraft] = useState('')

  const available = suggestions.filter((tag) => !value.includes(tag)).slice(0, 12)

  const add = (raw: string) => {
    const tag = raw.trim()
    if (tag === '' || value.includes(tag)) {
      setDraft('')
      return
    }
    onChange([...value, tag])
    setDraft('')
  }

  const remove = (tag: string) => onChange(value.filter((t) => t !== tag))

  return (
    <div className="stack-sm">
      {value.length > 0 ? (
        <div className="chip-list">
          {value.map((tag) => (
            <span key={tag} className="chip is-active">
              {tag}
              <button
                type="button"
                className="chip__remove"
                aria-label={`移除标签 ${tag}`}
                onClick={() => remove(tag)}
              >
                <IconClose size={11} />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <input
        className="input"
        placeholder="输入标签后按回车，例如：想送人"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            add(draft)
          } else if (e.key === 'Backspace' && draft === '' && value.length > 0) {
            remove(value[value.length - 1])
          }
        }}
        onBlur={() => add(draft)}
      />

      {available.length > 0 ? (
        <div className="chip-list">
          {available.map((tag) => (
            <button key={tag} type="button" className="chip chip--dashed" onClick={() => add(tag)}>
              <IconPlus size={11} />
              {tag}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 属性勾选器（决定这次要填哪些属性）                                    */
/* ------------------------------------------------------------------ */

interface AttributePickerProps {
  open: boolean
  onClose: () => void
  defs: AttributeDef[]
  selectedIds: string[]
  onChange: (ids: string[]) => void
}

export function AttributePicker({
  open,
  onClose,
  defs,
  selectedIds,
  onChange,
}: AttributePickerProps) {
  const sorted = useMemo(
    () => [...defs].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'zh-CN')),
    [defs],
  )

  const toggle = (id: string) => {
    onChange(
      selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id],
    )
  }

  return (
    <Modal
      open={open}
      title="选择要填的属性"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>关闭</Button>
          <Button variant="primary" onClick={onClose}>
            确定（已选 {selectedIds.length}）
          </Button>
        </>
      }
    >
      {sorted.length === 0 ? (
        <div className="dim small">
          属性库还是空的。去「属性」页面定义几个（比如品牌、购入日期、价格），
          之后就能在录入时按需勾选。
        </div>
      ) : (
        <>
          <div className="dim small" style={{ marginBottom: 'var(--gap-3)' }}>
            只勾选这次真正需要的。不勾的属性不会出现在表单里，也不会占地方。
          </div>
          <div className="attr-picker">
            {sorted.map((def) => {
              const active = selectedIds.includes(def.id)
              return (
                <label key={def.id} className="attr-picker__row">
                  <input type="checkbox" checked={active} onChange={() => toggle(def.id)} />
                  <span className="attr-picker__name">{def.name}</span>
                  <span className="tiny dim">
                    {def.type === 'select'
                      ? '单选'
                      : def.type === 'bool'
                        ? '是/否'
                        : def.type === 'date'
                          ? '日期'
                          : def.type === 'number'
                            ? `数字${def.unit ? `（${def.unit}）` : ''}`
                            : '文本'}
                  </span>
                </label>
              )
            })}
          </div>
        </>
      )}
    </Modal>
  )
}
