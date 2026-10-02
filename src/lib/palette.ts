/**
 * 分组配色。
 *
 * 物品列表按分类 / 位置 / 标签分组时，每组一种颜色 —— 一眼能区分，
 * 比一片灰色好认得多。
 *
 * ── 两条规则，都是为了「不添乱」─────────────────────────────
 *
 * 1. **同一个 key 永远同一个颜色。**
 *    颜色由 key 的哈希决定，不按出现顺序。这样「衣物」不论在哪个筛选、
 *    哪个排序下都是同一个颜色，你能靠颜色认东西，而不是每换一次视角就重新学一遍。
 *
 * 2. **相邻分组绝不撞色。**
 *    光有哈希会有个问题：两个挨着的分组可能抽到同一个颜色，那比不配色还难看。
 *    所以分配时如果和上一个撞了，就往后顺一个。
 *
 * 3. 虚拟分组（未分类 / 未归位 / 未加标签）一律用中性灰 ——
 *    它们是「没有值」，不该跟真实分类抢眼。
 */

export interface GroupColor {
  /** 左侧竖条、色点 */
  bar: string
  /** 标题文字（在白底上可读） */
  text: string
  /** 极浅底色（标题背景） */
  soft: string
  /** 浅色分隔线 */
  line: string
}

/**
 * 12 色，都取自同一档明度（600 / 700 / 50 / 200），
 * 所以摆在一起色感是统一的，不会花。
 */
const PALETTE: GroupColor[] = [
  { bar: '#2563eb', text: '#1d4ed8', soft: '#eff6ff', line: '#bfdbfe' }, // 蓝
  { bar: '#7c3aed', text: '#6d28d9', soft: '#f5f3ff', line: '#ddd6fe' }, // 紫
  { bar: '#059669', text: '#047857', soft: '#ecfdf5', line: '#a7f3d0' }, // 绿
  { bar: '#db2777', text: '#be185d', soft: '#fdf2f8', line: '#fbcfe8' }, // 玫红
  { bar: '#0891b2', text: '#0e7490', soft: '#ecfeff', line: '#a5f3fc' }, // 青
  { bar: '#ea580c', text: '#c2410c', soft: '#fff7ed', line: '#fed7aa' }, // 橙
  { bar: '#4f46e5', text: '#4338ca', soft: '#eef2ff', line: '#c7d2fe' }, // 靛
  { bar: '#65a30d', text: '#4d7c0f', soft: '#f7fee7', line: '#d9f99d' }, // 黄绿
  { bar: '#dc2626', text: '#b91c1c', soft: '#fef2f2', line: '#fecaca' }, // 红
  { bar: '#0d9488', text: '#0f766e', soft: '#f0fdfa', line: '#99f6e4' }, // 青绿
  { bar: '#d97706', text: '#b45309', soft: '#fffbeb', line: '#fde68a' }, // 琥珀
  { bar: '#475569', text: '#334155', soft: '#f8fafc', line: '#e2e8f0' }, // 石板
]

/** 「未分类 / 未归位 / 未加标签」用的中性色 */
export const NEUTRAL_GROUP_COLOR: GroupColor = {
  bar: '#9b9b9b',
  text: '#6b6b6b',
  soft: '#fafafa',
  line: '#e8e8e6',
}

/** 状态分组的语义色 —— 这里不该用哈希，含义是固定的 */
const STATUS_COLORS: Record<string, GroupColor> = {
  active: { bar: '#059669', text: '#047857', soft: '#ecfdf5', line: '#a7f3d0' },
  idle: { bar: '#d97706', text: '#b45309', soft: '#fffbeb', line: '#fde68a' },
  discarded: NEUTRAL_GROUP_COLOR,
}

/** 稳定的字符串哈希（FNV-1a），不用 Math.random —— 每次刷新结果必须一样 */
function hashString(value: string): number {
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return Math.abs(hash)
}

function isVirtualKey(key: string): boolean {
  return key.startsWith('__')
}

/**
 * 给一批分组 key 分配颜色。
 *
 * 传入**显示顺序**的 key 列表，返回 key → 颜色。
 * 顺带保证了相邻两个不会撞色。
 */
export function assignGroupColors(keys: readonly string[]): Map<string, GroupColor> {
  const out = new Map<string, GroupColor>()
  let previousBar: string | null = null

  for (const key of keys) {
    const color = colorForKey(key)
    let resolved = color

    // 和上一个撞了就往后再挑一个
    if (resolved.bar === previousBar && !isVirtualKey(key)) {
      const index = PALETTE.indexOf(color)
      resolved = PALETTE[(index + 1) % PALETTE.length]
    }

    out.set(key, resolved)
    previousBar = resolved.bar
  }

  return out
}

/** 单个 key 的颜色 */
export function colorForKey(key: string): GroupColor {
  if (isVirtualKey(key)) return NEUTRAL_GROUP_COLOR
  if (STATUS_COLORS[key]) return STATUS_COLORS[key]
  return PALETTE[hashString(key) % PALETTE.length]
}
