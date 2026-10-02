import type { ReactNode } from 'react'
import type { TreeItem } from '../types'
import type { TreeNode } from '../lib/tree'
import { t, useT } from '../i18n'
import { IconChevronRight, IconFolder } from './ui/icons'

/**
 * 通用树形视图。
 *
 * 位置和分类都是不限层级的树，长得也一样，
 * 所以渲染逻辑只写这一份 —— 省得两边各写一遍然后样式慢慢跑偏。
 */
export interface TreeViewProps<T extends TreeItem> {
  nodes: TreeNode<T>[]
  /**
   * 当前选中项，支持多选（分类选择器里一件物品可以属于多个分类）。
   * 「未归位」「未分类」这两个虚拟节点用它们的哨兵 id 表示
   * （UNASSIGNED_ID / UNCATEGORIZED_ID），跟筛选器里的表示保持一致。
   */
  selectedIds: readonly string[]
  /** 点某个节点。虚拟节点（未归位 / 未分类）传 null。 */
  onSelect: (id: string | null) => void
  /** 含子孙的数量，显示在行尾 */
  counts: Map<string, number>
  expanded: Set<string>
  onToggle: (id: string) => void
  /** 行尾的操作按钮（新建子级 / 移动 / 重命名 / 删除） */
  renderActions?: (node: T) => ReactNode
  /** 树顶的虚拟节点，例如「未归位」「未分类」 */
  virtualRoot?: { id: string; label: string; count: number } | null
  emptyText?: string
}

export function TreeView<T extends TreeItem>({
  nodes,
  selectedIds,
  onSelect,
  counts,
  expanded,
  onToggle,
  renderActions,
  virtualRoot = null,
  emptyText,
}: TreeViewProps<T>) {
  // 订阅语言：展开 / 折叠的读屏标签和兜底的空状态文字要跟着切
  useT()

  const selected = new Set(selectedIds)

  const renderNodes = (list: TreeNode<T>[], depth: number): ReactNode =>
    list.map((node) => {
      const id = node.node.id
      const hasChildren = node.children.length > 0
      const isOpen = expanded.has(id)
      const isActive = selected.has(id)
      const count = counts.get(id) ?? 0

      return (
        <div key={id}>
          <div
            className={`tree-node__row${isActive ? ' is-active' : ''}`}
            style={{ paddingLeft: `calc(${depth} * 14px + var(--gap-2))` }}
          >
            {hasChildren ? (
              <button
                type="button"
                className={`tree-node__toggle${isOpen ? ' is-open' : ''}`}
                aria-label={isOpen ? t('tree.collapse') : t('tree.expand')}
                aria-expanded={isOpen}
                onClick={() => onToggle(id)}
              >
                <IconChevronRight size={11} />
              </button>
            ) : (
              <span className="tree-node__toggle tree-node__toggle--empty" />
            )}

            <button
              type="button"
              className={`tree-node__label${count === 0 ? ' tree-node__label--empty-loc' : ''}`}
              onClick={() => onSelect(id)}
              aria-pressed={isActive}
            >
              <span className="truncate">{node.node.name}</span>
            </button>

            <span className="tree-node__count">{count > 0 ? count : ''}</span>

            {renderActions ? (
              <div className="tree-node__actions">{renderActions(node.node)}</div>
            ) : null}
          </div>

          {hasChildren && isOpen ? renderNodes(node.children, depth + 1) : null}
        </div>
      )
    })

  return (
    <div className="tree">
      {virtualRoot ? (
        <div
          className={`tree-node__row${selected.has(virtualRoot.id) ? ' is-active' : ''}`}
          style={{ paddingLeft: 'var(--gap-2)' }}
        >
          <span className="tree-node__toggle tree-node__toggle--empty" />
          <button
            type="button"
            className={`tree-node__label${
              virtualRoot.count === 0 ? ' tree-node__label--empty-loc' : ''
            }`}
            onClick={() => onSelect(null)}
            aria-pressed={selected.has(virtualRoot.id)}
          >
            <IconFolder size={13} />
            <span className="truncate">{virtualRoot.label}</span>
          </button>
          <span className="tree-node__count">
            {virtualRoot.count > 0 ? virtualRoot.count : ''}
          </span>
        </div>
      ) : null}

      {nodes.length === 0 ? (
        <div className="dim small" style={{ padding: 'var(--gap-3)' }}>
          {/* 调用方给了就用调用方的（那是它的文案），没给才用这里的兜底 */}
          {emptyText ?? t('tree.empty')}
        </div>
      ) : null}

      {renderNodes(nodes, 0)}
    </div>
  )
}
