import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AttributePicker, CategoryPicker, CollectionPicker, LocationPicker, TagInput } from '../components/pickers'
import { IconChevronRight, IconClose, IconPlus, IconTrash } from '../components/ui/icons'
import { Button, EmptyState, Switch } from '../components/ui/primitives'
import type { DictKey } from '../i18n'
import { useT } from '../i18n'
import { isExpired } from '../lib/expiry'
import { todayISODate, addDaysToISODate } from '../lib/format'
import {
  countByLocationIncludingDescendants,
  liveItems,
} from '../store/selectors'
import { suggestAttrIds, useAppStore, type ItemInput } from '../store/useAppStore'
import type { AttributeDef, AttrValue, ItemStatus } from '../types'

/* ------------------------------------------------------------------ */
/* 有效期：快捷设置的候选值                                            */
/* ------------------------------------------------------------------ */

/**
 * 存的是「天数 + 词典 key」，不是现成的文字。
 *
 * 模块顶层调 t() 会把加载那一刻的语言冻进常量里，切语言时这一排按钮
 * 不会跟着变（见 docs/i18n-约定.md 第 4 条）。存 key、渲染时再查表。
 */
const EXPIRY_QUICK_CHOICES: Array<{ days: number; labelKey: DictKey }> = [
  { days: 7, labelKey: 'expiry.fieldQuickWeek' },
  { days: 30, labelKey: 'expiry.fieldQuickMonth' },
  { days: 183, labelKey: 'expiry.fieldQuickHalfYear' },
  { days: 365, labelKey: 'expiry.fieldQuickYear' },
]

/**
 * 表单里能选的三个状态。
 *
 * 只有三个 —— 「已舍弃」不在这里：它是流程的出口（顶部那个舍弃按钮），
 * 不是一种你可以随手选中的状态。让用户直接选「已舍弃」等于把
 * 「扔东西」变成一个下拉选项，那太轻率了。
 */
const STATUS_OPTIONS: Array<{
  status: Exclude<ItemStatus, 'discarded'>
  labelKey: DictKey
  hintKey: DictKey
}> = [
  { status: 'active', labelKey: 'itemEdit.statusActive', hintKey: 'itemEdit.statusActiveHint' },
  { status: 'idle', labelKey: 'itemEdit.statusIdle', hintKey: 'itemEdit.statusIdleHint' },
  { status: 'spare', labelKey: 'itemEdit.statusSpare', hintKey: 'itemEdit.statusSpareHint' },
]

/**
 * 在 `YYYY-MM-DD` 上加减天数 —— 搬到 src/lib/format.ts 了。
 *
 * 理由：AI 输入框旁边那排「一周后 / 一个月后」的补全也要用同一个算术。
 * 两份日期算术迟早会漂，而漂了就是「差一天」这种最难发现的错。
 */

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
  const { t } = useT()

  return (
    <div className="field">
      <label className="field__label" htmlFor={`attr-${def.id}`}>
        {def.name}
        {def.unit ? (
          <span className="field__label-required">{t('itemEdit.attrUnitParen', { unit: def.unit })}</span>
        ) : null}
      </label>

      {def.type === 'bool' ? (
        <Switch
          checked={value === true}
          onChange={(checked) => onChange(checked)}
          label={value === true ? t('common.yes') : t('common.no')}
        />
      ) : def.type === 'select' ? (
        <select
          id={`attr-${def.id}`}
          className="select"
          value={text}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">{t('itemEdit.attrNotSet')}</option>
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
  const { t } = useT()

  const data = useAppStore((s) => s.data)
  const derived = useAppStore((s) => s.derived)
  const ui = useAppStore((s) => s.ui)
  const setUi = useAppStore((s) => s.setUi)
  const addItem = useAppStore((s) => s.addItem)
  const updateItem = useAppStore((s) => s.updateItem)
  const addCollection = useAppStore((s) => s.addCollection)
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
  /** 有效期至（YYYY-MM-DD）；null = 没设置 —— 和「已过期」是两回事 */
  const [expiresAt, setExpiresAt] = useState<string | null>(null)
  /** 所属的活动合集 */
  const [collectionIds, setCollectionIds] = useState<string[]>([])

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
      setExpiresAt(existing.expiresAt)
      setCollectionIds(existing.collectionIds)
      // 有标签、有备注、或属于某个活动，就默认把「更多」摊开 ——
      // 否则用户会看不到自己之前填过的东西，以为丢了
      setMoreOpen(
        existing.tags.length > 0 || existing.note !== '' || existing.collectionIds.length > 0,
      )
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
      setExpiresAt(null)
      setCollectionIds([])
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

  // 填了有效期，但那天已经过去了。只是提醒，**不拦保存** ——
  // 记录一件本来就已经过期的东西（比如去年的药）是正当用法。
  const expiryIsPast = expiresAt !== null && isExpired(expiresAt)

  const buildInput = (): ItemInput => ({
    name,
    locationId,
    categoryIds,
    quantity,
    status,
    tags,
    note,
    expiresAt,
    collectionIds,
    attrs: Object.fromEntries(
      Object.entries(attrs).filter(([key]) => attrIds.includes(key)),
    ) as Record<string, AttrValue>,
  })

  const save = (continueAfter: boolean) => {
    const trimmed = name.trim()
    if (trimmed === '') {
      notify(t('itemEdit.nameRequired'), 'error')
      nameRef.current?.focus()
      return
    }

    if (isEdit && existing) {
      updateItem(existing.id, { ...buildInput(), name: trimmed })
      notify(t('common.saved'), 'success')
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
      // 有效期属于「每件各不相同」的东西，连续录入时清掉
      setExpiresAt(null)
      notify(t('itemEdit.savedContinue'), 'success')
      nameRef.current?.focus()
    } else {
      notify(t('common.saved'), 'success')
      navigate('/items')
    }
  }

  if (isEdit && !existing) {
    return (
      <>
        <div className="page-header">
          <div>
            <div className="page-header__title">{t('nav.titleItemDetail')}</div>
          </div>
        </div>
        <EmptyState
          title={t('itemEdit.notFoundTitle')}
          hint={t('itemEdit.notFoundHint')}
          action={<Button onClick={() => navigate('/items')}>{t('itemEdit.backToItems')}</Button>}
        />
      </>
    )
  }

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-header__title">
            {isEdit ? t('itemEdit.titleEdit') : t('nav.titleItemNew')}
          </div>
          <div className="page-header__sub">
            {isEdit ? t('itemEdit.subtitleEdit') : t('itemEdit.subtitleNew')}
          </div>
        </div>
        <div className="page-header__actions">
          {isEdit && existing ? (
            <Button
              variant="danger"
              onClick={() => {
                markDiscarded(existing.id)
                notify(
                  t('itemEdit.discardedToast', { status: t('status.discarded') }),
                  'success',
                )
                navigate('/items')
              }}
            >
              <IconTrash size={14} />
              {t('itemEdit.discard')}
            </Button>
          ) : null}
          <Button variant="primary" onClick={() => save(false)}>
            {t('common.save')}
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
            {t('itemEdit.fieldName')}{' '}
            <span className="field__label-required">{t('common.required')}</span>
          </label>
          <input
            id="item-name"
            ref={nameRef}
            className="input input--lg"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('itemEdit.namePlaceholder')}
            autoComplete="off"
            enterKeyHint="done"
          />
        </div>

        {/* ---------------- 位置 ---------------- */}
        <div className="field">
          <span className="field__label">{t('itemEdit.fieldLocation')}</span>
          <button
            type="button"
            className="input"
            style={{ textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
            onClick={() => setLocationOpen(true)}
          >
            <span className={`grow truncate${locationId ? '' : ' dim'}`}>
              {locationId
                ? derived.index.pathString(locationId, ' / ')
                : t('itemEdit.locationPick')}
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
              {t('itemEdit.locationClear')}
            </button>
          ) : null}
        </div>

        {/* ---------------- 分类 ---------------- */}
        <div className="field">
          <span className="field__label">{t('itemEdit.fieldCategories')}</span>
          <div className="chip-list">
            {categoryNames.map((label, index) => (
              <span key={`${label}-${index}`} className="chip is-active">
                {label}
                <button
                  type="button"
                  className="chip__remove"
                  aria-label={t('itemEdit.removeCategoryAria', { name: label })}
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
              {categoryNames.length > 0
                ? t('itemEdit.categoriesChange')
                : t('itemEdit.categoriesChoose')}
            </button>
          </div>
          <div className="field__hint">{t('itemEdit.categoriesHint')}</div>
        </div>

        {/* ---------------- 数量 ---------------- */}
        <div className="field">
          <label className="field__label" htmlFor="item-quantity">
            {t('itemEdit.fieldQuantity')}
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

        {/* ---------------- 状态 ---------------- */}
        {/*
          三档，不是开关：开关只能表达「是 / 不是」，
          而备用是**第三条支线**（特意留着的），不是闲置的一种。
          合成一档会让「闲置占比」和闲置页的提醒都被弄脏。

          已舍弃不在这三档里 —— 它是出口，由顶部那个「舍弃」按钮负责，
          恢复在设置页的回收站。所以这里单独说一句，免得用户以为
          「一个都没选中」是界面坏了。（以前用开关时，已舍弃的物品
          会被显示成「在用」，那是个实打实的错。）
        */}
        <div className="field">
          <span className="field__label">{t('itemEdit.fieldStatus')}</span>
          {status === 'discarded' ? (
            <div className="dim small">{t('itemEdit.statusDiscardedHint')}</div>
          ) : (
            <>
              <div className="segmented">
                {STATUS_OPTIONS.map((option) => (
                  <button
                    key={option.status}
                    type="button"
                    className={`segmented__item${status === option.status ? ' is-active' : ''}`}
                    onClick={() => setStatus(option.status)}
                  >
                    {t(option.labelKey)}
                  </button>
                ))}
              </div>
              <div className="dim small" style={{ marginTop: 'var(--gap-2)' }}>
                {t(STATUS_OPTIONS.find((o) => o.status === status)?.hintKey ?? 'itemEdit.statusActiveHint')}
              </div>
            </>
          )}
        </div>

        {/* ---------------- 有效期 ---------------- */}
        <div className="field">
          <label className="field__label" htmlFor="item-expires-at">
            {t('expiry.fieldLabel')}
          </label>
          <input
            id="item-expires-at"
            className="input"
            type="date"
            value={expiresAt ?? ''}
            onChange={(e) => setExpiresAt(e.target.value === '' ? null : e.target.value)}
          />
          {expiresAt ? (
            <button
              type="button"
              className="btn btn--sm btn--ghost"
              style={{ alignSelf: 'flex-start' }}
              onClick={() => setExpiresAt(null)}
            >
              <IconClose size={12} />
              {t('expiry.fieldClear')}
            </button>
          ) : null}
          <div className="expiry-field__quick">
            {EXPIRY_QUICK_CHOICES.map(({ days, labelKey }) => (
              <Button
                key={days}
                size="sm"
                onClick={() => setExpiresAt(addDaysToISODate(todayISODate(), days))}
              >
                {t(labelKey)}
              </Button>
            ))}
          </div>
          <div className="field__hint">{t('expiry.fieldHint')}</div>
          {expiryIsPast ? (
            <div className="expiry-field__warning small">{t('expiry.fieldPastWarning')}</div>
          ) : null}
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
            {t('itemEdit.moreToggle')}
          </button>

          {moreOpen ? (
            <div className="stack" style={{ paddingTop: 'var(--gap-2)' }}>
              <div className="field">
                <span className="field__label">{t('itemEdit.fieldTags')}</span>
                <TagInput
                  value={tags}
                  onChange={setTags}
                  suggestions={data.tags.map((tag) => tag.name)}
                />
                <div className="field__hint">{t('itemEdit.tagsHint')}</div>
              </div>

              <div className="field">
                <span className="field__label">{t('itemEdit.fieldCollections')}</span>
                <CollectionPicker
                  value={collectionIds}
                  onChange={setCollectionIds}
                  collections={data.collections}
                  onCreate={(name) => {
                    const id = addCollection(name)
                    if (id === null) return null
                    // 刚建的顺手勾上 —— 用户在这里输名字就是为了把东西放进去
                    setCollectionIds((prev) => (prev.includes(id) ? prev : [...prev, id]))
                    return id
                  }}
                />
                <div className="field__hint">{t('itemEdit.collectionsHint')}</div>
              </div>

              <div className="field">
                <label className="field__label" htmlFor="item-note">
                  {t('itemEdit.fieldNote')}
                </label>
                <textarea
                  id="item-note"
                  className="textarea"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={t('itemEdit.notePlaceholder')}
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
                {t('itemEdit.fieldAttributes')}
              </div>
              <div className="field__hint">{t('itemEdit.attributesHint')}</div>
            </div>
            <Button onClick={() => setAttrPickerOpen(true)}>
              <IconPlus size={13} />
              {t('itemEdit.addAttributes')}
            </Button>
          </div>

          {selectedAttrDefs.length === 0 ? (
            <div className="dim small">
              {attrDefs.length === 0
                ? t('itemEdit.attributesEmptyLibrary')
                : t('itemEdit.attributesEmptySelected')}
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
                    title={t('itemEdit.removeAttrTitle', { name: def.name })}
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
              {t('common.save')}
            </Button>
          ) : (
            <>
              <Button variant="primary" size="lg" onClick={() => save(true)}>
                {t('itemEdit.saveAndContinue')}
              </Button>
              <Button size="lg" onClick={() => save(false)}>
                {t('itemEdit.saveAndBack')}
              </Button>
            </>
          )}
          <span className="spacer" />
          <span className="tiny dim">{isEdit ? '' : t('itemEdit.ctrlEnterHint')}</span>
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
