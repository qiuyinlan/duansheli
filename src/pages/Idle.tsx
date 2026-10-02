import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ItemRow } from '../components/ItemRow'
import { IconTrash } from '../components/ui/icons'
import { Button, ConfirmDialog, EmptyState } from '../components/ui/primitives'
import { daysSince, formatDays, percent } from '../lib/format'
import { computeStats, liveItems, sortByIdleDuration } from '../store/selectors'
import { useAppStore } from '../store/useAppStore'

export function Idle() {
  const navigate = useNavigate()
  const data = useAppStore((s) => s.data)
  const derived = useAppStore((s) => s.derived)
  const setIdle = useAppStore((s) => s.setIdle)
  const batchSetStatus = useAppStore((s) => s.batchSetStatus)
  const notify = useAppStore((s) => s.notify)

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
            <div className="page-header__title">闲置</div>
            <div className="page-header__sub">标记为闲置的物品会汇总到这里</div>
          </div>
        </div>
        <EmptyState
          title="闲置已清空"
          hint={
            <>
              没有一件东西处在「闲置」状态 —— 很干净。
              <br />
              以后发现有东西一直没动，就在物品列表里点一下「闲置」，它就会出现在这里。
            </>
          }
          action={<Button onClick={() => navigate('/items')}>去物品列表</Button>}
        />
      </>
    )
  }

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-header__title">闲置</div>
          <div className="page-header__sub">
            闲置越久的排越前面 —— 最该被处理的自动浮到顶上
          </div>
        </div>
      </div>

      <div className="idle-highlight" style={{ marginBottom: 'var(--gap-5)' }}>
        <div>
          <div className="idle-highlight__value">{idleItems.length}</div>
          <div className="tiny dim">件闲置</div>
        </div>
        <div className="idle-highlight__text">
          占全部物品的 {idlePercent}%
          {oldestDays > 0 ? `，最久的已经闲置了 ${formatDays(oldestDays)}` : ''}。
          <br />
          看一遍，能扔的就点「已处理」。
        </div>
      </div>

      <div className="row-between wrap" style={{ marginBottom: 'var(--gap-3)' }}>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={() => setSelected(allSelected ? new Set() : new Set(idleItems.map((i) => i.id)))}
          />
          <span className="small muted">全选这 {idleItems.length} 件</span>
        </label>

        {selected.size > 0 ? (
          <div className="row">
            <span className="small muted">已选 {selected.size} 件</span>
            <Button
              size="sm"
              onClick={() => {
                batchSetStatus(selectedIds, 'active')
                notify(`已把 ${selectedIds.length} 件改回「在用」`, 'success')
                setSelected(new Set())
              }}
            >
              改回在用
            </Button>
            <Button size="sm" onClick={() => setConfirmOpen(true)}>
              已处理（舍弃）
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
                    改回在用
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    title="已处理（移入已舍弃）"
                    onClick={() => {
                      batchSetStatus([item.id], 'discarded')
                      notify('已移入「已舍弃」，可在设置里找回', 'success')
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
        title="确认已处理？"
        danger
        confirmLabel="已处理"
        message={
          <>
            将把选中的 {selectedIds.length} 件物品标记为「已舍弃」。
            <br />
            记录不会消失，可以在「设置 → 已舍弃回收站」里找回。
          </>
        }
        onConfirm={() => {
          batchSetStatus(selectedIds, 'discarded')
          notify(`已处理 ${selectedIds.length} 件，闲置清单又短了一点`, 'success')
          setSelected(new Set())
          setConfirmOpen(false)
        }}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  )
}
