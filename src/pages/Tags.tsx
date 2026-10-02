import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { IconPencil, IconPlus, IconTrash } from '../components/ui/icons'
import { Button, ConfirmDialog, EmptyState, IconButton, Modal } from '../components/ui/primitives'
import { useAppStore } from '../store/useAppStore'

export function Tags() {
  const navigate = useNavigate()
  const data = useAppStore((s) => s.data)
  const addTag = useAppStore((s) => s.addTag)
  const renameTag = useAppStore((s) => s.renameTag)
  const deleteTag = useAppStore((s) => s.deleteTag)
  const notify = useAppStore((s) => s.notify)

  const [draft, setDraft] = useState('')
  const [renameTarget, setRenameTarget] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<{ name: string; count: number } | null>(null)

  const counts = useMemo(() => {
    const map = new Map<string, number>()
    for (const item of data.items) {
      for (const tag of new Set(item.tags)) map.set(tag, (map.get(tag) ?? 0) + 1)
    }
    return map
  }, [data.items])

  const sorted = useMemo(() => {
    const names = new Set<string>([...data.tags.map((t) => t.name), ...counts.keys()])
    return [...names].sort(
      (a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || a.localeCompare(b, 'zh-CN'),
    )
  }, [data.tags, counts])

  const create = () => {
    const name = draft.trim()
    if (name === '') return
    addTag(name)
    setDraft('')
    notify('已添加标签', 'success')
  }

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-header__title">标签</div>
          <div className="page-header__sub">
            标签管的是「什么情境」，例如「想送人」「舍不得扔」「待维修」。
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 'var(--gap-5)' }}>
        <div className="row">
          <input
            className="input grow"
            placeholder="添加一个标签"
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
        <div className="field__hint" style={{ marginTop: 'var(--gap-2)' }}>
          录入物品时也可以随手新建标签，不必先来这里。
        </div>
      </div>

      {sorted.length === 0 ? (
        <EmptyState title="还没有标签" hint="标签是可选的，不用也可以。" />
      ) : (
        <div className="list">
          {sorted.map((name) => {
            const count = counts.get(name) ?? 0
            return (
              <div key={name} className="manage-row">
                <span className="manage-row__name truncate">#{name}</span>
                <span className="manage-row__meta">{count} 件</span>
                <div className="manage-row__actions">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => navigate(`/items?tag=${encodeURIComponent(name)}&group=tag`)}
                  >
                    查看
                  </Button>
                  <IconButton
                    label="重命名"
                    onClick={() => {
                      setRenameTarget(name)
                      setRenameDraft(name)
                    }}
                  >
                    <IconPencil size={13} />
                  </IconButton>
                  <IconButton
                    label="删除"
                    onClick={() => setDeleteTarget({ name, count })}
                  >
                    <IconTrash size={13} />
                  </IconButton>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <Modal
        open={renameTarget !== null}
        title="重命名标签"
        onClose={() => setRenameTarget(null)}
        maxWidth={400}
        footer={
          <>
            <Button onClick={() => setRenameTarget(null)}>取消</Button>
            <Button
              variant="primary"
              disabled={renameDraft.trim() === ''}
              onClick={() => {
                if (renameTarget === null) return
                renameTag(renameTarget, renameDraft)
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
              if (renameTarget === null) return
              renameTag(renameTarget, renameDraft)
              setRenameTarget(null)
              notify('已重命名', 'success')
            }
          }}
        />
      </Modal>

      <ConfirmDialog
        open={deleteTarget !== null}
        title={`删除标签「${deleteTarget?.name ?? ''}」？`}
        danger
        confirmLabel="删除"
        message={
          deleteTarget && deleteTarget.count > 0 ? (
            <>
              有 <span className="numeric">{deleteTarget.count}</span> 件物品带着这个标签。
              删除后标签会被移除，物品本身不会消失。
            </>
          ) : (
            <>这个标签还没有被任何物品使用。</>
          )
        }
        onConfirm={() => {
          if (!deleteTarget) return
          deleteTag(deleteTarget.name)
          notify('已删除标签', 'success')
          setDeleteTarget(null)
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  )
}
