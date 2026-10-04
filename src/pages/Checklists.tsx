import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  IconArrowLeft,
  IconCheck,
  IconChevronRight,
  IconClock,
  IconClose,
  IconPlus,
  IconTrash,
} from '../components/ui/icons'
import { Button, ConfirmDialog, EmptyState, Modal } from '../components/ui/primitives'
import type { Checklist, ChecklistEntry } from '../types'
import { useT } from '../i18n'
import { useAppStore } from '../store/useAppStore'

/**
 * 清单。**一次性的待办**，和作为模板的「活动合集」是两回事。
 *
 * 这一页的设计目标就一条：**在出门前那一晚好用**。
 * 所以打钩要一步完成、改条目要能就地改、办完能一键清掉或整份删掉。
 *
 * 条目是**快照**（名字和数量都是抄下来的），物品后来改名或删掉都不影响这份清单 ——
 * 清单里还可以有库里根本没有的东西（顺路买瓶水）。
 */
export function Checklists() {
  const { id } = useParams<{ id: string }>()
  return id === undefined ? <ChecklistList /> : <ChecklistDetail id={id} />
}

/* ------------------------------------------------------------------ */
/* 列表                                                                */
/* ------------------------------------------------------------------ */

function ChecklistList() {
  const navigate = useNavigate()
  const data = useAppStore((s) => s.data)
  const renameChecklist = useAppStore((s) => s.renameChecklist)
  const deleteChecklist = useAppStore((s) => s.deleteChecklist)
  const notify = useAppStore((s) => s.notify)
  const { t, tc } = useT()

  const [renaming, setRenaming] = useState<Checklist | null>(null)
  const [deleting, setDeleting] = useState<Checklist | null>(null)

  // 最近的排前面 —— 清单是临时的，用得最勤的那个才该在最上面
  const sorted = useMemo(
    () => [...data.checklists].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [data.checklists],
  )

  const collectionName = (collectionId: string | null): string | null => {
    if (collectionId === null) return null
    return data.collections.find((c) => c.id === collectionId)?.name ?? null
  }

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-header__title">{t('nav.titleChecklists')}</div>
          <div className="page-header__sub">{t('checklists.subtitle')}</div>
        </div>
        <div className="page-header__actions">
          <Button onClick={() => navigate('/items')}>{t('checklists.createFromItems')}</Button>
        </div>
      </div>

      {sorted.length === 0 ? (
        <EmptyState
          title={t('checklists.emptyTitle')}
          hint={
            <>
              {t('checklists.emptyHint')}
              <br />
              {t('checklists.emptyHintSecond')}
            </>
          }
          action={
            <Button variant="primary" onClick={() => navigate('/items')}>
              {t('checklists.createFromItems')}
            </Button>
          }
        />
      ) : (
        <ul className="list">
          {sorted.map((checklist) => {
            const total = checklist.entries.length
            const done = checklist.entries.filter((e) => e.checked).length
            const from = collectionName(checklist.fromCollectionId)

            return (
              <li key={checklist.id} className="list-row">
                <button
                  type="button"
                  className="list-row__main"
                  onClick={() => navigate(`/checklists/${checklist.id}`)}
                >
                  <span className="list-row__title">
                    {checklist.name}
                    {total > 0 && done === total ? (
                      <span className="checklist-done" title={t('checklists.allDone')}>
                        <IconCheck size={12} />
                      </span>
                    ) : null}
                  </span>
                  <span className="list-row__meta">
                    <span className="badge">{tc(total, 'checklists.count')}</span>
                    {total > 0 ? (
                      <span className="truncate">
                        {t('checklists.progress', { done, total })}
                      </span>
                    ) : null}
                    {from !== null ? (
                      <span className="truncate dim">
                        {t('checklists.fromCollection', { name: from })}
                      </span>
                    ) : null}
                  </span>
                </button>
                <div className="list-row__actions">
                  <Button
                    size="sm"
                    variant="ghost"
                    title={t('common.rename')}
                    onClick={() => setRenaming(checklist)}
                  >
                    {t('common.rename')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    title={t('common.delete')}
                    onClick={() => setDeleting(checklist)}
                  >
                    <IconTrash size={14} />
                  </Button>
                  <span className="list-row__caret">
                    <IconChevronRight size={14} />
                  </span>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <NameChecklistDialog
        checklist={renaming}
        onClose={() => setRenaming(null)}
        onConfirm={(name) => {
          if (renaming !== null) renameChecklist(renaming.id, name)
          setRenaming(null)
          notify(t('checklists.renamedToast'), 'success')
        }}
      />

      <ConfirmDialog
        open={deleting !== null}
        title={t('checklists.deleteTitle')}
        danger
        confirmLabel={t('common.delete')}
        message={
          <>
            {t('checklists.deleteBodyLead')}
            <strong>{t('checklists.deleteBodyStrong')}</strong>
            {t('checklists.deleteBodyTail')}
          </>
        }
        onConfirm={() => {
          if (deleting !== null) {
            deleteChecklist(deleting.id)
            notify(t('checklists.deleteToast', { name: deleting.name }), 'success')
          }
          setDeleting(null)
        }}
        onCancel={() => setDeleting(null)}
      />
    </>
  )
}

/* ------------------------------------------------------------------ */
/* 详情：打钩 + 就地编辑                                                */
/* ------------------------------------------------------------------ */

function ChecklistDetail({ id }: { id: string }) {
  const navigate = useNavigate()
  const data = useAppStore((s) => s.data)
  const toggleChecklistEntry = useAppStore((s) => s.toggleChecklistEntry)
  const updateChecklistEntry = useAppStore((s) => s.updateChecklistEntry)
  const addChecklistEntry = useAppStore((s) => s.addChecklistEntry)
  const removeChecklistEntry = useAppStore((s) => s.removeChecklistEntry)
  const clearCheckedEntries = useAppStore((s) => s.clearCheckedEntries)
  const renameChecklist = useAppStore((s) => s.renameChecklist)
  const deleteChecklist = useAppStore((s) => s.deleteChecklist)
  const notify = useAppStore((s) => s.notify)
  const { t } = useT()

  const [draft, setDraft] = useState('')
  const [renameOpen, setRenameOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const draftRef = useRef<HTMLInputElement>(null)

  const checklist = data.checklists.find((c) => c.id === id)

  // 换清单时清掉输入框里没提交的内容，否则会把上一条带到下一份清单里
  useEffect(() => {
    setDraft('')
  }, [id])

  if (checklist === undefined) {
    return (
      <>
        <div className="page-header">
          <div>
            <div className="page-header__title">{t('nav.titleChecklists')}</div>
          </div>
        </div>
        <EmptyState
          title={t('checklists.emptyTitle')}
          action={<Button onClick={() => navigate('/checklists')}>{t('checklists.backToList')}</Button>}
        />
      </>
    )
  }

  const total = checklist.entries.length
  const done = checklist.entries.filter((e) => e.checked).length
  const collection = data.collections.find((c) => c.id === checklist.fromCollectionId)

  const submitDraft = () => {
    if (draft.trim() === '') return
    addChecklistEntry(checklist.id, draft)
    setDraft('')
    // 连着加好几条是常态，所以加完把焦点留在输入框里
    draftRef.current?.focus()
  }

  return (
    <>
      <div className="page-header">
        <div>
          <button type="button" className="crumb" onClick={() => navigate('/checklists')}>
            <IconArrowLeft size={13} />
            {t('checklists.backToList')}
          </button>
          <div className="page-header__title">
            <IconClock size={18} /> {checklist.name}
          </div>
          <div className="page-header__sub">
            {total === 0
              ? t('checklists.detailSubtitle')
              : done === total
                ? t('checklists.allDone')
                : t('checklists.progress', { done, total })}
            {collection !== undefined ? (
              <>
                {' · '}
                {t('checklists.fromCollection', { name: collection.name })}
              </>
            ) : null}
          </div>
        </div>
        <div className="page-header__actions">
          <Button onClick={() => setRenameOpen(true)}>{t('common.rename')}</Button>
          <Button variant="danger" onClick={() => setDeleteOpen(true)}>
            {t('common.delete')}
          </Button>
        </div>
      </div>

      {total === 0 ? (
        <div className="notice" style={{ marginBottom: 'var(--gap-4)' }}>
          <span className="notice__icon">
            <IconClock size={16} />
          </span>
          <span className="notice__body small">
            <strong>{t('checklists.emptyEntriesTitle')}</strong>
            <br />
            {t('checklists.emptyEntriesHint')}
          </span>
        </div>
      ) : (
        <>
          {/* 进度条：出门前想知道「还差几件」，一眼看得出比数数字强 */}
          <div className="checklist-progress" role="presentation">
            <span
              className="checklist-progress__fill"
              style={{ width: `${total === 0 ? 0 : (done / total) * 100}%` }}
            />
          </div>

          <ul className="checklist">
            {checklist.entries.map((entry) => (
              <ChecklistRow
                key={entry.id}
                entry={entry}
                itemExists={
                  entry.itemId !== null && data.items.some((item) => item.id === entry.itemId)
                }
                onToggle={() => toggleChecklistEntry(checklist.id, entry.id)}
                onRename={(name) => updateChecklistEntry(checklist.id, entry.id, { name })}
                onQuantity={(quantity) =>
                  updateChecklistEntry(checklist.id, entry.id, { quantity })
                }
                onRemove={() => {
                  removeChecklistEntry(checklist.id, entry.id)
                  notify(t('checklists.entryRemovedToast'), 'success')
                }}
                onOpenItem={
                  entry.itemId !== null
                    ? () => navigate(`/items/${entry.itemId}`)
                    : undefined
                }
              />
            ))}
          </ul>

          <div className="row wrap" style={{ marginTop: 'var(--gap-3)', marginBottom: 'var(--gap-5)' }}>
            {done > 0 ? (
              <>
                <Button
                  size="sm"
                  onClick={() => {
                    const removed = clearCheckedEntries(checklist.id)
                    notify(t('checklists.clearCheckedToast', { count: removed }), 'success')
                  }}
                >
                  {t('checklists.clearChecked', { count: done })}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    // 打错了想全撤：一条条点回去太烦
                    for (const entry of checklist.entries) {
                      if (entry.checked) toggleChecklistEntry(checklist.id, entry.id, false)
                    }
                  }}
                >
                  {t('checklists.uncheckAll')}
                </Button>
              </>
            ) : null}
          </div>
        </>
      )}

      {/* 加一条：库里有没有这件东西都行 */}
      <div className="field">
        <label className="field__label" htmlFor="checklist-add">
          {t('checklists.addEntry')}
        </label>
        <div className="row">
          <input
            id="checklist-add"
            ref={draftRef}
            className="input grow"
            value={draft}
            placeholder={t('checklists.addEntryPlaceholder')}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitDraft()
            }}
          />
          <Button variant="primary" disabled={draft.trim() === ''} onClick={submitDraft}>
            <IconPlus size={14} />
          </Button>
        </div>
        <div className="tiny dim" style={{ marginTop: 4 }}>
          {t('checklists.addEntryHint')}
        </div>
      </div>

      <NameChecklistDialog
        checklist={renameOpen ? checklist : null}
        onClose={() => setRenameOpen(false)}
        onConfirm={(name) => {
          renameChecklist(checklist.id, name)
          setRenameOpen(false)
          notify(t('checklists.renamedToast'), 'success')
        }}
      />

      <ConfirmDialog
        open={deleteOpen}
        title={t('checklists.deleteTitle')}
        danger
        confirmLabel={t('common.delete')}
        message={
          <>
            {t('checklists.deleteBodyLead')}
            <strong>{t('checklists.deleteBodyStrong')}</strong>
            {t('checklists.deleteBodyTail')}
          </>
        }
        onConfirm={() => {
          deleteChecklist(checklist.id)
          setDeleteOpen(false)
          notify(t('checklists.deleteToast', { name: checklist.name }), 'success')
          navigate('/checklists')
        }}
        onCancel={() => setDeleteOpen(false)}
      />
    </>
  )
}

/* ------------------------------------------------------------------ */
/* 一行：勾选框 + 名字 + 数量 + 删                                     */
/* ------------------------------------------------------------------ */

function ChecklistRow({
  entry,
  itemExists,
  onToggle,
  onRename,
  onQuantity,
  onRemove,
  onOpenItem,
}: {
  entry: ChecklistEntry
  /** 关联的物品还在不在库里 —— 不在就别说「点进去看」了 */
  itemExists: boolean
  onToggle: () => void
  onRename: (name: string) => void
  onQuantity: (quantity: number) => void
  onRemove: () => void
  onOpenItem?: () => void
}) {
  const { t } = useT()
  // 名字就地改：输入框一直存在，但只有聚焦时才像个框 ——
  // 这样「一眼看清单」和「随手改名」不互相打架
  const [name, setName] = useState(entry.name)

  useEffect(() => {
    setName(entry.name)
  }, [entry.name])

  return (
    <li className={`checklist__row${entry.checked ? ' is-checked' : ''}`}>
      <label className="checklist__check">
        <input
          type="checkbox"
          checked={entry.checked}
          aria-label={t('checklists.checkAria', { name: entry.name })}
          onChange={onToggle}
        />
      </label>

      <input
        className="checklist__name"
        value={name}
        aria-label={t('checklists.entryNamePlaceholder')}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => {
          if (name.trim() === '') {
            setName(entry.name) // 空名字不接受，悄悄还原
            return
          }
          if (name !== entry.name) onRename(name)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
        }}
      />

      <input
        className="checklist__qty"
        type="number"
        min={1}
        value={entry.quantity}
        aria-label={t('checklists.quantityAria')}
        onChange={(e) => onQuantity(Number(e.target.value))}
      />

      {entry.itemId !== null ? (
        itemExists ? (
          <button
            type="button"
            className="checklist__link"
            title={t('checklists.goToItem')}
            onClick={onOpenItem}
          >
            <IconChevronRight size={13} />
          </button>
        ) : (
          <span className="checklist__gone tiny dim" title={t('checklists.itemGone')}>
            <IconClose size={12} />
          </span>
        )
      ) : (
        // 库里没有的东西（顺路买的）留个空位，让三列仍然对齐
        <span className="checklist__link" />
      )}

      <button
        type="button"
        className="checklist__remove"
        title={t('checklists.removeEntry')}
        aria-label={t('checklists.removeEntry')}
        onClick={onRemove}
      >
        <IconClose size={13} />
      </button>
    </li>
  )
}

/* ------------------------------------------------------------------ */
/* 命名弹框（新建走物品列表那条路，这里只管改名）                        */
/* ------------------------------------------------------------------ */

function NameChecklistDialog({
  checklist,
  onClose,
  onConfirm,
}: {
  checklist: Checklist | null
  onClose: () => void
  onConfirm: (name: string) => void
}) {
  const { t } = useT()
  const [draft, setDraft] = useState('')

  useEffect(() => {
    if (checklist !== null) setDraft(checklist.name)
  }, [checklist])

  const trimmed = draft.trim()

  return (
    <Modal
      open={checklist !== null}
      title={t('checklists.renameTitle')}
      onClose={onClose}
      maxWidth={400}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" disabled={trimmed === ''} onClick={() => onConfirm(trimmed)}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <input
        className="input"
        autoFocus
        value={draft}
        placeholder={t('checklists.namePlaceholder')}
        aria-label={t('checklists.namePlaceholder')}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && trimmed !== '') onConfirm(trimmed)
        }}
      />
    </Modal>
  )
}

/** 供物品列表页复用：勾了几件，给这份新清单起个名字 */
export function CreateChecklistDialog({
  open,
  itemCount,
  defaultName,
  onClose,
  onConfirm,
}: {
  open: boolean
  itemCount: number
  defaultName: string
  onClose: () => void
  onConfirm: (name: string) => void
}) {
  const { t, tc } = useT()
  const [draft, setDraft] = useState(defaultName)

  useEffect(() => {
    if (open) setDraft(defaultName)
  }, [open, defaultName])

  const trimmed = draft.trim()

  return (
    <Modal
      open={open}
      title={t('checklists.createTitle')}
      onClose={onClose}
      maxWidth={400}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" disabled={trimmed === ''} onClick={() => onConfirm(trimmed)}>
            {t('common.create')}
          </Button>
        </>
      }
    >
      <div className="stack">
        <input
          className="input"
          autoFocus
          value={draft}
          placeholder={t('checklists.namePlaceholder')}
          aria-label={t('checklists.namePlaceholder')}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && trimmed !== '') onConfirm(trimmed)
          }}
        />
        <div className="small muted">{tc(itemCount, 'checklists.count')}</div>
      </div>
    </Modal>
  )
}
