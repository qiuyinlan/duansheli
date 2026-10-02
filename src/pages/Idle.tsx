import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ItemRow } from '../components/ItemRow'
import { IconTrash } from '../components/ui/icons'
import { Button, ConfirmDialog, EmptyState } from '../components/ui/primitives'
import { daysSince, formatDays, percent } from '../lib/format'
import { useT } from '../i18n'
import { computeStats, liveItems, sortByIdleDuration } from '../store/selectors'
import { useAppStore } from '../store/useAppStore'

export function Idle() {
  const navigate = useNavigate()
  const data = useAppStore((s) => s.data)
  const derived = useAppStore((s) => s.derived)
  const setIdle = useAppStore((s) => s.setIdle)
  const batchSetStatus = useAppStore((s) => s.batchSetStatus)
  const notify = useAppStore((s) => s.notify)

  // useT() 一方面是拿 t，另一方面是**订阅语言**：
  // 语言一换这个页面就会重新渲染，页面上所有文字才会跟着变。
  const { t } = useT()

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmOpen, setConfirmOpen] = useState(false)

  const stats = useMemo(() => computeStats(data), [data])
  const idleItems = useMemo(
    () => sortByIdleDuration(data.items.filter((i) => i.status === 'idle')),
    [data.items],
  )

  const liveCount = useMemo(() => liveItems(data).length, [data])
  const idlePercent = percent(stats.idleCount, liveCount)

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectedIds = useMemo(() => [...selected], [selected])
  const allSelected = idleItems.length > 0 && idleItems.every((i) => selected.has(i.id))

  const oldestDays = idleItems.length
    ? daysSince(idleItems[0].idleAt ?? idleItems[0].updatedAt)
    : 0

  if (idleItems.length === 0) {
    return (
      <>
        <div className="page-header">
          <div>
            <div className="page-header__title">{t('nav.titleIdle')}</div>
            <div className="page-header__sub">{t('idle.subtitleEmpty')}</div>
          </div>
        </div>
        <EmptyState
          title={t('idle.emptyTitle')}
          hint={
            <>
              {t('idle.emptyHintFirst')}
              <br />
              {t('idle.emptyHintSecond')}
            </>
          }
          action={<Button onClick={() => navigate('/items')}>{t('idle.emptyAction')}</Button>}
        />
      </>
    )
  }

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-header__title">{t('nav.titleIdle')}</div>
          <div className="page-header__sub">{t('idle.subtitle')}</div>
        </div>
      </div>

      <div className="idle-highlight" style={{ marginBottom: 'var(--gap-5)' }}>
        <div>
          <div className="idle-highlight__value">{idleItems.length}</div>
          <div className="tiny dim">{t('idle.highlightLabel')}</div>
        </div>
        <div className="idle-highlight__text">
          {oldestDays > 0
            ? t('idle.shareOldest', { percent: idlePercent, days: formatDays(oldestDays) })
            : t('idle.share', { percent: idlePercent })}
          <br />
          {t('idle.hint')}
        </div>
      </div>

      <div className="row-between wrap" style={{ marginBottom: 'var(--gap-3)' }}>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={() => setSelected(allSelected ? new Set() : new Set(idleItems.map((i) => i.id)))}
          />
          <span className="small muted">{t('idle.selectAll', { count: idleItems.length })}</span>
        </label>

        {selected.size > 0 ? (
          <div className="row">
            <span className="small muted">{t('idle.selectedCount', { count: selected.size })}</span>
            <Button
              size="sm"
              onClick={() => {
                batchSetStatus(selectedIds, 'active')
                notify(t('idle.markedActiveToast', { count: selectedIds.length }), 'success')
                setSelected(new Set())
              }}
            >
              {t('idle.markActive')}
            </Button>
            <Button size="sm" onClick={() => setConfirmOpen(true)}>
              {t('idle.discard')}
            </Button>
          </div>
        ) : null}
      </div>

      <ul className="list">
        {idleItems.map((item) => {
          const days = daysSince(item.idleAt ?? item.updatedAt)
          return (
            <ItemRow
              key={item.id}
              item={item}
              ctx={derived}
              selectable
              selected={selected.has(item.id)}
              onToggleSelect={toggleSelect}
              onOpen={(id) => navigate(`/items/${id}`)}
              extra={
                <span className={`idle-row__days${days >= 180 ? ' idle-row__days--long' : ''}`}>
                  {formatDays(days)}
                </span>
              }
              actions={
                <>
                  <Button size="sm" variant="ghost" onClick={() => setIdle(item.id, false)}>
                    {t('idle.markActive')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    title={t('idle.discardTitle')}
                    onClick={() => {
                      batchSetStatus([item.id], 'discarded')
                      notify(t('idle.discardedToast'), 'success')
                    }}
                  >
                    <IconTrash size={14} />
                  </Button>
                </>
              }
            />
          )
        })}
      </ul>

      <ConfirmDialog
        open={confirmOpen}
        title={t('idle.confirmTitle')}
        danger
        confirmLabel={t('idle.confirmLabel')}
        message={
          <>
            {t('idle.confirmBodyFirst', { count: selectedIds.length })}
            <br />
            {t('idle.confirmBodySecond')}
          </>
        }
        onConfirm={() => {
          batchSetStatus(selectedIds, 'discarded')
          notify(t('idle.handledToast', { count: selectedIds.length }), 'success')
          setSelected(new Set())
          setConfirmOpen(false)
        }}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  )
}
