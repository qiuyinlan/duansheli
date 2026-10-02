import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { IconPencil, IconPlus, IconTrash } from '../components/ui/icons'
import { Button, ConfirmDialog, EmptyState, IconButton, Modal } from '../components/ui/primitives'
import { useAppStore } from '../store/useAppStore'
import type { Category } from '../types'

export function Categories() {
  const navigate = useNavigate()
  const data = useAppStore((s) => s.data)
  const addCategory = useAppStore((s) => s.addCategory)
  const renameCategory = useAppStore((s) => s.renameCategory)
  const deleteCategory = useAppStore((s) => s.deleteCategory)
  const notify = useAppStore((s) => s.notify)

  const [draft, setDraft] = useState('')
  const [renameTarget, setRenameTarget] = useState<Category | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<{ category: Category; count: number } | null>(
    null,
  )

  const sorted = useMemo(
    () =>
      [...data.categories].sort(
        (a, b) => a.order - b.order || a.name.localeCompare(b.name, 'zh-CN'),
      ),
    [data.categories],
  )

  const counts = useMemo(() => {
    const map = new Map<string, number>()
    for (const item of data.items) {
      for (const id of new Set(item.categoryIds)) {
        map.set(id, (map.get(id) ?? 0) + 1)
      }
    }
    return map
    // 已舍弃的物品也算，这样删除分类前能如实告出影响范围
  }, [data.items])

  const create = () => {
    const name = draft.trim()
    if (name === '') return
    const created = addCategory(name)
    if (!created) {
      notify(`已经有一个叫「${name}」的分类了`, 'error')
      return
    }
    setDraft('')
    notify('已添加分类', 'success')
  }

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-header__title">分类</div>
          <div className="page-header__sub">
            分类管的是「这是什么」。一件物品可以同时属于多个分类。
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 'var(--gap-5)' }}>
        <div className="row">
          <input
            className="input grow"
            placeholder="添加一个分类，例如：露营装备"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                create()
              }
            }}
          />
          <Button variant="primary" onClick={create} disabled={draft.trim() === ''}>
            <IconPlus size={13} />
            添加
          </Button>
        </div>
      </div>

      {sorted.length === 0 ? (
        <EmptyState
          title="还没有分类"
          hint="先建 5～10 个常用的就好，太多反而会让人犹豫。"
        />
      ) : (
        <div className="list">
          {sorted.map((cat) => {
            const count = counts.get(cat.id) ?? 0
            return (
              <div key={cat.id} className="manage-row">
                <span className="manage-row__name truncate">{cat.name}</span>
                <span className="manage-row__meta">{count} 件</span>
                <div className="manage-row__actions">
                  <Button
                    size="sm"
                    variant="ghost"
                    title="查看这个分类下的物品"
                    onClick={() => navigate(`/items?cat=${encodeURIComponent(cat.id)}&group=category`)}
                  >
                    查看
                  </Button>
                  <IconButton
                    label="重命名"
                    onClick={() => {
                      setRenameTarget(cat)
                      setRenameDraft(cat.name)
                    }}
                  >
                    <IconPencil size={13} />
                  </IconButton>
                  <IconButton
                    label="删除"
                    onClick={() => setDeleteTarget({ category: cat, count })}
                  >
                    <IconTrash size={13} />
                  </IconButton>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ---------------- 重命名 ---------------- */}
      <Modal
        open={renameTarget !== null}
        title="重命名分类"
        onClose={() => setRenameTarget(null)}
        maxWidth={400}
        footer={
          <>
            <Button onClick={() => setRenameTarget(null)}>取消</Button>
            <Button
              variant="primary"
              disabled={renameDraft.trim() === ''}
              onClick={() => {
                if (!renameTarget) return
                renameCategory(renameTarget.id, renameDraft)
                setRenameTarget(null)
                notify('已重命名', 'success')
              }}
            >
              保存
            </Button>
          </>
        }
      >
        <input
          className="input"
          autoFocus
          value={renameDraft}
          onChange={(e) => setRenameDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              if (!renameTarget) return
              renameCategory(renameTarget.id, renameDraft)
              setRenameTarget(null)
              notify('已重命名', 'success')
            }
          }}
        />
      </Modal>

      {/* ---------------- 删除 ---------------- */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title={`删除分类「${deleteTarget?.category.name ?? ''}」？`}
        danger
        confirmLabel="删除"
        message={
          deleteTarget && deleteTarget.count > 0 ? (
            <>
              有 <span className="numeric">{deleteTarget.count}</span> 件物品使用了这个分类。
              <br />
              <br />
              删除后，这些物品的该分类标记会被移除，<strong>物品本身不会消失</strong>。
              删除前会自动存一份快照。
            </>
          ) : (
            <>没有物品在使用这个分类，可以放心删除。删除前会自动存一份快照。</>
          )
        }
        onConfirm={() => {
          if (!deleteTarget) return
          deleteCategory(deleteTarget.category.id)
          notify('已删除分类', 'success')
          setDeleteTarget(null)
        }}
        onCancel={() => setDeleteTarget(null)}
      />

      <div className="row wrap" style={{ marginTop: 'var(--gap-5)', gap: 'var(--gap-4)' }}>
        <span className="tiny dim">删除分类不会删除物品，但会影响按分类的统计。</span>
        <span className="tiny dim">执行删除前会自动存一份快照，可随时回退。</span>
      </div>
    </>
  )
}
