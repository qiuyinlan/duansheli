import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { TreeView } from './TreeView'
import { EmptyState } from './ui/primitives'
import { ItemRow } from './ItemRow'
import { useT } from '../i18n'
import { useAppStore } from '../store/useAppStore'
import { liveItems } from '../store/selectors'
import type { Category } from '../types'
import type { TreeNode } from '../lib/tree'
import { buildTree } from '../lib/tree'
import { IconGrip } from './ui/icons'

const CATEGORY_DRAG_MIME = 'application/x-duansheli-digital-category'

function findNode(nodes: TreeNode<Category>[], id: string): TreeNode<Category> | null {
  for (const node of nodes) {
    if (node.node.id === id) return node
    const child = findNode(node.children, id)
    if (child) return child
  }
  return null
}

export function DigitalCategoryBrowser() {
  const navigate = useNavigate()
  const data = useAppStore((s) => s.data)
  const derived = useAppStore((s) => s.derived)
  const moveCategory = useAppStore((s) => s.moveCategory)
  const notify = useAppStore((s) => s.notify)
  const { t } = useT()
  const digitalCategories = useMemo(
    () => data.categories.filter((category) => category.assetType === 'digital'),
    [data.categories],
  )
  const digitalTree = useMemo(() => buildTree(digitalCategories), [digitalCategories])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [draggingId, setDraggingId] = useState<string | null>(null)

  useEffect(() => {
    setExpanded(new Set(digitalCategories.map((category) => category.id)))
  }, [digitalCategories])

  const activeId = selectedId && digitalCategories.some((category) => category.id === selectedId)
    ? selectedId
    : digitalTree[0]?.node.id ?? null
  const activeNode = activeId ? findNode(digitalTree, activeId) : null
  const childCategories = activeNode?.children ?? []
  const digitalItems = useMemo(
    () => liveItems(data).filter((item) => item.assetType === 'digital'),
    [data],
  )
  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const item of digitalItems) {
      for (const id of item.categoryIds) counts.set(id, (counts.get(id) ?? 0) + 1)
    }
    return counts
  }, [digitalItems])
  const itemsInActiveCategory = activeNode?.children.length === 0
    ? digitalItems.filter((item) => item.categoryIds.includes(activeNode.node.id))
    : []

  const handleCategoryDrop = (targetId: string | null, sourceId: string) => {
    const source = digitalCategories.find((category) => category.id === sourceId)
    if (!source || source.parentId === null || targetId === sourceId) return
    const target = targetId === null ? null : digitalCategories.find((category) => category.id === targetId)
    if (targetId !== null && !target) return
    if (target && target.id === source.parentId) {
      setDraggingId(null)
      return
    }

    const result = moveCategory(sourceId, targetId)
    if (result.ok) {
      setDraggingId(null)
      setSelectedId(targetId)
      if (targetId) setExpanded((previous) => new Set(previous).add(targetId))
      notify(t('categories.moveDone'), 'success')
    } else {
      setDraggingId(null)
      notify(result.reason ?? t('categories.moveFailed'), 'error')
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-header__title">{t('nav.titleDigitalAssets')}</div>
          <div className="page-header__sub">{t('digital.browserSubtitle')}</div>
        </div>
        <div className="page-header__actions">
          <button type="button" className="btn btn--primary" onClick={() => navigate('/ai')}>
            {t('items.aiEntry')}
          </button>
          <button type="button" className="btn btn--primary" onClick={() => navigate('/items/new?asset=digital')}>
            {t('items.addItem')}
          </button>
        </div>
      </div>
      <div className="split digital-browser">
        <aside className="digital-browser__tree">
          {digitalTree.length > 0 ? (
            <TreeView
              nodes={digitalTree}
              selectedIds={activeId ? [activeId] : []}
              onSelect={setSelectedId}
              counts={categoryCounts}
              expanded={expanded}
              dropTarget={{ mime: CATEGORY_DRAG_MIME, onDrop: handleCategoryDrop }}
              onToggle={(id) => setExpanded((prev) => {
                const next = new Set(prev)
                if (next.has(id)) next.delete(id)
                else next.add(id)
                return next
              })}
            />
          ) : (
            <EmptyState title={t('digital.noCategories')} hint={t('digital.noCategoriesHint')} />
          )}
        </aside>
        <section className="digital-browser__content">
          <div className="row-between wrap" style={{ marginBottom: 'var(--gap-3)' }}>
            <div>
              <div className="digital-browser__title">
                {activeNode ? derived.categoryIndex.pathString(activeNode.node.id, ' / ') : t('digital.categories')}
              </div>
              <div className="small muted">{activeNode?.children.length ? t('digital.leafCategories') : t('digital.savedMaterials')}</div>
            </div>
          </div>

          {childCategories.length ? (
            <ul className="list">
              {childCategories.map((node) => (
                <li className={`list-row digital-folder-row${draggingId === node.node.id ? ' is-dragging' : ''}`} key={node.node.id}>
                  <button type="button" className="list-row__main" onClick={() => setSelectedId(node.node.id)}>
                    <span className="list-row__title">{node.node.name}</span>
                    <span className="list-row__meta">{derived.categoryIndex.pathString(node.node.id, ' / ')}</span>
                  </button>
                  {node.node.parentId !== null ? (
                    <span
                      className="digital-folder-row__handle"
                      draggable
                      title={t('digital.dragCategory')}
                      aria-label={t('digital.dragCategory')}
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = 'move'
                        event.dataTransfer.setData(CATEGORY_DRAG_MIME, node.node.id)
                        setDraggingId(node.node.id)
                      }}
                      onDragEnd={() => setDraggingId(null)}
                    >
                      <IconGrip size={15} />
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : itemsInActiveCategory.length > 0 ? (
            <ul className="list">
              {itemsInActiveCategory.map((item) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  ctx={derived}
                  onOpen={(id) => navigate(`/items/${id}`)}
                  actions={item.digitalUri ? <a className="btn btn--sm" href={item.digitalUri} target="_blank" rel="noreferrer">{t('digital.openLink')}</a> : null}
                />
              ))}
            </ul>
          ) : (
            <EmptyState
              title={activeNode ? t('digital.emptyCategory') : t('digital.noCategories')}
              hint={activeNode ? t('digital.emptyCategoryHint') : t('digital.noCategoriesHint')}
            />
          )}
        </section>
      </div>
    </>
  )
}
