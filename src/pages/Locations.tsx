import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ItemRow } from '../components/ItemRow'
import { TreeView } from '../components/TreeView'
import { LocationPicker } from '../components/pickers'
import { IconPencil, IconPlus, IconTrash } from '../components/ui/icons'
import { Button, ConfirmDialog, EmptyState, Modal, Switch } from '../components/ui/primitives'
import { useT } from '../i18n'
import {
  countByLocationIncludingDescendants,
  itemsInLocation,
  liveItems,
} from '../store/selectors'
import { useAppStore } from '../store/useAppStore'
import { UNASSIGNED_ID } from '../types'

interface NameDialogState {
  mode: 'add' | 'rename'
  parentId: string | null
  targetId?: string
  initial: string
  title: string
}

export function Locations() {
  const navigate = useNavigate()
  const data = useAppStore((s) => s.data)
  const derived = useAppStore((s) => s.derived)
  const ui = useAppStore((s) => s.ui)
  const setUi = useAppStore((s) => s.setUi)
  const addLocation = useAppStore((s) => s.addLocation)
  const renameLocation = useAppStore((s) => s.renameLocation)
  const deleteLocation = useAppStore((s) => s.deleteLocation)
  const moveLocation = useAppStore((s) => s.moveLocation)
  const setIdle = useAppStore((s) => s.setIdle)
  const notify = useAppStore((s) => s.notify)

  // 拿 t/tc 的同时也订阅了语言：切语言时这个页面会整个重新渲染
  const { t, tc } = useT()

  const [selected, setSelected] = useState<string | null>(null)
  const [touched, setTouched] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [expandInit, setExpandInit] = useState(false)

  const [nameDialog, setNameDialog] = useState<NameDialogState | null>(null)
  const [nameDraft, setNameDraft] = useState('')
  const [moveTarget, setMoveTarget] = useState<string | null>(null)
  const [deleteProbe, setDeleteProbe] = useState<{
    id: string
    name: string
    childCount: number
    itemCount: number
  } | null>(null)

  // 首次拿到位置数据后，默认把整棵树展开
  useEffect(() => {
    if (expandInit || derived.flat.length === 0) return
    setExpanded(new Set(derived.flat.map((n) => n.node.id)))
    setExpandInit(true)
  }, [derived.flat, expandInit])

  const live = useMemo(() => liveItems(data), [data])
  const counts = useMemo(
    () => countByLocationIncludingDescendants(live, derived),
    [live, derived],
  )

  // 还没点过任何位置时，默认选中第一个顶层位置（比默认看「未归位」友好）
  const activeId = touched ? selected : (derived.tree[0]?.node.id ?? null)

  const scopedItems = useMemo(
    () => itemsInLocation(live, activeId, ui.includeDescendants, derived),
    [live, activeId, ui.includeDescendants, derived],
  )

  const activeLabel = activeId
    ? derived.index.pathString(activeId, ' / ')
    : t('status.unassigned')
  const directCount = data.items.filter((i) => i.locationId === activeId).length

  const openAddDialog = (parentId: string | null) => {
    setNameDraft('')
    setNameDialog({
      mode: 'add',
      parentId,
      initial: '',
      title: parentId
        ? t('locations.addChildTitle', { name: derived.index.byId.get(parentId)?.name ?? '' })
        : t('locations.addTopTitle'),
    })
  }

  const openRenameDialog = (id: string) => {
    const loc = derived.index.byId.get(id)
    if (!loc) return
    setNameDraft(loc.name)
    setNameDialog({
      mode: 'rename',
      parentId: loc.parentId,
      targetId: id,
      initial: loc.name,
      title: t('locations.renameTitle'),
    })
  }

  const submitNameDialog = () => {
    if (!nameDialog) return
    const name = nameDraft.trim()
    if (name === '') return
    if (nameDialog.mode === 'add') {
      const created = addLocation(name, nameDialog.parentId)
      if (!created) {
        notify(t('locations.addFailed'), 'error')
        return
      }
      if (nameDialog.parentId) {
        setExpanded((prev) => new Set(prev).add(nameDialog.parentId as string))
      }
      notify(t('locations.addDone'), 'success')
    } else if (nameDialog.targetId) {
      renameLocation(nameDialog.targetId, name)
      notify(t('locations.renameDone'), 'success')
    }
    setNameDialog(null)
  }

  const handleDelete = (id: string) => {
    const loc = derived.index.byId.get(id)
    if (!loc) return
    const result = deleteLocation(id)
    if (result.ok) {
      notify(t('locations.deleteDone', { name: loc.name }), 'success')
      if (activeId === id) {
        setSelected(null)
        setTouched(true)
      }
      return
    }
    setDeleteProbe({
      id,
      name: loc.name,
      childCount: result.childCount,
      itemCount: result.itemCount,
    })
  }

  // 删除确认框里「还有 N 个子位置、M 件物品」那一段。
  // 分隔符也走词典：中文是顿号，英文得写成 and。
  const deleteContents = [
    deleteProbe && deleteProbe.childCount > 0
      ? tc(deleteProbe.childCount, 'locations.deleteChildCount')
      : null,
    deleteProbe && deleteProbe.itemCount > 0
      ? tc(deleteProbe.itemCount, 'locations.deleteItemCount')
      : null,
  ]
    .filter((part): part is string => part !== null)
    .join(t('locations.deleteJoin'))

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-header__title">{t('nav.titleLocations')}</div>
          <div className="page-header__sub">
            {tc(data.locations.length, 'locations.subtitle')}
          </div>
        </div>
        <div className="page-header__actions">
          <Button variant="primary" onClick={() => openAddDialog(null)}>
            <IconPlus size={13} />
            {t('locations.newTop')}
          </Button>
        </div>
      </div>

      {data.locations.length === 0 ? (
        <EmptyState
          title={t('locations.empty')}
          hint={
            <>
              {t('locations.emptyHint')}
              <br />
              {t('locations.emptyHintExample')}
            </>
          }
          action={
            <Button variant="primary" onClick={() => openAddDialog(null)}>
              {t('locations.createFirst')}
            </Button>
          }
        />
      ) : (
        <div className="split">
          {/* ---------------- 左：位置树 ---------------- */}
          <div className="split__side">
            <TreeView
              nodes={derived.tree}
              selectedIds={activeId ? [activeId] : [UNASSIGNED_ID]}
              onSelect={(id) => {
                setSelected(id)
                setTouched(true)
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
              virtualRoot={{
                id: UNASSIGNED_ID,
                label: t('status.unassigned'),
                count: counts.get(UNASSIGNED_ID) ?? 0,
              }}
              renderActions={(node) => (
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    title={t('locations.addChild')}
                    onClick={() => openAddDialog(node.id)}
                  >
                    <IconPlus size={12} />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    title={t('locations.moveUnder')}
                    onClick={() => setMoveTarget(node.id)}
                  >
                    ↑
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    title={t('common.rename')}
                    onClick={() => openRenameDialog(node.id)}
                  >
                    <IconPencil size={12} />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    title={t('common.delete')}
                    onClick={() => handleDelete(node.id)}
                  >
                    <IconTrash size={12} />
                  </Button>
                </>
              )}
            />
          </div>

          {/* ---------------- 右：该位置的物品 ---------------- */}
          <div>
            <div className="row-between wrap" style={{ marginBottom: 'var(--gap-3)' }}>
              <div>
                <div style={{ fontSize: 'var(--fs-h2)', fontWeight: 600 }}>{activeLabel}</div>
                <div className="small muted">
                  {tc(scopedItems.length, 'locations.countHere')}
                  {activeId && ui.includeDescendants && directCount !== scopedItems.length
                    ? tc(directCount, 'locations.directHere')
                    : null}
                </div>
              </div>
              {activeId ? (
                <Switch
                  checked={ui.includeDescendants}
                  onChange={(v) => setUi({ includeDescendants: v })}
                  label={t('locations.includeDescendants')}
                />
              ) : null}
            </div>

            {scopedItems.length === 0 ? (
              <EmptyState
                title={activeId ? t('locations.scopedEmpty') : t('locations.unassignedEmpty')}
                hint={
                  activeId ? t('locations.scopedEmptyHint') : t('locations.unassignedEmptyHint')
                }
              />
            ) : (
              <ul className="list">
                {scopedItems.map((item) => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    ctx={derived}
                    onOpen={(itemId) => navigate(`/items/${itemId}`)}
                    actions={
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setIdle(item.id, item.status !== 'idle')}
                      >
                        {item.status === 'idle'
                          ? t('locations.markActive')
                          : t('locations.markIdle')}
                      </Button>
                    }
                  />
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* ---------------- 新建 / 重命名 ---------------- */}
      <Modal
        open={nameDialog !== null}
        title={nameDialog?.title ?? ''}
        onClose={() => setNameDialog(null)}
        maxWidth={400}
        footer={
          <>
            <Button onClick={() => setNameDialog(null)}>{t('common.cancel')}</Button>
            <Button variant="primary" onClick={submitNameDialog} disabled={nameDraft.trim() === ''}>
              {t('common.confirm')}
            </Button>
          </>
        }
      >
        <input
          className="input"
          autoFocus
          value={nameDraft}
          placeholder={t('locations.namePlaceholder')}
          onChange={(e) => setNameDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              submitNameDialog()
            }
          }}
        />
      </Modal>

      {/* ---------------- 移动位置 ---------------- */}
      <LocationPicker
        open={moveTarget !== null}
        onClose={() => setMoveTarget(null)}
        value={null}
        onSelect={(newParentId) => {
          if (moveTarget === null) return
          const result = moveLocation(moveTarget, newParentId)
          if (result.ok) {
            notify(t('locations.moveDone'), 'success')
            if (newParentId) setExpanded((prev) => new Set(prev).add(newParentId))
          } else {
            notify(result.reason ?? t('locations.moveFailed'), 'error')
          }
          setMoveTarget(null)
        }}
        ctx={derived}
        counts={counts}
      />

      {/* ---------------- 删除有内容的位置 ---------------- */}
      <ConfirmDialog
        open={deleteProbe !== null}
        title={t('locations.deleteTitle', { name: deleteProbe?.name ?? '' })}
        danger
        confirmLabel={t('locations.deleteConfirm')}
        message={
          <>
            {t('locations.deleteBodyLead', { list: deleteContents })}
            <br />
            <br />
            {t('locations.deleteBodyHint', { unassigned: t('status.unassigned') })}
          </>
        }
        onConfirm={() => {
          if (!deleteProbe) return
          const result = deleteLocation(deleteProbe.id, null)
          if (result.ok) {
            notify(
              t('locations.deleteMovedDone', { unassigned: t('status.unassigned') }),
              'success',
            )
            setSelected(null)
            setTouched(true)
          } else {
            notify(result.reason ?? t('locations.deleteFailed'), 'error')
          }
          setDeleteProbe(null)
        }}
        onCancel={() => setDeleteProbe(null)}
      />
    </>
  )
}
