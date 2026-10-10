/**
 * AI 提议的**新建位置**预览。
 *
 * 用户的原话：「在 左边小小型一号白色四层收纳/顶层，新建这个位置」+「需要可以新建位置」。
 *
 * ── 为什么单独摆一块、还要单独一个采纳按钮 ────────────────────
 *
 * 和分类是同一个理由：位置是**结构**。把层级建错了，界面上只会「树变了样子」——
 * 你根本看不出哪一层错了。所以别让它在「采纳物品」那个按钮里顺带发生，
 * 用户得有机会单独过一眼。
 *
 * ── 最要紧的一句话：会顺带建出中间层 ──────────────────────────
 *
 * 用户写的是**路径**（"左边小小型一号白色四层收纳 / 顶层"），而中间那级可能
 * 还不存在。计划会把它一起建出来 —— 所以这一块必须**把要建的每一级都列出来**，
 * 而不是只写「新建 顶层」。他过一眼就知道「哦，顺手帮我建了两级」，
 * 不想要就把勾去掉。
 *
 * ── 两种状态 ─────────────────────────────────────────────────
 * | 状态 | 显示 | 能不能采纳 |
 * |---|---|---|
 * | `ok` | 正常一行，列出要建的每一级 | 能 |
 * | `duplicate` | 灰的「库里已经有这个位置了」 | 不执行（也无需执行） |
 */

import type { LocationPlanEntry } from '../ai/locationEdit'
import { useT } from '../i18n'
import { Button } from './ui/primitives'

interface Props {
  entries: LocationPlanEntry[]
  onChange: (entries: LocationPlanEntry[]) => void
}

export function LocationChangePreview({ entries, onChange }: Props) {
  const { t, tc } = useT()

  if (entries.length === 0) return null

  const toggle = (key: string) => {
    onChange(
      entries.map((entry) => (entry.key === key ? { ...entry, include: !entry.include } : entry)),
    )
  }

  const included = entries.filter((e) => e.include && e.status === 'ok')
  const problems = entries.filter((e) => e.status !== 'ok')

  return (
    <div className="stack">
      <div className="row-between wrap">
        <div className="small muted">
          {t('ai.locLead')}
          <strong className="numeric">{entries.length}</strong>
          {t('ai.locLeadTail')}
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

      {problems.length > 0 ? (
        <div className="small dim">
          {t('ai.locProblemsLead')}
          <strong className="numeric">{problems.length}</strong>
          {t('ai.locProblemsTail')}
        </div>
      ) : null}

      <ul className="cat-plan">
        {entries.map((entry) => {
          /* 中间层 = 要建的每一级里，除了最后那一级自己 */
          const intermediate = Math.max(0, entry.willCreate.length - 1)
          return (
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
                aria-label={t('ai.locIncludeAria', { name: entry.toLabel })}
                onChange={() => toggle(entry.key)}
              />

              <span className="cat-plan__kind">{t('ai.locKindCreate')}</span>

              <span className="cat-plan__body">
                <span className="cat-plan__names">
                  <span className="cat-plan__from">{t('ai.locFromNew')}</span>
                  <span className="cat-plan__arrow">→</span>
                  <span className="cat-plan__to">{entry.toLabel}</span>
                </span>

                {entry.status === 'ok' ? (
                  <span className="cat-plan__note">
                    {intermediate > 0
                      ? tc(intermediate, 'ai.locAlsoLevels')
                      : t('ai.locOnlyItself')}
                  </span>
                ) : (
                  <span className="cat-plan__note">{t('ai.locNoteDuplicate')}</span>
                )}
              </span>
            </li>
          )
        })}
      </ul>

      <div className="dim small">
        {included.length > 0 ? tc(included.length, 'ai.locWillApply') : t('ai.locNothingApply')}
      </div>
    </div>
  )
}
