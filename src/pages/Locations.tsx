import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ItemRow } from '../components/ItemRow'
import { TreeView } from '../components/TreeView'
import { LocationPicker } from '../components/pickers'
import { IconPencil, IconPlus, IconTrash } from '../components/ui/icons'
import { Button, ConfirmDialog, EmptyState, Modal, Switch } from '../components/ui/primitives'
import { useT } from '../i18n'
import {
  countByLocationIncludingDescendants,
  itemsInLocation,
  liveItems,
} from '../store/selectors'
import { useAppStore } from '../store/useAppStore'
import type { Item } from '../types'
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

  // 首次拿到位置数据后，默认把整棵树展开
  useEffect(() => {
    if (expandInit || derived.flat.length === 0) return
    setExpanded(new Set(derived.flat.map((n) => n.node.id)))
    setExpandInit(true)
  }, [derived.flat, expandInit])

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

  const openAddDialog = (parentId: string | null) => {
    setNameDraft('')
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
      const created = addLocation(name, nameDialog.parentId)
      if (!created) {
        notify(t('locations.addFailed'), 'error')
        return
      }
      if (nameDialog.parentId) {
        setExpanded((prev) => new Set(prev).add(nameDialog.parentId as string))
      }
      notify(t('locations.addDone'), 'success')
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
            <TreeView
              nodes={derived.tree}
              selectedIds={activeId ? [activeId] : [UNASSIGNED_ID]}
              /*
               * 目录层级配色：大标题保持原样，子目录统一绿色。
               *
               * 用户的原话是「显示位置的时候，它不是会有文件大标题，
               * 然后里面有子文件夹吗？……身为子目录、子大标题而非物品的，
               * 变颜色统一绿色」。所以这一页（这是一棵**目录树**）上色，
               * 物品行那边照旧是普通文字 —— 见 ItemRow 里那段注释。
               */
              tintDepth
              onSelect={(id) => {
                setSelected(id)
                setTouched(true)
              }}
              counts={counts}
              expanded={expanded}
              onToggle={(id) =>
                setExpanded((prev) => {
                  const next = new Set(prev)
                  if (next.has(id)) next.delete(id)
                  else next.add(id)
                  return next
                })
              }
              virtualRoot={{
                id: UNASSIGNED_ID,
                label: t('status.unassigned'),
                count: counts.get(UNASSIGNED_ID) ?? 0,
              }}
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
