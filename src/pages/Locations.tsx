import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ItemRow } from '../components/ItemRow'
import { TreeView } from '../components/TreeView'
import { LocationPicker } from '../components/pickers'
import { IconPencil, IconPlus, IconTrash } from '../components/ui/icons'
import { Button, ConfirmDialog, EmptyState, Modal, Switch } from '../components/ui/primitives'
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

  const activeLabel = activeId ? derived.index.pathString(activeId, ' / ') : '未归位'
  const directCount = data.items.filter((i) => i.locationId === activeId).length

  const openAddDialog = (parentId: string | null) => {
    setNameDraft('')
    setNameDialog({
      mode: 'add',
      parentId,
      initial: '',
      title: parentId ? `在「${derived.index.byId.get(parentId)?.name ?? ''}」下新建位置` : '新建顶层位置',
    })
  }

  const openRenameDialog = (id: string) => {
    const loc = derived.index.byId.get(id)
    if (!loc) return
    setNameDraft(loc.name)
    setNameDialog({ mode: 'rename', parentId: loc.parentId, targetId: id, initial: loc.name, title: '重命名位置' })
  }

  const submitNameDialog = () => {
    if (!nameDialog) return
    const name = nameDraft.trim()
    if (name === '') return
    if (nameDialog.mode === 'add') {
      const created = addLocation(name, nameDialog.parentId)
      if (!created) {
        notify('创建失败，请检查名称', 'error')
        return
      }
      if (nameDialog.parentId) {
        setExpanded((prev) => new Set(prev).add(nameDialog.parentId as string))
      }
      notify('已创建位置', 'success')
    } else if (nameDialog.targetId) {
      renameLocation(nameDialog.targetId, name)
      notify('已重命名', 'success')
    }
    setNameDialog(null)
  }

  const handleDelete = (id: string) => {
    const loc = derived.index.byId.get(id)
    if (!loc) return
    const result = deleteLocation(id)
    if (result.ok) {
      notify(`已删除位置「${loc.name}」`, 'success')
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

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-header__title">位置</div>
          <div className="page-header__sub">
            共 <span className="numeric">{data.locations.length}</span> 个位置，层级不限，想加多深都行
          </div>
        </div>
        <div className="page-header__actions">
          <Button variant="primary" onClick={() => openAddDialog(null)}>
            <IconPlus size={13} />
            新建位置
          </Button>
        </div>
      </div>

      {data.locations.length === 0 ? (
        <EmptyState
          title="还没有创建任何位置"
          hint={
            <>
              位置可以一层层往下分，比如：
              <br />
              家 › 卧室 › 衣柜 › 第二层抽屉
            </>
          }
          action={
            <Button variant="primary" onClick={() => openAddDialog(null)}>
              创建第一个位置
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
                label: '未归位',
                count: counts.get(UNASSIGNED_ID) ?? 0,
              }}
              renderActions={(node) => (
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    title="新建子位置"
                    onClick={() => openAddDialog(node.id)}
                  >
                    <IconPlus size={12} />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    title="移动到其他位置下"
                    onClick={() => setMoveTarget(node.id)}
                  >
                    ↑
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    title="重命名"
                    onClick={() => openRenameDialog(node.id)}
                  >
                    <IconPencil size={12} />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    title="删除"
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
                  共 <span className="numeric">{scopedItems.length}</span> 件
                  {activeId && ui.includeDescendants && directCount !== scopedItems.length
                    ? `（其中 ${directCount} 件直接放在这里）`
                    : ''}
                </div>
              </div>
              {activeId ? (
                <Switch
                  checked={ui.includeDescendants}
                  onChange={(v) => setUi({ includeDescendants: v })}
                  label="含子位置"
                />
              ) : null}
            </div>

            {scopedItems.length === 0 ? (
              <EmptyState
                title={activeId ? '这个位置是空的' : '没有未归位的物品'}
                hint={
                  activeId
                    ? '空位置很好 —— 说明这里没有堆积。'
                    : '每件物品都已经有了明确的位置。'
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
                        {item.status === 'idle' ? '改回在用' : '闲置'}
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
            <Button onClick={() => setNameDialog(null)}>取消</Button>
            <Button variant="primary" onClick={submitNameDialog} disabled={nameDraft.trim() === ''}>
              确定
            </Button>
          </>
        }
      >
        <input
          className="input"
          autoFocus
          value={nameDraft}
          placeholder="例如：第二层抽屉"
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
            notify('已移动位置', 'success')
            if (newParentId) setExpanded((prev) => new Set(prev).add(newParentId))
          } else {
            notify(result.reason ?? '移动失败', 'error')
          }
          setMoveTarget(null)
        }}
        ctx={derived}
        counts={counts}
      />

      {/* ---------------- 删除有内容的位置 ---------------- */}
      <ConfirmDialog
        open={deleteProbe !== null}
        title={`删除位置「${deleteProbe?.name ?? ''}」？`}
        danger
        confirmLabel="移动内容并删除"
        message={
          <>
            这个位置下还有
            {deleteProbe && deleteProbe.childCount > 0
              ? ` ${deleteProbe.childCount} 个子位置`
              : ''}
            {deleteProbe && deleteProbe.childCount > 0 && deleteProbe.itemCount > 0 ? '、' : ''}
            {deleteProbe && deleteProbe.itemCount > 0 ? ` ${deleteProbe.itemCount} 件物品` : ''}
            。
            <br />
            <br />
            继续的话，它们会被移动到「未归位」，物品本身不会丢失；之后可以再各自指定新位置。
          </>
        }
        onConfirm={() => {
          if (!deleteProbe) return
          const result = deleteLocation(deleteProbe.id, null)
          if (result.ok) {
            notify('已删除位置，内容已移到「未归位」', 'success')
            setSelected(null)
            setTouched(true)
          } else {
            notify(result.reason ?? '删除失败', 'error')
          }
          setDeleteProbe(null)
        }}
        onCancel={() => setDeleteProbe(null)}
      />
    </>
  )
}
