import { useEffect, useMemo } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { computeStats } from '../store/selectors'
import { useAppStore } from '../store/useAppStore'
import { applySectionTheme, themeForPath } from '../lib/sections'
import type { DictKey } from '../i18n'
import { useT } from '../i18n'
import { LanguageSwitch } from './LanguageSwitch'
import { ToastStack } from './ui/primitives'
import {
  IconArrowLeft,
  IconClock,
  IconFolder,
  IconGear,
  IconIdle,
  IconItems,
  IconLocations,
  IconMore,
  IconOverview,
  IconPlus,
  IconSettings,
  IconSparkle,
  IconTag,
} from './ui/icons'

/* ------------------------------------------------------------------ */
/* 导航结构                                                            */
/* ------------------------------------------------------------------ */

interface NavEntry {
  to: string
  /**
   * 存的是 **词典 key**，不是显示文字。
   *
   * 因为这些数组是模块级的常量，如果在模块加载时就把 t() 的结果存进来，
   * 语言一换它们不会跟着变 —— 会变成「页面标题是英文、侧栏还是中文」这种
   * 半截状态。存 key、渲染时再查表，就没这个问题。
   */
  labelKey: DictKey
  Icon: (props: { size?: number }) => JSX.Element
  /** 用计数做徽标 */
  badge?: 'idle' | 'expiry'
}

const PRIMARY_NAV: NavEntry[] = [
  { to: '/', labelKey: 'nav.overview', Icon: IconOverview },
  { to: '/items', labelKey: 'nav.items', Icon: IconItems },
  { to: '/locations', labelKey: 'nav.locations', Icon: IconLocations },
  { to: '/idle', labelKey: 'nav.idle', Icon: IconIdle, badge: 'idle' },
  { to: '/expiry', labelKey: 'nav.expiry', Icon: IconClock, badge: 'expiry' },
  { to: '/ai', labelKey: 'nav.ai', Icon: IconSparkle },
]

const MANAGE_NAV: NavEntry[] = [
  { to: '/categories', labelKey: 'nav.categories', Icon: IconFolder },
  { to: '/attributes', labelKey: 'nav.attributes', Icon: IconSettings },
  { to: '/tags', labelKey: 'nav.tags', Icon: IconTag },
  { to: '/settings', labelKey: 'nav.settings', Icon: IconGear },
]

/**
 * 手机底部 Tab：4 个主入口 + 「更多」。
 *
 * 只放 4 个是因为 5 格已经是手机上的极限了，再多每一格都太窄。
 * 「有效期」和「AI 助手」都在「更多」里 —— 尤其加上英文之后，
 * 标签一长就会挤成两行。
 */
const BOTTOM_NAV: NavEntry[] = [
  ...PRIMARY_NAV.slice(0, 4),
  { to: '/more', labelKey: 'nav.more', Icon: IconMore },
]

/** 这些路由是手机端的一级页面，不需要返回按钮 */
const ROOT_ROUTES = new Set([
  '/',
  '/items',
  '/locations',
  '/idle',
  '/expiry',
  '/ai',
  '/more',
  '/categories',
  '/attributes',
  '/tags',
  '/settings',
])

function titleKeyForPath(pathname: string): DictKey {
  if (pathname === '/') return 'nav.titleOverview'
  if (pathname === '/items') return 'nav.titleItems'
  if (pathname === '/items/new') return 'nav.titleItemNew'
  if (/^\/items\/[^/]+$/.test(pathname)) return 'nav.titleItemDetail'
  if (pathname === '/locations') return 'nav.titleLocations'
  if (pathname === '/idle') return 'nav.titleIdle'
  if (pathname === '/expiry') return 'nav.titleExpiry'
  if (pathname === '/ai') return 'nav.titleAi'
  if (pathname === '/more') return 'nav.titleMore'
  if (pathname === '/categories') return 'nav.titleCategories'
  if (pathname === '/attributes') return 'nav.titleAttributes'
  if (pathname === '/tags') return 'nav.titleTags'
  if (pathname === '/settings') return 'nav.titleSettings'
  return 'nav.titleFallback'
}

function isRouteActive(pathname: string, to: string): boolean {
  if (to === '/') return pathname === '/'
  if (to === '/items') return pathname === '/items' || pathname.startsWith('/items/')
  return pathname === to || pathname.startsWith(`${to}/`)
}

/* ------------------------------------------------------------------ */
/* 外壳                                                                */
/* ------------------------------------------------------------------ */

export function AppShell() {
  const location = useLocation()
  const navigate = useNavigate()
  const data = useAppStore((s) => s.data)
  const lastExportAt = useAppStore((s) => s.ui.lastExportAt)
  const expirySoonDays = useAppStore((s) => s.ui.expirySoonDays)
  const { t, lang } = useT()

  const stats = useMemo(
    () => computeStats(data, expirySoonDays),
    [data, expirySoonDays],
  )

  const pathname = location.pathname

  // 切换页面时回到顶部，避免在长列表里跳转后停在半空
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' })
  }, [pathname])

  // 每个板块有自己的主色。写到 :root 上而不是容器上，
  // 这样通过 portal 挂到 body 的模态框、轻提示也能跟着变色。
  useEffect(() => {
    applySectionTheme(themeForPath(pathname))
  }, [pathname])

  // 标签页标题跟着语言和当前页面走。lang 在依赖里是因为 t() 是个
  // 读模块级状态的普通函数，不显式依赖它就不会重跑。
  useEffect(() => {
    document.title = `${t(titleKeyForPath(pathname))} · ${t('nav.brand')}`
  }, [pathname, lang, t])

  const badgeValue = (entry: NavEntry): number | null => {
    if (entry.badge === 'idle') return stats.idleCount > 0 ? stats.idleCount : null
    if (entry.badge === 'expiry') {
      const urgent = stats.expiredCount + stats.expiringSoonCount
      return urgent > 0 ? urgent : null
    }
    return null
  }

  // 录入页和详情页不显示悬浮按钮，避免遮住表单
  const showFab = pathname !== '/items/new' && !/^\/items\/[^/]+$/.test(pathname)
  const showBack = !ROOT_ROUTES.has(pathname)

  const backupHint = stats.totalItems > 0 && lastExportAt === null ? t('nav.neverBackedUp') : null

  return (
    <div className="app-shell">
      {/* ---------------- 桌面侧栏 ---------------- */}
      <aside className="sidebar">
        <div className="sidebar__brand">
          <div className="sidebar__brand-name">{t('nav.brand')}</div>
          <div className="sidebar__brand-sub">{t('nav.tagline')}</div>
        </div>

        <nav className="sidebar__nav">
          {PRIMARY_NAV.map((entry) => {
            const badge = badgeValue(entry)
            return (
              <NavLink
                key={entry.to}
                to={entry.to}
                className={`nav-item${isRouteActive(pathname, entry.to) ? ' is-active' : ''}`}
              >
                <entry.Icon />
                <span className="nav-item__label">{t(entry.labelKey)}</span>
                {badge !== null ? <span className="nav-item__badge">{badge}</span> : null}
              </NavLink>
            )
          })}

          <div className="sidebar__group-label">{t('nav.manage')}</div>
          {MANAGE_NAV.map((entry) => (
            <NavLink
              key={entry.to}
              to={entry.to}
              className={`nav-item${isRouteActive(pathname, entry.to) ? ' is-active' : ''}`}
            >
              <entry.Icon />
              <span className="nav-item__label">{t(entry.labelKey)}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar__footer">
          <div>
            {t('nav.footerCounts', {
              items: stats.totalItems,
              idle: stats.idleCount,
            })}
          </div>
          {backupHint ? (
            <div>
              <button
                type="button"
                className="dim"
                style={{ textDecoration: 'underline' }}
                onClick={() => navigate('/settings')}
              >
                {backupHint}
              </button>
            </div>
          ) : null}
        </div>
      </aside>

      {/* ---------------- 主内容 ---------------- */}
      <div className="main">
        <header className="topbar">
          {showBack ? (
            <button
              type="button"
              className="btn btn--icon"
              aria-label={t('nav.ariaBack')}
              onClick={() => navigate(-1)}
            >
              <IconArrowLeft size={18} />
            </button>
          ) : null}
          <div className="topbar__title">{t(titleKeyForPath(pathname))}</div>
          {/* 语言开关固定在右上角 */}
          <LanguageSwitch />
        </header>

        <div className="main__inner">
          <Outlet />
        </div>
      </div>

      {/* ---------------- 手机底部 Tab ---------------- */}
      <nav className="bottom-nav">
        {BOTTOM_NAV.map((entry) => {
          const badge = badgeValue(entry)
          return (
            <NavLink
              key={entry.to}
              to={entry.to}
              className={`bottom-nav__item${isRouteActive(pathname, entry.to) ? ' is-active' : ''}`}
            >
              <entry.Icon size={19} />
              <span>{t(entry.labelKey)}</span>
              {badge !== null ? <span className="bottom-nav__badge">{badge}</span> : null}
            </NavLink>
          )
        })}
      </nav>

      {showFab ? (
        <button
          type="button"
          className="fab"
          aria-label={t('nav.ariaAddItem')}
          onClick={() => navigate('/items/new')}
        >
          <IconPlus size={22} />
        </button>
      ) : null}

      <ToastStack />
    </div>
  )
}
