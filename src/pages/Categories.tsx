import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ItemRow } from '../components/ItemRow'
import { TreeView } from '../components/TreeView'
import { IconPencil, IconPlus, IconTrash } from '../components/ui/icons'
import { Button, ConfirmDialog, EmptyState, Modal, Switch } from '../components/ui/primitives'
import {
  countByCategoryIncludingDescendants,
  itemsInCategory,
  liveItems,
} from '../store/selectors'
import { useAppStore } from '../store/useAppStore'
import { UNCATEGORIZED_ID } from '../types'

interface NameDialogState {
  mode: 'add' | 'rename'
  parentId: string | null
  targetId?: string
  title: string
}

/**
 * 分类管理页。
 *
 * 结构跟「位置」页完全对称 —— 都是不限层级的树，操作也一样：
 * 新建子级 / 重命名 / 移动到别处 / 删除。
 * 左边树，右边显示这个分类下的物品。
 */
export function Categories() {
  const navigate = useNavigate()

  const data = useAppStore((s) => s.data)
  const derived = useAppStore((s) => s.derived)
  const ui = useAppStore((s) => s.ui)
  const setUi = useAppStore((s) => s.setUi)
  const addCategory = useAppStore((s) => s.addCategory)
  const renameCategory = useAppStore((s) => s.renameCategory)
  const moveCategory = useAppStore((s) => s.moveCategory)
  const deleteCategory = useAppStore((s) => s.deleteCategory)
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

  // 分类树一般不大，首次拿到数据后全展开
  useEffect(() => {
    if (expandInit || derived.categoryFlat.length === 0) return
    setExpanded(new Set(derived.categoryFlat.map((node) => node.node.id)))
    setExpandInit(true)
  }, [derived.categoryFlat, expandInit])

  const live = useMemo(() => liveItems(data), [data])
  const counts = useMemo(
    () => countByCategoryIncludingDescendants(live, derived),
    [live, derived],
  )

  // 还没点过任何分类时，默认选中第一个顶层分类
  const activeId = touched ? selected : (derived.categoryTree[0]?.node.id ?? null)

  const scopedItems = useMemo(() => {
    if (activeId === null) {
      return live.filter((item) => item.categoryIds.length === 0)
    }
    return itemsInCategory(live, activeId, ui.includeDescendants, derived)
  }, [live, activeId, ui.includeDescendants, derived])

  const activeLabel = activeId
    ? derived.categoryIndex.pathString(activeId, ' / ')
    : '未分类'

  const directCount = activeId
    ? live.filter((item) => item.categoryIds.includes(activeId)).length
    : scopedItems.length

  const openAddDialog = (parentId: string | null) => {
    setNameDraft('')
    setNameDialog({
      mode: 'add',
      parentId,
      title: parentId
        ? `在「${derived.categoryById.get(parentId)?.name ?? ''}」下新建子分类`
        : '新建顶层分类',
    })
  }

  const openRenameDialog = (id: string) => {
    const category = derived.categoryById.get(id)
    if (!category) return
    setNameDraft(category.name)
    setNameDialog({
      mode: 'rename',
      parentId: category.parentId,
      targetId: id,
      title: '重命名分类',
    })
  }

  const submitNameDialog = () => {
    if (!nameDialog) return
    const name = nameDraft.trim()
    if (name === '') return

    if (nameDialog.mode === 'add') {
      const created = addCategory(name, nameDialog.parentId)
      if (!created) {
        notify('同一级下已经有同名的分类了', 'error')
        return
      }
      if (nameDialog.parentId) {
        setExpanded((prev) => new Set(prev).add(nameDialog.parentId as string))
      }
      notify('已创建分类', 'success')
    } else if (nameDialog.targetId) {
      renameCategory(nameDialog.targetId, name)
      notify('已重命名', 'success')
    }
    setNameDialog(null)
  }

  const handleDelete = (id: string) => {
    const category = derived.categoryById.get(id)
    if (!category) return

    const result = deleteCategory(id)
    if (result.ok) {
      notify(`已删除分类「${category.name}」`, 'success')
      if (activeId === id) {
        setSelected(null)
        setTouched(true)
      }
      return
    }
    setDeleteProbe({
      id,
      name: category.name,
      childCount: result.childCount,
      itemCount: result.itemCount,
    })
  }

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-header__title">分类</div>
          <div className="page-header__sub">
            分类管的是「这是什么」。可以分很多级，比如 化妆品 › 眼妆；一件物品可以同时属于多个分类。
          </div>
        </div>
        <div className="page-header__actions">
          <Button variant="primary" onClick={() => openAddDialog(null)}>
            <IconPlus size={13} />
            新建分类
          </Button>
        </div>
      </div>

      {data.categories.length === 0 ? (
        <EmptyState
          title="还没有分类"
          hint={
            <>
              先建几个常用的顶层分类就好，比如：衣物、电子、日用品。
              <br />
              之后随时可以在任意分类下面继续加子分类。
            </>
          }
          action={
            <Button variant="primary" onClick={() => openAddDialog(null)}>
              创建第一个分类
            </Button>
          }
        />
      ) : (
        <div className="split">
          {/* ---------------- 左：分类树 ---------------- */}
          <div className="split__side">
            <TreeView
              nodes={derived.categoryTree}
              selectedIds={activeId ? [activeId] : [UNCATEGORIZED_ID]}
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
                id: UNCATEGORIZED_ID,
                label: '未分类',
                count: counts.get(UNCATEGORIZED_ID) ?? 0,
              }}
              renderActions={(node) => (
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    title="新建子分类"
                    onClick={() => openAddDialog(node.id)}
                  >
                    <IconPlus size={12} />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    title="移动到其他分类下"
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

          {/* ---------------- 右：该分类下的物品 ---------------- */}
          <div>
            <div className="row-between wrap" style={{ marginBottom: 'var(--gap-3)' }}>
              <div>
                <div style={{ fontSize: 'var(--fs-h2)', fontWeight: 600 }}>{activeLabel}</div>
                <div className="small muted">
                  共 <span className="numeric">{scopedItems.length}</span> 件
                  {activeId && ui.includeDescendants && directCount !== scopedItems.length
                    ? `（其中 ${directCount} 件直接挂在这里）`
                    : ''}
                </div>
              </div>
              {activeId ? (
                <Switch
                  checked={ui.includeDescendants}
                  onChange={(v) => setUi({ includeDescendants: v })}
                  label="含子分类"
                />
              ) : null}
            </div>

            {scopedItems.length === 0 ? (
              <EmptyState
                title={activeId ? '这个分类下还没有物品' : '所有物品都已经分类了'}
                hint={
                  activeId
                    ? '空分类没问题 —— 先建好结构，东西可以慢慢归。'
                    : '每一件东西都找到了自己的位置。'
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
                        onClick={() =>
                          navigate(`/items?cat=${encodeURIComponent(activeId ?? '')}&group=category`)
                        }
                      >
                        筛选
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
            <Button
              variant="primary"
              onClick={submitNameDialog}
              disabled={nameDraft.trim() === ''}
            >
              确定
            </Button>
          </>
        }
      >
        <input
          className="input"
          autoFocus
          value={nameDraft}
          placeholder="例如：眼妆"
          onChange={(e) => setNameDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              submitNameDialog()
            }
          }}
        />
      </Modal>

      {/* ---------------- 移动分类 ---------------- */}
      <MoveCategoryDialog
        open={moveTarget !== null}
        onClose={() => setMoveTarget(null)}
        onPick={(newParentId) => {
          if (moveTarget === null) return
          const result = moveCategory(moveTarget, newParentId)
          if (result.ok) {
            notify('已移动分类', 'success')
            if (newParentId) setExpanded((prev) => new Set(prev).add(newParentId))
          } else {
            notify(result.reason ?? '移动失败', 'error')
          }
          setMoveTarget(null)
        }}
      />

      {/* ---------------- 删除有内容的分类 ---------------- */}
      <ConfirmDialog
        open={deleteProbe !== null}
        title={`删除分类「${deleteProbe?.name ?? ''}」？`}
        danger
        confirmLabel="移到未分类并删除"
        message={
          <>
            这个分类下还有
            {deleteProbe && deleteProbe.childCount > 0
              ? ` ${deleteProbe.childCount} 个子分类`
              : ''}
            {deleteProbe && deleteProbe.childCount > 0 && deleteProbe.itemCount > 0 ? '、' : ''}
            {deleteProbe && deleteProbe.itemCount > 0
              ? ` ${deleteProbe.itemCount} 件物品`
              : ''}
            。
            <br />
            <br />
            继续的话，<strong>子分类会挂到顶层</strong>、直接挂在这里的物品会变成「未分类」——
            东西本身都不会丢，子分类里的物品也不受影响。删除前会自动存一份快照。
          </>
        }
        onConfirm={() => {
          if (!deleteProbe) return
          const result = deleteCategory(deleteProbe.id, null)
          if (result.ok) {
            notify('已删除分类，内容已妥善安置', 'success')
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

/* ------------------------------------------------------------------ */
/* 移动目标选择器                                                      */
/* ------------------------------------------------------------------ */

function MoveCategoryDialog({
  open,
  onClose,
  onPick,
}: {
  open: boolean
  onClose: () => void
  onPick: (newParentId: string | null) => void
}) {
  const derived = useAppStore((s) => s.derived)
  const data = useAppStore((s) => s.data)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (open) setExpanded(new Set(derived.categoryFlat.map((node) => node.node.id)))
  }, [open, derived.categoryFlat])

  const counts = useMemo(
    () => countByCategoryIncludingDescendants(liveItems(data), derived),
    [data, derived],
  )

  return (
    <Modal
      open={open}
      title="移动分类"
      onClose={onClose}
      footer={<Button onClick={onClose}>取消</Button>}
    >
      <div className="dim small" style={{ marginBottom: 'var(--gap-3)' }}>
        选一个新的上级分类。选「移到顶层」就把它提为顶层分类。
        <br />
        （它自己的子分类会跟着一起走）
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
          selectedIds={[]}
          onSelect={(id) => onPick(id)}
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
          virtualRoot={{ id: UNCATEGORIZED_ID, label: '移到顶层', count: 0 }}
        />
      </div>
    </Modal>
  )
}
