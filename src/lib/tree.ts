import type { Location } from '../types'

/** 排序：先按手动 order，再按名称（中文按拼音/字形顺序，localeCompare 足够） */
function compareLocations(a: Location, b: Location): number {
  if (a.order !== b.order) return a.order - b.order
  return a.name.localeCompare(b.name, 'zh-CN')
}

export interface TreeNode<T> {
  node: T
  children: TreeNode<T>[]
  depth: number
}

/**
 * 构建位置树。
 * 容错处理：
 *  1. parentId 指向不存在的节点 → 当作顶层
 *  2. 存在环（A 的父是 B、B 的父是 A）→ 拆环，把无法从顶层到达的节点提升为顶层
 */
export function buildLocationTree(locations: Location[]): TreeNode<Location>[] {
  const nodeById = new Map<string, TreeNode<Location>>()
  for (const loc of locations) {
    nodeById.set(loc.id, { node: loc, children: [], depth: 0 })
  }

  const roots: TreeNode<Location>[] = []
  for (const loc of locations) {
    const self = nodeById.get(loc.id)!
    const parent = loc.parentId ? nodeById.get(loc.parentId) : undefined
    if (parent && parent !== self) {
      parent.children.push(self)
    } else {
      roots.push(self)
    }
  }

  // 可达性检查，拆掉孤环
  const visited = new Set<string>()
  const mark = (n: TreeNode<Location>) => {
    if (visited.has(n.node.id)) return
    visited.add(n.node.id)
    for (const c of n.children) mark(c)
  }
  for (const r of roots) mark(r)
  for (const loc of locations) {
    if (visited.has(loc.id)) continue
    const self = nodeById.get(loc.id)!
    const parent = loc.parentId ? nodeById.get(loc.parentId) : undefined
    if (parent) parent.children = parent.children.filter((c) => c !== self)
    self.children = []
    roots.push(self)
    mark(self)
  }

  const sortRec = (nodes: TreeNode<Location>[], depth: number) => {
    nodes.sort((a, b) => compareLocations(a.node, b.node))
    for (const n of nodes) {
      n.depth = depth
      sortRec(n.children, depth + 1)
    }
  }
  sortRec(roots, 0)
  return roots
}

/** 把树摊平成显示顺序的数组（深度优先） */
export function flattenTree(roots: TreeNode<Location>[]): TreeNode<Location>[] {
  const out: TreeNode<Location>[] = []
  const walk = (nodes: TreeNode<Location>[]) => {
    for (const n of nodes) {
      out.push(n)
      walk(n.children)
    }
  }
  walk(roots)
  return out
}

/**
 * 位置索引 —— 在渲染前建一次，避免在循环里反复遍历全部位置。
 * 提供路径查询、子孙集合查询，都带缓存。
 */
export interface LocationIndex {
  byId: Map<string, Location>
  /** 是否存在某个位置 */
  has(id: string): boolean
  /** 从顶层到自身的名称数组，如 ['家','卧室','衣柜']；未归位返回 [] */
  pathNames(id: string | null): string[]
  /** '家 / 卧室 / 衣柜'；未归位返回「未归位」 */
  pathString(id: string | null, sep?: string): string
  /** 自身 + 全部子孙的 id 集合 */
  descendantIds(id: string): Set<string>
  /** 层级深度，顶层为 0 */
  depthOf(id: string): number
}

export function createLocationIndex(locations: Location[]): LocationIndex {
  const byId = new Map(locations.map((l) => [l.id, l]))
  const childrenOf = new Map<string, string[]>()
  for (const l of locations) {
    if (!l.parentId || !byId.has(l.parentId)) continue
    const arr = childrenOf.get(l.parentId)
    if (arr) arr.push(l.id)
    else childrenOf.set(l.parentId, [l.id])
  }

  const pathCache = new Map<string, string[]>()
  const descendantCache = new Map<string, Set<string>>()

  const pathNames = (id: string | null): string[] => {
    if (!id) return []
    const cached = pathCache.get(id)
    if (cached) return cached
    const names: string[] = []
    const seen = new Set<string>()
    let cur: string | null = id
    // seen 兜底防环死循环
    while (cur && !seen.has(cur)) {
      seen.add(cur)
      const loc = byId.get(cur)
      if (!loc) break
      names.unshift(loc.name)
      cur = loc.parentId && byId.has(loc.parentId) ? loc.parentId : null
    }
    pathCache.set(id, names)
    return names
  }

  const descendantIds = (id: string): Set<string> => {
    const cached = descendantCache.get(id)
    if (cached) return cached
    const out = new Set<string>()
    const stack = [id]
    while (stack.length) {
      const cur = stack.pop()!
      if (out.has(cur)) continue
      out.add(cur)
      const kids = childrenOf.get(cur)
      if (kids) stack.push(...kids)
    }
    descendantCache.set(id, out)
    return out
  }

  return {
    byId,
    has: (id) => byId.has(id),
    pathNames,
    pathString: (id, sep = ' / ') => {
      if (!id) return '未归位'
      const names = pathNames(id)
      return names.length ? names.join(sep) : '未归位'
    },
    descendantIds,
    depthOf: (id) => Math.max(0, pathNames(id).length - 1),
  }
}

/** 判断 candidateId 是否是 ancestorId 的子孙（不含自身） */
export function isDescendantOf(
  index: LocationIndex,
  candidateId: string,
  ancestorId: string,
): boolean {
  return index.descendantIds(ancestorId).has(candidateId) && candidateId !== ancestorId
}

/**
 * 能否把 nodeId 挂到 newParentId 下。
 * 禁止挂到自己或自己的子孙下（否则树会成环、节点会从界面上消失）。
 */
export function canReparent(
  index: LocationIndex,
  nodeId: string,
  newParentId: string | null,
): { ok: true } | { ok: false; reason: string } {
  if (newParentId === null) return { ok: true }
  if (newParentId === nodeId) return { ok: false, reason: '不能把位置移动到它自己下面' }
  if (!index.has(newParentId)) return { ok: false, reason: '目标位置不存在' }
  if (isDescendantOf(index, newParentId, nodeId)) {
    return { ok: false, reason: '不能把位置移动到它自己的子位置下面' }
  }
  return { ok: true }
}

/** 从 id 列表里剔除所有「其祖先也在列表里」的节点，用于按位置筛选时去重 */
export function pruneRedundantIds(index: LocationIndex, ids: string[]): string[] {
  const set = new Set(ids)
  return ids.filter((id) => {
    for (const other of set) {
      if (other !== id && index.descendantIds(other).has(id)) return false
    }
    return true
  })
}
