import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ItemRow } from '../components/ItemRow'
import { TreeView } from '../components/TreeView'
import { LocationPicker } from '../components/pickers'
import { IconPencil, IconPlus, IconTrash } from '../components/ui/icons'
import { Button, ConfirmDialog, EmptyState, Modal, SearchInput, Switch } from '../components/ui/primitives'
import { useT } from '../i18n'
import { commandVocab } from '../ai/commandVocab'
import { levelNames, levelsFromName } from '../lib/levels'
import { assignTreeColors, topLevelColorMap, type ColorTreeNode } from '../lib/palette'
import { expandAncestorsOf, filterTreeByIds, searchTreeIds, type TreeNode } from '../lib/tree'
import {
  countByLocationIncludingDescendants,
  itemsInLocation,
  liveItems,
} from '../store/selectors'
import { useAppStore } from '../store/useAppStore'
import type { Item, Location } from '../types'
import { UNASSIGNED_ID } from '../types'

/**
 * 拖物品用的数据类型。
 *
 * 用一个专属类型，而不是顺手写 `text/plain`：后者是**谁都能塞**的通用类型
 * （随便一段选中的文字拖起来就是它）。专属类型意味着只有物品行会产出，
 * 位置树也就只会接住「从物品行上拎起来的东西」，别的一概不理会。
 */
const ITEM_DRAG_MIME = 'application/x-duansheli-item'

interface NameDialogState {
  mode: 'add' | 'rename'
  parentId: string | null
  targetId?: string
  initial: string
  /*
   * 注意这里**不存译好的标题**。
   *
   * 存字符串的写法是：打开对话框时算出 `title: t('locations.renameTitle')`，
   * 然后在 Modal 上渲染它。平时看不出问题 —— 因为对话框的全屏遮罩正好盖住了
   * 右上角的语言开关，「开着对话框切语言」这条路径走不到。
   * 但这只是**碰巧**成立：哪天遮罩不盖顶栏了、或者加个快捷键切语言，它就露出来，
   * 而且是最难查的那种症状 —— 别处都变了，就这一处没变。
   * 所以标题改成在渲染时由 mode / parentId 现推。
   */
}

export function Locations() {
  const navigate = useNavigate()
  const data = useAppStore((s) => s.data)
  const derived = useAppStore((s) => s.derived)
  const ui = useAppStore((s) => s.ui)
  const setUi = useAppStore((s) => s.setUi)
  const addLocation = useAppStore((s) => s.addLocation)
  const addLocationWithLevels = useAppStore((s) => s.addLocationWithLevels)
  const renameLocation = useAppStore((s) => s.renameLocation)
  const deleteLocation = useAppStore((s) => s.deleteLocation)
  const moveLocation = useAppStore((s) => s.moveLocation)
  const batchMoveToLocation = useAppStore((s) => s.batchMoveToLocation)
  const batchSetStatus = useAppStore((s) => s.batchSetStatus)
  const updateItem = useAppStore((s) => s.updateItem)
  const setIdle = useAppStore((s) => s.setIdle)
  const notify = useAppStore((s) => s.notify)

  // 拿 t/tc 的同时也订阅了语言：切语言时这个页面会整个重新渲染
  const { t, tc } = useT()

  const [selected, setSelected] = useState<string | null>(null)
  const [touched, setTouched] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [expandInit, setExpandInit] = useState(false)

  const [nameDialog, setNameDialog] = useState<NameDialogState | null>(null)
  const [nameDraft, setNameDraft] = useState('')
  /** 「同时把 1~N 层也建好」——只在名字里写了层数时才出现 */
  const [alsoBuildLevels, setAlsoBuildLevels] = useState(true)
  const [moveTarget, setMoveTarget] = useState<string | null>(null)
  /** 正在被拖着的物品（只为把那一行画淡一点） */
  const [draggingId, setDraggingId] = useState<string | null>(null)
  /** 触屏 / 键盘用户的「移到…」：拖拽在手机上根本不触发，得留一条不用拖的路 */
  const [itemMoveTarget, setItemMoveTarget] = useState<Item | null>(null)
  /**
   * 行内改名（issue 7）。
   *
   * 用户的原话：「在位置那一个页面里也可以进行物品的增删改查，现在只能点击
   * 那个物品进去才能编辑它，我想要像分类那个地方一样，可以直接在那个界面删除。」
   *
   * 分类页右边那列的每一条都能就地处理。位置页既然结构跟它一样，
   * 行为也该一样 —— 想改个名字不该被逼着离开这一页。
   */
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [deleteProbe, setDeleteProbe] = useState<{
    id: string
    name: string
    childCount: number
    itemCount: number
  } | null>(null)

  /*
   * 展开状态：**先照用户上次调好的来**，没有记录才给默认视角。
   *
   * 用户的原话：「感觉现在pc端，看那个位置，全是绿的，还是不好看，
   * 这么多折叠层级，怎么看最清晰呢」。
   *
   * 以前是「进来就把整棵树全部展开」—— 那等于一进门就给他最坏的第一眼：
   * 所有层级同时铺开。现在的默认是**只展开顶层**（看得见有哪几个大标题，
   * 点一下再往下走），而且他手动调过的状态**会被记住**（切页回来不再重来）。
   */
  useEffect(() => {
    if (expandInit || derived.tree.length === 0) return
    setExpanded(
      ui.locationsExpandedTouched
        ? new Set(ui.expandedLocations)
        : new Set(derived.tree.map((node) => node.node.id)),
    )
    setExpandInit(true)
  }, [
    derived.tree,
    expandInit,
    ui.locationsExpandedTouched,
    ui.expandedLocations,
  ])

  /**
   * 展开状态一变就记住（跟着这台设备走）。
   *
   * 注意这里记的是 `expanded`（**用户自己的选择**），不是 `effectiveExpanded`
   * （那个还掺了「搜索时临时展开的祖先」）—— 搜索不该改写他的偏好。
   */
  useEffect(() => {
    if (!expandInit) return
    setUi({ expandedLocations: [...expanded], locationsExpandedTouched: true })
  }, [expanded, expandInit, setUi])

  /**
   * 点开 / 收起一级。
   *
   * 用**函数式更新**而不是读当前渲染里的那份：同一批里连点两下
   * （测试里一次 act 点多个、用户手快也一样）时，读闭包的那版会让
   * 前一下的展开丢掉 —— 表现是「点两个，只有一个开了」。
   */
  const toggleExpanded = (id: string) => {
    setExpandInit(true)
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const expandAll = () => {
    setExpandInit(true)
    setExpanded(new Set(derived.flat.map((node) => node.node.id)))
  }

  const collapseAll = () => {
    setExpandInit(true)
    setExpanded(new Set())
  }

  /* ---- 搜索：和分类页、选择器**同一套**函数，行为必然一致 ---- */
  const [query, setQuery] = useState('')
  const searching = query.trim() !== ''
  const matchedIds = useMemo(
    () => (searching ? searchTreeIds(derived.flat.map((node) => node.node), query) : new Set<string>()),
    [searching, derived.flat, query],
  )
  const searchView = useMemo(
    () => (searching ? filterTreeByIds(derived.flat.map((node) => node.node), matchedIds) : null),
    [searching, derived.flat, matchedIds],
  )
  /** 搜索结果里「只是路径」的祖先节点 —— 淡一档，别看起来像命中 */
  const dimmedIds = useMemo(() => {
    if (!searching || searchView === null) return new Set<string>()
    return new Set([...searchView.keptIds].filter((id) => !matchedIds.has(id)))
  }, [searching, searchView, matchedIds])
  /** 搜索时把命中项的祖先展开（但不动用户调过的展开状态） */
  const effectiveExpanded = useMemo(() => {
    if (!searching || searchView === null) return expanded
    return new Set([...expanded, ...expandAncestorsOf(derived.flat.map((node) => node.node), matchedIds)])
  }, [searching, searchView, expanded, derived.flat, matchedIds])

  /**
   * 顶层分支一份色板，子层继承它并逐层变淡（`assignTreeColors`）。
   *
   * 顶层 key 用**完整的顶层列表**（含没有东西的）算，和物品列表、概览图表
   * 共用同一份规则 —— 否则会出现「列表里这一支是蓝的、这里却是绿的」。
   */
  const branchColors = useMemo(() => {
    const toColorNodes = (nodes: TreeNode<Location>[]): ColorTreeNode[] =>
      nodes.map((node) => ({ key: node.node.id, children: toColorNodes(node.children) }))
    return assignTreeColors(
      toColorNodes(derived.tree),
      topLevelColorMap(derived.tree.map((node) => node.node.id)),
    )
  }, [derived.tree])

  const live = useMemo(() => liveItems(data), [data])
  const counts = useMemo(
    () => countByLocationIncludingDescendants(live, derived),
    [live, derived],
  )

  // 还没点过任何位置时，默认选中第一个顶层位置（比默认看「未归位」友好）
  const activeId = touched ? selected : (derived.tree[0]?.node.id ?? null)

  const scopedItems = useMemo(
    () => itemsInLocation(live, activeId, ui.includeDescendants, derived),
    [live, activeId, ui.includeDescendants, derived],
  )

  /*
   * 这一页标题上写的是**完整路径**（「家 / 卧室 / 衣柜」），纯文字、不上色 ——
   * 颜色留给左边的目录树本身（见下面那段注释）。
   */
  const activeLabel = activeId
    ? derived.index.pathString(activeId, ' / ')
    : t('status.unassigned')
  const directCount = data.items.filter((i) => i.locationId === activeId).length

  /** 对话框标题现推，不存进 state —— 存了就会把当时那门语言冻住（见 NameDialogState 的注释） */
  const nameDialogTitle =
    nameDialog === null
      ? ''
      : nameDialog.mode === 'rename'
        ? t('locations.renameTitle')
        : nameDialog.parentId
          ? t('locations.addChildTitle', {
              name: derived.index.byId.get(nameDialog.parentId)?.name ?? '',
            })
          : t('locations.addTopTitle')

  /**
   * 正在打的名字里写着几层（「白色四层收纳架」→ 4），认不出来就是 null。
   *
   * 现推、不存 state：存了就会在用户接着打字之后变成一个过期的数字。
   */
  const levelCountOfDraft = nameDraft.trim() === '' ? null : levelsFromName(nameDraft)

  const openAddDialog = (parentId: string | null) => {
    setNameDraft('')
    setAlsoBuildLevels(true)
    setNameDialog({ mode: 'add', parentId, initial: '' })
  }

  const openRenameDialog = (id: string) => {
    const loc = derived.index.byId.get(id)
    if (!loc) return
    setNameDraft(loc.name)
    setNameDialog({ mode: 'rename', parentId: loc.parentId, targetId: id, initial: loc.name })
  }

  const submitNameDialog = () => {
    if (!nameDialog) return
    const name = nameDraft.trim()
    if (name === '') return
    if (nameDialog.mode === 'add') {
      /*
       * 名字里写着「几层」时，可以顺手把 1~N 层一起建好。
       *
       * 为什么要有这个勾（而不是自动建）：位置是**结构**，一口气多出四个位置
       * 得是用户看得见、点得掉的一步。默认勾上，但摆在他眼前 ——
       * 他打「茶话弄奶茶保温袋」这种名字时，这里根本不会出现（认不出层数）。
       */
      const levelCount = levelsFromName(name)
      const names = levelCount === null ? [] : levelNames(levelCount, commandVocab().levelLabel)

      const result =
        alsoBuildLevels && names.length > 0
          ? addLocationWithLevels(name, nameDialog.parentId, names)
          : null
      const created = result !== null ? result.created : addLocation(name, nameDialog.parentId)
      if (!created) {
        notify(t('locations.addFailed'), 'error')
        return
      }
      if (nameDialog.parentId) {
        setExpanded((prev) => new Set(prev).add(nameDialog.parentId as string))
      }
      setExpanded((prev) => new Set(prev).add(created.id))
      notify(
        result !== null && result.levels.length > 0
          ? t('locations.addWithLevelsDone', { name, count: result.levels.length })
          : t('locations.addDone'),
        'success',
      )
    } else if (nameDialog.targetId) {
      renameLocation(nameDialog.targetId, name)
      notify(t('locations.renameDone'), 'success')
    }
    setNameDialog(null)
  }

  const handleDelete = (id: string) => {
    const loc = derived.index.byId.get(id)
    if (!loc) return
    const result = deleteLocation(id)
    if (result.ok) {
      notify(t('locations.deleteDone', { name: loc.name }), 'success')
      if (activeId === id) {
        setSelected(null)
        setTouched(true)
      }
      return
    }
    setDeleteProbe({
      id,
      name: loc.name,
      childCount: result.childCount,
      itemCount: result.itemCount,
    })
  }

  /**
   * 松手了：把拖过来的物品放进这个位置。
   *
   * targetId 为 null 就是落到了「未归位」上 —— 那是「撤掉位置」，不是「没有动作」，
   * 所以这里必须区分 null 和不传。
   */
  const handleDropItem = (targetId: string | null, itemId: string) => {
    setDraggingId(null)

    const item = data.items.find((i) => i.id === itemId)
    if (!item) return

    const targetLabel = targetId
      ? derived.index.pathString(targetId, ' / ')
      : t('status.unassigned')

    /*
     * 拖回原地什么都不做 —— 但**要说一声**。
     * 不说的话，用户会以为拖拽没生效，然后反复拖，或者干脆改用手动路径。
     */
    if (item.locationId === targetId) {
      notify(t('locations.dropSame', { name: item.name, location: targetLabel }), 'info')
      return
    }

    batchMoveToLocation([itemId], targetId)
    notify(t('locations.dropDone', { name: item.name, location: targetLabel }), 'success')

    /*
     * 落到折叠着的位置里时，把那个位置展开 ——
     * 否则东西「进去了」但屏幕上什么也没变，看起来就像被吞了。
     */
    if (targetId) setExpanded((prev) => new Set(prev).add(targetId))
  }

  const startRename = (target: Item) => {
    setRenamingId(target.id)
    setRenameDraft(target.name)
  }

  const commitRename = () => {
    if (renamingId === null) return
    const name = renameDraft.trim()
    // 名字不能改成空的 —— 一条没名字的东西在这一页上没法认
    if (name !== '') {
      updateItem(renamingId, { name })
      notify(t('locations.itemRenamed'), 'success')
    }
    setRenamingId(null)
  }

  // 删除确认框里「还有 N 个子位置、M 件物品」那一段。
  // 分隔符也走词典：中文是顿号，英文得写成 and。
  const deleteContents = [
    deleteProbe && deleteProbe.childCount > 0
      ? tc(deleteProbe.childCount, 'locations.deleteChildCount')
      : null,
    deleteProbe && deleteProbe.itemCount > 0
      ? tc(deleteProbe.itemCount, 'locations.deleteItemCount')
      : null,
  ]
    .filter((part): part is string => part !== null)
    .join(t('locations.deleteJoin'))

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-header__title">{t('nav.titleLocations')}</div>
          <div className="page-header__sub">
            {tc(data.locations.length, 'locations.subtitle')}
          </div>
        </div>
        <div className="page-header__actions">
          <Button variant="primary" onClick={() => openAddDialog(null)}>
            <IconPlus size={13} />
            {t('locations.newTop')}
          </Button>
        </div>
      </div>

      {data.locations.length === 0 ? (
        <EmptyState
          title={t('locations.empty')}
          hint={
            <>
              {t('locations.emptyHint')}
              <br />
              {t('locations.emptyHintExample')}
            </>
          }
          action={
            <Button variant="primary" onClick={() => openAddDialog(null)}>
              {t('locations.createFirst')}
            </Button>
          }
        />
      ) : (
        <div className="split">
          {/* ---------------- 左：位置树 ---------------- */}
          <div className="split__side">
            {/*
              搜索 + 展开控制。
              用户要的是「这么多折叠层级，怎么看最清晰」—— 层级一深，
              最有效的一招其实是**直接跳到某个位置**，而不是让眼睛顺着树爬。
              搜索用的是分类页/选择器**同一套**函数，所以行为必然一致。
            */}
            <div className="stack-sm" style={{ marginBottom: 'var(--gap-3)' }}>
              <SearchInput
                value={query}
                onValueChange={setQuery}
                placeholder={t('locations.searchPlaceholder')}
                aria-label={t('locations.searchAria')}
              />
              <div className="row-between wrap">
                <span className="tiny dim">
                  {searching
                    ? matchedIds.size > 0
                      ? tc(matchedIds.size, 'locations.searchFound')
                      : t('locations.searchNone')
                    : t('locations.expandHint')}
                </span>
                <span className="row" style={{ gap: 'var(--gap-2)' }}>
                  <Button size="sm" onClick={expandAll} disabled={searching}>
                    {t('locations.expandAll')}
                  </Button>
                  <Button size="sm" onClick={collapseAll} disabled={searching}>
                    {t('locations.collapseAll')}
                  </Button>
                </span>
              </div>
            </div>

            <TreeView
              nodes={searchView ? searchView.roots : derived.tree}
              selectedIds={activeId ? [activeId] : [UNASSIGNED_ID]}
              /*
               * 按**分支**上色（顶层色条 + 子层极淡），不再按层级上色。
               *
               * 用户第二次的反馈：「全是绿的，还是不好看，这么多折叠层级」。
               * 原因是颜色当时同时表达「这是目录」和「这是第几层」，
               * 而层级缩进已经说清了 —— 越深重复越多，就成了绿墙。
               * 现在颜色只说一件事：**你在哪一支**。
               */
              colors={branchColors}
              dimmedIds={dimmedIds}
              onSelect={(id) => {
                setSelected(id)
                setTouched(true)
              }}
              counts={counts}
              expanded={effectiveExpanded}
              onToggle={toggleExpanded}
              virtualRoot={
                searching
                  ? null
                  : {
                      id: UNASSIGNED_ID,
                      label: t('status.unassigned'),
                      count: counts.get(UNASSIGNED_ID) ?? 0,
                    }
              }
              /*
               * 落点：从右边列表把物品拖到任意一个位置上。
               *
               * 之所以值得做：给一件东西改归位，原本要「打开物品 → 找位置字段 →
               * 在选择器里翻到那一层」，路径长得不成比例；而位置树本来就摆在
               * 旁边，拖过去是最直接的说法。
               */
              dropTarget={{ mime: ITEM_DRAG_MIME, onDrop: handleDropItem }}
              renderActions={(node) => (
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    title={t('locations.addChild')}
                    onClick={() => openAddDialog(node.id)}
                  >
                    <IconPlus size={12} />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    title={t('locations.moveUnder')}
                    onClick={() => setMoveTarget(node.id)}
                  >
                    ↑
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    title={t('common.rename')}
                    onClick={() => openRenameDialog(node.id)}
                  >
                    <IconPencil size={12} />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    title={t('common.delete')}
                    onClick={() => handleDelete(node.id)}
                  >
                    <IconTrash size={12} />
                  </Button>
                </>
              )}
            />
          </div>

          {/* ---------------- 右：该位置的物品 ---------------- */}
          <div>
            <div className="row-between wrap" style={{ marginBottom: 'var(--gap-3)' }}>
              <div>
                <div style={{ fontSize: 'var(--fs-h2)', fontWeight: 600 }}>{activeLabel}</div>
                <div className="small muted">
                  {tc(scopedItems.length, 'locations.countHere')}
                  {activeId && ui.includeDescendants && directCount !== scopedItems.length
                    ? tc(directCount, 'locations.directHere')
                    : null}
                </div>
                {/* 有东西可拖才提这一句：空列表上写「拖到左边」只会让人去找拖什么 */}
                {scopedItems.length > 0 ? (
                  <div className="tiny dim" style={{ marginTop: 2 }}>
                    {t('locations.dragHint')}
                  </div>
                ) : null}
              </div>
              {activeId ? (
                <Switch
                  checked={ui.includeDescendants}
                  onChange={(v) => setUi({ includeDescendants: v })}
                  label={t('locations.includeDescendants')}
                />
              ) : null}
            </div>

            {scopedItems.length === 0 ? (
              <EmptyState
                title={activeId ? t('locations.scopedEmpty') : t('locations.unassignedEmpty')}
                hint={
                  activeId ? t('locations.scopedEmptyHint') : t('locations.unassignedEmptyHint')
                }
              />
            ) : (
              <ul className="list">
                {scopedItems.map((item) =>
                  renamingId === item.id ? (
                    /*
                      改名时换成一条专门的输入行，而不是往 ItemRow 里塞东西。
                      ItemRow 的主按钮是 flex:1，后面再插一个输入框只会被挤扁；
                      而这里就是要一行「名字 → 输入框」，别的都不需要。
                    */
                    <li key={item.id} className="list-row">
                      <input
                        className="input grow"
                        autoFocus
                        value={renameDraft}
                        aria-label={t('locations.renameItemAria', { name: item.name })}
                        onChange={(e) => setRenameDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            commitRename()
                          } else if (e.key === 'Escape') {
                            setRenamingId(null)
                          }
                        }}
                      />
                      <Button size="sm" variant="primary" onClick={commitRename}>
                        {t('common.save')}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setRenamingId(null)}>
                        {t('common.cancel')}
                      </Button>
                    </li>
                  ) : (
                    <ItemRow
                      key={item.id}
                      item={item}
                      ctx={derived}
                      onOpen={(itemId) => navigate(`/items/${itemId}`)}
                      // 整行可拖：抓住名字、位置、空白处都行，不用瞄准那个把手
                      draggable
                      dragging={draggingId === item.id}
                      dragHandleTitle={t('locations.dragHandleTitle')}
                      onDragStart={(e) => {
                        e.dataTransfer.setData(ITEM_DRAG_MIME, item.id)
                        // 左边树上那块的接收判断看的就是这行；不设的话有些浏览器
                        // 会把这次拖动当成「复制」，落点上会画个加号
                        e.dataTransfer.effectAllowed = 'move'
                        setDraggingId(item.id)
                      }}
                      // 拖完（不管放没放下）都要把「正在拖」的状态收掉
                      onDragEnd={() => setDraggingId(null)}
                      actions={
                        <>
                          {/*
                            这一页要能**就地**改东西（issue 7）。
                            以前只能点进物品详情才能编辑、也删不掉，
                            而「位置」页本来就是站在柜子前面清点的地方 ——
                            每改一件都要跳出去再跳回来，清点根本做不下去。

                            四个动作：改名 / 移到别处 / 改状态 / 删除。
                            拖拽那条路照旧（桌面更快），这四条是手机和键盘的入口。
                          */}
                          <Button
                            size="sm"
                            variant="ghost"
                            title={t('locations.renameItemTitle')}
                            onClick={() => startRename(item)}
                          >
                            <IconPencil size={13} />
                          </Button>
                          {/*
                            手机上 HTML5 拖放根本不触发，键盘也拖不了 ——
                            所以每条都留一个不用拖的入口，不然这个页面在手机上
                            会变成「看得见、改不动」。
                          */}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setItemMoveTarget(item)}
                          >
                            {t('locations.moveItem')}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setIdle(item.id, item.status !== 'idle')}
                          >
                            {item.status === 'idle'
                              ? t('locations.markActive')
                              : t('locations.markIdle')}
                          </Button>
                          {/* 单击直接进回收站 —— 这一行上的垃圾桶指的就是这一件 */}
                          <Button
                            size="sm"
                            variant="ghost"
                            title={t('locations.deleteItemTitle')}
                            onClick={() => {
                              batchSetStatus([item.id], 'discarded')
                              notify(tc(1, 'ai.discardPicker.doneToast'), 'success')
                            }}
                          >
                            <IconTrash size={14} />
                          </Button>
                        </>
                      }
                    />
                  ),
                )}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* ---------------- 新建 / 重命名 ---------------- */}
      <Modal
        open={nameDialog !== null}
        title={nameDialogTitle}
        onClose={() => setNameDialog(null)}
        maxWidth={400}
        footer={
          <>
            <Button onClick={() => setNameDialog(null)}>{t('common.cancel')}</Button>
            <Button variant="primary" onClick={submitNameDialog} disabled={nameDraft.trim() === ''}>
              {t('common.confirm')}
            </Button>
          </>
        }
      >
        <input
          className="input"
          autoFocus
          value={nameDraft}
          placeholder={t('locations.namePlaceholder')}
          onChange={(e) => setNameDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              submitNameDialog()
            }
          }}
        />
        {/*
          只在名字里真的写了「几层」时才出现 —— 平时这个对话框和以前一模一样。
        */}
        {nameDialog !== null && nameDialog.mode === 'add' && levelCountOfDraft !== null ? (
          <div className="stack-sm" style={{ marginTop: 'var(--gap-3)' }}>
            <Switch
              checked={alsoBuildLevels}
              onChange={setAlsoBuildLevels}
              label={t('locations.alsoLevels', { count: levelCountOfDraft })}
            />
            <div className="tiny dim">
              {t('locations.alsoLevelsHint', { count: levelCountOfDraft })}
            </div>
          </div>
        ) : null}
      </Modal>

      {/* ---------------- 移动位置 ---------------- */}
      <LocationPicker
        open={moveTarget !== null}
        onClose={() => setMoveTarget(null)}
        value={null}
        onSelect={(newParentId) => {
          if (moveTarget === null) return
          const result = moveLocation(moveTarget, newParentId)
          if (result.ok) {
            notify(t('locations.moveDone'), 'success')
            if (newParentId) setExpanded((prev) => new Set(prev).add(newParentId))
          } else {
            notify(result.reason ?? t('locations.moveFailed'), 'error')
          }
          setMoveTarget(null)
        }}
        ctx={derived}
        counts={counts}
      />

      {/* ---------------- 移动物品（拖不了的时候走这条） ---------------- */}
      <LocationPicker
        open={itemMoveTarget !== null}
        onClose={() => setItemMoveTarget(null)}
        value={itemMoveTarget?.locationId ?? null}
        onSelect={(locationId) => {
          if (itemMoveTarget === null) return
          // 和拖拽走同一段逻辑：不管从哪条路进来，行为都必须一模一样
          handleDropItem(locationId, itemMoveTarget.id)
          setItemMoveTarget(null)
        }}
        ctx={derived}
        counts={counts}
      />

      {/* ---------------- 删除有内容的位置 ---------------- */}
      <ConfirmDialog
        open={deleteProbe !== null}
        title={t('locations.deleteTitle', { name: deleteProbe?.name ?? '' })}
        danger
        confirmLabel={t('locations.deleteConfirm')}
        message={
          <>
            {t('locations.deleteBodyLead', { list: deleteContents })}
            <br />
            <br />
            {t('locations.deleteBodyHint', { unassigned: t('status.unassigned') })}
          </>
        }
        onConfirm={() => {
          if (!deleteProbe) return
          const result = deleteLocation(deleteProbe.id, null)
          if (result.ok) {
            notify(
              t('locations.deleteMovedDone', { unassigned: t('status.unassigned') }),
              'success',
            )
            setSelected(null)
            setTouched(true)
          } else {
            notify(result.reason ?? t('locations.deleteFailed'), 'error')
          }
          setDeleteProbe(null)
        }}
        onCancel={() => setDeleteProbe(null)}
      />
    </>
  )
}
