import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AttributePicker, CategoryPicker, LocationPicker, TagInput } from '../components/pickers'
import { IconChevronRight, IconClose, IconPlus, IconTrash } from '../components/ui/icons'
import { Button, EmptyState, Switch } from '../components/ui/primitives'
import {
  countByLocationIncludingDescendants,
  liveItems,
} from '../store/selectors'
import { suggestAttrIds, useAppStore, type ItemInput } from '../store/useAppStore'
import type { AttributeDef, AttrValue, ItemStatus } from '../types'

/* ------------------------------------------------------------------ */
/* 单个属性输入控件                                                    */
/* ------------------------------------------------------------------ */

function AttributeField({
  def,
  value,
  onChange,
}: {
  def: AttributeDef
  value: AttrValue | undefined
  onChange: (value: AttrValue) => void
}) {
  const text = value === null || value === undefined ? '' : String(value)

  return (
    <div className="field">
      <label className="field__label" htmlFor={`attr-${def.id}`}>
        {def.name}
        {def.unit ? <span className="field__label-required">（{def.unit}）</span> : null}
      </label>

      {def.type === 'bool' ? (
        <Switch
          checked={value === true}
          onChange={(checked) => onChange(checked)}
          label={value === true ? '是' : '否'}
        />
      ) : def.type === 'select' ? (
        <select
          id={`attr-${def.id}`}
          className="select"
          value={text}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">未填写</option>
          {def.options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={`attr-${def.id}`}
          className={`input${def.type === 'number' ? ' input--number' : ''}`}
          type={def.type === 'number' ? 'number' : def.type === 'date' ? 'date' : 'text'}
          inputMode={def.type === 'number' ? 'decimal' : undefined}
          value={text}
          placeholder={def.type === 'number' ? def.unit : ''}
          onChange={(e) => {
            const raw = e.target.value
            if (def.type === 'number') {
              onChange(raw === '' ? null : Number(raw))
            } else {
              onChange(raw)
            }
          }}
        />
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 页面                                                                */
/* ------------------------------------------------------------------ */

export function ItemEdit() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const data = useAppStore((s) => s.data)
  const derived = useAppStore((s) => s.derived)
  const ui = useAppStore((s) => s.ui)
  const setUi = useAppStore((s) => s.setUi)
  const addItem = useAppStore((s) => s.addItem)
  const updateItem = useAppStore((s) => s.updateItem)
  const markDiscarded = useAppStore((s) => s.markDiscarded)
  const rememberAttrSelection = useAppStore((s) => s.rememberAttrSelection)
  const notify = useAppStore((s) => s.notify)

  const isEdit = Boolean(id)
  const existing = useMemo(
    () => (id ? data.items.find((i) => i.id === id) : undefined),
    [data.items, id],
  )

  const [name, setName] = useState('')
  const [locationId, setLocationId] = useState<string | null>(null)
  const [categoryIds, setCategoryIds] = useState<string[]>([])
  const [quantity, setQuantity] = useState(1)
  const [status, setStatus] = useState<ItemStatus>('active')
  const [tags, setTags] = useState<string[]>([])
  const [note, setNote] = useState('')
  const [attrs, setAttrs] = useState<Record<string, AttrValue>>({})
  const [attrIds, setAttrIds] = useState<string[]>([])

  const [moreOpen, setMoreOpen] = useState(false)
  const [locationOpen, setLocationOpen] = useState(false)
  const [categoryOpen, setCategoryOpen] = useState(false)
  const [attrPickerOpen, setAttrPickerOpen] = useState(false)

  const nameRef = useRef<HTMLInputElement>(null)

  // 初始化表单：编辑时用已有数据，新建时沿用上次选择的位置与分类
  useEffect(() => {
    if (existing) {
      setName(existing.name)
      setLocationId(existing.locationId)
      setCategoryIds(existing.categoryIds)
      setQuantity(existing.quantity)
      setStatus(existing.status)
      setTags(existing.tags)
      setNote(existing.note)
      setAttrs(existing.attrs)
      setAttrIds(Object.keys(existing.attrs))
      setMoreOpen(existing.tags.length > 0 || existing.note !== '')
    } else {
      setName('')
      setLocationId(ui.lastLocationId)
      setCategoryIds(ui.lastCategoryIds)
      setQuantity(1)
      setStatus('active')
      setTags([])
      setNote('')
      setAttrs({})
      setAttrIds(suggestAttrIds(ui, data.attributeDefs, ui.lastCategoryIds))
      setMoreOpen(false)
    }
    // 只在进入页面或切换物品时重新初始化
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  // 新建时，若选中的分类有「上次用过的属性组合」记忆，自动带上
  useEffect(() => {
    if (isEdit) return
    if (attrIds.length > 0) return
    const suggested = suggestAttrIds(ui, data.attributeDefs, categoryIds)
    if (suggested.length > 0) setAttrIds(suggested)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryIds, isEdit])

  useEffect(() => {
    if (!isEdit) nameRef.current?.focus()
  }, [isEdit])

  const locationCounts = useMemo(
    () => countByLocationIncludingDescendants(liveItems(data), derived),
    [data, derived],
  )

  const attrDefs = data.attributeDefs
  const selectedAttrDefs = useMemo(
    () => attrDefs.filter((d) => attrIds.includes(d.id)),
    [attrDefs, attrIds],
  )

  const categoryNames = categoryIds
    .map((cid) => derived.categoryById.get(cid)?.name)
    .filter((n): n is string => Boolean(n))

  const buildInput = (): ItemInput => ({
    name,
    locationId,
    categoryIds,
    quantity,
    status,
    tags,
    note,
    attrs: Object.fromEntries(
      Object.entries(attrs).filter(([key]) => attrIds.includes(key)),
    ) as Record<string, AttrValue>,
  })

  const save = (continueAfter: boolean) => {
    const trimmed = name.trim()
    if (trimmed === '') {
      notify('先给这件物品起个名字吧', 'error')
      nameRef.current?.focus()
      return
    }

    if (isEdit && existing) {
      updateItem(existing.id, { ...buildInput(), name: trimmed })
      notify('已保存', 'success')
      navigate('/items')
      return
    }

    addItem({ ...buildInput(), name: trimmed })
    rememberAttrSelection(categoryIds, attrIds)
    setUi({ lastLocationId: locationId, lastCategoryIds: categoryIds })

    if (continueAfter) {
      // 保留位置与分类 —— 整理同一个抽屉时这是最常用的连续录入方式
      setName('')
      setQuantity(1)
      setTags([])
      setNote('')
      setAttrs({})
      notify('已保存，继续录入下一件', 'success')
      nameRef.current?.focus()
    } else {
      notify('已保存', 'success')
      navigate('/items')
    }
  }

  if (isEdit && !existing) {
    return (
      <>
        <div className="page-header">
          <div>
            <div className="page-header__title">物品详情</div>
          </div>
        </div>
        <EmptyState
          title="找不到这件物品"
          hint="它可能已经被彻底删除了。"
          action={<Button onClick={() => navigate('/items')}>回到物品列表</Button>}
        />
      </>
    )
  }

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-header__title">{isEdit ? '编辑物品' : '录入物品'}</div>
          <div className="page-header__sub">
            {isEdit
              ? '改完记得保存'
              : '只有名称是必填的，其余都可以以后慢慢补'}
          </div>
        </div>
        <div className="page-header__actions">
          {isEdit && existing ? (
            <Button
              variant="danger"
              onClick={() => {
                markDiscarded(existing.id)
                notify('已移入「已舍弃」，可在设置里找回', 'success')
                navigate('/items')
              }}
            >
              <IconTrash size={14} />
              舍弃
            </Button>
          ) : null}
          <Button variant="primary" onClick={() => save(false)}>
            保存
          </Button>
        </div>
      </div>

      <form
        className="edit-form"
        onSubmit={(e) => {
          e.preventDefault()
          save(false)
        }}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault()
            save(!isEdit)
          }
        }}
      >
        {/* ---------------- 名称 ---------------- */}
        <div className="field">
          <label className="field__label" htmlFor="item-name">
            名称 <span className="field__label-required">必填</span>
          </label>
          <input
            id="item-name"
            ref={nameRef}
            className="input input--lg"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="写得具体一点，例如「灰色羊毛衫」而不是「毛衣」"
            autoComplete="off"
            enterKeyHint="done"
          />
        </div>

        {/* ---------------- 位置 ---------------- */}
        <div className="field">
          <span className="field__label">位置</span>
          <button
            type="button"
            className="input"
            style={{ textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
            onClick={() => setLocationOpen(true)}
          >
            <span className={`grow truncate${locationId ? '' : ' dim'}`}>
              {locationId ? derived.index.pathString(locationId, ' / ') : '未归位（点击选择）'}
            </span>
            <IconChevronRight size={13} />
          </button>
          {locationId ? (
            <button
              type="button"
              className="btn btn--sm btn--ghost"
              style={{ alignSelf: 'flex-start' }}
              onClick={() => setLocationId(null)}
            >
              <IconClose size={12} />
              清空位置
            </button>
          ) : null}
        </div>

        {/* ---------------- 分类 ---------------- */}
        <div className="field">
          <span className="field__label">分类</span>
          <div className="chip-list">
            {categoryNames.map((label, index) => (
              <span key={`${label}-${index}`} className="chip is-active">
                {label}
                <button
                  type="button"
                  className="chip__remove"
                  aria-label={`移除分类 ${label}`}
                  onClick={() =>
                    setCategoryIds((prev) => prev.filter((_, i) => i !== index))
                  }
                >
                  <IconClose size={11} />
                </button>
              </span>
            ))}
            <button
              type="button"
              className="chip chip--dashed"
              onClick={() => setCategoryOpen(true)}
            >
              <IconPlus size={11} />
              {categoryNames.length > 0 ? '修改分类' : '选择分类'}
            </button>
          </div>
          <div className="field__hint">一件物品可以同时属于多个分类。</div>
        </div>

        {/* ---------------- 数量 ---------------- */}
        <div className="field">
          <label className="field__label" htmlFor="item-quantity">
            数量
          </label>
          <input
            id="item-quantity"
            className="input input--number"
            style={{ maxWidth: 120 }}
            type="number"
            min={1}
            inputMode="numeric"
            value={quantity}
            onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))}
          />
        </div>

        {/* ---------------- 闲置 ---------------- */}
        <div className="field">
          <span className="field__label">状态</span>
          <Switch
            checked={status === 'idle'}
            onChange={(checked) => setStatus(checked ? 'idle' : 'active')}
            label={
              status === 'idle'
                ? '标记为闲置 —— 会出现在「闲置」页面里，等着被处理'
                : '在用（打开开关可以标记为闲置）'
            }
          />
        </div>

        {/* ---------------- 更多（标签、备注） ---------------- */}
        <div>
          <button
            type="button"
            className="collapsible__toggle"
            onClick={() => setMoreOpen((v) => !v)}
            aria-expanded={moreOpen}
          >
            <span className={`collapsible__caret${moreOpen ? ' is-open' : ''}`}>
              <IconChevronRight size={10} />
            </span>
            更多（标签、备注）
          </button>

          {moreOpen ? (
            <div className="stack" style={{ paddingTop: 'var(--gap-2)' }}>
              <div className="field">
                <span className="field__label">标签</span>
                <TagInput
                  value={tags}
                  onChange={setTags}
                  suggestions={data.tags.map((t) => t.name)}
                />
                <div className="field__hint">
                  标签适合记「情境」而不是「是什么」，例如「想送人」「舍不得扔」。
                </div>
              </div>

              <div className="field">
                <label className="field__label" htmlFor="item-note">
                  备注
                </label>
                <textarea
                  id="item-note"
                  className="textarea"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="任何想记下来的事，比如「妈妈送的」「有点漏水」"
                />
              </div>
            </div>
          ) : null}
        </div>

        <div className="edit-form__divider" />

        {/* ---------------- 属性 ---------------- */}
        <div className="stack">
          <div className="row-between wrap">
            <div>
              <div className="field__label" style={{ margin: 0 }}>
                属性
              </div>
              <div className="field__hint">
                只加这次需要的。不勾的属性不会出现在表单里。
              </div>
            </div>
            <Button onClick={() => setAttrPickerOpen(true)}>
              <IconPlus size={13} />
              添加属性
            </Button>
          </div>

          {selectedAttrDefs.length === 0 ? (
            <div className="dim small">
              {attrDefs.length === 0
                ? '属性库还是空的，可以在「属性」页面里定义。'
                : '还没有选择任何属性。'}
            </div>
          ) : (
            <div className="stack">
              {selectedAttrDefs.map((def) => (
                <div key={def.id} className="row" style={{ alignItems: 'flex-end', gap: 'var(--gap-2)' }}>
                  <div className="grow">
                    <AttributeField
                      def={def}
                      value={attrs[def.id]}
                      onChange={(value) =>
                        setAttrs((prev) => ({ ...prev, [def.id]: value }))
                      }
                    />
                  </div>
                  <Button
                    variant="ghost"
                    title={`不再填写「${def.name}」`}
                    onClick={() => {
                      setAttrIds((prev) => prev.filter((x) => x !== def.id))
                      setAttrs((prev) => {
                        const next = { ...prev }
                        delete next[def.id]
                        return next
                      })
                    }}
                  >
                    <IconClose size={14} />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="edit-form__divider" />

        {/* ---------------- 保存 ---------------- */}
        <div className="edit-form__actions">
          {isEdit ? (
            <Button variant="primary" onClick={() => save(false)}>
              保存
            </Button>
          ) : (
            <>
              <Button variant="primary" size="lg" onClick={() => save(true)}>
                保存并继续录入
              </Button>
              <Button size="lg" onClick={() => save(false)}>
                保存并返回
              </Button>
            </>
          )}
          <span className="spacer" />
          <span className="tiny dim">
            {isEdit ? '' : '按 Ctrl / ⌘ + Enter 也是「保存并继续」'}
          </span>
        </div>
      </form>

      {/* ---------------- 弹窗 ---------------- */}
      <CategoryPicker
        open={categoryOpen}
        onClose={() => setCategoryOpen(false)}
        selectedIds={categoryIds}
        onChange={setCategoryIds}
      />

      <AttributePicker
        open={attrPickerOpen}
        onClose={() => setAttrPickerOpen(false)}
        defs={attrDefs}
        selectedIds={attrIds}
        onChange={(ids) => {
          setAttrIds(ids)
          // 取消勾选时顺手把已填的值清掉，保证导出的数据干净
          setAttrs((prev) => {
            const next: Record<string, AttrValue> = {}
            for (const key of ids) if (prev[key] !== undefined) next[key] = prev[key]
            return next
          })
        }}
      />

      <LocationPicker
        open={locationOpen}
        onClose={() => setLocationOpen(false)}
        value={locationId}
        onSelect={setLocationId}
        ctx={derived}
        counts={locationCounts}
      />
    </>
  )
}
