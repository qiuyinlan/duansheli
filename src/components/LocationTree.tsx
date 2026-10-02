import type { ReactNode } from 'react'
import type { Location } from '../types'
import type { TreeNode } from '../lib/tree'
import { IconChevronRight, IconFolder } from './ui/icons'

interface LocationTreeProps {
  nodes: TreeNode<Location>[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  /** 含子孙位置的数量，用于行尾徽标 */
  counts: Map<string, number>
  expanded: Set<string>
  onToggle: (id: string) => void
  /** 行尾的操作按钮（重命名 / 新建子位置 / 删除） */
  renderActions?: (node: Location) => ReactNode
  /** 是否在树顶显示「未归位」这一项 */
  showUnassigned?: boolean
  unassignedCount?: number
}

export function LocationTree({
  nodes,
  selectedId,
  onSelect,
  counts,
  expanded,
  onToggle,
  renderActions,
  showUnassigned = false,
  unassignedCount = 0,
}: LocationTreeProps) {
  const renderNodes = (list: TreeNode<Location>[], depth: number): ReactNode =>
    list.map((node) => {
      const id = node.node.id
      const hasChildren = node.children.length > 0
      const isOpen = expanded.has(id)
      const isActive = selectedId === id
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
                aria-label={isOpen ? '折叠' : '展开'}
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
              title={node.node.note || node.node.name}
            >
              <span className="truncate">{node.node.name}</span>
            </button>

            <span className="tree-node__count">{count > 0 ? count : ''}</span>

            {renderActions ? <div className="tree-node__actions">{renderActions(node.node)}</div> : null}
          </div>

          {hasChildren && isOpen ? renderNodes(node.children, depth + 1) : null}
        </div>
      )
    })

  return (
    <div className="tree">
      {showUnassigned ? (
        <div
          className={`tree-node__row${selectedId === null ? ' is-active' : ''}`}
          style={{ paddingLeft: 'var(--gap-2)' }}
        >
          <span className="tree-node__toggle tree-node__toggle--empty" />
          <button
            type="button"
            className={`tree-node__label${unassignedCount === 0 ? ' tree-node__label--empty-loc' : ''}`}
            onClick={() => onSelect(null)}
          >
            <IconFolder size={13} />
            <span className="truncate">未归位</span>
          </button>
          <span className="tree-node__count">{unassignedCount > 0 ? unassignedCount : ''}</span>
        </div>
      ) : null}

      {nodes.length === 0 && !showUnassigned ? (
        <div className="dim small" style={{ padding: 'var(--gap-3)' }}>
          还没有位置
        </div>
      ) : null}

      {renderNodes(nodes, 0)}
    </div>
  )
}
