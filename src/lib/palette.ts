/**
 * 分组配色。
 *
 * 物品列表按分类 / 位置 / 标签分组时，每组一种颜色 —— 一眼能区分，
 * 比一片灰色好认得多。
 *
 * ── 四条规则，都是为了「不添乱」─────────────────────────────
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
 *
 * 4. **树形分组只在顶层上色。** ← 后加的，这条很关键
 *
 *    一开始是每个节点各自哈希，结果是：一个一级标题下面，子分类各是各的颜色，
 *    一块里面五彩斑斓。可颜色的作用本来是「把大块分开」，
 *    用在同一块的**内部**只会添乱 —— 用户的原话是「太五颜六色了」。
 *
 *    所以树形分组改成：**只有顶层拿独立色相，子级继承所属顶层并逐层变淡**
 *    （见 `assignTreeColors`）。缩进表达层级，深浅表达远近，
 *    颜色只负责回答「这是哪一大块」。
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

/** 粗略的 HSV 色相（0–360），只用来判断「看起来像不像」，不需要多精确 */
function hexHue(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!m) return 0
  const n = Number.parseInt(m[1], 16)
  const r = ((n >> 16) & 0xff) / 255
  const g = ((n >> 8) & 0xff) / 255
  const b = (n & 0xff) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  if (d === 0) return 0
  let h: number
  if (max === r) h = ((g - b) / d) % 6
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  return (((h * 60) % 360) + 360) % 360
}

/** 色相环上的最短距离（度）。灰阶没有色相，返回 0 → 会被当成「跟谁都不像」 */
function hueDistance(a: string, b: string): number {
  const d = Math.abs(hexHue(a) - hexHue(b))
  return Math.min(d, 360 - d)
}

/**
 * 相邻两组至少差这么多度色相才算「看起来不一样」。
 *
 * 色板里有好几组近似色（三个绿、两个橙、两个红），只挡**完全相同**根本不够 ——
 * 尤其现在树形分组只在顶层上色，顶层之间能不能一眼分开就是配色的全部意义。
 * 28° 大约是「红 vs 橙」「绿 vs 青绿」这种能被眼睛分开的距离。
 */
const MIN_ADJACENT_HUE = 28

/**
 * 给一批分组 key 分配颜色。
 *
 * 传入**显示顺序**的 key 列表，返回 key → 颜色。
 *
 * 两条避让规则，都是为了让「一眼能分开」这件事真的成立：
 *   1. **尽量不重复** —— 同样的 key 列表里，一个颜色只用一次
 *      （色板 12 个色，分组通常不到 12 个，所以基本能做到全不重样）
 *   2. **相邻要把色相拉开** —— 色板里有三个绿、两个橙、两个红，
 *      只挡「色值相同」不够，挨着的一个绿一个青绿看起来照样像同一组
 *
 * 两条都是**尽量**而不是硬保证：分组比色板还多的时候，重复是必然的。
 * 优先级是「不重复 + 拉得开」→「拉得开」→「认了」。
 *
 * 虚拟分组（中性灰）和状态色（固定语义）不参与避让 ——
 * 它们的颜色有含义，不能为了好看被挪走。
 *
 * ⚠️ 因为规则依赖整个 key 列表，**调用方必须传同一份规范顺序的 key 列表**，
 * 否则同一个分类在图表和列表里会算出不同颜色（见 Overview.tsx 的注释）。
 */
export function assignGroupColors(keys: readonly string[]): Map<string, GroupColor> {
  const out = new Map<string, GroupColor>()
  const used = new Set<string>()
  let previous: GroupColor | null = null

  for (const key of keys) {
    let resolved = colorForKey(key)
    const fixed = isVirtualKey(key) || Boolean(STATUS_COLORS[key])

    if (!fixed) {
      const start = PALETTE.indexOf(resolved)
      if (start >= 0) {
        const pick = (needUnused: boolean): GroupColor | null => {
          for (let step = 0; step < PALETTE.length; step++) {
            const candidate = PALETTE[(start + step) % PALETTE.length] as GroupColor
            if (needUnused && used.has(candidate.bar)) continue
            if (previous !== null && hueDistance(candidate.bar, previous.bar) < MIN_ADJACENT_HUE) {
              continue
            }
            return candidate
          }
          return null
        }

        resolved = pick(true) ?? pick(false) ?? resolved
      }

      used.add(resolved.bar)
      previous = resolved
    }

    out.set(key, resolved)
  }

  return out
}

/** 单个 key 的颜色 */
export function colorForKey(key: string): GroupColor {
  if (isVirtualKey(key)) return NEUTRAL_GROUP_COLOR
  if (STATUS_COLORS[key]) return STATUS_COLORS[key]
  return PALETTE[hashString(key) % PALETTE.length]
}

/* ------------------------------------------------------------------ */
/* 树的配色：只有顶层拿独立色相，子级继承并变淡                          */
/* ------------------------------------------------------------------ */

/**
 * 把一个颜色往白里混。ratio = 0 是原色，1 是纯白。
 *
 * 为什么自己算而不是用 CSS 的 `color-mix()`：那玩意儿要 Chrome 111+ / Safari 16.2+，
 * 而这个项目一向是「不给自己留兼容性惊喜」，而且自己算能在测试里直接断言结果。
 */
export function mixWithWhite(hex: string, ratio: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!m) return hex
  const n = Number.parseInt(m[1], 16)
  const mix = (channel: number) => Math.round(channel + (255 - channel) * ratio)
  const parts = [mix((n >> 16) & 0xff), mix((n >> 8) & 0xff), mix(n & 0xff)]
  return `#${parts.map((c) => c.toString(16).padStart(2, '0')).join('')}`
}

/**
 * 按层级把颜色变淡。
 *
 * **文字颜色刻意不变**，只让竖条 / 色点 / 底色 / 分隔线变淡。两个原因：
 *   · 小字号下再往浅里混，对比度会掉到看不清（白底上混掉 40% 就低于 4.5:1 了）
 *   · 标题文字用同一个色相，反而强化了「你还在化妆品这一块里」的感觉
 */
export function depthColor(base: GroupColor, depth: number): GroupColor {
  if (depth <= 0) return base

  // 只分两档就够：再深的层级已经缩进得很明显了，
  // 继续变淡会让第四层几乎看不见形状
  const deep = depth >= 2
  return {
    bar: mixWithWhite(base.bar, deep ? 0.62 : 0.45),
    text: base.text,
    soft: mixWithWhite(base.soft, deep ? 0.75 : 0.55),
    line: mixWithWhite(base.line, deep ? 0.55 : 0.4),
  }
}

/** 能参与树形配色的最小形状 —— 只要 key 和 children */
export interface ColorTreeNode {
  key: string
  children: readonly ColorTreeNode[]
}

/**
 * 给一棵分组树分配颜色。
 *
 * 顶层沿用 `assignGroupColors`，子级继承所属顶层的色相并逐层变淡。
 *
 * ⚠️ `topColors` 建议**由调用方显式传进来**，而且要用一份「规范的完整顶层 key 列表」
 * 算出来。因为避让规则依赖整个 key 列表，而列表页只渲染**有内容的**分组、
 * 概览图表只画**有数量的**分类 —— 两边各算一遍，key 集合不同，结果就会不一样，
 * 于是出现「列表里化妆品是蓝的、图表里是绿的」。
 * 传同一张表进去，这个问题从根上没了。
 */
export function assignTreeColors<T extends ColorTreeNode>(
  roots: readonly T[],
  topColors?: ReadonlyMap<string, GroupColor>,
): Map<string, GroupColor> {
  const out = new Map<string, GroupColor>()
  const tops = topColors ?? assignGroupColors(roots.map((root) => root.key))

  const walk = (node: ColorTreeNode, base: GroupColor, depth: number) => {
    out.set(node.key, depthColor(base, depth))
    for (const child of node.children) walk(child, base, depth + 1)
  }

  for (const root of roots) {
    const base = tops.get(root.key) ?? NEUTRAL_GROUP_COLOR
    walk(root, base, 0)
  }

  return out
}

/**
 * 顶层 key → 颜色。
 *
 * 传**规范的完整顶层 key 列表**（分类 / 位置在树里的显示顺序，含没有内容的），
 * 算出来那张表给分组列表和概览图表共用 —— 两边必然一致。
 */
export function topLevelColorMap(keys: readonly string[]): Map<string, GroupColor> {
  return assignGroupColors(keys)
}
