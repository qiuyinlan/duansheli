import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { BarChart } from '../components/ui/BarChart'
import { IconAlert, IconChevronRight } from '../components/ui/icons'
import { Button, EmptyState } from '../components/ui/primitives'
import { daysSince, formatRelative, percent } from '../lib/format'
import { UNASSIGNED_ID, UNCATEGORIZED_ID, UNTAGGED_ID } from '../types'
import {
  computeStats,
  countByCategory,
  countByStatus,
  countByTag,
  countByTopLocation,
  liveItems,
} from '../store/selectors'
import { useAppStore } from '../store/useAppStore'

export function Overview() {
  const data = useAppStore((s) => s.data)
  const derived = useAppStore((s) => s.derived)
  const lastExportAt = useAppStore((s) => s.ui.lastExportAt)
  const navigate = useNavigate()

  const stats = useMemo(() => computeStats(data), [data])
  const live = useMemo(() => liveItems(data), [data])
  const byCategory = useMemo(() => countByCategory(live, derived), [live, derived])
  const byLocation = useMemo(() => countByTopLocation(live, derived), [live, derived])
  const byTag = useMemo(() => countByTag(live, derived), [live, derived])
  const byStatus = useMemo(() => countByStatus(data.items), [data.items])

  const idlePercent = percent(stats.idleCount, stats.totalItems)
  const backupOverdue =
    stats.totalItems > 0 && (lastExportAt === null || daysSince(lastExportAt) >= 7)

  if (stats.totalItems === 0) {
    return (
      <>
        <div className="page-header">
          <div>
            <div className="page-header__title">概览</div>
            <div className="page-header__sub">你的家当会在这里变成一张图</div>
          </div>
        </div>

        <EmptyState
          title="还没有录入任何物品"
          hint={
            <>
              先录一件试试 —— 只要填个名称就能存下，其余都是可选的。
              <br />
              分类、位置、属性库已经替你准备好了一套常用的起步内容，随时可以改。
            </>
          }
          action={
            <Button variant="primary" onClick={() => navigate('/items/new')}>
              录入第一件物品
            </Button>
          }
        />
      </>
    )
  }

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-header__title">概览</div>
          <div className="page-header__sub">
            最近更新于 {formatRelative(data.updatedAt)}
          </div>
        </div>
        <div className="page-header__actions">
          <Button onClick={() => navigate('/items/new')}>录入物品</Button>
        </div>
      </div>

      {backupOverdue ? (
        <div className="notice notice--alert" style={{ marginBottom: 'var(--gap-5)' }}>
          <span className="notice__icon">
            <IconAlert />
          </span>
          <span className="notice__body">
            {lastExportAt === null
              ? '数据只存在这台设备的浏览器里，还没有导出过备份。清一次浏览器数据就全没了。'
              : `上次导出备份是 ${formatRelative(lastExportAt)}，建议重新导出一份。`}
          </span>
          <span className="notice__action">
            <Button size="sm" onClick={() => navigate('/settings')}>
              去备份
            </Button>
          </span>
        </div>
      ) : null}

      <div className="overview-hero">
        <span className="overview-hero__value numeric">{stats.totalItems}</span>
        <span className="overview-hero__label">件物品（不含已舍弃）</span>
      </div>

      <div className="stat-grid" style={{ marginBottom: 'var(--gap-6)' }}>
        <button type="button" className="stat" onClick={() => navigate('/items')}>
          <span className="stat__value numeric">{stats.categoryCount}</span>
          <span className="stat__label">个分类</span>
        </button>
        <button type="button" className="stat" onClick={() => navigate('/locations')}>
          <span className="stat__value numeric">{stats.locationCount}</span>
          <span className="stat__label">个位置</span>
        </button>
        <button type="button" className="stat" onClick={() => navigate('/idle')}>
          <span className="stat__value numeric">{stats.idleCount}</span>
          <span className="stat__label">件闲置</span>
        </button>
        <button
          type="button"
          className="stat"
          onClick={() => navigate('/items?loc=__unassigned__&group=location')}
          title="查看未归位的物品"
        >
          <span className="stat__value numeric">{stats.unassignedCount}</span>
          <span className="stat__label">件未归位</span>
        </button>
      </div>

      {/* ---------------- 闲置占比：断舍离的核心指标 ---------------- */}
      <section className="section">
        <div className="idle-highlight">
          <div>
            <div className="idle-highlight__value">{idlePercent}%</div>
            <div className="tiny dim">闲置占比</div>
          </div>
          <div className="idle-highlight__text">
            {stats.idleCount === 0
              ? '目前没有闲置物品 —— 每一件都在用，很干净。'
              : `有 ${stats.idleCount} 件已经闲置。闲置越久越说明它不该留在这里。`}
          </div>
          {stats.idleCount > 0 ? (
            <Button onClick={() => navigate('/idle')}>
              去处理
              <IconChevronRight size={13} />
            </Button>
          ) : null}
        </div>
      </section>

      {/* ---------------- 按分类 ---------------- */}
      <section className="section">
        <div className="section__head">
          <div className="section__title">按分类</div>
          <div className="section__note">
            只统计顶层分类；一件物品在同一顶层下只算一次
          </div>
        </div>
        <BarChart
          data={byCategory}
          limit={8}
          emptyText="还没有设置分类"
          onSelect={(d) => {
            if (d.target?.kind === 'category') {
              navigate(`/items?cat=${encodeURIComponent(d.target.id)}&group=category`)
            } else {
              navigate(`/items?cat=${UNCATEGORIZED_ID}&group=category`)
            }
          }}
        />
      </section>

      {/* ---------------- 按位置 ---------------- */}
      <section className="section">
        <div className="section__head">
          <div className="section__title">按位置</div>
          <div className="section__note">这里只显示第一层，点进去可以看每一层</div>
        </div>
        <BarChart
          data={byLocation}
          limit={8}
          emptyText="还没有设置位置"
          onSelect={(d) => {
            if (d.target?.kind === 'location') {
              navigate(`/items?loc=${encodeURIComponent(d.target.id)}&group=location`)
            } else {
              navigate(`/items?loc=${UNASSIGNED_ID}&group=location`)
            }
          }}
        />
      </section>

      {/* ---------------- 按标签（有标签时才显示） ---------------- */}
      {byTag.length > 1 || (byTag.length === 1 && byTag[0].key !== '__untagged__') ? (
        <section className="section">
          <div className="section__head">
            <div className="section__title">按标签</div>
          </div>
          <BarChart
            data={byTag}
            limit={8}
            onSelect={(d) => {
              if (d.target?.kind === 'tag') {
                navigate(`/items?tag=${encodeURIComponent(d.target.id)}&group=tag`)
              } else {
                navigate(`/items?tag=${UNTAGGED_ID}&group=tag`)
              }
            }}
          />
        </section>
      ) : null}

      {/* ---------------- 按状态 ---------------- */}
      {stats.discardedCount > 0 ? (
        <section className="section">
          <div className="section__head">
            <div className="section__title">按状态</div>
            <div className="section__note">已舍弃的物品仍保留记录，可在设置里查看</div>
          </div>
          <BarChart
            data={byStatus}
            onSelect={(d) => {
              if (d.target?.kind === 'status') navigate(`/items?status=${d.target.id}`)
            }}
          />
        </section>
      ) : null}
    </>
  )
}
