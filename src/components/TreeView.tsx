import { useState } from 'react'
import type { DragEvent, ReactNode } from 'react'
import type { TreeItem } from '../types'
import type { TreeNode } from '../lib/tree'
import { t, useT } from '../i18n'
import { IconChevronRight, IconFolder } from './ui/icons'

/**
 * 「别处拖过来的东西可以落在这棵树上」。
 *
 * 为什么要 MIME 类型而不是直接 onDrop：拖拽的数据在**别人的事件里**装好
 * （比如物品行塞进去一个物品 id），这棵树只认那种类型的数据 ——
 * 拖文字、拖文件从上面经过时既不亮、也不拦，不会出现「随手拖个东西上来
 * 就把物品挪走了」。类型串由调用方给，所以这棵树本身对「拖的是什么」一无所知。
 */
export interface TreeDropTarget {
  /** 只认这个类型 */
  mime: string
  /** 松手时调用。顶部虚拟节点（未归位 / 未分类）传 null。 */
  onDrop: (id: string | null, payload: string) => void
}

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
  /** 给这棵树配上落点：每一行（含虚拟节点）都能接住拖过来的东西 */
  dropTarget?: TreeDropTarget | null
  /**
   * 这些节点只是「路径上的一环」，不是搜索命中项。
   *
   * 搜索时用：搜「眼影盘」得到的是「化妆品 › 眼妆 › 眼影盘」，
   * 前两段只是交代它在哪儿，**不该看起来像结果**。所以它们淡一档显示。
   */
  dimmedIds?: ReadonlySet<string>
  /**
   * 给不同层级的**目录名**上色。
   *
   * ── 为什么需要它（用户的说法）────────────────────────────────
   * 「显示位置的时候，它不是会有文件大标题，然后里面有子文件夹吗？
   *   如果是文件夹的嵌套文件夹，那每一个文件夹就要增加一个颜色，
   *   这样子比较好分辨，如果是文件夹位置和里面的物品都是白色的话，
   *   这样有点不好分辨。」
   * 后面又补了一句更明确的：「目录、身为子目录、子大标题而非物品的，
   *   变颜色统一绿色。」
   *
   * 所以规则很短：**第一层（大标题）保持原样，第二层及以下统一绿色。**
   * 只有目录名（这一行的文字）上色，行里的数量、按钮一概不动 ——
   * 这是一棵目录树，「我在第几层」才是这里唯一要用颜色表达的信息。
   */
  tintDepth?: boolean
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
  dropTarget = null,
  dimmedIds,
  tintDepth = false,
}: TreeViewProps<T>) {
  // 订阅语言：展开 / 折叠的读屏标签和兜底的空状态文字要跟着切
  useT()

  const selected = new Set(selectedIds)

  /*
   * 鼠标下面正悬着哪一行。
   *
   * 存的是节点的 key（虚拟节点用它的 id），不是 payload —— 只为了画高亮，
   * 松手那一刻才去读真正拖的是什么。
   */
  const [dropHover, setDropHover] = useState<string | null>(null)

  /** 这次拖的是不是「给这棵树的东西」。不是的话，后面几个处理函数全都不插手。 */
  const acceptsDrag = (e: DragEvent<HTMLElement>) =>
    dropTarget !== null && e.dataTransfer.types.includes(dropTarget.mime)

  /**
   * 一行的落点属性。
   *
   * key 用来标记「悬停的是哪一行」，id 是松手时交出去的东西（虚拟节点为 null）。
   */
  const dropProps = (key: string, id: string | null) => {
    if (dropTarget === null) return {}
    return {
      onDragOver: (e: DragEvent<HTMLDivElement>) => {
        if (!acceptsDrag(e)) return
        // 不 preventDefault 就等于「这里不放」，浏览器会画个禁止符号
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        if (dropHover !== key) setDropHover(key)
      },
      onDragLeave: (e: DragEvent<HTMLDivElement>) => {
        /*
         * 行里面有按钮和文字，鼠标从行背景移到行内的按钮上也会触发一次
         * dragleave —— 那是「还在这一行里」，不能把高亮撤掉，
         * 否则手一动高亮就闪。
         */
        const next = e.relatedTarget as Node | null
        if (next && e.currentTarget.contains(next)) return
        setDropHover((prev) => (prev === key ? null : prev))
      },
      onDrop: (e: DragEvent<HTMLDivElement>) => {
        if (!acceptsDrag(e)) return
        e.preventDefault()
        const payload = e.dataTransfer.getData(dropTarget.mime)
        setDropHover(null)
        if (payload) dropTarget.onDrop(id, payload)
      },
    }
  }

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
            className={`tree-node__row${isActive ? ' is-active' : ''}${
              dropHover === id ? ' is-drop-hover' : ''
            }`}
            style={{ paddingLeft: `calc(${depth} * 14px + var(--gap-2))` }}
            {...dropProps(id, id)}
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
              className={[
                'tree-node__label',
                count === 0 ? 'tree-node__label--empty-loc' : '',
                dimmedIds?.has(id) ? 'tree-node__label--path' : '',
                /*
                 * 目录层级配色（见 tintDepth 的注释）：
                 * 第 0 层是大标题，保持原样；第 1 层起是子目录，统一绿色。
                 * depth 是渲染时递归传下来的，所以这里只认层数，不认别的东西。
                 */
                tintDepth && depth > 0 ? 'tree-node__label--sub' : '',
              ]
                .filter(Boolean)
                .join(' ')}
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
          className={`tree-node__row${selected.has(virtualRoot.id) ? ' is-active' : ''}${
            dropHover === virtualRoot.id ? ' is-drop-hover' : ''
          }`}
          style={{ paddingLeft: 'var(--gap-2)' }}
          /*
           * 「未归位」也是落点，落到它身上等于把东西从位置上撤下来 ——
           * 这条路径得有，否则拖出去的东西就再也拖不回来了。
           */
          {...dropProps(virtualRoot.id, null)}
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
