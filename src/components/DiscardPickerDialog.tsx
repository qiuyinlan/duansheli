/**
 * 「把哪些东西移进回收站」的选择框（issue 3）。
 *
 * ── 它**只**给批量删除用 ─────────────────────────────────────────
 * 这一点很重要，第一版我做错了：
 *
 * 用户最初报的是「删除物品放入回收站时也要跳出勾选的界面，让我手动采纳」，
 * 于是我把**行内那个垃圾桶图标**也接到了这个框上。用户第二次的反馈是：
 *
 * 「在物品界面，点击右边选项，删除，跳出的是所有物品，让我再次选择放啥进
 *   回收站。但是明明只需要点击一下删除键，直接丢到回收站的。」
 *
 * 他是对的，我错在**把「小心」用错了地方**：
 *
 * | 入口 | 意图 | 该不该问 |
 * |---|---|---|
 * | 某一行的垃圾桶 | 「把**这一件**扔了」—— 指着它点的，没有歧义 | 不该。而且丢进去还能恢复 |
 * | 勾选一堆后点「删除」 | 「这几个到底选对没有」 | **该问**，批量选错才是真会出事 |
 *
 * 所以行内的垃圾桶一律单击直接进回收站（各页面自己调 store），
 * 这个框只服务批量那条路 —— 那里本来就有一份「用户刚勾的」名单，
 * 框里正是把那份名单亮出来让他核一遍。
 */

import { useEffect, useMemo, useState } from 'react'
import type { Item } from '../types'
import type { DerivedContext } from '../store/selectors'
import { useT } from '../i18n'
import { Button, Modal } from './ui/primitives'

interface Props {
  open: boolean
  onClose: () => void
  /** 候选条目：传进来就是「这次可能被删的东西」 */
  items: Item[]
  ctx: DerivedContext
  /** 用户点了确认，带上他勾选的那些 id（至少一个） */
  onConfirm: (ids: string[]) => void
  /** 标题下面那句额外说明，例如「这一页的 12 件闲置」 */
  hint?: string
  /**
   * 打开时预先勾上这些 id。
   *
   * 批量删除时把**用户在列表里已经勾好的那些**带进来 ——
   * 「要删哪些」是他上一步刚表达过的意思，再让他从零勾一遍是来回折腾；
   * 但框里仍然把名单亮出来，而且**最终由他点确认**，所以那一步没有被绕过。
   */
  preselect?: readonly string[]
}

export function DiscardPickerDialog({
  open,
  onClose,
  items,
  ctx,
  onConfirm,
  hint,
  preselect,
}: Props) {
  const { t, tc } = useT()
  const [picked, setPicked] = useState<Set<string>>(new Set())

  /*
   * 每次打开都重来一遍。
   *
   * 不依赖 items 的长度，只依赖 open —— items 每次渲染都是新数组，
   * 依赖它会把用户刚勾的勾选冲掉。
   */
  useEffect(() => {
    if (open) setPicked(new Set(preselect ?? []))
    // preselect 同上：只认「打开那一刻」的值
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const ids = useMemo(() => items.map((item) => item.id), [items])
  const allPicked = ids.length > 0 && ids.every((id) => picked.has(id))
  const pickedCount = picked.size

  const toggle = (id: string) => {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAll = () => {
    setPicked(allPicked ? new Set() : new Set(ids))
  }

  return (
    <Modal
      open={open}
      title={t('ai.discardPicker.title')}
      onClose={onClose}
      maxWidth={520}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button
            variant="danger"
            disabled={pickedCount === 0}
            onClick={() => onConfirm([...picked])}
          >
            {pickedCount === 0
              ? t('ai.discardPicker.nonePicked')
              : tc(pickedCount, 'ai.discardPicker.confirm')}
          </Button>
        </>
      }
    >
      <div className="stack">
        <div className="small muted">
          {t('ai.discardPicker.lead')}
          {hint ? <span className="dim"> {hint}</span> : null}
        </div>

        {items.length === 0 ? (
          <div className="dim small">{t('ai.discardPicker.empty')}</div>
        ) : (
          <>
            <label className="checkbox">
              <input type="checkbox" checked={allPicked} onChange={toggleAll} />
              <span className="small muted">
                {t('ai.discardPicker.selectAll', { count: items.length })}
              </span>
            </label>

            <div className="pick-list">
              {items.map((item) => (
                <label key={item.id} className="pick-row">
                  <input
                    type="checkbox"
                    checked={picked.has(item.id)}
                    onChange={() => toggle(item.id)}
                  />
                  <span className="pick-row__main">
                    <span className="pick-row__name">
                      {item.name}
                      {item.quantity > 1 ? <span className="dim"> ×{item.quantity}</span> : null}
                    </span>
                    <span className="pick-row__meta">
                      {item.locationId
                        ? ctx.index.pathString(item.locationId, ' / ')
                        : t('status.unassigned')}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </>
        )}

        <div className="tiny dim">
          {tc(pickedCount, 'ai.discardPicker.trashNote')}
          <br />
          {t('ai.discardPicker.whereToRestore')}
        </div>
      </div>
    </Modal>
  )
}
