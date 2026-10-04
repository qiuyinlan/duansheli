import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { BarChart } from '../components/ui/BarChart'
import { IconAlert, IconChevronRight } from '../components/ui/icons'
import { Button, EmptyState } from '../components/ui/primitives'
import { daysSince, formatRelative, percent } from '../lib/format'
import { colorForKey, topLevelColorMap } from '../lib/palette'
import { useT } from '../i18n'
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
  const soonDays = useAppStore((s) => s.ui.expirySoonDays)
  const navigate = useNavigate()

  // useT() 一方面是拿 t/tc，另一方面是**订阅语言**：
  // 语言一换这个页面就会重新渲染，页面上所有文字才会跟着变。
  const { t, tc } = useT()

  const stats = useMemo(() => computeStats(data, soonDays), [data, soonDays])
  const live = useMemo(() => liveItems(data), [data])
  const byCategory = useMemo(() => countByCategory(live, derived), [live, derived])
  const byLocation = useMemo(() => countByTopLocation(live, derived), [live, derived])
  const byTag = useMemo(() => countByTag(live, derived), [live, derived])
  const byStatus = useMemo(() => countByStatus(data.items), [data.items])

  /*
   * 图表用的取色表。
   *
   * ⚠️ key 列表必须是**完整的顶层节点**（含没有物品的），而且顺序用
   * 「分类 / 位置在树里的显示顺序」—— 和物品列表页算的是同一份。
   * 理由是配色的避让规则依赖整个 key 列表：图表只画有数量的分类、
   * 列表只渲染有内容的组，两边各算一遍就会算出不同颜色，
   * 于是出现「列表里化妆品是蓝的、图表里是绿的」。
   */
  const categoryColorOf = useMemo(() => {
    const keys = derived.categoryFlat.filter((n) => n.depth === 0).map((n) => n.node.id)
    const map = topLevelColorMap(keys)
    return (key: string) => map.get(key) ?? colorForKey(key)
  }, [derived])

  const locationColorOf = useMemo(() => {
    const keys = derived.flat.filter((n) => n.depth === 0).map((n) => n.node.id)
    const map = topLevelColorMap(keys)
    return (key: string) => map.get(key) ?? colorForKey(key)
  }, [derived])

  const idlePercent = percent(stats.idleCount, stats.totalItems)
  const backupOverdue =
    stats.totalItems > 0 && (lastExportAt === null || daysSince(lastExportAt) >= 7)

  // 到期的东西才值得占一块版面，一件都没有时整张卡片不渲染
  const urgentExpiryCount = stats.expiredCount + stats.expiringSoonCount

  if (stats.totalItems === 0) {
    return (
      <>
        <div className="page-header">
          <div>
            <div className="page-header__title">{t('nav.titleOverview')}</div>
            <div className="page-header__sub">{t('overview.subtitleEmpty')}</div>
          </div>
        </div>

        <EmptyState
          title={t('overview.emptyTitle')}
          hint={
            <>
              {t('overview.emptyHintFirst')}
              <br />
              {t('overview.emptyHintSecond')}
              <br />
              <br />
              {/* 换个网址打开也会看到这一页 —— 这句就是给那种情况准备的 */}
              <span className="dim">{t('overview.emptyOriginNote')}</span>
            </>
          }
          action={
            <Button variant="primary" onClick={() => navigate('/items/new')}>
              {t('overview.emptyAction')}
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
          <div className="page-header__title">{t('nav.titleOverview')}</div>
          <div className="page-header__sub">
            {t('overview.updatedAt', { time: formatRelative(data.updatedAt) })}
          </div>
        </div>
        <div className="page-header__actions">
          <Button onClick={() => navigate('/items/new')}>{t('overview.addItem')}</Button>
        </div>
      </div>

      {backupOverdue ? (
        <div className="notice notice--alert" style={{ marginBottom: 'var(--gap-5)' }}>
          <span className="notice__icon">
            <IconAlert />
          </span>
          <span className="notice__body">
            {lastExportAt === null
              ? t('overview.backupNever')
              : t('overview.backupStale', { time: formatRelative(lastExportAt) })}
          </span>
          <span className="notice__action">
            <Button size="sm" onClick={() => navigate('/settings')}>
              {t('overview.backupAction')}
            </Button>
          </span>
        </div>
      ) : null}

      <div className="overview-hero">
        <span className="overview-hero__value numeric">{stats.totalItems}</span>
        <span className="overview-hero__label">{t('overview.heroLabel')}</span>
      </div>

      <div className="stat-grid" style={{ marginBottom: 'var(--gap-6)' }}>
        <button type="button" className="stat" onClick={() => navigate('/items')}>
          <span className="stat__value numeric">{stats.categoryCount}</span>
          <span className="stat__label">{t('overview.statCategories')}</span>
        </button>
        <button type="button" className="stat" onClick={() => navigate('/locations')}>
          <span className="stat__value numeric">{stats.locationCount}</span>
          <span className="stat__label">{t('overview.statLocations')}</span>
        </button>
        <button type="button" className="stat" onClick={() => navigate('/idle')}>
          <span className="stat__value numeric">{stats.idleCount}</span>
          <span className="stat__label">{t('overview.statIdle')}</span>
        </button>
        <button
          type="button"
          className="stat"
          onClick={() => navigate('/items?loc=__unassigned__&group=location')}
          title={t('overview.statUnassignedTitle')}
        >
          <span className="stat__value numeric">{stats.unassignedCount}</span>
          <span className="stat__label">{t('overview.statUnassigned')}</span>
        </button>
      </div>

      {/* ---------------- 有效期：有要处理的才显示 ---------------- */}
      {urgentExpiryCount > 0 ? (
        <section className="section">
          <button
            type="button"
            className="expiry-summary"
            style={{ width: '100%', textAlign: 'left' }}
            onClick={() => navigate('/expiry')}
          >
            <span className="row-between wrap">
              <span className="section__title">{t('expiry.cardTitle')}</span>
              <span className="small muted">
                {t('expiry.cardAction')} <IconChevronRight size={13} />
              </span>
            </span>
            <span className="expiry-summary__counts">
              {stats.expiredCount > 0 ? (
                <span className="expiry-summary__pill expiry-summary__pill--expired">
                  {tc(stats.expiredCount, 'expiry.cardExpired')}
                </span>
              ) : null}
              {stats.expiringSoonCount > 0 ? (
                <span className="expiry-summary__pill expiry-summary__pill--soon">
                  {tc(stats.expiringSoonCount, 'expiry.cardSoon')}
                </span>
              ) : null}
            </span>
          </button>
        </section>
      ) : null}

      {/* ---------------- 闲置占比：断舍离的核心指标 ---------------- */}
      <section className="section">
        <div className="idle-highlight">
          <div>
            <div className="idle-highlight__value">{idlePercent}%</div>
            <div className="tiny dim">{t('overview.idleShare')}</div>
          </div>
          <div className="idle-highlight__text">
            {stats.idleCount === 0
              ? t('overview.idleNone')
              : t('overview.idleSome', { count: stats.idleCount })}
          </div>
          {stats.idleCount > 0 ? (
            <Button onClick={() => navigate('/idle')}>
              {t('overview.idleAction')}
              <IconChevronRight size={13} />
            </Button>
          ) : null}
        </div>
      </section>

      {/* ---------------- 按分类 ---------------- */}
      <section className="section">
        <div className="section__head">
          <div className="section__title">{t('overview.byCategory')}</div>
          <div className="section__note">{t('overview.byCategoryNote')}</div>
        </div>
        <BarChart
          data={byCategory}
          limit={8}
          colorOf={categoryColorOf}
          emptyText={t('overview.emptyCategories')}
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
          <div className="section__title">{t('overview.byLocation')}</div>
          <div className="section__note">{t('overview.byLocationNote')}</div>
        </div>
        <BarChart
          data={byLocation}
          limit={8}
          colorOf={locationColorOf}
          emptyText={t('overview.emptyLocations')}
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
            <div className="section__title">{t('overview.byTag')}</div>
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
            <div className="section__title">{t('overview.byStatus')}</div>
            <div className="section__note">{t('overview.byStatusNote')}</div>
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
