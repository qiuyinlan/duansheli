import { useMemo, useState } from 'react'
import { IconPencil, IconPlus, IconTrash } from '../components/ui/icons'
import { Button, ConfirmDialog, EmptyState, IconButton, Modal, Switch } from '../components/ui/primitives'
import { useAppStore } from '../store/useAppStore'
import type { AttrType, AttributeDef } from '../types'
import type { DictKey } from '../i18n'
import { t, tc, useT } from '../i18n'

/**
 * 属性类型的显示名。
 *
 * 表里存的是**词典 key**，不是文字 —— 如果在模块顶层就把 t() 的结果存下来，
 * 语言一换这张表不会重新求值（见 docs/i18n-约定.md 第 3 节），
 * 会出现「页面标题变英文了、列表里还是中文」这种半截状态。
 *
 * 这几个词和录入页的属性勾选器是同一套（itemEdit.attrType*），所以借过来用，
 * 免得两处各自翻译、慢慢跑偏。
 */
const TYPE_LABEL_KEY: Record<AttrType, DictKey> = {
  text: 'itemEdit.attrTypeText',
  number: 'itemEdit.attrTypeNumber',
  date: 'itemEdit.attrTypeDate',
  select: 'itemEdit.attrTypeSelect',
  bool: 'itemEdit.attrTypeBool',
}

/** 渲染时才查表，所以切换语言能正确跟着变 */
function typeLabel(type: AttrType): string {
  return t(TYPE_LABEL_KEY[type])
}

interface AttrFormState {
  id: string | null
  name: string
  type: AttrType
  /** 单选选项，用逗号或换行分隔输入 */
  optionsText: string
  unit: string
  showByDefault: boolean
}

const EMPTY_FORM: AttrFormState = {
  id: null,
  name: '',
  type: 'text',
  optionsText: '',
  unit: '',
  showByDefault: false,
}

export function Attributes() {
  const data = useAppStore((s) => s.data)
  const addAttributeDef = useAppStore((s) => s.addAttributeDef)
  const updateAttributeDef = useAppStore((s) => s.updateAttributeDef)
  const deleteAttributeDef = useAppStore((s) => s.deleteAttributeDef)
  const notify = useAppStore((s) => s.notify)

  // 订阅语言：语言一换这个组件就重新渲染，页面上所有文字才会跟着变
  useT()

  const [form, setForm] = useState<AttrFormState | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{ def: AttributeDef; count: number } | null>(
    null,
  )

  const sorted = useMemo(
    () =>
      [...data.attributeDefs].sort(
        (a, b) => a.order - b.order || a.name.localeCompare(b.name, 'zh-CN'),
      ),
    [data.attributeDefs],
  )

  const usageCount = useMemo(() => {
    const map = new Map<string, number>()
    for (const item of data.items) {
      for (const [key, value] of Object.entries(item.attrs)) {
        if (value === null || value === undefined || value === '') continue
        map.set(key, (map.get(key) ?? 0) + 1)
      }
    }
    return map
  }, [data.items])

  const submit = () => {
    if (!form) return
    const name = form.name.trim()
    if (name === '') return

    const options = form.optionsText
      .split(/[,，\n]/)
      .map((s) => s.trim())
      .filter(Boolean)

    if (form.type === 'select' && options.length === 0) {
      notify(t('attributes.needOption'), 'error')
      return
    }

    if (form.id === null) {
      const created = addAttributeDef({
        name,
        type: form.type,
        options,
        unit: form.unit,
        showByDefault: form.showByDefault,
      })
      if (!created) {
        notify(t('attributes.duplicate', { name }), 'error')
        return
      }
      notify(t('attributes.addedToast'), 'success')
    } else {
      updateAttributeDef(form.id, {
        name,
        type: form.type,
        options,
        unit: form.unit,
        showByDefault: form.showByDefault,
      })
      notify(t('attributes.savedToast'), 'success')
    }
    setForm(null)
  }

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-header__title">{t('nav.titleAttributes')}</div>
          <div className="page-header__sub">{t('attributes.subtitle')}</div>
        </div>
        <div className="page-header__actions">
          <Button variant="primary" onClick={() => setForm({ ...EMPTY_FORM })}>
            <IconPlus size={13} />
            {t('attributes.newField')}
          </Button>
        </div>
      </div>

      {sorted.length === 0 ? (
        <EmptyState
          title={t('attributes.emptyTitle')}
          hint={
            <>
              {t('attributes.emptyHint1')}
              <br />
              {t('attributes.emptyHint2')}
            </>
          }
          action={
            <Button variant="primary" onClick={() => setForm({ ...EMPTY_FORM })}>
              {t('attributes.emptyAction')}
            </Button>
          }
        />
      ) : (
        <div className="list">
          {sorted.map((def) => {
            const count = usageCount.get(def.id) ?? 0
            return (
              <div key={def.id} className="manage-row">
                <span className="manage-row__name truncate">
                  {/* 属性名是用户自己的数据，不翻译 */}
                  {def.name}
                  {def.unit ? (
                    <span className="dim">{t('itemEdit.attrUnitParen', { unit: def.unit })}</span>
                  ) : null}
                </span>
                <span className="manage-row__meta">
                  {typeLabel(def.type)}
                  {def.type === 'select' && def.options.length > 0
                    ? ` · ${tc(def.options.length, 'attributes.optionCount')}`
                    : ''}
                  {def.showByDefault ? ` · ${t('attributes.showByDefaultShort')}` : ''}
                </span>
                <span className="manage-row__meta">{tc(count, 'attributes.usage')}</span>
                <div className="manage-row__actions">
                  <IconButton
                    label={t('common.edit')}
                    onClick={() =>
                      setForm({
                        id: def.id,
                        name: def.name,
                        type: def.type,
                        optionsText: def.options.join('，'),
                        unit: def.unit,
                        showByDefault: def.showByDefault,
                      })
                    }
                  >
                    <IconPencil size={13} />
                  </IconButton>
                  <IconButton
                    label={t('common.delete')}
                    onClick={() => setDeleteTarget({ def, count })}
                  >
                    <IconTrash size={13} />
                  </IconButton>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ---------------- 新建 / 编辑 ---------------- */}
      <Modal
        open={form !== null}
        title={form?.id ? t('attributes.titleEdit') : t('attributes.newField')}
        onClose={() => setForm(null)}
        footer={
          <>
            <Button onClick={() => setForm(null)}>{t('common.cancel')}</Button>
            <Button variant="primary" onClick={submit} disabled={(form?.name.trim() ?? '') === ''}>
              {t('common.save')}
            </Button>
          </>
        }
      >
        {form ? (
          <div className="stack">
            <div className="field">
              <label className="field__label" htmlFor="attr-name">
                {t('attributes.fieldName')}{' '}
                <span className="field__label-required">{t('common.required')}</span>
              </label>
              <input
                id="attr-name"
                className="input"
                autoFocus
                value={form.name}
                placeholder={t('attributes.namePlaceholder')}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>

            <div className="field">
              <label className="field__label" htmlFor="attr-type">
                {t('attributes.fieldType')}
              </label>
              <select
                id="attr-type"
                className="select"
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value as AttrType })}
              >
                <option value="text">{t('attributes.typeOptText')}</option>
                <option value="number">{t('attributes.typeOptNumber')}</option>
                <option value="date">{t('attributes.typeOptDate')}</option>
                <option value="select">{t('attributes.typeOptSelect')}</option>
                <option value="bool">{t('attributes.typeOptBool')}</option>
              </select>
            </div>

            {form.type === 'select' ? (
              <div className="field">
                <label className="field__label" htmlFor="attr-options">
                  {t('attributes.fieldOptions')}{' '}
                  <span className="field__label-required">{t('attributes.optionsCommaHint')}</span>
                </label>
                <input
                  id="attr-options"
                  className="input"
                  value={form.optionsText}
                  placeholder={t('attributes.optionsPlaceholder')}
                  onChange={(e) => setForm({ ...form, optionsText: e.target.value })}
                />
              </div>
            ) : null}

            {form.type === 'number' ? (
              <div className="field">
                <label className="field__label" htmlFor="attr-unit">
                  {t('attributes.fieldUnit')}{' '}
                  <span className="field__label-required">{t('common.optional')}</span>
                </label>
                <input
                  id="attr-unit"
                  className="input"
                  value={form.unit}
                  placeholder={t('attributes.unitPlaceholder')}
                  onChange={(e) => setForm({ ...form, unit: e.target.value })}
                />
              </div>
            ) : null}

            <Switch
              checked={form.showByDefault}
              onChange={(v) => setForm({ ...form, showByDefault: v })}
              label={t('attributes.showByDefault')}
            />

            <div className="field__hint">{t('attributes.formHint')}</div>
          </div>
        ) : null}
      </Modal>

      {/* ---------------- 删除 ---------------- */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title={t('attributes.deleteTitle', { name: deleteTarget?.def.name ?? '' })}
        danger
        confirmLabel={t('common.delete')}
        message={
          deleteTarget && deleteTarget.count > 0 ? (
            <>
              {t('attributes.deleteInUseLead')}
              <span className="numeric">{deleteTarget.count}</span>
              {tc(deleteTarget.count, 'attributes.deleteInUseTail')}
              <br />
              <br />
              {t('attributes.deleteInUseNote')}
            </>
          ) : (
            <>{t('attributes.deleteUnused')}</>
          )
        }
        onConfirm={() => {
          if (!deleteTarget) return
          deleteAttributeDef(deleteTarget.def.id)
          notify(t('attributes.deletedToast'), 'success')
          setDeleteTarget(null)
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  )
}
