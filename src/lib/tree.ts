/**
 * 通用树工具。
 *
 * 位置和分类都是「不限层级的树」，结构完全一样，
 * 所以这一层做成泛型，两边共用一套逻辑 —— 免得同样的防环、路径、子孙集合
 * 各写一遍，然后其中一份悄悄长出 bug。
 */

import type { TreeItem } from '../types'

/** 任何能构成树的东西：位置、分类，以及将来的其他层级数据 */
export type { TreeItem }

function compareNodes<T extends TreeItem>(a: T, b: T): number {
  if (a.order !== b.order) return a.order - b.order
  return a.name.localeCompare(b.name, 'zh-CN')
}

export interface TreeNode<T> {
  node: T
  children: TreeNode<T>[]
  depth: number
}

/**
 * 构建树。
 * 容错处理：
 *  1. parentId 指向不存在的节点 → 当作顶层
 *  2. 存在环（A 的父是 B、B 的父是 A）→ 拆环，把无法从顶层到达的节点提升为顶层
 */
export function buildTree<T extends TreeItem>(nodes: T[]): TreeNode<T>[] {
  const nodeById = new Map<string, TreeNode<T>>()
  for (const item of nodes) {
    nodeById.set(item.id, { node: item, children: [], depth: 0 })
  }

  const roots: TreeNode<T>[] = []
  for (const item of nodes) {
    const self = nodeById.get(item.id) as TreeNode<T>
    const parent = item.parentId ? nodeById.get(item.parentId) : undefined
    if (parent && parent !== self) parent.children.push(self)
    else roots.push(self)
  }

  // 可达性检查，拆掉孤环
  const visited = new Set<string>()
  const mark = (node: TreeNode<T>) => {
    if (visited.has(node.node.id)) return
    visited.add(node.node.id)
    for (const child of node.children) mark(child)
  }
  for (const root of roots) mark(root)

  for (const item of nodes) {
    if (visited.has(item.id)) continue
    const self = nodeById.get(item.id) as TreeNode<T>
    const parent = item.parentId ? nodeById.get(item.parentId) : undefined
    if (parent) parent.children = parent.children.filter((child) => child !== self)
    self.children = []
    roots.push(self)
    mark(self)
  }

  const sortRec = (list: TreeNode<T>[], depth: number) => {
    list.sort((a, b) => compareNodes(a.node, b.node))
    for (const node of list) {
      node.depth = depth
      sortRec(node.children, depth + 1)
    }
  }
  sortRec(roots, 0)
  return roots
}

/** 把树摊平成显示顺序的数组（深度优先） */
export function flattenTree<T>(roots: TreeNode<T>[]): TreeNode<T>[] {
  const out: TreeNode<T>[] = []
  const walk = (list: TreeNode<T>[]) => {
    for (const node of list) {
      out.push(node)
      walk(node.children)
    }
  }
  walk(roots)
  return out
}

/**
 * 树索引 —— 在渲染前建一次，避免在循环里反复遍历全部节点。
 * 提供路径查询、子孙集合查询，都带缓存。
 */
export interface TreeIndex<T extends TreeItem> {
  byId: Map<string, T>
  has(id: string): boolean
  /** 从顶层到自身的名称数组；找不到或 id 为 null 时返回 [] */
  pathNames(id: string | null): string[]
  /** '家 / 卧室 / 衣柜'；id 为空或找不到时返回 fallback */
  pathString(id: string | null, sep?: string, fallback?: string): string
  /** 自身 + 全部子孙的 id 集合 */
  descendantIds(id: string): Set<string>
  /** 层级深度，顶层为 0 */
  depthOf(id: string): number
  /** 所属的顶层节点 id；自己就是顶层时返回自己 */
  rootId(id: string): string | null
}

export function createTreeIndex<T extends TreeItem>(nodes: T[]): TreeIndex<T> {
  const byId = new Map(nodes.map((node) => [node.id, node]))

  const childrenOf = new Map<string, string[]>()
  for (const node of nodes) {
    if (!node.parentId || !byId.has(node.parentId)) continue
    const bucket = childrenOf.get(node.parentId)
    if (bucket) bucket.push(node.id)
    else childrenOf.set(node.parentId, [node.id])
  }

  const pathCache = new Map<string, string[]>()
  const descendantCache = new Map<string, Set<string>>()
  const rootCache = new Map<string, string | null>()

  const pathNames = (id: string | null): string[] => {
    if (!id) return []
    const cached = pathCache.get(id)
    if (cached) return cached

    const names: string[] = []
    const seen = new Set<string>()
    let current: string | null = id
    // seen 兜底防环死循环
    while (current && !seen.has(current)) {
      seen.add(current)
      const node = byId.get(current)
      if (!node) break
      names.unshift(node.name)
      current = node.parentId && byId.has(node.parentId) ? node.parentId : null
    }
    pathCache.set(id, names)
    return names
  }

  const descendantIds = (id: string): Set<string> => {
    const cached = descendantCache.get(id)
    if (cached) return cached
    const out = new Set<string>()
    const stack = [id]
    while (stack.length > 0) {
      const current = stack.pop() as string
      if (out.has(current)) continue
      out.add(current)
      const children = childrenOf.get(current)
      if (children) stack.push(...children)
    }
    descendantCache.set(id, out)
    return out
  }

  const rootId = (id: string): string | null => {
    if (rootCache.has(id)) return rootCache.get(id) ?? null
    if (!byId.has(id)) return null

    let current = byId.get(id) as T
    const seen = new Set<string>([id])
    while (current.parentId) {
      const parent = byId.get(current.parentId)
      if (!parent || seen.has(parent.id)) break
      seen.add(parent.id)
      current = parent
    }
    rootCache.set(id, current.id)
    return current.id
  }

  return {
    byId,
    has: (id) => byId.has(id),
    pathNames,
    pathString: (id, sep = ' / ', fallback = '') => {
      const names = pathNames(id)
      return names.length > 0 ? names.join(sep) : fallback
    },
    descendantIds,
    depthOf: (id) => Math.max(0, pathNames(id).length - 1),
    rootId,
  }
}

/** 判断 candidateId 是否是 ancestorId 的子孙（不含自身） */
export function isDescendantOf<T extends TreeItem>(
  index: TreeIndex<T>,
  candidateId: string,
  ancestorId: string,
): boolean {
  return index.descendantIds(ancestorId).has(candidateId) && candidateId !== ancestorId
}

/**
 * 不能挂过去的原因。
 *
 * 这里返回**机器可读的代号**而不是给用户看的句子：
 * `lib/` 是不该知道界面语言的（它连 i18n 都不该 import），
 * 而且这同一个判断位置和分类都要用 —— 给用户看的时候该说「位置」还是「分类」
 * 只有调用方知道。由调用方把代号翻成人话。
 */
export type ReparentBlock = 'self' | 'missing' | 'descendant'

export type ReparentCheck = { ok: true } | { ok: false; blocked: ReparentBlock }

/**
 * 能否把 nodeId 挂到 newParentId 下。
 * 禁止挂到自己或自己的子孙下（否则树会成环、节点会从界面上消失）。
 */
export function canReparent<T extends TreeItem>(
  index: TreeIndex<T>,
  nodeId: string,
  newParentId: string | null,
): ReparentCheck {
  if (newParentId === null) return { ok: true }
  if (newParentId === nodeId) return { ok: false, blocked: 'self' }
  if (!index.has(newParentId)) return { ok: false, blocked: 'missing' }
  if (isDescendantOf(index, newParentId, nodeId)) {
    return { ok: false, blocked: 'descendant' }
  }
  return { ok: true }
}

/** 从 id 列表里剔除所有「其祖先也在列表里」的节点，用于按层级筛选时去重 */
export function pruneRedundantIds<T extends TreeItem>(
  index: TreeIndex<T>,
  ids: string[],
): string[] {
  const set = new Set(ids)
  return ids.filter((id) => {
    for (const other of set) {
      if (other !== id && index.descendantIds(other).has(id)) return false
    }
    return true
  })
}

/* ------------------------------------------------------------------ */
/* 按名字搜索树                                                        */
/* ------------------------------------------------------------------ */

/**
 * 名字里含关键词的节点 id 集合。
 *
 * 匹配规则和 AI 那边的 `normName` 一致：去掉首尾和内部多余空白、不分大小写。
 * 两处必须一致 —— 不一致的表现是「AI 找得到的，搜索框找不到」（或者反过来），
 * 而那种不一致最难解释、也最难查。
 */
export function searchTreeIds<T extends TreeItem>(
  nodes: readonly T[],
  query: string,
): Set<string> {
  const wanted = query.trim().replace(/\s+/g, ' ').toLowerCase()
  const out = new Set<string>()
  if (wanted === '') return out
  for (const node of nodes) {
    if (node.name.trim().replace(/\s+/g, ' ').toLowerCase().includes(wanted)) out.add(node.id)
  }
  return out
}

/**
 * 只留下「命中的节点 + 它们的全部祖先」。
 *
 * ── 为什么不是「只留命中的那些」──────────────────────────────────
 * 位置和分类都是树，把父级摘掉之后**剩下的节点会被显示成顶层**（buildTree
 * 遇到找不到的 parentId 就当顶层用）—— 于是搜「眼影盘」得到一条孤零零的
 * 「眼影盘」，用户会以为它是顶层分类，点下去选错了层级也不知道。
 *
 * 所以祖先必须跟着留：命中的照常显示，**祖先只作为路径出现**。
 * 界面上拿 matchedIds 把两者分开呈现（祖先淡一点），一眼看得出
 * 「这条是藏在哪个大分类下面的」。
 */
export function filterTreeByIds<T extends TreeItem>(
  nodes: readonly T[],
  matchedIds: ReadonlySet<string>,
): { roots: TreeNode<T>[]; keptIds: Set<string> } {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const kept = new Set<string>()

  for (const id of matchedIds) {
    if (!byId.has(id)) continue
    let current: T | undefined = byId.get(id)
    const guard = new Set<string>()
    while (current && !guard.has(current.id)) {
      guard.add(current.id)
      kept.add(current.id)
      current = current.parentId ? byId.get(current.parentId) : undefined
    }
  }

  const keptNodes = nodes.filter((node) => kept.has(node.id))
  return { roots: buildTree(keptNodes), keptIds: kept }
}

/**
 * 过滤之后要展开哪些节点。
 *
 * 不展开的话搜索结果里的父级是折叠的 —— 搜出来的东西反而看不见。
 * 只展开**祖先**：命中者自己底下的那些没命中的子节点不该跟着铺开。
 */
export function expandAncestorsOf<T extends TreeItem>(
  nodes: readonly T[],
  matchedIds: ReadonlySet<string>,
): Set<string> {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const out = new Set<string>()

  for (const id of matchedIds) {
    const node = byId.get(id)
    if (!node) continue
    let current = node.parentId ? byId.get(node.parentId) : undefined
    const guard = new Set<string>()
    while (current && !guard.has(current.id)) {
      guard.add(current.id)
      out.add(current.id)
      current = current.parentId ? byId.get(current.parentId) : undefined
    }
  }
  return out
}
