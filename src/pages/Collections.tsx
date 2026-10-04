import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ItemRow } from '../components/ItemRow'
import { IconArrowLeft, IconChevronRight, IconSuitcase } from '../components/ui/icons'
import { Button, ConfirmDialog, EmptyState, Modal } from '../components/ui/primitives'
import { CreateChecklistDialog } from './Checklists'
import type { Collection } from '../types'
import { useT } from '../i18n'
import { countByCollection, itemsInCollection, liveItems } from '../store/selectors'
import { useAppStore } from '../store/useAppStore'

/**
 * 活动合集。
 *
 * 「为了做一件事，要凑齐哪些东西」—— 旅行、学习、搬家。
 *
 * 和分类 / 位置的区别：**没有层级，是个平铺的清单**。
 * 所以这一页不做树，就是一张列表；点进去看这个活动里都有什么。
 *
 * 两个角色（列表 / 详情）写在同一个文件里，因为它们共用「新建 + 改名」那套弹框状态，
 * 拆成两个文件反而要多传一堆东西。
 */
export function Collections() {
  const { id } = useParams<{ id: string }>()
  return id === undefined ? <CollectionList /> : <CollectionDetail id={id} />
}

/* ------------------------------------------------------------------ */
/* 列表                                                                */
/* ------------------------------------------------------------------ */

function CollectionList() {
  const navigate = useNavigate()
  const data = useAppStore((s) => s.data)
  const addCollection = useAppStore((s) => s.addCollection)
  const notify = useAppStore((s) => s.notify)
  const { t, tc } = useT()

  const [createOpen, setCreateOpen] = useState(false)

  // 已舍弃的东西不算进活动的件数 —— 它们已经不在你手上了
  const rows = useMemo(
    () => countByCollection({ ...data, items: liveItems(data) }, data.collections),
    [data],
  )

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-header__title">{t('nav.titleCollections')}</div>
          <div className="page-header__sub">{t('collections.subtitle')}</div>
        </div>
        <div className="page-header__actions">
          <Button variant="primary" onClick={() => setCreateOpen(true)}>
            {t('collections.create')}
          </Button>
        </div>
      </div>

      {data.collections.length === 0 ? (
        <EmptyState
          title={t('collections.emptyTitle')}
          hint={
            <>
              {t('collections.emptyHint')}
              <br />
              {t('collections.emptyHintSecond')}
            </>
          }
          action={
            <Button variant="primary" onClick={() => setCreateOpen(true)}>
              {t('collections.createFirst')}
            </Button>
          }
        />
      ) : (
        <ul className="list">
          {rows.map(({ collection, count }) => (
            <li key={collection.id} className="list-row">
              <button
                type="button"
                className="list-row__main collection-row"
                onClick={() => navigate(`/collections/${collection.id}`)}
              >
                <span className="list-row__title">
                  <span className="collection-row__icon">
                    <IconSuitcase size={15} />
                  </span>
                  {collection.name}
                </span>
                <span className="list-row__meta">
                  {count > 0 ? (
                    <span className="badge">{tc(count, 'collections.count')}</span>
                  ) : (
                    <span className="badge dim">{t('collections.emptyBadge')}</span>
                  )}
                  {collection.note !== '' ? (
                    <span className="truncate">{collection.note}</span>
                  ) : null}
                </span>
              </button>
              <div className="list-row__actions">
                <span className="list-row__caret">
                  <IconChevronRight size={14} />
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      <CreateCollectionDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onConfirm={(name) => {
          const created = addCollection(name)
          setCreateOpen(false)
          if (created === null) return
          const isNew = !data.collections.some((c) => c.name === name.trim())
          notify(
            isNew
              ? t('collections.toastCreated', { name: name.trim() })
              : t('collections.toastDuplicate', { name: name.trim() }),
            isNew ? 'success' : 'info',
          )
          // 新建成功就直接进去，省一次点击 —— 建活动本来就是为了往里放东西
          if (isNew) navigate(`/collections/${created}`)
        }}
      />
    </>
  )
}

/* ------------------------------------------------------------------ */
/* 详情                                                                */
/* ------------------------------------------------------------------ */

function CollectionDetail({ id }: { id: string }) {
  const navigate = useNavigate()
  const data = useAppStore((s) => s.data)
  const derived = useAppStore((s) => s.derived)
  const updateCollection = useAppStore((s) => s.updateCollection)
  const deleteCollection = useAppStore((s) => s.deleteCollection)
  const removeItemsFromCollection = useAppStore((s) => s.removeItemsFromCollection)
  const createChecklist = useAppStore((s) => s.createChecklist)
  const notify = useAppStore((s) => s.notify)
  const { t, tc } = useT()

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [renameOpen, setRenameOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [checklistOpen, setChecklistOpen] = useState(false)
  const [noteDraft, setNoteDraft] = useState('')

  const collection = data.collections.find((c) => c.id === id)

  // 换活动时要清空勾选和备注草稿，否则会把上一个活动的状态带过来
  useEffect(() => {
    setSelected(new Set())
    setNoteDraft(collection?.note ?? '')
  }, [id, collection?.note])

  const items = useMemo(() => itemsInCollection(liveItems(data), id), [data, id])

  const toggleSelect = (itemId: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(itemId)) next.delete(itemId)
      else next.add(itemId)
      return next
    })
  }

  const selectedIds = useMemo(() => [...selected], [selected])

  if (collection === undefined) {
    return (
      <>
        <div className="page-header">
          <div>
            <div className="page-header__title">{t('nav.titleCollections')}</div>
          </div>
        </div>
        <EmptyState
          title={t('collections.emptyTitle')}
          action={<Button onClick={() => navigate('/collections')}>{t('collections.backToList')}</Button>}
        />
      </>
    )
  }

  return (
    <>
      <div className="page-header">
        <div>
          <button
            type="button"
            className="crumb"
            onClick={() => navigate('/collections')}
          >
            <IconArrowLeft size={13} />
            {t('collections.backToList')}
          </button>
          <div className="page-header__title">
            <IconSuitcase size={18} /> {collection.name}
          </div>
          <div className="page-header__sub">
            {tc(items.length, 'collections.count')} · {t('collections.detailSubtitle')}
          </div>
        </div>
        <div className="page-header__actions">
          <Button onClick={() => setRenameOpen(true)}>{t('common.rename')}</Button>
          <Button variant="danger" onClick={() => setDeleteOpen(true)}>
            {t('common.delete')}
          </Button>
        </div>
      </div>

      {/* 备注：改完即存，不需要额外一个保存按钮 */}
      <div className="field" style={{ marginBottom: 'var(--gap-5)' }}>
        <label className="field__label" htmlFor="collection-note">
          {t('collections.noteLabel')}
        </label>
        <input
          id="collection-note"
          className="input"
          value={noteDraft}
          placeholder={t('collections.notePlaceholder')}
          onChange={(e) => setNoteDraft(e.target.value)}
          onBlur={() => {
            if (noteDraft !== collection.note) {
              updateCollection(collection.id, { note: noteDraft })
              notify(t('collections.toastNoteSaved'), 'success')
            }
          }}
        />
      </div>

      {items.length === 0 ? (
        <EmptyState
          title={t('collections.detailEmptyTitle')}
          hint={t('collections.detailEmptyHint')}
          action={
            <Button variant="primary" onClick={() => navigate('/items')}>
              {t('collections.pickItems')}
            </Button>
          }
        />
      ) : (
        <>
          <div className="row-between wrap" style={{ marginBottom: 'var(--gap-3)' }}>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={items.length > 0 && items.every((i) => selected.has(i.id))}
                onChange={() =>
                  setSelected(
                    items.every((i) => selected.has(i.id))
                      ? new Set()
                      : new Set(items.map((i) => i.id)),
                  )
                }
              />
              <span className="small muted">
                {t('common.selectAll')}（{items.length}）
              </span>
            </label>

            {selected.size > 0 ? (
              <div className="row">
                <span className="small muted">{tc(selected.size, 'collections.count')}</span>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => setChecklistOpen(true)}
                >
                  {t('collections.makeChecklist')}
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    const removed = removeItemsFromCollection(selectedIds, collection.id)
                    notify(t('collections.removeSelected', { count: removed }), 'success')
                    setSelected(new Set())
                  }}
                >
                  {t('collections.removeSelected', { count: selected.size })}
                </Button>
              </div>
            ) : null}
          </div>

          <ul className="list">
            {items.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                ctx={derived}
                selectable
                selected={selected.has(item.id)}
                onToggleSelect={toggleSelect}
                onOpen={(itemId) => navigate(`/items/${itemId}`)}
                actions={
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      removeItemsFromCollection([item.id], collection.id)
                      notify(t('collections.removeOne'), 'success')
                    }}
                  >
                    {t('collections.removeOne')}
                  </Button>
                }
              />
            ))}
          </ul>
        </>
      )}

      <CreateCollectionDialog
        open={renameOpen}
        title={t('collections.renameTitle')}
        initial={collection.name}
        confirmLabel={t('common.save')}
        onClose={() => setRenameOpen(false)}
        onConfirm={(name) => {
          updateCollection(collection.id, { name })
          setRenameOpen(false)
          notify(t('collections.toastRenamed'), 'success')
        }}
      />

      <CreateChecklistDialog
        open={checklistOpen}
        itemCount={selectedIds.length}
        defaultName={t('collections.makeChecklistName', { name: collection.name })}
        onClose={() => setChecklistOpen(false)}
        onConfirm={(name) => {
          const created = createChecklist({
            name,
            itemIds: selectedIds,
            // 记下来源，清单页上会写「来自「旅行」」——
            // 但活动后来被删掉也不影响这份清单，它已经是一份独立的快照了
            fromCollectionId: collection.id,
          })
          setChecklistOpen(false)
          if (created === null) return
          notify(
            t('checklists.createdToast', { name, count: selectedIds.length }),
            'success',
          )
          setSelected(new Set())
          navigate(`/checklists/${created}`)
        }}
      />

      <ConfirmDialog
        open={deleteOpen}
        title={t('collections.deleteTitle')}
        danger
        confirmLabel={t('common.delete')}
        message={
          <>
            {t('collections.deleteBodyLead')}
            <strong>{t('collections.deleteBodyStrong')}</strong>
            {t('collections.deleteBodyTail')}
          </>
        }
        onConfirm={() => {
          const affected = deleteCollection(collection.id)
          setDeleteOpen(false)
          notify(
            t('collections.deleteToast', { name: collection.name, count: affected }),
            'success',
          )
          navigate('/collections')
        }}
        onCancel={() => setDeleteOpen(false)}
      />
    </>
  )
}

/* ------------------------------------------------------------------ */
/* 新建 / 改名弹框                                                     */
/* ------------------------------------------------------------------ */

function CreateCollectionDialog({
  open,
  title,
  initial = '',
  confirmLabel,
  onClose,
  onConfirm,
}: {
  open: boolean
  title?: string
  initial?: string
  confirmLabel?: string
  onClose: () => void
  onConfirm: (name: string) => void
}) {
  const { t } = useT()
  const [draft, setDraft] = useState(initial)

  // 每次打开都用最新的初始值 —— 否则改名弹框会残留上一次的名字
  useEffect(() => {
    if (open) setDraft(initial)
  }, [open, initial])

  const trimmed = draft.trim()

  return (
    <Modal
      open={open}
      title={title ?? t('collections.createTitle')}
      onClose={onClose}
      maxWidth={400}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button
            variant="primary"
            disabled={trimmed === ''}
            onClick={() => onConfirm(trimmed)}
          >
            {confirmLabel ?? t('common.confirm')}
          </Button>
        </>
      }
    >
      <input
        className="input"
        autoFocus
        value={draft}
        placeholder={t('collections.newPlaceholder')}
        aria-label={t('collections.namePlaceholder')}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && trimmed !== '') onConfirm(trimmed)
        }}
      />
    </Modal>
  )
}

/** 供物品列表页复用：选一个活动，或新建一个 */
export function AddToCollectionDialog({
  open,
  itemCount,
  onClose,
  onPick,
}: {
  open: boolean
  itemCount: number
  onClose: () => void
  onPick: (collection: Collection) => void
}) {
  const data = useAppStore((s) => s.data)
  const addCollection = useAppStore((s) => s.addCollection)
  const { t, tc } = useT()
  const [draft, setDraft] = useState('')

  useEffect(() => {
    if (open) setDraft('')
  }, [open])

  const trimmed = draft.trim()
  // 用户手打一个已经存在的名字时，意图显然是「加进去」，不是「提示重名再操作一遍」
  const matched = data.collections.find((c) => c.name === trimmed)

  const pickByName = () => {
    if (trimmed === '') return
    if (matched) {
      onPick(matched)
      return
    }
    const created = addCollection(trimmed)
    if (created === null) return
    onPick({ id: created, name: trimmed, note: '', order: data.collections.length, createdAt: '' })
  }

  return (
    <Modal
      open={open}
      title={t('collections.addTitle')}
      onClose={onClose}
      maxWidth={420}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" disabled={trimmed === ''} onClick={pickByName}>
            {matched ? t('collections.addExisting') : t('collections.createAndAdd')}
          </Button>
        </>
      }
    >
      <div className="stack">
        <div className="small muted">{t('collections.addHint')}</div>

        {data.collections.length > 0 ? (
          <div className="stack-sm">
            <div className="field__label">{t('collections.addPickExisting')}</div>
            <div className="row wrap">
              {data.collections.map((collection) => (
                <button
                  key={collection.id}
                  type="button"
                  className="chip"
                  onClick={() => onPick(collection)}
                >
                  <IconSuitcase size={13} /> {collection.name}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="stack-sm">
          <div className="field__label">{t('collections.addOrNew')}</div>
          <input
            className="input"
            autoFocus
            value={draft}
            placeholder={t('collections.newPlaceholder')}
            aria-label={t('collections.namePlaceholder')}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') pickByName()
            }}
          />
        </div>

        <div className="tiny dim">{tc(itemCount, 'collections.willAdd')}</div>
      </div>
    </Modal>
  )
}
