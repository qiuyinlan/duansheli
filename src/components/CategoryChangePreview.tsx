/**
 * AI 提议的**分类改动**预览（新建 / 改名 / 移动 / 删除）。
 *
 * 用户要的能力：「我希望 ai 可以编辑分类，我可以让它帮我整理已有的分类。」
 *
 * ── 为什么这一块必须单独摆出来 ──────────────────────────────────
 *
 * 分类是**结构**。改一件物品改错了，你能看见那一件不对劲；
 * 而把分类的层级动错了，界面上只会「树变了样子」—— 你根本看不出哪一层错了。
 * （第 31 章那次一次性整理就踩过：新建的上级分类忘了塞回数组，
 * 结果是所有被挪的分类挂在一个**不存在的父级**上，界面上它们直接消失。）
 *
 * 所以这一块的任务只有一个：**在动之前，把「将要发生什么」一行一行说清楚**，
 * 而且每一行都能单独取消。
 *
 * ── 三种状态各有各的说法 ────────────────────────────────────────
 *
 * | 状态 | 显示 | 能不能采纳 |
 * |---|---|---|
 * | `ok` | 正常一行，带 `旧 → 新` | 能 |
 * | `noop` | 灰的「本来就是这样」 | 不执行（执行了也没意义） |
 * | `missing` | 红的「找不到这个分类」 | **不执行**，而且要说清 |
 * | `duplicate` | 橙的「同级已经有同名的了」 | 不执行 |
 * | `cycle` | 红的「会让自己变成自己的下级」 | 不执行（树会坏） |
 *
 * 后四种**一条都不许偷偷做**，也不许偷偷丢掉 —— 用户点了采纳却什么都没发生，
 * 比明确告诉他「这 3 条做不了」糟得多。
 */

import type { CategoryPlanEntry } from '../ai/categoryEdit'
import { useT, type DictKey } from '../i18n'
import { Button } from './ui/primitives'
import { IconAlert } from './ui/icons'

interface Props {
  entries: CategoryPlanEntry[]
  onChange: (entries: CategoryPlanEntry[]) => void
}

export function CategoryChangePreview({ entries, onChange }: Props) {
  const { t, tc } = useT()

  if (entries.length === 0) return null

  const toggle = (key: string) => {
    onChange(
      entries.map((entry) => (entry.key === key ? { ...entry, include: !entry.include } : entry)),
    )
  }

  const included = entries.filter((e) => e.include && e.status === 'ok')
  const problems = entries.filter((e) => e.status !== 'ok' && e.status !== 'noop')

  return (
    <div className="stack">
      <div className="row-between wrap">
        <div className="small muted">
          {t('ai.catLead')}
          <strong className="numeric">{entries.length}</strong>
          {t('ai.catLeadTail')}
        </div>
        <div className="row wrap">
          <Button size="sm" onClick={() => onChange(entries.map((e) => ({ ...e, include: true })))}>
            {t('common.selectAll')}
          </Button>
          <Button size="sm" onClick={() => onChange(entries.map((e) => ({ ...e, include: false })))}>
            {t('common.selectNone')}
          </Button>
        </div>
      </div>

      {/*
        做不了的那几条**单独说一遍**。
        只靠在每行上标个红点很容易被忽略，而它们的后果最容易被误解：
        用户以为改了、其实一条都没动。
      */}
      {problems.length > 0 ? (
        <div className="notice notice--alert">
          <span className="notice__icon">
            <IconAlert />
          </span>
          <span className="notice__body small">
            {t('ai.catProblemsLead')}
            <strong>{t('ai.catProblemsBold')}</strong>
            {t('ai.catProblemsTail')}
          </span>
        </div>
      ) : null}
      <ul className="cat-plan">
        {entries.map((entry) => (
          <li
            key={entry.key}
            className={`cat-plan__row cat-plan__row--${entry.status}${
              entry.status === 'ok' && entry.include ? '' : ' cat-plan__row--off'
            }`}
          >
            <input
              type="checkbox"
              className="row-checkbox"
              checked={entry.include && entry.status === 'ok'}
              disabled={entry.status !== 'ok'}
              aria-label={t('ai.catIncludeAria', { name: entry.fromLabel })}
              onChange={() => toggle(entry.key)}
            />

            <span className="cat-plan__kind">{t(kindLabelKey(entry.kind))}</span>

            <span className="cat-plan__body">
              <span className="cat-plan__names">
                <span className="cat-plan__from">
                  {entry.isNew === true ? t('ai.catFromNew') : entry.fromLabel}
                </span>
                {entry.status === 'ok' && entry.toLabel !== entry.fromLabel ? (
                  <>
                    <span className="cat-plan__arrow">→</span>
                    <span className="cat-plan__to">{entry.toLabel}</span>
                  </>
                ) : null}
              </span>

              {/* 删分类的连带后果必须写出来 —— 用户最怕的就是「删了它会不会把东西也删了」 */}
              {entry.kind === 'delete' && entry.status === 'ok' ? (
                <span className="cat-plan__note">
                  {entry.childCount && entry.childCount > 0
                    ? tc(entry.childCount, 'ai.catDeleteChildren')
                    : null}
                  {entry.childCount && entry.childCount > 0 && entry.itemCount
                    ? t('ai.listSeparator')
                    : null}
                  {entry.itemCount && entry.itemCount > 0
                    ? tc(entry.itemCount, 'ai.catDeleteItems')
                    : null}
                  {t('ai.catDeleteNothingLost')}
                </span>
              ) : null}

              {entry.status !== 'ok' ? (
                <span className="cat-plan__note">{t(statusNoteKey(entry.status))}</span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>

      {/* 采纳按钮上一行的小字：点之前让人知道会改几条 */}
      <div className="dim small">
        {included.length > 0 ? tc(included.length, 'ai.catWillApply') : t('ai.catNothingApply')}
      </div>
    </div>
  )
}

function kindLabelKey(kind: CategoryPlanEntry['kind']): DictKey {
  switch (kind) {
    case 'create':
      return 'ai.catKindCreate'
    case 'rename':
      return 'ai.catKindRename'
    case 'move':
      return 'ai.catKindMove'
    case 'delete':
      return 'ai.catKindDelete'
  }
}

function statusNoteKey(status: CategoryPlanEntry['status']): DictKey {
  switch (status) {
    case 'noop':
      return 'ai.catNoteNoop'
    case 'missing':
      return 'ai.catNoteMissing'
    case 'duplicate':
      return 'ai.catNoteDuplicate'
    case 'cycle':
      return 'ai.catNoteCycle'
    default:
      return 'ai.catNoteNoop'
  }
}
