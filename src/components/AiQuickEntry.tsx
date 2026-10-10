/**
 * 速录面板：一行一件，填完拼成一段话放进对话框。
 *
 * ── 它为什么不是「直接录入表单」 ──────────────────────────────────
 * 「物品」页已经有一个完整的录入表单了，这里再做一个是重复的 ——
 * 这个面板要解决的是**另一种**场景：手上一次性过十几件东西，
 * 一件一件走表单太慢，而每件要说的话又是同一套（名字 + 放哪 + 归哪 + 过期）。
 *
 * 所以它的出口只有一个：**把话写好放进输入框**。
 * 之后的路一步都没少 —— 发给模型 → 草稿 → 你自己看一遍 → 点采纳。
 * 面板只是替你把打字的活干了，不绕过任何一道确认。
 *
 * ── 位置和分类为什么带候选 ────────────────────────────────────────
 * 这两个字段是唯一「写错了会静默出事」的地方：路径对不上库里任何一条，
 * 这条会被标成「新位置 / 新分类」而且默认不勾选。所以这两个框底下直接铺
 * 候选，用的还是输入框那套规则（src/ai/commands.ts 的 suggestSlot）——
 * 同一个 App 里两处匹配规则不一样，是最难解释的一类 bug。
 */

import { useState } from 'react'
import type { ChangeEvent } from 'react'
import { IconPlus, IconTrash } from './ui/icons'
import { Button, IconButton } from './ui/primitives'
import type { ComposerContext } from './AiQuickBar'
import { candidateLabel } from './AiQuickBar'
import { composeQuickText, suggestSlot } from '../ai/commands'
import type { QuickEntryRow, SlotCandidate, SlotHit } from '../ai/commands'
import { commandVocab } from '../ai/commandVocab'
import { useT } from '../i18n'
import { uid } from '../lib/id'
import { useAppStore } from '../store/useAppStore'

/** 面板内部的一行：多一个 key，用来让 React 认得出是哪一行 */
interface Row extends QuickEntryRow {
  key: string
}

const STATUS_KEYS = {
  active: 'itemEdit.statusActive',
  idle: 'itemEdit.statusIdle',
  spare: 'itemEdit.statusSpare',
} as const

function emptyRow(): Row {
  return { key: uid(), name: '', location: '', category: '', expiry: '', status: 'active' }
}

/** 位置 / 分类的候选 —— 和输入框里那套是同一个函数 */
function suggestFor(
  kind: 'location' | 'category',
  value: string,
  composer: ComposerContext,
): SlotCandidate[] {
  if (value.trim() === '') return []
  const hit: SlotHit = { kind, from: 0, to: value.length, query: value }
  if (kind === 'location') {
    return suggestSlot(hit, {
      nodes: composer.locations,
      index: composer.locationIndex,
      usage: composer.locationUsage,
      /* 速录面板和输入框是同一套候选，置顶也得跟着走 —— 否则两处顺序不一样 */
      pinnedIds: composer.pinnedLocationIds,
      limit: 5,
    }).candidates.filter((candidate) => candidate.id !== null)
  }
  return suggestSlot(hit, {
    nodes: composer.categories,
    index: composer.categoryIndex,
    pinnedIds: composer.pinnedCategoryIds,
    limit: 5,
  }).candidates.filter((candidate) => candidate.id !== null)
}

/** 位置 / 分类输入框：打字的时候底下铺几条候选，点一下就填进去 */
function PathField({
  kind,
  value,
  composer,
  label,
  onChange,
}: {
  kind: 'location' | 'category'
  value: string
  composer: ComposerContext
  label: string
  onChange: (next: string) => void
}) {
  const { t } = useT()
  const candidates = suggestFor(kind, value, composer)
  const exact = candidates.some((candidate) => candidate.exact)
  const warn = value.trim() !== '' && candidates.length > 0 && !exact

  return (
    <div className="quick-entry__field">
      <input
        className="input"
        value={value}
        placeholder={label}
        aria-label={label}
        onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)}
      />
      {candidates.length > 0 ? (
        <div className="quick-entry__suggest">
          {candidates.map((candidate, index) => (
            <button
              key={`${candidate.id ?? 'new'}-${index}`}
              type="button"
              className="quick-entry__chip"
              onClick={() => onChange(candidate.pathText)}
            >
              {candidateLabel(candidate, value)}
            </button>
          ))}
        </div>
      ) : null}
      {warn ? (
        <div className="tiny ai-check--warn">
          {t(kind === 'location' ? 'ai.slotWillCreateLocation' : 'ai.slotWillCreateCategory')}
        </div>
      ) : null}
    </div>
  )
}

export function AiQuickEntry({
  composer,
  onGenerate,
}: {
  composer: ComposerContext
  /** 把拼好的话交给上面（上面负责插进输入框，不覆盖已经写好的东西） */
  onGenerate: (text: string) => void
}) {
  const { t, tc } = useT()
  const notify = useAppStore((s) => s.notify)
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<Row[]>([emptyRow()])

  const update = (key: string, patch: Partial<QuickEntryRow>) => {
    setRows((prev) => prev.map((row) => (row.key === key ? { ...row, ...patch } : row)))
  }

  const filled = rows.filter((row) => row.name.trim() !== '').length

  const generate = () => {
    if (filled === 0) return
    onGenerate(composeQuickText(rows, commandVocab()))
    notify(tc(filled, 'ai.quickGenerated'), 'success')
    setRows([emptyRow()])
  }

  return (
    <div className={`quick-entry${open ? ' is-open' : ''}`}>
      <div className="row" style={{ gap: 'var(--gap-2)', alignItems: 'center' }}>
        <Button size="sm" onClick={() => setOpen((prev) => !prev)}>
          {t('ai.quickToggle')}
        </Button>
        {open ? <span className="tiny dim">{t('ai.quickHint')}</span> : null}
      </div>

      {open ? (
        <div className="quick-entry__body">
          <div className="quick-entry__head tiny dim">
            <span>{t('ai.quickName')}</span>
            <span>{t('ai.quickLocation')}</span>
            <span>{t('ai.quickCategory')}</span>
            <span>{t('ai.quickExpiry')}</span>
            <span>{t('ai.quickStatus')}</span>
            <span />
          </div>

          {rows.map((row, index) => (
            <div className="quick-entry__row" key={row.key}>
              <input
                className="input"
                value={row.name}
                placeholder={t('ai.quickName')}
                aria-label={t('ai.quickName')}
                onChange={(event) => update(row.key, { name: event.target.value })}
              />
              <PathField
                kind="location"
                value={row.location}
                composer={composer}
                label={t('ai.quickLocation')}
                onChange={(next) => update(row.key, { location: next })}
              />
              <PathField
                kind="category"
                value={row.category}
                composer={composer}
                label={t('ai.quickCategory')}
                onChange={(next) => update(row.key, { category: next })}
              />
              <input
                className="input"
                type="date"
                value={row.expiry}
                aria-label={t('ai.quickExpiry')}
                onChange={(event) => update(row.key, { expiry: event.target.value })}
              />
              <select
                className="input"
                value={row.status}
                aria-label={t('ai.quickStatus')}
                onChange={(event) =>
                  update(row.key, { status: event.target.value as QuickEntryRow['status'] })
                }
              >
                {(['active', 'idle', 'spare'] as const).map((status) => (
                  <option key={status} value={status}>
                    {t(STATUS_KEYS[status])}
                  </option>
                ))}
              </select>
              <IconButton
                label={t('ai.quickRemoveAria', { index: index + 1 })}
                onClick={() => setRows((prev) => prev.filter((item) => item.key !== row.key))}
                disabled={rows.length === 1}
              >
                <IconTrash size={14} />
              </IconButton>
            </div>
          ))}

          <div className="row wrap" style={{ gap: 'var(--gap-2)' }}>
            <Button size="sm" onClick={() => setRows((prev) => [...prev, emptyRow()])}>
              <IconPlus size={13} />
              {t('ai.quickAddRow')}
            </Button>
            <Button size="sm" variant="primary" onClick={generate} disabled={filled === 0}>
              {t('ai.quickGenerate')}
              {filled > 0 ? ` (${filled})` : ''}
            </Button>
            <Button size="sm" onClick={() => setRows([emptyRow()])} disabled={filled === 0}>
              {t('ai.quickClear')}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
