import { useEffect, useMemo, useState } from 'react'
import type { AttributeDef, Collection } from '../types'
import { UNASSIGNED_ID } from '../types'
import type { DerivedContext } from '../store/selectors'
import { countByCategoryIncludingDescendants, liveItems } from '../store/selectors'
import { expandAncestorsOf, filterTreeByIds, searchTreeIds } from '../lib/tree'
import { pinnedNodes, togglePinned } from '../lib/pins'
import { useAppStore } from '../store/useAppStore'
import { useT } from '../i18n'
import { TreeView } from './TreeView'
import { IconClose, IconPlus, IconStar, IconSuitcase } from './ui/icons'
import { Button, Modal, PinButton, SearchInput } from './ui/primitives'

/* ------------------------------------------------------------------ */
/* 「置顶」那一小块                                                    */
/* ------------------------------------------------------------------ */

/**
 * 弹窗顶上那一块「置顶」。
 *
 * ── 为什么要有它，而不是只把置顶的排到树的最前面 ──────────────────
 * 位置和分类都是**树**：把一条挪到最前面，就等于把它从它的父子关系里
 * 拎出来（「衣柜 / 2层」跑到根上，看着像顶层位置）。所以树本身不动，
 * 置顶的那几条另外摆一块 —— 每条都写着**完整路径**，
 * 点一下就能选中，不用先一层层展开去找。
 *
 * 点它的行为和点树里那一行**完全一样**（由调用方决定是选中还是切换勾选），
 * 星星则是取消置顶。
 */
function PinnedBlock({
  nodes,
  pathOf,
  isActive,
  onPick,
  onUnpin,
}: {
  nodes: Array<{ id: string; name: string }>
  pathOf: (id: string) => string
  isActive: (id: string) => boolean
  onPick: (id: string) => void
  onUnpin: (id: string) => void
}) {
  const { t } = useT()
  if (nodes.length === 0) return null

  return (
    <div className="picker-pinned">
      <div className="picker-pinned__head tiny">
        <IconStar size={11} filled />
        {t('common.pinnedTitle')}
      </div>
      <div className="picker-pinned__list">
        {nodes.map((node) => {
          const path = pathOf(node.id)
          return (
            <div key={node.id} className="picker-pinned__row">
              <button
                type="button"
                className={`tree-node__label grow${isActive(node.id) ? ' is-picked' : ''}`}
                onClick={() => onPick(node.id)}
                aria-pressed={isActive(node.id)}
              >
                <span className="truncate">{path === '' ? node.name : path}</span>
              </button>
              <PinButton pinned name={path === '' ? node.name : path} onClick={() => onUnpin(node.id)} />
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 位置选择器                                                          */
/* ------------------------------------------------------------------ */

interface LocationPickerProps {
  open: boolean
  onClose: () => void
  value: string | null
  onSelect: (id: string | null) => void
  ctx: DerivedContext
  counts: Map<string, number>
  allowUnassigned?: boolean
}

export function LocationPicker({
  open,
  onClose,
  value,
  onSelect,
  ctx,
  counts,
  allowUnassigned = true,
}: LocationPickerProps) {
  const { t, tc } = useT()
  /** 搜索词 —— 位置多了之后，滚动找一层抽屉是很费劲的事（issue 4） */
  const [query, setQuery] = useState('')

  /*
   * 置顶（星星）。存在界面偏好里、跟着这台设备走 ——
   * 「我常把东西放在哪个抽屉」是使用习惯，不是数据。
   */
  const pinnedLocationIds = useAppStore((s) => s.ui.pinnedLocationIds)
  const setUi = useAppStore((s) => s.setUi)

  // 打开时展开顶层 + 当前选中项的祖先路径，让人一眼看到自己在哪
  const initialExpanded = useMemo(() => {
    const set = new Set<string>()
    for (const node of ctx.tree) set.add(node.node.id)

    if (value) {
      const guard = new Set<string>()
      let current = ctx.index.byId.get(value)
      while (current?.parentId && !guard.has(current.id)) {
        guard.add(current.id)
        set.add(current.parentId)
        current = ctx.index.byId.get(current.parentId)
      }
    }
    return set
  }, [ctx, value])

  const [expanded, setExpanded] = useState<Set<string>>(initialExpanded)

  useEffect(() => {
    if (open) {
      setExpanded(initialExpanded)
      // 每次打开都从「没搜索」开始，免得上次搜的词让人以为位置变少了
      setQuery('')
    }
  }, [open, initialExpanded])

  const currentPath = value ? ctx.index.pathString(value, ' / ') : t('status.unassigned')

  /** 置顶的那几条（按他点星星的顺序），已经删掉的位置自动跳过 */
  const pinnedLocations = useMemo(
    () => pinnedNodes(pinnedLocationIds, [...ctx.index.byId.values()]),
    [pinnedLocationIds, ctx],
  )
  const togglePin = (id: string) =>
    setUi({ pinnedLocationIds: togglePinned(pinnedLocationIds, id) })

  /*
   * 搜索：命中的位置**连同祖先**一起显示（祖先淡一档）。
   * 只留命中项的话，剩下的节点会被当成顶层 —— 搜「第二层抽屉」得到一条
   * 孤零零的「第二层抽屉」，用户根本看不出它是哪个柜子里的。
   */
  const matchedIds = useMemo(
    () => searchTreeIds(ctx.locationById ? [...ctx.index.byId.values()] : [], query),
    [ctx, query],
  )
  const searching = query.trim() !== ''
  const view = useMemo(
    () => (searching ? filterTreeByIds([...ctx.index.byId.values()], matchedIds) : null),
    [searching, ctx, matchedIds],
  )
  const pathOnlyIds = useMemo(() => {
    if (!searching || !view) return new Set<string>()
    return new Set([...view.keptIds].filter((id) => !matchedIds.has(id)))
  }, [searching, view, matchedIds])
  const effectiveExpanded = useMemo(() => {
    if (!searching) return expanded
    return new Set([...expanded, ...expandAncestorsOf([...ctx.index.byId.values()], matchedIds)])
  }, [searching, expanded, ctx, matchedIds])

  return (
    <Modal
      open={open}
      title={t('itemEdit.pickLocationTitle')}
      onClose={onClose}
      footer={<Button onClick={onClose}>{t('common.close')}</Button>}
    >
      <div className="dim small" style={{ marginBottom: 'var(--gap-3)' }}>
        {t('itemEdit.pickLocationCurrent', { path: currentPath })}
      </div>

      <div style={{ marginBottom: 'var(--gap-2)' }}>
        <SearchInput
          value={query}
          onValueChange={setQuery}
          placeholder={t('itemEdit.locationSearchPlaceholder')}
          aria-label={t('itemEdit.locationSearchAria')}
        />
      </div>

      {searching ? (
        <div className="small muted" style={{ marginBottom: 'var(--gap-2)' }}>
          {matchedIds.size > 0
            ? tc(matchedIds.size, 'itemEdit.locationSearchFound')
            : t('itemEdit.locationSearchNone')}
        </div>
      ) : (
        <>
          {/* 没在搜索时才摆出来 —— 搜索时用户要的是结果，不是捷径 */}
          <PinnedBlock
            nodes={pinnedLocations}
            pathOf={(id) => ctx.index.pathString(id, ' / ')}
            isActive={(id) => id === value}
            onPick={(id) => {
              onSelect(id)
              onClose()
            }}
            onUnpin={togglePin}
          />
          {/* 一次都没置顶过时提一句，怎么用一眼就能看懂；钉了之后就不念了 */}
          {pinnedLocations.length === 0 ? (
            <div className="tiny dim" style={{ marginBottom: 'var(--gap-2)' }}>
              {t('common.pinHint')}
            </div>
          ) : null}
        </>
      )}

      <TreeView
        nodes={view ? view.roots : ctx.tree}
        selectedIds={value ? [value] : [UNASSIGNED_ID]}
        /*
         * 目录层级配色，和位置页那棵树保持一致 ——
         * 同一个「家 / 卧室 / 衣柜」在这里和在那里长得应该一样，
         * 否则用户得学两套。
         */
        tintDepth
        onSelect={(id) => {
          onSelect(id)
          onClose()
        }}
        counts={counts}
        expanded={effectiveExpanded}
        pinnedIds={new Set(pinnedLocationIds)}
        onTogglePin={togglePin}
        onToggle={(id) =>
          setExpanded((prev) => {
            const next = new Set(prev)
            if (next.has(id)) next.delete(id)
            else next.add(id)
            return next
          })
        }
        dimmedIds={pathOnlyIds}
        /* 搜索时「未归位」那一行不该跟着出现在结果里 —— 它没名字，永远不匹配 */
        virtualRoot={
          allowUnassigned && !searching
            ? {
                id: UNASSIGNED_ID,
                label: t('status.unassigned'),
                count: counts.get(UNASSIGNED_ID) ?? 0,
              }
            : null
        }
        emptyText={searching ? t('itemEdit.locationSearchNone') : t('itemEdit.locationsEmpty')}
      />
    </Modal>
  )
}

/* ------------------------------------------------------------------ */
/* 分类选择器（树形多选）                                              */
/* ------------------------------------------------------------------ */

interface CategoryPickerProps {
  open: boolean
  onClose: () => void
  selectedIds: string[]
  onChange: (ids: string[]) => void
}

export function CategoryPicker({ open, onClose, selectedIds, onChange }: CategoryPickerProps) {
  const data = useAppStore((s) => s.data)
  const derived = useAppStore((s) => s.derived)
  const addCategory = useAppStore((s) => s.addCategory)
  const notify = useAppStore((s) => s.notify)
  const { t, tc } = useT()

  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [newName, setNewName] = useState('')
  /** 搜索词 —— 分类多了之后，滚动找一个分类是很费劲的事（issue 4） */
  const [query, setQuery] = useState('')

  /* 置顶（星星），和位置选择器同一套规矩：存界面偏好、跟着这台设备走 */
  const pinnedCategoryIds = useAppStore((s) => s.ui.pinnedCategoryIds)
  const setUi = useAppStore((s) => s.setUi)

  // 分类树一般不大，打开时全展开
  useEffect(() => {
    if (!open) return
    setExpanded(new Set(derived.categoryFlat.map((node) => node.node.id)))
    // 每次打开都从「没搜索」开始，免得上次搜的词让人以为分类变少了
    setQuery('')
  }, [open, derived.categoryFlat])

  const counts = useMemo(
    () => countByCategoryIncludingDescendants(liveItems(data), derived),
    [data, derived],
  )

  /*
   * 搜索。
   *
   * 命中的节点**连同祖先**一起显示（祖先淡一档）：树里把父级摘掉之后，
   * 剩下的节点会被当成顶层显示，于是搜「眼影盘」得到一条孤零零的
   * 「眼影盘」—— 用户会以为它是顶层分类，点下去选错层级也不知道。
   */
  const matchedIds = useMemo(
    () => searchTreeIds(data.categories, query),
    [data.categories, query],
  )
  const searching = query.trim() !== ''
  const view = useMemo(
    () => (searching ? filterTreeByIds(data.categories, matchedIds) : null),
    [searching, data.categories, matchedIds],
  )
  /** 祖先节点（留着当路径，但不是命中项） */
  const pathOnlyIds = useMemo(() => {
    if (!searching || !view) return new Set<string>()
    return new Set([...view.keptIds].filter((id) => !matchedIds.has(id)))
  }, [searching, view, matchedIds])

  /*
   * 搜索时把祖先路径自动展开，而且**不要**动用户手动调过的 expanded ——
   * 所以这里算的是「额外要展开的」，跟 expanded 合并后再给 TreeView。
   */
  const effectiveExpanded = useMemo(() => {
    if (!searching) return expanded
    return new Set([...expanded, ...expandAncestorsOf(data.categories, matchedIds)])
  }, [searching, expanded, data.categories, matchedIds])

  const toggle = (id: string) => {
    onChange(
      selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id],
    )
  }

  /** 置顶的那几个分类（按他点星星的顺序），已经删掉的自动跳过 */
  const pinnedCategories = useMemo(
    () => pinnedNodes(pinnedCategoryIds, [...derived.categoryIndex.byId.values()]),
    [pinnedCategoryIds, derived],
  )
  const togglePin = (id: string) =>
    setUi({ pinnedCategoryIds: togglePinned(pinnedCategoryIds, id) })

  const createTopLevel = () => {
    const name = newName.trim()
    if (name === '') return
    const created = addCategory(name, null)
    if (!created) {
      notify(t('itemEdit.duplicateCategory', { name }), 'error')
      return
    }
    onChange([...selectedIds, created.id])
    setNewName('')
  }

  return (
    <Modal
      open={open}
      title={t('itemEdit.pickCategoryTitle')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('common.close')}</Button>
          <Button variant="primary" onClick={onClose}>
            {t('itemEdit.pickConfirm', { count: selectedIds.length })}
          </Button>
        </>
      }
    >
      <div className="dim small" style={{ marginBottom: 'var(--gap-3)' }}>
        {t('itemEdit.pickCategoryHint')}
      </div>

      {/* 搜索框：分类多的时候靠它，不用一层层翻 */}
      <div style={{ marginBottom: 'var(--gap-2)' }}>
        <SearchInput
          value={query}
          onValueChange={setQuery}
          placeholder={t('itemEdit.categorySearchPlaceholder')}
          aria-label={t('itemEdit.categorySearchAria')}
        />
      </div>

      {/* 搜索时把「找到几条」如实说出来 —— 找不到是常见情况（打错一个字） */}
      {searching ? (
        <div className="small muted" style={{ marginBottom: 'var(--gap-2)' }}>
          {matchedIds.size > 0
            ? tc(matchedIds.size, 'itemEdit.categorySearchFound')
            : t('itemEdit.categorySearchNone')}
        </div>
      ) : (
        <>
          {/* 置顶的几个分类单独摆一块（点一下 = 勾上 / 取消，和树里那一行一样） */}
          <PinnedBlock
            nodes={pinnedCategories}
            pathOf={(id) => derived.categoryIndex.pathString(id, ' / ')}
            isActive={(id) => selectedIds.includes(id)}
            onPick={toggle}
            onUnpin={togglePin}
          />
          {pinnedCategories.length === 0 ? (
            <div className="tiny dim" style={{ marginBottom: 'var(--gap-2)' }}>
              {t('common.pinHint')}
            </div>
          ) : null}
        </>
      )}

      <div
        style={{
          border: '1px solid var(--line)',
          borderRadius: 'var(--radius)',
          padding: 'var(--gap-2)',
          maxHeight: 320,
          overflowY: 'auto',
        }}
      >
        <TreeView
          nodes={view ? view.roots : derived.categoryTree}
          selectedIds={selectedIds}
          onSelect={(id) => {
            if (id) toggle(id)
          }}
          counts={counts}
          expanded={effectiveExpanded}
          onToggle={(id) =>
            setExpanded((prev) => {
              const next = new Set(prev)
              if (next.has(id)) next.delete(id)
              else next.add(id)
              return next
            })
          }
          dimmedIds={pathOnlyIds}
          pinnedIds={new Set(pinnedCategoryIds)}
          onTogglePin={togglePin}
          emptyText={
            searching ? t('itemEdit.categorySearchNone') : t('itemEdit.categoriesEmpty')
          }
        />
      </div>

      <div className="field" style={{ marginTop: 'var(--gap-4)' }}>
        <label className="field__label" htmlFor="new-category-name">
          {t('itemEdit.newTopCategory')}
        </label>
        <div className="row">
          <input
            id="new-category-name"
            className="input grow"
            placeholder={t('itemEdit.newCategoryPlaceholder')}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                createTopLevel()
              }
            }}
          />
          <Button onClick={createTopLevel} disabled={newName.trim() === ''}>
            <IconPlus size={13} />
            {t('common.create')}
          </Button>
        </div>
        <div className="field__hint">{t('itemEdit.subCategoryHint')}</div>
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------------ */
/* 标签输入                                                            */
/* ------------------------------------------------------------------ */

interface TagInputProps {
  value: string[]
  onChange: (tags: string[]) => void
  /** 数据里已经用过的标签 */
  suggestions: string[]
}

export function TagInput({ value, onChange, suggestions }: TagInputProps) {
  const [draft, setDraft] = useState('')
  const { t } = useT()

  const available = suggestions.filter((tag) => !value.includes(tag)).slice(0, 12)

  const add = (raw: string) => {
    const tag = raw.trim()
    if (tag === '' || value.includes(tag)) {
      setDraft('')
      return
    }
    onChange([...value, tag])
    setDraft('')
  }

  const remove = (tag: string) => onChange(value.filter((v) => v !== tag))

  return (
    <div className="stack-sm">
      {value.length > 0 ? (
        <div className="chip-list">
          {value.map((tag) => (
            <span key={tag} className="chip is-active">
              {tag}
              <button
                type="button"
                className="chip__remove"
                aria-label={t('itemEdit.removeTagAria', { name: tag })}
                onClick={() => remove(tag)}
              >
                <IconClose size={11} />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <input
        className="input"
        placeholder={t('itemEdit.tagPlaceholder')}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            add(draft)
          } else if (e.key === 'Backspace' && draft === '' && value.length > 0) {
            remove(value[value.length - 1])
          }
        }}
        onBlur={() => add(draft)}
      />

      {available.length > 0 ? (
        <div className="chip-list">
          {available.map((tag) => (
            <button key={tag} type="button" className="chip chip--dashed" onClick={() => add(tag)}>
              <IconPlus size={11} />
              {tag}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 活动合集选择器                                                      */
/* ------------------------------------------------------------------ */

interface CollectionPickerProps {
  value: string[]
  onChange: (ids: string[]) => void
  collections: Collection[]
  /**
   * 输一个新名字时建活动。返回新 id（建不出来返回 null）。
   *
   * 做成回调而不是在这里直接调 store，是因为「建完要不要顺手勾上」是
   * 调用方的决定 —— 录入页显然要勾上，别的地方未必。
   */
  onCreate: (name: string) => string | null
}

/**
 * 活动合集选择器。
 *
 * 和 TagInput 长得像，但有个关键区别：**已选和候选都是点一下切换的按钮**，
 * 而不是「去掉一个标签」。因为活动是有限几个、而且反复勾来勾去，
 * 切换比「先删再加」顺手得多。
 */
export function CollectionPicker({
  value,
  onChange,
  collections,
  onCreate,
}: CollectionPickerProps) {
  const { t } = useT()
  const [draft, setDraft] = useState('')

  const sorted = useMemo(
    () => [...collections].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name)),
    [collections],
  )

  const toggle = (id: string) => {
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id])
  }

  const submitDraft = () => {
    const name = draft.trim()
    if (name === '') return
    // 名字已经存在就当「勾上它」，而不是报重名 —— 用户的意图显然是选中
    const existing = sorted.find((c) => c.name === name)
    if (existing) {
      if (!value.includes(existing.id)) onChange([...value, existing.id])
      setDraft('')
      return
    }
    const created = onCreate(name)
    setDraft('')
    if (created === null) return
  }

  return (
    <div className="stack-sm">
      {sorted.length > 0 ? (
        <div className="chip-list">
          {sorted.map((collection) => (
            <button
              key={collection.id}
              type="button"
              className={`chip${value.includes(collection.id) ? ' is-active' : ''}`}
              aria-pressed={value.includes(collection.id)}
              onClick={() => toggle(collection.id)}
            >
              <IconSuitcase size={11} />
              {collection.name}
            </button>
          ))}
        </div>
      ) : (
        <div className="field__hint">{t('itemEdit.noCollectionsYet')}</div>
      )}

      <input
        className="input"
        placeholder={t('itemEdit.collectionPlaceholder')}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            submitDraft()
          }
        }}
        onBlur={submitDraft}
      />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 属性勾选器（决定这次要填哪些属性）                                    */
/* ------------------------------------------------------------------ */

interface AttributePickerProps {
  open: boolean
  onClose: () => void
  defs: AttributeDef[]
  selectedIds: string[]
  onChange: (ids: string[]) => void
}

export function AttributePicker({
  open,
  onClose,
  defs,
  selectedIds,
  onChange,
}: AttributePickerProps) {
  const { t } = useT()

  const sorted = useMemo(
    () => [...defs].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'zh-CN')),
    [defs],
  )

  const toggle = (id: string) => {
    onChange(
      selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id],
    )
  }

  return (
    <Modal
      open={open}
      title={t('itemEdit.pickAttrTitle')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('common.close')}</Button>
          <Button variant="primary" onClick={onClose}>
            {t('itemEdit.pickConfirm', { count: selectedIds.length })}
          </Button>
        </>
      }
    >
      {sorted.length === 0 ? (
        <div className="dim small">{t('itemEdit.attrPickerEmpty')}</div>
      ) : (
        <>
          <div className="dim small" style={{ marginBottom: 'var(--gap-3)' }}>
            {t('itemEdit.attrPickerHint')}
          </div>
          <div className="attr-picker">
            {sorted.map((def) => {
              const active = selectedIds.includes(def.id)
              return (
                <label key={def.id} className="attr-picker__row">
                  <input type="checkbox" checked={active} onChange={() => toggle(def.id)} />
                  <span className="attr-picker__name">{def.name}</span>
                  <span className="tiny dim">
                    {def.type === 'select'
                      ? t('itemEdit.attrTypeSelect')
                      : def.type === 'bool'
                        ? t('itemEdit.attrTypeBool')
                        : def.type === 'date'
                          ? t('itemEdit.attrTypeDate')
                          : def.type === 'number'
                            ? def.unit
                              ? t('itemEdit.attrTypeNumberUnit', { unit: def.unit })
                              : t('itemEdit.attrTypeNumber')
                            : t('itemEdit.attrTypeText')}
                  </span>
                </label>
              )
            })}
          </div>
        </>
      )}
    </Modal>
  )
}
