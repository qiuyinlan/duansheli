import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ItemRow } from '../components/ItemRow'
import { IconCalendar, IconTrash } from '../components/ui/icons'
import { Button, ConfirmDialog, EmptyState } from '../components/ui/primitives'
import type { Item } from '../types'
import { compareExpiry, expiryState } from '../lib/expiry'
import { t, tc, useT } from '../i18n'
import { useAppStore } from '../store/useAppStore'

/** 阈值备选值。「即将过期」到底算多少天，不同的人差很多，所以给一排现成的 */
const THRESHOLD_CHOICES = [3, 7, 14, 30, 60, 90, 180, 365]

export function Expiry() {
  const navigate = useNavigate()
  const data = useAppStore((s) => s.data)
  const derived = useAppStore((s) => s.derived)
  const soonDays = useAppStore((s) => s.ui.expirySoonDays)
  const showLater = useAppStore((s) => s.ui.expiryShowLater)
  const setUi = useAppStore((s) => s.setUi)
  const setExpiry = useAppStore((s) => s.setExpiry)
  const batchSetStatus = useAppStore((s) => s.batchSetStatus)
  const notify = useAppStore((s) => s.notify)

  // useT() 一方面是拿 t/tc，另一方面是**订阅语言**：
  // 语言一换这个组件就会重新渲染，页面上所有文字才会跟着变。
  useT()

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmOpen, setConfirmOpen] = useState(false)

  // 只在用 + 闲置里找；已舍弃的不该再提醒到期
  const buckets = useMemo(() => {
    const live = data.items.filter((item) => item.status !== 'discarded')
    const expired: Item[] = []
    const soon: Item[] = []
    const later: Item[] = []
    const none: Item[] = []

    for (const item of live) {
      switch (expiryState(item.expiresAt, soonDays)) {
        case 'expired':
          expired.push(item)
          break
        case 'soon':
          soon.push(item)
          break
        case 'ok':
          later.push(item)
          break
        default:
          none.push(item)
      }
    }

    // 已过期：过期最久的排前面（更该处理）；即将过期：最急的排前面
    expired.sort((a, b) => compareExpiry(a.expiresAt, b.expiresAt, 'asc'))
    soon.sort((a, b) => compareExpiry(a.expiresAt, b.expiresAt, 'asc'))
    later.sort((a, b) => compareExpiry(a.expiresAt, b.expiresAt, 'asc'))
    none.sort((a, b) => a.name.localeCompare(b.name))

    return { expired, soon, later, none }
  }, [data.items, soonDays])

  const urgent = useMemo(
    () => [...buckets.expired, ...buckets.soon],
    [buckets.expired, buckets.soon],
  )

  const hasExpiryCount = buckets.expired.length + buckets.soon.length + buckets.later.length

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectedIds = useMemo(() => [...selected], [selected])
  const allSelected = urgent.length > 0 && urgent.every((i) => selected.has(i.id))

  /* ---- 一件都没填：引导去填，而不是给一个空列表 ---- */
  if (hasExpiryCount === 0 && buckets.none.length > 0) {
    return (
      <>
        <PageHeader />
        <EmptyState
          title={t('expiry.nothingSet')}
          hint={t('expiry.nothingSetHint')}
          action={<Button onClick={() => navigate('/items')}>{t('nav.items')}</Button>}
        />
      </>
    )
  }

  /* ---- 填了，但最近没有要到期的 ---- */
  if (urgent.length === 0 && !showLater) {
    return (
      <>
        <PageHeader />
        <EmptyState
          title={t('expiry.allClear')}
          hint={t('expiry.allClearHint')}
          action={
            <Button onClick={() => setUi({ expiryShowLater: true })}>
              {t('expiry.showLaterLabel')}
            </Button>
          }
        />
      </>
    )
  }

  const renderGroup = (key: string, label: string, items: Item[]) => {
    if (items.length === 0) return null
    return (
      <section key={key} style={{ marginBottom: 'var(--gap-5)' }}>
        <div className="row-between wrap" style={{ marginBottom: 'var(--gap-2)' }}>
          <div className={`expiry-group__title expiry-group__title--${key}`}>
            {label} <span className="dim numeric">{items.length}</span>
          </div>
        </div>
        <ul className="list">
          {items.map((item) => (
            <ItemRow
              key={item.id}
              item={item}
              ctx={derived}
              selectable={key === 'expired' || key === 'soon'}
              selected={selected.has(item.id)}
              onToggleSelect={toggleSelect}
              onOpen={(id) => navigate(`/items/${id}`)}
              actions={
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setExpiry([item.id], null)
                      notify(t('common.saved'), 'success')
                    }}
                  >
                    {t('expiry.fieldClear')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    title={t('common.delete')}
                    onClick={() => {
                      batchSetStatus([item.id], 'discarded')
                      notify(t('expiry.discardedToast', { count: 1 }), 'success')
                    }}
                  >
                    <IconTrash size={14} />
                  </Button>
                </>
              }
            />
          ))}
        </ul>
      </section>
    )
  }

  return (
    <>
      <PageHeader />

      {/* ---- 概览 + 阈值设置 ---- */}
      <div className="expiry-summary" style={{ marginBottom: 'var(--gap-5)' }}>
        <div className="expiry-summary__counts">
          {buckets.expired.length > 0 ? (
            <span className="expiry-summary__pill expiry-summary__pill--expired">
              {tc(buckets.expired.length, 'expiry.countExpired')}
            </span>
          ) : null}
          {buckets.soon.length > 0 ? (
            <span className="expiry-summary__pill expiry-summary__pill--soon">
              {tc(buckets.soon.length, 'expiry.countSoon', { days: soonDays })}
            </span>
          ) : null}
          {buckets.none.length > 0 ? (
            <span className="expiry-summary__pill expiry-summary__pill--none">
              {t('expiry.countNone', { count: buckets.none.length })}
            </span>
          ) : null}
        </div>

        <div className="expiry-summary__settings">
          <label className="row" style={{ gap: 'var(--gap-2)' }}>
            <span className="small muted">{t('expiry.thresholdLabel')}</span>
            <select
              className="select"
              value={String(soonDays)}
              onChange={(e) => setUi({ expirySoonDays: Number(e.target.value) })}
            >
              {THRESHOLD_CHOICES.map((days) => (
                <option key={days} value={days}>
                  {t('expiry.thresholdDays', { count: days })}
                </option>
              ))}
            </select>
          </label>
          <label className="checkbox small muted">
            <input
              type="checkbox"
              checked={showLater}
              onChange={(e) => setUi({ expiryShowLater: e.target.checked })}
            />
            <span>{t('expiry.showLaterLabel')}</span>
          </label>
        </div>
        <div className="tiny dim">{t('expiry.thresholdHint')}</div>
      </div>

      {/* ---- 批量操作 ---- */}
      {urgent.length > 0 ? (
        <div className="row-between wrap" style={{ marginBottom: 'var(--gap-3)' }}>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={() =>
                setSelected(allSelected ? new Set() : new Set(urgent.map((i) => i.id)))
              }
            />
            <span className="small muted">
              {t('common.selectAll')}（{urgent.length}）
            </span>
          </label>

          {selected.size > 0 ? (
            <div className="row">
              <span className="small muted">{tc(selected.size, 'format.countItems')}</span>
              <Button
                size="sm"
                onClick={() => {
                  setExpiry(selectedIds, null)
                  notify(t('expiry.handleSelected', { count: selectedIds.length }), 'success')
                  setSelected(new Set())
                }}
              >
                {t('expiry.fieldClear')}
              </Button>
              <Button size="sm" onClick={() => setConfirmOpen(true)}>
                {t('expiry.discardSelected', { count: selectedIds.length })}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* ---- 三/四组清单 ---- */}
      {renderGroup('expired', t('expiry.groupExpired'), buckets.expired)}
      {renderGroup('soon', t('expiry.groupSoon'), buckets.soon)}
      {showLater ? renderGroup('later', t('expiry.groupLater'), buckets.later) : null}
      {showLater ? renderGroup('none', t('expiry.groupNone'), buckets.none) : null}

      <ConfirmDialog
        open={confirmOpen}
        title={t('common.confirmDeleteTitle')}
        danger
        confirmLabel={t('expiry.discardSelected', { count: selectedIds.length })}
        message={t('common.confirmDeleteBody')}
        onConfirm={() => {
          batchSetStatus(selectedIds, 'discarded')
          notify(t('expiry.discardedToast', { count: selectedIds.length }), 'success')
          setSelected(new Set())
          setConfirmOpen(false)
        }}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  )
}

function PageHeader() {
  return (
    <div className="page-header">
      <div>
        <div className="page-header__title">
          <IconCalendar size={18} /> {t('nav.titleExpiry')}
        </div>
        <div className="page-header__sub">{t('expiry.subtitle')}</div>
      </div>
    </div>
  )
}
