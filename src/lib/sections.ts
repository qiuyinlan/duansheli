/**
 * 板块配色。
 *
 * 设计思路（重要，改配色前先读）：
 *   导航栏本身保持中性灰 —— 你任何时候看到的都只有「当前板块」一种颜色。
 *   如果九个板块在侧栏里各显各色，那就是一道彩虹，反而乱。
 *   颜色只出现在「你正在看的这一屏」上，这样既有辨识度又不吵。
 *
 * 每个板块三个色阶：
 *   accent      主色 —— 按钮底色、图表、激活态
 *   accentText  在白底上可读的文字色（比主色深一档）
 *   accentSoft  极浅的底色 —— 激活项背景、选中区域
 */

export interface SectionTheme {
  key: string
  label: string
  accent: string
  accentText: string
  accentSoft: string
}

export const SECTION_THEMES: Record<string, SectionTheme> = {
  overview: {
    key: 'overview',
    label: '概览',
    accent: '#2563eb',
    accentText: '#1d4ed8',
    accentSoft: '#eff6ff',
  },
  items: {
    key: 'items',
    label: '物品',
    accent: '#4f46e5',
    accentText: '#4338ca',
    accentSoft: '#eef2ff',
  },
  locations: {
    key: 'locations',
    label: '位置',
    accent: '#0d9488',
    accentText: '#0f766e',
    accentSoft: '#f0fdfa',
  },
  idle: {
    key: 'idle',
    label: '闲置',
    accent: '#d97706',
    accentText: '#b45309',
    accentSoft: '#fffbeb',
  },
  ai: {
    key: 'ai',
    label: 'AI 助手',
    accent: '#7c3aed',
    accentText: '#6d28d9',
    accentSoft: '#f5f3ff',
  },
  categories: {
    key: 'categories',
    label: '分类',
    accent: '#0891b2',
    accentText: '#0e7490',
    accentSoft: '#ecfeff',
  },
  attributes: {
    key: 'attributes',
    label: '属性',
    accent: '#059669',
    accentText: '#047857',
    accentSoft: '#ecfdf5',
  },
  tags: {
    key: 'tags',
    label: '标签',
    accent: '#db2777',
    accentText: '#be185d',
    accentSoft: '#fdf2f8',
  },
  settings: {
    key: 'settings',
    label: '设置',
    accent: '#475569',
    accentText: '#334155',
    accentSoft: '#f8fafc',
  },
}

export const DEFAULT_SECTION_KEY = 'overview'

/** 路由 → 板块。用前缀匹配，所以 /items/new、/items/abc 都会落到「物品」。 */
export function sectionKeyForPath(pathname: string): string {
  if (pathname === '/' || pathname === '') return 'overview'
  if (pathname.startsWith('/items')) return 'items'
  if (pathname.startsWith('/locations')) return 'locations'
  if (pathname.startsWith('/idle')) return 'idle'
  if (pathname.startsWith('/ai')) return 'ai'
  if (pathname.startsWith('/categories')) return 'categories'
  if (pathname.startsWith('/attributes')) return 'attributes'
  if (pathname.startsWith('/tags')) return 'tags'
  if (pathname.startsWith('/settings')) return 'settings'
  // 「更多」这类没有自己主色的页面，沿用中性的默认色
  return DEFAULT_SECTION_KEY
}

export function themeForPath(pathname: string): SectionTheme {
  const key = sectionKeyForPath(pathname)
  return SECTION_THEMES[key] ?? (SECTION_THEMES[DEFAULT_SECTION_KEY] as SectionTheme)
}

/**
 * 把主题写到 :root 上，而不是写在某个容器上 ——
 * 因为模态框和轻提示是通过 portal 挂到 document.body 上的，
 * 写在容器上它们就继承不到颜色。
 */
export function applySectionTheme(theme: SectionTheme, root?: HTMLElement): void {
  const target = root ?? (typeof document !== 'undefined' ? document.documentElement : null)
  if (!target) return
  target.style.setProperty('--accent', theme.accent)
  target.style.setProperty('--accent-text', theme.accentText)
  target.style.setProperty('--accent-soft', theme.accentSoft)
}
