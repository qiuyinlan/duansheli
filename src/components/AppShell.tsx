import { useEffect, useMemo } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { computeStats } from '../store/selectors'
import { useAppStore } from '../store/useAppStore'
import { applySectionTheme, themeForPath } from '../lib/sections'
import { ToastStack } from './ui/primitives'
import {
  IconArrowLeft,
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
  label: string
  Icon: (props: { size?: number }) => JSX.Element
  /** 用闲置件数做徽标 */
  badge?: 'idle'
}

const PRIMARY_NAV: NavEntry[] = [
  { to: '/', label: '概览', Icon: IconOverview },
  { to: '/items', label: '物品', Icon: IconItems },
  { to: '/locations', label: '位置', Icon: IconLocations },
  { to: '/idle', label: '闲置', Icon: IconIdle, badge: 'idle' },
  { to: '/ai', label: 'AI 助手', Icon: IconSparkle },
]

const MANAGE_NAV: NavEntry[] = [
  { to: '/categories', label: '分类', Icon: IconFolder },
  { to: '/attributes', label: '属性', Icon: IconSettings },
  { to: '/tags', label: '标签', Icon: IconTag },
  { to: '/settings', label: '设置', Icon: IconGear },
]

/** 手机底部 Tab：4 个主入口 + 「更多」（AI 助手放在「更多」里） */
const BOTTOM_NAV: NavEntry[] = [...PRIMARY_NAV.slice(0, 4), { to: '/more', label: '更多', Icon: IconMore }]

/** 这些路由是手机端的一级页面，不需要返回按钮 */
const ROOT_ROUTES = new Set([
  '/',
  '/items',
  '/locations',
  '/idle',
  '/ai',
  '/more',
  '/categories',
  '/attributes',
  '/tags',
  '/settings',
])

function resolveTitle(pathname: string): string {
  if (pathname === '/') return '概览'
  if (pathname === '/items') return '物品'
  if (pathname === '/items/new') return '录入物品'
  if (/^\/items\/[^/]+$/.test(pathname)) return '物品详情'
  if (pathname === '/locations') return '位置'
  if (pathname === '/idle') return '闲置'
  if (pathname === '/ai') return 'AI 助手'
  if (pathname === '/more') return '更多'
  if (pathname === '/categories') return '分类'
  if (pathname === '/attributes') return '属性'
  if (pathname === '/tags') return '标签'
  if (pathname === '/settings') return '设置'
  return '断舍离'
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

  const stats = useMemo(() => computeStats(data), [data])

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

  const badgeValue = (entry: NavEntry): number | null =>
    entry.badge === 'idle' && stats.idleCount > 0 ? stats.idleCount : null

  // 录入页和详情页不显示悬浮按钮，避免遮住表单
  const showFab = pathname !== '/items/new' && !/^\/items\/[^/]+$/.test(pathname)
  const showBack = !ROOT_ROUTES.has(pathname)

  const backupHint =
    stats.totalItems > 0 && lastExportAt === null ? '尚未导出过备份' : null

  return (
    <div className="app-shell">
      {/* ---------------- 桌面侧栏 ---------------- */}
      <aside className="sidebar">
        <div className="sidebar__brand">
          <div className="sidebar__brand-name">断舍离</div>
          <div className="sidebar__brand-sub">整理你的家当</div>
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
                <span className="nav-item__label">{entry.label}</span>
                {badge !== null ? <span className="nav-item__badge">{badge}</span> : null}
              </NavLink>
            )
          })}

          <div className="sidebar__group-label">管理</div>
          {MANAGE_NAV.map((entry) => (
            <NavLink
              key={entry.to}
              to={entry.to}
              className={`nav-item${isRouteActive(pathname, entry.to) ? ' is-active' : ''}`}
            >
              <entry.Icon />
              <span className="nav-item__label">{entry.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar__footer">
          <div>
            共 <span className="numeric">{stats.totalItems}</span> 件 · 闲置{' '}
            <span className="numeric">{stats.idleCount}</span> 件
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
              aria-label="返回"
              onClick={() => navigate(-1)}
            >
              <IconArrowLeft size={18} />
            </button>
          ) : null}
          <div className="topbar__title">{resolveTitle(pathname)}</div>
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
              <span>{entry.label}</span>
              {badge !== null ? <span className="bottom-nav__badge">{badge}</span> : null}
            </NavLink>
          )
        })}
      </nav>

      {showFab ? (
        <button
          type="button"
          className="fab"
          aria-label="录入物品"
          onClick={() => navigate('/items/new')}
        >
          <IconPlus size={22} />
        </button>
      ) : null}

      <ToastStack />
    </div>
  )
}
