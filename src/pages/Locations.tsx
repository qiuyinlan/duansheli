import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ItemRow } from '../components/ItemRow'
import { DigitalCategoryBrowser } from '../components/DigitalCategoryBrowser'
import { TreeView } from '../components/TreeView'
import { LocationPicker } from '../components/pickers'
import { IconPencil, IconPlus, IconTrash } from '../components/ui/icons'
import { Button, EmptyState, Modal, SearchInput, Switch } from '../components/ui/primitives'
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
import type { LocationDeleteMode } from '../store/useAppStore'
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
  const [searchParams] = useSearchParams()
  const data = useAppStore((s) => s.data)
  const derived = useAppStore((s) => s.derived)
  const ui = useAppStore((s) => s.ui)
  const setUi = useAppStore((s) => s.setUi)
  const addLocation = useAppStore((s) => s.addLocation)
  const addLocationWithLevels = useAppStore((s) => s.addLocationWithLevels)
  const renameLocation = useAppStore((s) => s.renameLocation)
  const deleteLocations = useAppStore((s) => s.deleteLocations)
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
  /**
   * 选择模式：树上每行多一个勾选框，**删除只走这一条路**。
   *
   * 用户的原话：「位置编辑页面可以多选一键删除。不用直接显示删除键，
   * 进入选择界面能选择后再删除。」以前每行挂了四个按钮（新建子级 / 移动 /
   * 改名 / 删除），在手机上挤成一排、误点一下就是删掉一整棵子树，
   * 而且删完弹出来的确认只有一条路（内容一律移到顶层）——
   * 于是他看到的是「删了之后莫名其妙又恢复了」。
   */
  const [selectMode, setSelectMode] = useState(false)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  /** 进选择模式之前用户自己调好的展开状态 —— 退出时原样还回去 */
  const preSelectExpanded = useRef<Set<string> | null>(null)
  /** 要删的那批位置。非 null = 确认框开着（里面写清了会删掉什么、物品去哪） */
  const [deleteTargets, setDeleteTargets] = useState<string[] | null>(null)

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

  const live = useMemo(() => {
    const items = liveItems(data)
    return searchParams.get('asset') === 'digital'
      ? items.filter((item) => item.assetType === 'digital')
      : items.filter((item) => item.assetType !== 'digital')
  }, [data, searchParams])
  const matchingItems = useMemo(() => {
    if (!searching) return []
    const needle = query.trim().toLocaleLowerCase()
    return live
      .filter((item) => {
        const locationPath = item.locationId ? derived.index.pathString(item.locationId, ' / ') : ''
        const categoryNames = item.categoryIds
          .map((id) => derived.categoryIndex.byId.get(id)?.name ?? '')
          .join(' ')
        const haystack = [item.name, item.note, item.tags.join(' '), locationPath, categoryNames]
          .join(' ')
          .toLocaleLowerCase()
        return haystack.includes(needle)
      })
      .slice(0, 20)
  }, [searching, query, live, derived])
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

  /* ---------------- 选择模式：勾选 → 删除所选 ---------------- */

  /** 当前树上看得见的那些位置（搜索时就是命中的那些）——「全选」只选看得见的 */
  const visibleIds = useMemo(() => {
    const out: string[] = []
    const walk = (list: TreeNode<Location>[]) => {
      for (const node of list) {
        out.push(node.node.id)
        walk(node.children)
      }
    }
    walk(searchView ? searchView.roots : derived.tree)
    return out
  }, [searchView, derived.tree])

  const enterSelectMode = () => {
    /*
     * 进选择模式先把整棵树展开：要勾的是**深层的某一个**，
     * 而默认只展开顶层（那是上一轮的改动，见 expandInit 那段）。
     * 展开状态原样记下来，退出时还回去 —— 挑几个位置不该顺手改掉
     * 他调好的浏览视图。
     */
    preSelectExpanded.current = expanded
    setExpanded(new Set(derived.flat.map((node) => node.node.id)))
    setSelectMode(true)
  }

  const exitSelectMode = () => {
    setSelectMode(false)
    setChecked(new Set())
    setDeleteTargets(null)
    if (preSelectExpanded.current !== null) {
      setExpanded(preSelectExpanded.current)
      preSelectExpanded.current = null
    }
  }

  const toggleCheck = (id: string) => {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  /**
   * 确认框要说的那几个数 —— 都是**现算**的（`derived` 一改就重算）。
   *
   * 「会删掉什么」必须说准：位置树删错不可撤销，而这几种模式之间的差别
   * （子位置留下 / 子位置一起没了）正是用户唯一需要看懂的地方。
   */
  const deletion = useMemo(() => {
    if (deleteTargets === null) return null
    const targets = deleteTargets.filter((id) => derived.index.has(id))
    if (targets.length === 0) return null

    const targetSet = new Set(targets)
    const closure = new Set<string>()
    for (const id of targets) {
      for (const nodeId of derived.index.descendantIds(id)) closure.add(nodeId)
    }

    const subPlaces = Math.max(0, closure.size - targets.length)
    const cascadeItems = data.items.filter(
      (item) => item.locationId !== null && closure.has(item.locationId),
    ).length
    const onlyItems = data.items.filter(
      (item) => item.locationId !== null && targetSet.has(item.locationId),
    ).length
    const names = targets.map((id) => derived.index.byId.get(id)?.name ?? '')

    return {
      targets,
      names,
      /** 整棵子树（含自己）会有多少个位置消失 —— cascade 时就是这个数 */
      subPlaces,
      cascadeItems,
      onlyItems,
      /** 有子位置才需要问「留不留」；没有的话两种说法是同一件事，只弹一个按钮 */
      needsChoice: subPlaces > 0,
    }
  }, [deleteTargets, derived, data])

  // 确认框正文里「N 个子位置、M 件物品」那一段。分隔符也走词典：中文顿号、英文 and。
  const deleteContents = deletion
    ? [
        deletion.subPlaces > 0 ? tc(deletion.subPlaces, 'locations.deleteChildCount') : null,
        deletion.cascadeItems > 0 ? tc(deletion.cascadeItems, 'locations.deleteItemCount') : null,
      ]
        .filter((part): part is string => part !== null)
        .join(t('locations.deleteJoin'))
    : ''

  /**
   * 真的动手删。
   *
   * 单条和批量走同一个函数 —— 差别只有「问不问」。**空位置不问**：
   * 没有子位置、也没有直接挂着的物品时，两种删法结果完全一样，
   * 摆个确认框只会让人多点一下（用户要的「能直接删除空位置」就是这个意思）。
   */
  const applyDelete = (targets: string[], mode: LocationDeleteMode) => {
    const names = targets.map((id) => derived.index.byId.get(id)?.name ?? '')
    // 这次会消失的位置（含子位置的模式要把子孙算上）—— 用来判断右边看的那个还在不在
    const gone = new Set<string>()
    for (const id of targets) {
      if (mode === 'cascade') for (const nodeId of derived.index.descendantIds(id)) gone.add(nodeId)
      else gone.add(id)
    }

    const result = deleteLocations(targets, mode)
    if (!result.ok) {
      notify(result.reason ?? t('locations.deleteFailed'), 'error')
      setDeleteTargets(null)
      return
    }

    notify(
      targets.length === 1
        ? t('locations.deleteDone', { name: names[0] ?? '' })
        : tc(result.removedCount, 'locations.deleteManyDone'),
      'success',
    )

    /*
     * 右边正在看的那个位置如果也被删了，就回到「什么都没选」——
     * 留在那儿只会显示成一张空表，看起来像数据坏了。
     */
    if (activeId !== null && gone.has(activeId)) {
      setSelected(null)
      setTouched(true)
    }

    exitSelectMode()
  }

  const openDeleteDialog = () => {
    if (checked.size === 0) {
      notify(t('locations.deleteNothingPicked'), 'info')
      return
    }
    const targets = [...checked].filter((id) => derived.index.has(id))
    if (targets.length === 0) return

    /*
     * 有没有「需要交代的东西」：子位置，或者直接挂在这一层上的物品。
     * 都没有就是空位置 —— 直接删，不弹框。
     */
    const hasContent = targets.some(
      (id) =>
        derived.index.descendantIds(id).size > 1 ||
        data.items.some((item) => item.locationId === id),
    )
    if (!hasContent) {
      applyDelete(targets, 'only')
      return
    }

    setDeleteTargets(targets)
  }

  const runDelete = (mode: LocationDeleteMode) => {
    if (!deletion) return
    applyDelete(deletion.targets, mode)
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

  if (searchParams.get('asset') === 'digital') return <DigitalCategoryBrowser />

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
                  {selectMode
                    ? checked.size > 0
                      ? tc(checked.size, 'locations.selectCount')
                      : t('locations.selectHint')
                    : searching
                      ? matchedIds.size > 0
                        ? tc(matchedIds.size, 'locations.searchFound')
                        : t('locations.searchNone')
                      : t('locations.expandHint')}
                </span>
                <span className="row" style={{ gap: 'var(--gap-2)' }}>
                  {selectMode ? (
                    <>
                      {/*
                        选择模式的工具条。删除键只出现在这里 ——
                        用户要的就是「进入选择界面能选择后再删除」。
                      */}
                      <Button
                        size="sm"
                        onClick={() => setChecked(new Set(visibleIds))}
                        disabled={checked.size === visibleIds.length && visibleIds.length > 0}
                      >
                        {t('common.selectAll')}
                      </Button>
                      <Button size="sm" onClick={() => setChecked(new Set())} disabled={checked.size === 0}>
                        {t('locations.selectClear')}
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={openDeleteDialog}
                        disabled={checked.size === 0}
                      >
                        {t('locations.deleteSelected')}
                      </Button>
                      <Button size="sm" variant="primary" onClick={exitSelectMode}>
                        {t('locations.selectDone')}
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button size="sm" onClick={expandAll} disabled={searching}>
                        {t('locations.expandAll')}
                      </Button>
                      <Button size="sm" onClick={collapseAll} disabled={searching}>
                        {t('locations.collapseAll')}
                      </Button>
                      <Button size="sm" onClick={enterSelectMode}>
                        {t('locations.selectMode')}
                      </Button>
                    </>
                  )}
                </span>
              </div>
              {selectMode ? (
                <div className="tiny dim">
                  {t('locations.selectHintItems', { unassigned: t('status.unassigned') })}
                </div>
              ) : null}
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
              selectionMode={selectMode}
              checkedIds={checked}
              onToggleCheck={toggleCheck}
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
               *
               * 选择模式下不接拖放：那时鼠标是在挑要删的东西，
               * 顺手把一件物品挪走是最不该发生的意外。
               */
              dropTarget={selectMode ? null : { mime: ITEM_DRAG_MIME, onDrop: handleDropItem }}
              /*
               * 行上的按钮：新建子位置 / 移动 / 改名。
               *
               * ⚠️ 这里**没有**删除。用户的原话是「不用直接显示删除键，
               * 进入选择界面能选择后再删除」—— 位置树删错不可撤销，
               * 一行上挤四个按钮在手机上尤其容易点错。
               */
              renderActions={
                selectMode
                  ? undefined
                  : (node) => (
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
                      </>
                    )
              }
            />
            {searching && matchingItems.length > 0 ? (
              <div className="stack-sm" style={{ marginTop: 'var(--gap-3)' }}>
                <div className="small muted">{t('locations.searchItemsLabel')}</div>
                <ul className="list">
                  {matchingItems.map((item) => (
                    <li className="list-row" key={item.id}>
                      <button type="button" className="link-button grow" onClick={() => navigate(`/items/${item.id}`)}>
                        <span>{item.name}</span>
                        <span className="tiny dim" style={{ display: 'block' }}>
                          {t('locations.searchItemLocation', {
                            path: item.locationId ? derived.index.pathString(item.locationId, ' / ') : t('status.unassigned'),
                          })}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
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

      {/*
        ---------------- 删除：两个选项 ----------------

        用户的原话：「删除一个位置，跳出来，删除该位置，和删除该位置及所有子位置」。
        所以这里不是一个是 / 否的确认框，而是**两条路**：
        · 删该位置 —— 子位置保留，往上一层（不至于「删了个大标题，下面全塌成顶层」）
        · 删该位置及所有子位置

        没有子位置时两种说法是同一件事，那就只留一个按钮 —— 摆两个一模一样的
        选项只会让人停下来想「这俩有什么区别」，而那正是最不该有的犹豫。
      */}
      <Modal
        open={deletion !== null}
        title={
          deletion
            ? deletion.targets.length === 1
              ? t('locations.deleteAskTitle', { name: deletion.names[0] ?? '' })
              : t('locations.deleteAskTitleMany', { count: deletion.targets.length })
            : ''
        }
        onClose={() => setDeleteTargets(null)}
        maxWidth={460}
        footer={
          <>
            <Button onClick={() => setDeleteTargets(null)}>{t('common.cancel')}</Button>
            {deletion?.needsChoice ? (
              <>
                <Button onClick={() => runDelete('only')}>
                  {deletion.targets.length === 1
                    ? t('locations.deleteOnlyBtn')
                    : t('locations.deleteOnlyBtnMany')}
                </Button>
                <Button variant="danger" onClick={() => runDelete('cascade')}>
                  {deletion.targets.length === 1
                    ? t('locations.deleteCascadeBtn')
                    : t('locations.deleteCascadeBtnMany')}
                </Button>
              </>
            ) : (
              <Button variant="danger" onClick={() => runDelete('only')}>
                {t('common.delete')}
              </Button>
            )}
          </>
        }
      >
        {deletion ? (
          <div style={{ fontSize: 'var(--fs-sm)', lineHeight: 1.75, color: 'var(--text-2)' }}>
            <div>
              {deletion.targets.length === 1
                ? t('locations.deleteAskLead', { name: deletion.names[0] ?? '', list: deleteContents })
                : t('locations.deleteAskLeadMany', {
                    count: deletion.targets.length,
                    list: deleteContents,
                  })}
            </div>
            <div className="tiny dim" style={{ marginTop: 'var(--gap-2)' }}>
              {deletion.needsChoice
                ? t('locations.deleteOnlyHint', {
                    places: deletion.subPlaces,
                    items: deletion.onlyItems,
                    unassigned: t('status.unassigned'),
                  })
                : t('locations.deletePlainHint', {
                    items: deletion.cascadeItems,
                    unassigned: t('status.unassigned'),
                  })}
            </div>
            {deletion.needsChoice ? (
              <div className="tiny dim" style={{ marginTop: 'var(--gap-1)' }}>
                {t('locations.deleteCascadeHint', {
                  places: deletion.subPlaces,
                  items: deletion.cascadeItems,
                  unassigned: t('status.unassigned'),
                })}
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </>
  )
}
