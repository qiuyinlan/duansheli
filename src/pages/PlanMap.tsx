import { useMemo, useState } from 'react'
import { Button, EmptyState, SearchInput } from '../components/ui/primitives'
import { useT } from '../i18n'
import { useAppStore } from '../store/useAppStore'

export function PlanMap() {
  const { t } = useT()
  const entries = useAppStore((s) => s.data.planMap ?? [])
  const add = useAppStore((s) => s.addPlanMapEntry)
  const rename = useAppStore((s) => s.renamePlanMapEntry)
  const toggle = useAppStore((s) => s.togglePlanMapEntry)
  const remove = useAppStore((s) => s.deletePlanMapEntry)
  const notify = useAppStore((s) => s.notify)
  const [draft, setDraft] = useState('')
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [editName, setEditName] = useState('')

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    return [...entries]
      .filter((entry) => !needle || entry.name.toLocaleLowerCase().includes(needle))
      .sort((a, b) => Number(a.done) - Number(b.done) || a.name.localeCompare(b.name, 'zh-Hans'))
  }, [entries, query])

  const doneCount = entries.filter((entry) => entry.done).length

  const addEntry = () => {
    const name = draft.trim()
    if (!name) {
      notify(t('planMap.noName'), 'error')
      return
    }
    add(name)
    setDraft('')
  }

  const beginRename = (id: string, name: string) => {
    setEditing(id)
    setEditName(name)
  }

  const commitRename = () => {
    if (!editing) return
    const name = editName.trim()
    if (name) rename(editing, name)
    setEditing(null)
  }

  return (
    <section className="section">
      <div className="page-header">
        <div>
          <div className="page-header__title">{t('planMap.title')}</div>
          <div className="page-header__sub">{t('planMap.hint')}</div>
        </div>
        <div className="page-header__actions">
          <span className="small">{t('planMap.doneCount', { done: doneCount, total: entries.length })}</span>
        </div>
      </div>

      <div className="row" style={{ alignItems: 'stretch' }}>
        <SearchInput
          value={draft}
          onValueChange={setDraft}
          placeholder={t('planMap.searchPlaceholder')}
          aria-label={t('planMap.searchPlaceholder')}
          onKeyDown={(event) => {
            if (event.key === 'Enter') addEntry()
          }}
        />
        <Button variant="primary" disabled={!draft.trim()} onClick={addEntry}>
          {t('planMap.add')}
        </Button>
      </div>

      {entries.length > 0 ? (
        <div className="row" style={{ marginTop: 'var(--gap-2)' }}>
          <SearchInput
            value={query}
            onValueChange={setQuery}
            placeholder={t('common.search')}
            aria-label={t('common.search')}
          />
        </div>
      ) : null}

      {visible.length === 0 ? (
        <EmptyState title={entries.length === 0 ? t('planMap.emptyTitle') : t('common.noResults')} hint={entries.length === 0 ? t('planMap.emptyHint') : undefined} />
      ) : (
        <div className="list" style={{ marginTop: 'var(--gap-3)' }}>
          {visible.map((entry) => (
            <div className="row-between" key={entry.id} style={{ gap: 'var(--gap-2)', opacity: entry.done ? 0.65 : 1 }}>
              {editing === entry.id ? (
                <input
                  className="input grow"
                  value={editName}
                  autoFocus
                  onChange={(event) => setEditName(event.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') commitRename()
                    if (event.key === 'Escape') setEditing(null)
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="link-button grow"
                  style={{ textAlign: 'left', textDecoration: entry.done ? 'line-through' : undefined }}
                  onDoubleClick={() => beginRename(entry.id, entry.name)}
                  title={t('planMap.rename')}
                >
                  {entry.name}
                </button>
              )}
              <div className="row" style={{ flexShrink: 0 }}>
                <Button size="sm" variant={entry.done ? 'ghost' : 'default'} onClick={() => toggle(entry.id)}>
                  {entry.done ? t('planMap.markUndone') : t('planMap.markDone')}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => beginRename(entry.id, entry.name)}>
                  {t('planMap.rename')}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    if (window.confirm(t('planMap.confirmDelete'))) remove(entry.id)
                  }}
                >
                  {t('planMap.delete')}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

