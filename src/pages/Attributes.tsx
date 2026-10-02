import { useMemo, useState } from 'react'
import { IconPencil, IconPlus, IconTrash } from '../components/ui/icons'
import { Button, ConfirmDialog, EmptyState, IconButton, Modal, Switch } from '../components/ui/primitives'
import { useAppStore } from '../store/useAppStore'
import type { AttrType, AttributeDef } from '../types'

const TYPE_LABEL: Record<AttrType, string> = {
  text: '文本',
  number: '数字',
  date: '日期',
  select: '单选',
  bool: '是/否',
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
      notify('单选类型至少需要一个选项', 'error')
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
        notify(`已经有一个叫「${name}」的属性了`, 'error')
        return
      }
      notify('已添加属性', 'success')
    } else {
      updateAttributeDef(form.id, {
        name,
        type: form.type,
        options,
        unit: form.unit,
        showByDefault: form.showByDefault,
      })
      notify('已保存（已有物品上的值不会丢失）', 'success')
    }
    setForm(null)
  }

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-header__title">属性</div>
          <div className="page-header__sub">
            这里定义「可以用哪些属性」，录入时再按需勾选 —— 用不上就不会出现在表单里。
          </div>
        </div>
        <div className="page-header__actions">
          <Button variant="primary" onClick={() => setForm({ ...EMPTY_FORM })}>
            <IconPlus size={13} />
            新建属性
          </Button>
        </div>
      </div>

      {sorted.length === 0 ? (
        <EmptyState
          title="属性库还是空的"
          hint={
            <>
              想记什么就定义什么，常见的有：品牌、购入日期、价格、颜色、尺寸、型号。
              <br />
              定义好之后，录入物品时勾一下就能填。
            </>
          }
          action={
            <Button variant="primary" onClick={() => setForm({ ...EMPTY_FORM })}>
              新建第一个属性
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
                  {def.name}
                  {def.unit ? <span className="dim">（{def.unit}）</span> : null}
                </span>
                <span className="manage-row__meta">
                  {TYPE_LABEL[def.type]}
                  {def.type === 'select' && def.options.length > 0
                    ? ` · ${def.options.length} 个选项`
                    : ''}
                  {def.showByDefault ? ' · 默认勾选' : ''}
                </span>
                <span className="manage-row__meta">{count} 处使用</span>
                <div className="manage-row__actions">
                  <IconButton
                    label="编辑"
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
                    label="删除"
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
        title={form?.id ? '编辑属性' : '新建属性'}
        onClose={() => setForm(null)}
        footer={
          <>
            <Button onClick={() => setForm(null)}>取消</Button>
            <Button variant="primary" onClick={submit} disabled={(form?.name.trim() ?? '') === ''}>
              保存
            </Button>
          </>
        }
      >
        {form ? (
          <div className="stack">
            <div className="field">
              <label className="field__label" htmlFor="attr-name">
                属性名称 <span className="field__label-required">必填</span>
              </label>
              <input
                id="attr-name"
                className="input"
                autoFocus
                value={form.name}
                placeholder="例如：品牌"
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>

            <div className="field">
              <label className="field__label" htmlFor="attr-type">
                类型
              </label>
              <select
                id="attr-type"
                className="select"
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value as AttrType })}
              >
                <option value="text">文本 —— 随便写</option>
                <option value="number">数字 —— 可以比较大小</option>
                <option value="date">日期</option>
                <option value="select">单选 —— 只能从固定选项里挑</option>
                <option value="bool">是 / 否</option>
              </select>
            </div>

            {form.type === 'select' ? (
              <div className="field">
                <label className="field__label" htmlFor="attr-options">
                  选项 <span className="field__label-required">用逗号分隔</span>
                </label>
                <input
                  id="attr-options"
                  className="input"
                  value={form.optionsText}
                  placeholder="黑，白，灰，木色"
                  onChange={(e) => setForm({ ...form, optionsText: e.target.value })}
                />
              </div>
            ) : null}

            {form.type === 'number' ? (
              <div className="field">
                <label className="field__label" htmlFor="attr-unit">
                  单位 <span className="field__label-required">可选</span>
                </label>
                <input
                  id="attr-unit"
                  className="input"
                  value={form.unit}
                  placeholder="例如：元、cm、kg"
                  onChange={(e) => setForm({ ...form, unit: e.target.value })}
                />
              </div>
            ) : null}

            <Switch
              checked={form.showByDefault}
              onChange={(v) => setForm({ ...form, showByDefault: v })}
              label="录入物品时默认勾选这个属性"
            />

            <div className="field__hint">
              提示：录入时勾选过一次之后，程序会记住「这个分类常用哪些属性」，下次自动带上。
            </div>
          </div>
        ) : null}
      </Modal>

      {/* ---------------- 删除 ---------------- */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title={`删除属性「${deleteTarget?.def.name ?? ''}」？`}
        danger
        confirmLabel="删除"
        message={
          deleteTarget && deleteTarget.count > 0 ? (
            <>
              有 <span className="numeric">{deleteTarget.count}</span> 处已经填了这个属性的值。
              <br />
              <br />
              删除后这些值将不再显示（物品本身和其他信息都不受影响）。
              删除前会自动存一份快照，之后也可以回退。
            </>
          ) : (
            <>还没有任何物品填过这个属性，可以放心删除。</>
          )
        }
        onConfirm={() => {
          if (!deleteTarget) return
          deleteAttributeDef(deleteTarget.def.id)
          notify('已删除属性', 'success')
          setDeleteTarget(null)
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  )
}
