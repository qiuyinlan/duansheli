import { useEffect, useMemo, useRef, useState } from 'react'
import type { AiUsage } from '../ai/deepseek'
import type { ChatBubble } from '../ai/chat'
import {
  applyInsert,
  commandChips,
  detectSlot,
  inspectDraft,
  shouldSuggest,
  suggestSlot,
} from '../ai/commands'
import type { CommandChip, SlotKind } from '../ai/commands'
import { commandVocab } from '../ai/commandVocab'
import { addDaysToISODate, todayISODate } from '../lib/format'
import type { DictKey } from '../i18n'
import { useT, type TFunction } from '../i18n'
import { IconAlert, IconSparkle } from './ui/icons'
import { Button, ConfirmDialog } from './ui/primitives'
import { AiQuickEntry } from './AiQuickEntry'
import { candidateLabel, CommandChipRow, DraftCheckLine, SlotPopover } from './AiQuickBar'
import type { ComposerContext, SlotRow } from './AiQuickBar'

interface Props {
  bubbles: ChatBubble[]
  running: boolean
  error: string | null
  /** 本次对话累计消耗 */
  usage: AiUsage
  /** 上一轮消耗 —— 用来判断「是不是该开新对话了」 */
  lastTurnUsage: AiUsage
  draftCount: number
  onSend: (text: string) => void
  onCancel: () => void
  onReset: () => void
  /** 位置 / 分类树 + 匹配规则：按钮、补全、预检都要用 */
  composer: ComposerContext
  /**
   * 点候选行右边那颗星：置顶 / 取消置顶。
   *
   * 只把「置顶了哪一条」这件事交出去（写进界面偏好），
   * 这一层不碰 localStorage —— 它只该管「这一段话」。
   */
  onTogglePin: (id: string, kind: 'location' | 'category') => void
}

/**
 * 起步示例：点一下就把整段填进输入框。
 *
 * 这里**存的是 key、不是文字** —— 模块级的常量要是在模块加载时就把 t() 的结果
 * 存下来，之后再切语言它不会变，按钮上会一直留着一开始那门语言。
 * 所以写成函数，渲染时再求值。
 *
 * 英文那三条不是逐字翻译：要读起来像英语使用者真会打进去的话，
 * 而且要对得上这个 App 的用法（一个输入框，既能录新的、也能改现有的）。
 */
function starters(t: TFunction): string[] {
  return [t('ai.starter1'), t('ai.starter2'), t('ai.starter3')]
}

/** 弹层标题 —— 存 key，渲染时再查表（和上面同一个理由） */
const SLOT_TITLES: Record<SlotKind, DictKey> = {
  location: 'ai.slotLocationTitle',
  category: 'ai.slotCategoryTitle',
  quantity: 'ai.slotQuantityTitle',
  expiry: 'ai.slotExpiryTitle',
}

/** 「几件」的候选。列到 10：再多就该直接打字了 */
const QUANTITY_OPTIONS = ['1', '2', '3', '4', '5', '10']

/** 过期日期的快捷候选：天数 + 词典 key（和录入表单里那一排是同一套说法） */
const EXPIRY_QUICK: Array<{ days: number; labelKey: DictKey }> = [
  { days: 7, labelKey: 'expiry.fieldQuickWeek' },
  { days: 30, labelKey: 'expiry.fieldQuickMonth' },
  { days: 183, labelKey: 'expiry.fieldQuickHalfYear' },
  { days: 365, labelKey: 'expiry.fieldQuickYear' },
]

/**
 * 对话整理面板。
 *
 * 这一块只负责「说话」，草稿的展示与采纳在旁边的预览面板里 ——
 * 两件事分开，用户才能一边聊一边盯着结果看。
 *
 * ── 输入框旁边那套东西（按钮 / 补全 / 预检）为什么都在这里 ──────
 * 因为 `draft` 是**这个组件的局部状态**（不落盘、也不进会话 store）：
 * 想「插到光标处」就必须能拿到同一个 textarea 和同一份值。
 * 把它提升进 store 反而会撞上「会话状态不持久化」那条设计（见 useAiSessionStore），
 * 而且换不来任何东西。规则在 src/ai/commands.ts，展示在 AiQuickBar/AiQuickEntry，
 * 这一层只做「接线」。
 */
export function AiChatPanel({
  bubbles,
  running,
  error,
  usage,
  lastTurnUsage,
  draftCount,
  onSend,
  onCancel,
  onReset,
  composer,
  onTogglePin,
}: Props) {
  const { t, lang } = useT()

  const [draft, setDraft] = useState('')
  const [confirmReset, setConfirmReset] = useState(false)
  const streamRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)

  /* ---- 输入框旁边那套东西的状态 ---- */

  /** 光标位置。补全算的是「光标前那句话」，所以这个必须跟着走 */
  const [caret, setCaret] = useState(0)
  /** 用户按了 Esc：这一轮别弹了，等下次打字/插按钮再说 */
  const [dismissed, setDismissed] = useState(false)
  /**
   * 用户有没有**主动**去过弹层（按过上下键）。
   *
   * 不区分这个的话会出一个很烦的坑：路径已经打得完全正确了，他按回车想发送，
   * 结果被当成「选中第一条候选」。所以只有他真按过上下键、或者路径还没打完
   * （补全正好能帮上忙）时，回车才用来选候选。
   */
  const [engaged, setEngaged] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  /** 最近用过/选过的位置和分类：下次补全时排在最前面 */
  const [recentLocations, setRecentLocations] = useState<string[]>([])
  const [recentCategories, setRecentCategories] = useState<string[]>([])
  /** 插完文字要把光标挪回去，那件事只能在 DOM 更新之后做 */
  const [pendingCaret, setPendingCaret] = useState<number | null>(null)

  const vocab = commandVocab()
  const chips = useMemo(() => commandChips(vocab), [lang])

  /* 新消息进来时滚到底部 */
  useEffect(() => {
    const node = streamRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [bubbles.length, running])

  /* 插完文字把光标放回该在的位置 —— 用户接着打的就是那一段 */
  useEffect(() => {
    if (pendingCaret === null) return
    const node = inputRef.current
    if (node) {
      node.focus()
      node.setSelectionRange(pendingCaret, pendingCaret)
    }
    setPendingCaret(null)
  }, [pendingCaret])

  /** 光标前那句话现在是哪个槽位 */
  const slot = useMemo(() => detectSlot(draft, caret, vocab), [draft, caret, lang])

  const suggestion = useMemo(() => {
    if (slot === null || dismissed || !shouldSuggest(slot)) return null
    if (slot.kind === 'location') {
      return suggestSlot(slot, {
        nodes: composer.locations,
        index: composer.locationIndex,
        recentIds: recentLocations,
        usage: composer.locationUsage,
        /* 点过星星的那几条永远排最前面 —— 见 compareRows 里的说明 */
        pinnedIds: composer.pinnedLocationIds,
        vocab,
      })
    }
    if (slot.kind === 'category') {
      return suggestSlot(slot, {
        nodes: composer.categories,
        index: composer.categoryIndex,
        recentIds: recentCategories,
        pinnedIds: composer.pinnedCategoryIds,
        vocab,
      })
    }
    return null
  }, [slot, dismissed, composer, recentLocations, recentCategories, lang])

  const popupOpen = slot !== null && !dismissed && shouldSuggest(slot)

  const rows = useMemo<SlotRow[]>(() => {
    if (!popupOpen || slot === null) return []
    if (slot.kind === 'quantity') {
      return QUANTITY_OPTIONS.map((value) => ({
        key: value,
        label: value,
        hint: null,
        isNew: false,
        isLevel: false,
        insert: value,
        candidateId: null,
        isBranch: false,
        pinned: false,
        /* 「几件」是个数字，没有可以置顶的东西 */
        pinnable: false,
      }))
    }
    if (slot.kind === 'expiry') {
      return EXPIRY_QUICK.map((choice) => {
        const iso = addDaysToISODate(todayISODate(), choice.days)
        return {
          key: iso,
          label: t(choice.labelKey),
          hint: iso,
          isNew: false,
          isLevel: false,
          insert: iso,
          candidateId: null,
          isBranch: false,
          pinned: false,
          pinnable: false,
        }
      })
    }
    if (suggestion === null) return []
    return suggestion.candidates.map((candidate, index) => ({
      key: `${candidate.id ?? 'new'}-${index}`,
      label:
        candidate.id === null && candidate.kind === 'new' ? (
          <span className="dim">{candidate.name}</span>
        ) : (
          candidateLabel(candidate, slot.query)
        ),
      hint:
        candidate.kind === 'new'
          ? t(slot.kind === 'category' ? 'ai.slotWillCreateCategory' : 'ai.slotWillCreateLocation')
          : candidate.kind === 'level'
            ? t('ai.slotLevelHint')
            : candidate.isBranch
              ? t('ai.slotDeeperHint')
              : null,
      isNew: candidate.kind === 'new',
      isLevel: candidate.kind === 'level',
      insert: candidate.pathText,
      candidateId: candidate.id,
      isBranch: candidate.isBranch,
      pinned: candidate.pinned,
      /* 只有库里真有这一条才给星星（置顶存的就是它的 id） */
      pinnable: candidate.kind === 'node' && candidate.id !== null,
    }))
  }, [popupOpen, slot, suggestion, lang])

  const popupFooter = useMemo(() => {
    if (!popupOpen || slot === null || suggestion === null) return null
    if (slot.kind === 'quantity' || slot.kind === 'expiry') return null
    if (suggestion.prefixUnknown) return t('ai.slotPrefixUnknown')
    /*
     * 已经站到某一级上了（点完一条分支就接着往下钻）—— 说一句，
     * 免得用户以为候选「怎么只剩这些」，又回去自己打「/」。
     */
    if (suggestion.drillingInto !== null) {
      const path = (
        slot.kind === 'category' ? composer.categoryIndex : composer.locationIndex
      ).pathString(suggestion.drillingInto, vocab.pathSeparator)
      if (path !== '') return t('ai.slotNowAt', { path })
    }
    return rows.some((row) => row.isLevel) ? t('ai.slotLevelHint') : null
  }, [popupOpen, slot, suggestion, rows, composer, lang])

  /**
   * 本地预检：位置/分类到底对不对得上库里。
   *
   * 用的是程序真正在用的那套匹配规则（`inspectDraft` 里调的 `matchPath`），
   * 所以它说的「对得上」和采纳时会发生的事**是一致的**。
   */
  const check = useMemo(
    () =>
      draft.trim() === ''
        ? null
        : inspectDraft(draft, composer.matchContext, {
            vocab,
            locationPath: (id) => composer.locationIndex.pathString(id, vocab.pathSeparator),
            categoryPath: (id) => composer.categoryIndex.pathString(id, vocab.pathSeparator),
            locationIndex: composer.locationIndex,
            categoryIndex: composer.categoryIndex,
          }),
    [draft, composer, lang],
  )

  const send = (text: string) => {
    const trimmed = text.trim()
    if (trimmed === '' || running) return
    onSend(trimmed)
    setDraft('')
    setCaret(0)
    setDismissed(false)
    setEngaged(false)
    setPendingCaret(0)
  }

  const askReset = () => {
    if (draftCount > 0 || bubbles.length > 0) setConfirmReset(true)
    else onReset()
  }

  /** 把一段文字插到光标处（不覆盖他已经写的东西） */
  const insertText = (text: string, opts: { newLineBefore?: boolean }) => {
    const result = applyInsert(draft, caret, text, {
      newLineBefore: opts.newLineBefore === true,
      separator: vocab.clauseSeparator,
    })
    setDraft(result.text)
    setCaret(result.caret)
    setPendingCaret(result.caret)
    setDismissed(false)
    setEngaged(false)
    setActiveIndex(0)
  }

  const insertChip = (chip: CommandChip) => {
    const result = applyInsert(draft, caret, chip.phrase, {
      leadingSeparator: chip.leadingSeparator,
      trailingSpace: chip.trailingSpace,
      newLineBefore: chip.newLineBefore,
      separator: vocab.clauseSeparator,
    })
    setDraft(result.text)
    setCaret(result.caret)
    setPendingCaret(result.caret)
    /* 点「放在」之后要立刻把已有的位置铺出来 —— 这正是这个按钮存在的意义 */
    setDismissed(false)
    setEngaged(false)
    setActiveIndex(0)
  }

  const pickRow = (index: number) => {
    const row = rows[index]
    if (row === undefined || slot === null) return
    const from = Math.max(0, Math.min(slot.from, draft.length))
    const to = Math.max(from, Math.min(slot.to, draft.length))
    const next = draft.slice(0, from) + row.insert + draft.slice(to)
    const nextCaret = from + row.insert.length
    setDraft(next)
    setCaret(nextCaret)
    setPendingCaret(nextCaret)
    setActiveIndex(0)
    setEngaged(false)

    if (row.candidateId !== null) {
      const id = row.candidateId
      const remember = (prev: string[]) => [id, ...prev.filter((each) => each !== id)].slice(0, 12)
      if (slot.kind === 'category') setRecentCategories(remember)
      else setRecentLocations(remember)
    }

    /* 叶子节点、数量、日期：选完就收起来。分支继续开着 —— 他可以接着往下钻 */
    const finished = row.candidateId === null || !row.isBranch
    setDismissed(finished)
  }

  const activeRow = rows[activeIndex]
  /**
   * 回车到底该「选中候选」还是「发送」。
   *
   *   1. 他按过上下键（engaged）→ 他想选，就选
   *   2. 路径还没打完（库里对不上这一串）→ 补全正好能帮上忙，就补
   *   3. 其余情况（已经是一条完整的路径）→ 发送。**这条最重要**：
   *      不然「打完一串正确的路径想回车发送」会变成「选中第一条候选」
   */
  const enterPicks =
    engaged ||
    (slot !== null &&
      slot.query.trim() !== '' &&
      suggestion !== null &&
      suggestion.resolvedId === null &&
      rows.length > 0 &&
      activeRow !== undefined)

  return (
    <div className="chat-panel">
      <div className="chat-panel__head">
        <span className="row" style={{ gap: 'var(--gap-2)' }}>
          <IconSparkle size={14} />
          <span className="small">{t('ai.panelTitle')}</span>
        </span>
        <span className="row" style={{ gap: 'var(--gap-3)' }}>
          {usage.totalTokens > 0 ? (
            <span className="tiny numeric" title={t('ai.usageTitle')}>
              {t('ai.usageLine', {
                last: lastTurnUsage.totalTokens,
                total: usage.totalTokens,
              })}
            </span>
          ) : null}
          <Button size="sm" onClick={askReset} disabled={running} title={t('ai.newChatTitle')}>
            {t('ai.newChat')}
          </Button>
        </span>
      </div>

      <div className="chat-panel__stream" ref={streamRef}>
        {bubbles.length === 0 ? (
          <div className="chat-panel__empty">
            <div className="small" style={{ marginBottom: 'var(--gap-3)' }}>
              <strong>{t('ai.emptyNewBold')}</strong>
              {t('ai.emptyNewTail')}
              <br />
              <strong>{t('ai.emptyEditBold')}</strong>
              {t('ai.emptyEditTail')}
            </div>
            <div className="stack-sm">
              {starters(t).map((starter) => (
                <button
                  key={starter}
                  type="button"
                  className="chat-starter"
                  onClick={() => {
                    setDraft(starter)
                    setCaret(starter.length)
                    setDismissed(false)
                  }}
                >
                  {starter.split('\n')[0]}
                </button>
              ))}
            </div>
          </div>
        ) : (
          bubbles.map((bubble) => (
            <div key={bubble.id} className={`chat-bubble chat-bubble--${bubble.role}`}>
              <div className="chat-bubble__text">{bubble.text}</div>
              {bubble.meta ? <div className="chat-bubble__meta">{bubble.meta}</div> : null}
            </div>
          ))
        )}

        {running ? (
          <div className="chat-bubble chat-bubble--assistant chat-bubble--pending">
            <span className="spinner" style={{ width: 12, height: 12, borderWidth: 2 }} />
            <span className="small dim">{t('ai.thinking')}</span>
          </div>
        ) : null}
      </div>

      {error !== null ? (
        <div className="notice notice--alert" style={{ margin: '0 var(--gap-3)' }}>
          <span className="notice__icon">
            <IconAlert />
          </span>
          <span className="notice__body small">{error}</span>
        </div>
      ) : null}

      <div className="chat-panel__composer">
        <CommandChipRow chips={chips} disabled={running} onPick={insertChip} />

        <div className="composer-field">
          {popupOpen ? (
            <SlotPopover
              title={t(SLOT_TITLES[slot.kind])}
              footer={popupFooter}
              rows={rows}
              activeIndex={activeIndex}
              onPick={pickRow}
              onHover={setActiveIndex}
              onTogglePin={(index) => {
                const row = rows[index]
                const id = row?.candidateId ?? null
                if (id === null || slot.kind === 'quantity' || slot.kind === 'expiry') return
                onTogglePin(id, slot.kind)
              }}
            />
          ) : null}
          <textarea
            ref={inputRef}
            className="textarea chat-panel__input"
            value={draft}
            disabled={running}
            placeholder={
              draftCount === 0
                ? t('ai.placeholderEmpty')
                : t('ai.placeholderWithDraft', { count: draftCount })
            }
            onChange={(e) => {
              setDraft(e.target.value)
              setCaret(e.target.selectionStart ?? e.target.value.length)
              setDismissed(false)
              setEngaged(false)
            }}
            onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
            onKeyDown={(e) => {
              /* 输入法组字期间一律不抢按键 —— 中文打字时回车是「确认候选词」 */
              if (e.nativeEvent.isComposing) return

              if (popupOpen && rows.length > 0) {
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  setEngaged(true)
                  setActiveIndex((index) => (index + 1) % rows.length)
                  return
                }
                if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  setEngaged(true)
                  setActiveIndex((index) => (index - 1 + rows.length) % rows.length)
                  return
                }
                if ((e.key === 'Enter' || e.key === 'Tab') && enterPicks) {
                  e.preventDefault()
                  pickRow(activeIndex)
                  return
                }
              }

              if (e.key === 'Escape') {
                setDismissed(true)
                setEngaged(false)
                return
              }

              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send(draft)
              }
            }}
          />
        </div>

        {check !== null ? <DraftCheckLine check={check} /> : null}

        <AiQuickEntry composer={composer} onGenerate={(text) => insertText(text, { newLineBefore: true })} />

        <div className="row">
          {running ? (
            <Button size="sm" onClick={onCancel} block>
              {t('common.cancel')}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="primary"
              block
              onClick={() => send(draft)}
              disabled={draft.trim() === ''}
            >
              {t('ai.send')}
            </Button>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmReset}
        title={t('ai.resetTitle')}
        confirmLabel={t('ai.resetConfirm')}
        cancelLabel={t('ai.resetCancel')}
        message={
          draftCount > 0 ? (
            <>
              {t('ai.resetHasDraftsLead')}
              <strong>{draftCount}</strong>
              {t('ai.resetHasDraftsMid')}
              <strong>{t('ai.resetNotSavedBold')}</strong>
              {t('ai.resetHasDraftsTail')}
              <br />
              <br />
              {t('ai.resetKeepHint')}
              <br />
              <br />
              <span className="dim">{t('ai.resetBenefit')}</span>
            </>
          ) : (
            <>{t('ai.resetEmptyBody')}</>
          )
        }
        onConfirm={() => {
          setConfirmReset(false)
          onReset()
        }}
        onCancel={() => setConfirmReset(false)}
      />
    </div>
  )
}
