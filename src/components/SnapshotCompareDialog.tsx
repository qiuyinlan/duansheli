/**
 * 快照对比（issue 15）。
 *
 * 用户的原话：「现在不是有很多快照吗？我希望可以就是我选择两个快照，
 * 然后帮我对比一下这两个快照的差别是什么，不然这样我不知道到底要恢复哪个快照。」
 *
 * ── 这个面板要回答的唯一问题 ──────────────────────────────────────
 * 「回退到哪一份？」—— 所以它只做一件事：把两份数据的差别**摆清楚**，
 * 然后让用户自己选。它刻意**不给建议**（「建议恢复左边那份」），
 * 因为哪一份是他要的，只有他自己知道。给错了建议比不给更糟。
 *
 * ── 三个设计决定 ──────────────────────────────────────────────────
 *
 * 1. **左边恒为「旧」、右边恒为「新」。** 按时间排，不按用户点的顺序 ——
 *    否则「少了 3 件」和「多了 3 件」会随点击顺序来回颠倒，读起来很累。
 *    界面上也把方向写出来（「旧 → 新」）。
 *
 * 2. **可以拿当前数据当右边。** 最常见的用法其实是「这份快照和现在比差什么」，
 *    而不是「两份老快照互相比」。所以加了一个「和现在比」的入口。
 *
 * 3. **一模一样就明说。** 两份快照没有差别时，说清「内容完全一致」比
 *    摆一堆 0 更让人放心 —— 也免得他为了一个数字不同去回退。
 */

import { useEffect, useState, type ReactNode } from 'react'
import type { AppData } from '../types'
import type { SnapshotDiff } from '../lib/diff'
import { diffAppData } from '../lib/diff'
import { getSnapshot, listSnapshots } from '../storage/snapshots'
import type { SnapshotMeta } from '../types'
import { useT } from '../i18n'
import { formatDateTime } from '../lib/format'
import { Button, Modal } from './ui/primitives'

interface Props {
  open: boolean
  onClose: () => void
  /** 当前列表里那份快照清单（由设置页给，免得这里再读一遍） */
  snapshots: SnapshotMeta[]
  /** 现在的数据 —— 「和现在比」那条路用 */
  current: AppData
  /** 左边那份（旧） */
  leftId: string
  /** 右边那份（新）；null / 'current' = 用当前数据 */
  rightId: string | null
  /**
   * 直接给右边那份数据，跳过从快照里读。
   *
   * 合并预览走这条：那份数据是**算出来**的（还没落库），并不在任何快照里。
   */
  rightData?: AppData
  /** 直接给左边那份数据 —— 同理 */
  leftData?: AppData
  /** 覆盖标题与开头那句话 —— 合并预览也复用它（见下面的注释） */
  title?: string
  /**
   * 开头那段话。由调用方给 —— 两个用途（快照对比 / 合并预览）的语气不一样，
   * 而且合并那边中间要加粗，所以类型是 ReactNode 而不是 string。
   */
  lead: ReactNode
  footer?: ReactNode
  /** 覆盖「旧 / 新」那两行的文字（合并预览里它俩不是时间，是「现在 / 合并后」） */
  leftLabel?: string
  rightLabel?: string
}

/**
 * 把 `key:旧值->新值` 这种机器可读的差异拆成三段来显示。
 *
 * 为什么存这么个丑格式：diffAppData 在 lib/ 里，它**不该知道界面语言**
 * （连 i18n 都不该 import）。所以它只产出「字段名 + 旧值 + 新值」，
 * 怎么摆、用什么箭头、要不要划掉旧值，全由这一层决定。
 */
function fieldLabel(field: string): { key: string; before: string; after: string } {
  const colon = field.indexOf(':')
  const key = colon >= 0 ? field.slice(0, colon) : field
  const rest = colon >= 0 ? field.slice(colon + 1) : ''
  const arrow = rest.indexOf('->')
  return {
    key,
    before: arrow >= 0 ? rest.slice(0, arrow) : '',
    after: arrow >= 0 ? rest.slice(arrow + 2) : rest,
  }
}

/**
 * 两个用途共用这一个对话框。
 *
 *  1. **快照对比**（issue 15）：选两份快照（或者一份快照 ↔ 现在的数据），
 *     看清差别再决定回退到哪一份。
 *  2. **合并预览**（issue 14）：「合并到底会发生什么」和「两份快照差什么」
 *     是**同一个问题**（都是两份数据之间的差异），所以不另写一套 ——
 *     另写一套的结果通常是两边慢慢长歪，一处改了另一处没改。
 *     合并时传 `current` = 现在的数据、右值 = 合并后的结果，再覆盖标题和脚注。
 */
export function SnapshotCompareDialog({
  open,
  onClose,
  snapshots,
  current,
  leftId,
  rightId,
  rightData,
  leftData,
  title,
  lead,
  footer,
  leftLabel,
  rightLabel,
}: Props) {
  const { t, tc } = useT()
  const [diff, setDiff] = useState<SnapshotDiff | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const key = `${leftId}|${rightId ?? 'current'}`

  /*
   * 打开时（以及选择变化时）算一次。
   *
   * 为什么放在 effect 里而不是渲染期直接算：
   *   · 要读 IndexedDB（异步），渲染期做不了
   *   · 在渲染期 setState 会让 React 反复重渲染，甚至绕不出来
   * diff 可能不小，所以也不能每次重渲染都算一遍 —— 靠 key 去重。
   */
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setError(null)

    void (async () => {
      try {
        const left =
          leftData ??
          (leftId === 'current' ? current : (await getSnapshot(leftId))?.data)
        const right =
          rightData ??
          (rightId === null || rightId === 'current'
            ? current
            : (await getSnapshot(rightId))?.data)
        if (cancelled) return
        if (!left || !right) {
          setError(t('settings.compareMissing'))
          setDiff(null)
          return
        }
        /*
         * 按时间定左右：左边旧、右边新。
         * 用户可以任意点两份，但读的时候方向必须一致 —— 否则
         * 「少了 3 件」和「多了 3 件」会随点击顺序来回颠倒。
         *
         * 直接给了数据（合并预览）时不做这个重排：那边左右是调用方定死的。
         */
        const at = (id: string | null) =>
          id === null || id === 'current'
            ? current.updatedAt
            : (snapshots.find((s) => s.id === id)?.at ?? '')
        const swap = leftData || rightData ? false : at(leftId) > at(rightId)
        setDiff(
          swap
            ? diffAppData(right, left, t('status.unassigned'))
            : diffAppData(left, right, t('status.unassigned')),
        )
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
    // key 已经把 leftId / rightId 概括进去了；snapshots 是列表，变化时重算也无妨
  }, [open, key, current, snapshots, leftId, rightId, leftData, rightData, t])

  const timeLabel = (id: string | null) => {
    if (id === null || id === 'current') return t('settings.compareCurrent')
    const meta = snapshots.find((s) => s.id === id)
    return meta ? formatDateTime(meta.at) : id
  }

  const newerIsRight = (() => {
    // 直接给了数据的场合（合并预览）左右由调用方定死，不做时间重排
    if (leftData || rightData) return true
    const at = (id: string | null) =>
      id === null || id === 'current'
        ? current.updatedAt
        : (snapshots.find((s) => s.id === id)?.at ?? '')
    return at(leftId) <= at(rightId)
  })()

  return (
    <Modal
      open={open}
      title={title ?? t('settings.compareTitle')}
      onClose={onClose}
      maxWidth={620}
      footer={
        footer ?? (
          <Button variant="primary" onClick={onClose}>
            {t('settings.gotIt')}
          </Button>
        )
      }
    >
      <div className="stack">
        <div className="small muted">
          {lead}
          <br />
          {newerIsRight ? (
            <span className="dim">
              {t('settings.compareOlder')}
              {leftLabel ?? timeLabel(leftId)}
              {' → '}
              {t('settings.compareNewer')}
              {rightLabel ?? timeLabel(rightId)}
            </span>
          ) : (
            <span className="dim">
              {t('settings.compareOlder')}
              {rightLabel ?? timeLabel(rightId)}
              {' → '}
              {t('settings.compareNewer')}
              {leftLabel ?? timeLabel(leftId)}
            </span>
          )}
        </div>

        {loading ? <div className="dim small">{t('common.loading')}</div> : null}
        {error !== null ? <div className="small" style={{ color: 'var(--danger)' }}>{error}</div> : null}

        {diff && !loading ? (
          <>
            {/* 摘要：三条数字 + 件数变化 */}
            <div className="report">
              <div className="report__row">
                <span>{t('nav.items')}</span>
                <span className="numeric">
                  {diff.leftItemCount} → {diff.rightItemCount}
                  {diff.leftItemCount !== diff.rightItemCount ? (
                    <strong>
                      {' '}
                      {diff.rightItemCount > diff.leftItemCount ? '+' : ''}
                      {diff.rightItemCount - diff.leftItemCount}
                    </strong>
                  ) : null}
                </span>
              </div>
              <div className="report__row">
                <span>{t('settings.compareUnits')}</span>
                <span className="numeric">
                  {diff.leftUnitCount} → {diff.rightUnitCount}
                </span>
              </div>
              <div className="report__row">
                <span>{t('settings.compareBreakdown')}</span>
                <span>
                  {t('settings.compareAddedCount', { count: diff.added.length })} ·{' '}
                  {t('settings.compareRemovedCount', { count: diff.removed.length })} ·{' '}
                  {t('settings.compareChangedCount', { count: diff.changed.length })} ·{' '}
                  {t('settings.compareSameCount', { count: diff.unchanged })}
                </span>
              </div>
            </div>

            {diff.identical ? (
              <div className="notice">
                <span className="notice__body small">{t('settings.compareIdentical')}</span>
              </div>
            ) : null}

            {/*
              疑似同一件东西（名字一样、id 不一样）。
              这是合并时最要紧的一类「冲突」—— 用户明确说过要看出来
              「哪些有冲突」（issue 14）。程序不替他判断是不是同一件，
              只把两边并排摆出来。
            */}
            {diff.nameConflicts.length > 0 ? (
              <div className="notice notice--alert">
                <span className="notice__body small">
                  {t('settings.compareConflictsLead')}
                  <strong>{diff.nameConflicts.length}</strong>
                  {t('settings.compareConflictsTail')}
                  <ul className="diff-list" style={{ marginTop: 'var(--gap-2)' }}>
                    {diff.nameConflicts.map((conflict) => (
                      <li key={`${conflict.leftId}-${conflict.rightId}`} className="diff-list__row">
                        <span className="diff-list__name">{conflict.name}</span>
                        <span className="diff-list__fields">
                          <span className="diff-field">
                            <span className="diff-field__key">
                              {t('settings.compareConflictLeft')}
                            </span>
                            <span>{conflict.leftSummary}</span>
                          </span>
                          <span className="diff-field">
                            <span className="diff-field__key">
                              {t('settings.compareConflictRight')}
                            </span>
                            <span>{conflict.rightSummary}</span>
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </span>
              </div>
            ) : null}

            {/* 少的那些 —— 回退过去会没的东西。这是最要紧的一块，所以放最前面 */}
            {diff.removed.length > 0 ? (
              <DiffList
                title={tc(diff.removed.length, 'settings.compareRemovedTitle')}
                tone="danger"
                rows={diff.removed.map((d) => ({ name: d.name, fields: [] }))}
              />
            ) : null}

            {diff.added.length > 0 ? (
              <DiffList
                title={tc(diff.added.length, 'settings.compareAddedTitle')}
                tone="ok"
                rows={diff.added.map((d) => ({ name: d.name, fields: [] }))}
              />
            ) : null}

            {diff.changed.length > 0 ? (
              <DiffList
                title={tc(diff.changed.length, 'settings.compareChangedTitle')}
                tone="muted"
                rows={diff.changed.map((d) => ({ name: d.name, fields: d.fields }))}
              />
            ) : null}

            {/* 结构性的差别（分类 / 位置 / 属性 / 标签 / 活动 / 清单） */}
            <StructureDiff diff={diff} />
          </>
        ) : null}
      </div>
    </Modal>
  )
}

function DiffList({
  title,
  tone,
  rows,
}: {
  title: string
  tone: 'danger' | 'ok' | 'muted'
  rows: Array<{ name: string; fields: string[] }>
}) {
  return (
    <div className="field">
      <span className="field__label">
        <span className={`diff-dot diff-dot--${tone}`} /> {title}
      </span>
      <ul className="diff-list">
        {rows.map((row, index) => (
          <li key={`${row.name}-${index}`} className="diff-list__row">
            <span className="diff-list__name">{row.name}</span>
            {row.fields.length > 0 ? (
              <span className="diff-list__fields">
                {row.fields.map((field, i) => {
                  const parts = fieldLabel(field)
                  return (
                    <span key={i} className="diff-field">
                      <span className="diff-field__key">{parts.key}</span>
                      <span className="diff-field__before">{parts.before}</span>
                      <span className="diff-field__arrow">→</span>
                      <span className="diff-field__after">{parts.after}</span>
                    </span>
                  )
                })}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  )
}

function StructureDiff({ diff }: { diff: SnapshotDiff }) {
  const { t } = useT()

  const groups: Array<{ label: string; added: string[]; removed: string[] }> = [
    { label: t('nav.categories'), ...diff.categories },
    { label: t('nav.locations'), ...diff.locations },
    { label: t('nav.attributes'), ...diff.attributeDefs },
    { label: t('nav.tags'), ...diff.tags },
    { label: t('nav.collections'), ...diff.collections },
    { label: t('nav.checklists'), ...diff.checklists },
  ].filter((group) => group.added.length > 0 || group.removed.length > 0)

  if (groups.length === 0) return null

  return (
    <div className="field">
      <span className="field__label">{t('settings.compareStructure')}</span>
      <div className="report">
        {groups.map((group) => (
          <div key={group.label} className="report__row">
            <span>{group.label}</span>
            <span className="small">
              {group.added.length > 0 ? (
                <span className="diff-tag diff-tag--ok">
                  +{group.added.slice(0, 6).join(t('ai.listSeparator'))}
                  {group.added.length > 6 ? '…' : ''}
                </span>
              ) : null}
              {group.removed.length > 0 ? (
                <span className="diff-tag diff-tag--danger">
                  −{group.removed.slice(0, 6).join(t('ai.listSeparator'))}
                  {group.removed.length > 6 ? '…' : ''}
                </span>
              ) : null}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** 供外部提前知道「有哪些快照可以比」时用得上（测试里也用它） */
export async function listSnapshotMetas(): Promise<SnapshotMeta[]> {
  return listSnapshots()
}
