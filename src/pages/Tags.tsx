import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { IconPencil, IconPlus, IconTrash } from '../components/ui/icons'
import { Button, ConfirmDialog, EmptyState, IconButton, Modal } from '../components/ui/primitives'
import { useAppStore } from '../store/useAppStore'
import { t, tc, useT } from '../i18n'

export function Tags() {
  const navigate = useNavigate()
  const data = useAppStore((s) => s.data)
  const addTag = useAppStore((s) => s.addTag)
  const renameTag = useAppStore((s) => s.renameTag)
  const deleteTag = useAppStore((s) => s.deleteTag)
  const notify = useAppStore((s) => s.notify)

  // 订阅语言：语言一换这个组件就重新渲染
  useT()

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
    notify(t('tags.addToast'), 'success')
  }

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-header__title">{t('nav.titleTags')}</div>
          <div className="page-header__sub">{t('tags.subtitle')}</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 'var(--gap-5)' }}>
        <div className="row">
          <input
            className="input grow"
            placeholder={t('tags.addPlaceholder')}
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
            {t('common.add')}
          </Button>
        </div>
        <div className="field__hint" style={{ marginTop: 'var(--gap-2)' }}>
          {t('tags.addHint')}
        </div>
      </div>

      {sorted.length === 0 ? (
        <EmptyState title={t('tags.emptyTitle')} hint={t('tags.emptyHint')} />
      ) : (
        <div className="list">
          {sorted.map((name) => {
            const count = counts.get(name) ?? 0
            return (
              <div key={name} className="manage-row">
                {/* 标签名是用户自己的数据，不翻译 */}
                <span className="manage-row__name truncate">#{name}</span>
                <span className="manage-row__meta">{tc(count, 'format.countItems')}</span>
                <div className="manage-row__actions">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => navigate(`/items?tag=${encodeURIComponent(name)}&group=tag`)}
                  >
                    {t('tags.view')}
                  </Button>
                  <IconButton
                    label={t('common.rename')}
                    onClick={() => {
                      setRenameTarget(name)
                      setRenameDraft(name)
                    }}
                  >
                    <IconPencil size={13} />
                  </IconButton>
                  <IconButton
                    label={t('common.delete')}
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
        title={t('tags.renameTitle')}
        onClose={() => setRenameTarget(null)}
        maxWidth={400}
        footer={
          <>
            <Button onClick={() => setRenameTarget(null)}>{t('common.cancel')}</Button>
            <Button
              variant="primary"
              disabled={renameDraft.trim() === ''}
              onClick={() => {
                if (renameTarget === null) return
                renameTag(renameTarget, renameDraft)
                setRenameTarget(null)
                notify(t('tags.renamedToast'), 'success')
              }}
            >
              {t('common.save')}
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
              notify(t('tags.renamedToast'), 'success')
            }
          }}
        />
      </Modal>

      <ConfirmDialog
        open={deleteTarget !== null}
        title={t('tags.deleteTitle', { name: deleteTarget?.name ?? '' })}
        danger
        confirmLabel={t('common.delete')}
        message={
          deleteTarget && deleteTarget.count > 0 ? (
            <>
              {t('tags.deleteInUseLead')}
              <span className="numeric">{deleteTarget.count}</span>
              {tc(deleteTarget.count, 'tags.deleteInUseTail')}
              {t('tags.deleteInUseNote')}
            </>
          ) : (
            <>{t('tags.deleteUnused')}</>
          )
        }
        onConfirm={() => {
          if (!deleteTarget) return
          deleteTag(deleteTarget.name)
          notify(t('tags.deletedToast'), 'success')
          setDeleteTarget(null)
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  )
}
