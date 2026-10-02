import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ItemRow } from '../components/ItemRow'
import { TreeView } from '../components/TreeView'
import { IconPencil, IconPlus, IconTrash } from '../components/ui/icons'
import { Button, ConfirmDialog, EmptyState, Modal, Switch } from '../components/ui/primitives'
import { useT } from '../i18n'
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
  /*
   * 注意这里**不存译好的标题**，标题在渲染时由 mode / parentId 现推。
   * 存字符串平时看不出问题（对话框的全屏遮罩正好盖住了右上角的语言开关），
   * 但那只是碰巧成立 —— 一旦遮罩不盖顶栏了，就会变成
   * 「别处都变了、就这一处没变」这种最难查的症状。理由同 Locations.tsx。
   */
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
    : t('status.uncategorized')

  const directCount = activeId
    ? live.filter((item) => item.categoryIds.includes(activeId)).length
    : scopedItems.length

  /** 对话框标题现推，不存进 state —— 存了就会把当时那门语言冻住（见 NameDialogState 的注释） */
  const nameDialogTitle =
    nameDialog === null
      ? ''
      : nameDialog.mode === 'rename'
        ? t('categories.renameTitle')
        : nameDialog.parentId
          ? t('categories.addChildTitle', {
              name: derived.categoryById.get(nameDialog.parentId)?.name ?? '',
            })
          : t('categories.addTopTitle')

  const openAddDialog = (parentId: string | null) => {
    setNameDraft('')
    setNameDialog({ mode: 'add', parentId })
  }

  const openRenameDialog = (id: string) => {
    const category = derived.categoryById.get(id)
    if (!category) return
    setNameDraft(category.name)
    setNameDialog({ mode: 'rename', parentId: category.parentId, targetId: id })
  }

  const submitNameDialog = () => {
    if (!nameDialog) return
    const name = nameDraft.trim()
    if (name === '') return

    if (nameDialog.mode === 'add') {
      const created = addCategory(name, nameDialog.parentId)
      if (!created) {
        notify(t('categories.addDuplicate'), 'error')
        return
      }
      if (nameDialog.parentId) {
        setExpanded((prev) => new Set(prev).add(nameDialog.parentId as string))
      }
      notify(t('categories.addDone'), 'success')
    } else if (nameDialog.targetId) {
      renameCategory(nameDialog.targetId, name)
      notify(t('categories.renameDone'), 'success')
    }
    setNameDialog(null)
  }

  const handleDelete = (id: string) => {
    const category = derived.categoryById.get(id)
    if (!category) return

    const result = deleteCategory(id)
    if (result.ok) {
      notify(t('categories.deleteDone', { name: category.name }), 'success')
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

  // 删除确认框里「还有 N 个子分类、M 件物品」那一段。
  // 分隔符也走词典：中文是顿号，英文得写成 and。
  const deleteContents = [
    deleteProbe && deleteProbe.childCount > 0
      ? tc(deleteProbe.childCount, 'categories.deleteChildCount')
      : null,
    deleteProbe && deleteProbe.itemCount > 0
      ? tc(deleteProbe.itemCount, 'categories.deleteItemCount')
      : null,
  ]
    .filter((part): part is string => part !== null)
    .join(t('categories.deleteJoin'))

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-header__title">{t('nav.titleCategories')}</div>
          <div className="page-header__sub">{t('categories.subtitle')}</div>
        </div>
        <div className="page-header__actions">
          <Button variant="primary" onClick={() => openAddDialog(null)}>
            <IconPlus size={13} />
            {t('categories.newTop')}
          </Button>
        </div>
      </div>

      {data.categories.length === 0 ? (
        <EmptyState
          title={t('categories.empty')}
          hint={
            <>
              {t('categories.emptyHint')}
              <br />
              {t('categories.emptyHintSecond')}
            </>
          }
          action={
            <Button variant="primary" onClick={() => openAddDialog(null)}>
              {t('categories.createFirst')}
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
                label: t('status.uncategorized'),
                count: counts.get(UNCATEGORIZED_ID) ?? 0,
              }}
              renderActions={(node) => (
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    title={t('categories.addChild')}
                    onClick={() => openAddDialog(node.id)}
                  >
                    <IconPlus size={12} />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    title={t('categories.moveUnder')}
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

          {/* ---------------- 右：该分类下的物品 ---------------- */}
          <div>
            <div className="row-between wrap" style={{ marginBottom: 'var(--gap-3)' }}>
              <div>
                <div style={{ fontSize: 'var(--fs-h2)', fontWeight: 600 }}>{activeLabel}</div>
                <div className="small muted">
                  {tc(scopedItems.length, 'categories.countHere')}
                  {activeId && ui.includeDescendants && directCount !== scopedItems.length
                    ? tc(directCount, 'categories.directHere')
                    : null}
                </div>
              </div>
              {activeId ? (
                <Switch
                  checked={ui.includeDescendants}
                  onChange={(v) => setUi({ includeDescendants: v })}
                  label={t('categories.includeDescendants')}
                />
              ) : null}
            </div>

            {scopedItems.length === 0 ? (
              <EmptyState
                title={activeId ? t('categories.scopedEmpty') : t('categories.allAssignedEmpty')}
                hint={
                  activeId ? t('categories.scopedEmptyHint') : t('categories.allAssignedEmptyHint')
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
                        {t('categories.filter')}
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
        title={nameDialogTitle}
        onClose={() => setNameDialog(null)}
        maxWidth={400}
        footer={
          <>
            <Button onClick={() => setNameDialog(null)}>{t('common.cancel')}</Button>
            <Button
              variant="primary"
              onClick={submitNameDialog}
              disabled={nameDraft.trim() === ''}
            >
              {t('common.confirm')}
            </Button>
          </>
        }
      >
        <input
          className="input"
          autoFocus
          value={nameDraft}
          placeholder={t('categories.namePlaceholder')}
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
            notify(t('categories.moveDone'), 'success')
            if (newParentId) setExpanded((prev) => new Set(prev).add(newParentId))
          } else {
            notify(result.reason ?? t('categories.moveFailed'), 'error')
          }
          setMoveTarget(null)
        }}
      />

      {/* ---------------- 删除有内容的分类 ---------------- */}
      <ConfirmDialog
        open={deleteProbe !== null}
        title={t('categories.deleteTitle', { name: deleteProbe?.name ?? '' })}
        danger
        confirmLabel={t('categories.deleteConfirm')}
        message={
          <>
            {t('categories.deleteBodyLead', { list: deleteContents })}
            <br />
            <br />
            {t('categories.deleteBodyBefore')}
            <strong>{t('categories.deleteBodyStrong')}</strong>
            {t('categories.deleteBodyAfter', { uncategorized: t('status.uncategorized') })}
          </>
        }
        onConfirm={() => {
          if (!deleteProbe) return
          const result = deleteCategory(deleteProbe.id, null)
          if (result.ok) {
            notify(t('categories.deleteMovedDone'), 'success')
            setSelected(null)
            setTouched(true)
          } else {
            notify(result.reason ?? t('categories.deleteFailed'), 'error')
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
  const { t } = useT()
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
      title={t('categories.moveTitle')}
      onClose={onClose}
      footer={<Button onClick={onClose}>{t('common.cancel')}</Button>}
    >
      <div className="dim small" style={{ marginBottom: 'var(--gap-3)' }}>
        {t('categories.moveHint', { moveToTop: t('categories.moveToTop') })}
        <br />
        {t('categories.moveHintSecond')}
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
          virtualRoot={{ id: UNCATEGORIZED_ID, label: t('categories.moveToTop'), count: 0 }}
        />
      </div>
    </Modal>
  )
}
