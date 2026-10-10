/**
 * AI 输入框旁边那套「快捷指令 + 补全 + 预检」的**展示层**。
 *
 * 这里刻意只做三件事，一行判断逻辑都不放：
 *   · 按钮长什么样（CommandChipRow）
 *   · 候选列表长什么样（SlotPopover）
 *   · 预检那行字怎么拼（DraftCheckLine）
 *
 * 规则全在 src/ai/commands.ts 里，状态全在 AiChatPanel 里。
 * 这么分的原因很实际：jsdom **没法模拟打字**（见 tests/dom.ts），
 * 补全这条路只能靠纯函数测；而这个文件要坏，坏的是「看起来不对」，
 * 一眼就能看见 —— 两类东西的风险不一样，就不该混在一起。
 */

import type { ReactNode } from 'react'
import type { Category, Location } from '../types'
import type { TreeIndex } from '../lib/tree'
import type { MatchContext } from '../ai/convert'
import type { CommandChip, DraftCheck, SlotCandidate } from '../ai/commands'
import { commandVocab } from '../ai/commandVocab'
import { useT } from '../i18n'
import { PinButton } from './ui/primitives'

/**
 * 输入框那套辅助功能要用的**全部**数据。
 *
 * 为什么打包成一个 props 传进来、而不是让 AiChatPanel 自己去 store 里取：
 * 那个组件只该管「这段话」这件事；数据和派生上下文由页面（Ai.tsx）准备好。
 * 顺带也让它能被单独挂起来测 —— 不用为了测一个按钮去搭整个 store。
 */
export interface ComposerContext {
  locations: Location[]
  locationIndex: TreeIndex<Location>
  categories: Category[]
  categoryIndex: TreeIndex<Category>
  /** 位置 id → 那个位置（含子位置）下有多少件东西，用来排序 */
  locationUsage: ReadonlyMap<string, number>
  /** 和真正落库时**同一套**匹配规则（convert.ts 里那份） */
  matchContext: MatchContext
  /**
   * 用户点星星置顶过的位置 / 分类 id（顺序即置顶顺序）。
   *
   * 放在这里而不是让面板自己去 store 里取，和上面几项同一个理由：
   * 面板只该管「这一段话」，数据由页面准备好一起传下来 ——
   * 顺带它也能被单独挂起来测（不用为了测一个星星去搭整个 store）。
   */
  pinnedLocationIds: readonly string[]
  pinnedCategoryIds: readonly string[]
}

/* ------------------------------------------------------------------ */
/* 一、快捷指令按钮                                                    */
/* ------------------------------------------------------------------ */

export function CommandChipRow({
  chips,
  disabled,
  onPick,
}: {
  chips: CommandChip[]
  disabled: boolean
  onPick: (chip: CommandChip) => void
}) {
  const { t } = useT()

  return (
    <div className="composer-chips" role="group" aria-label={t('ai.chipsLabel')} title={t('ai.chipsHint')}>
      {chips.map((chip) => (
        <button
          key={chip.id}
          type="button"
          className="composer-chip"
          disabled={disabled}
          onClick={() => onPick(chip)}
        >
          {chip.label}
        </button>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 二、候选列表                                                        */
/* ------------------------------------------------------------------ */

export interface SlotRow {
  key: string
  label: ReactNode
  /** 右边那句小字 */
  hint: string | null
  /** 库里没有这一条（会新建）—— 走警告色 */
  isNew: boolean
  /** 「几层」那种顺手给的子层 —— 不是警告，但也不是现成的 */
  isLevel: boolean
  /** 选中后插进输入框的文字 */
  insert: string
  /** 库里那一条的 id（数量 / 日期这种没有） */
  candidateId: string | null
  /** 库里那一条底下还有层级 —— 选完不收起弹层，让他接着往下钻 */
  isBranch: boolean
  /** 已经置顶了 —— 星星画实心，而且它排在列表最前面 */
  pinned: boolean
  /**
   * 能不能置顶。
   *
   * 只有**库里真的有这一条**才能置（置顶存的是它的 id）。
   * 「会被当成新位置」和「顺手给的 1层/2层」都还没有 id ——
   * 给它们画一颗点不动的星星，比不画更让人困惑。
   */
  pinnable: boolean
}

/** 把命中的那几个字加粗 —— 打「白色」时一眼看见命中的是哪儿 */
export function highlightMatch(name: string, query: string): ReactNode {
  const needle = query.trim()
  if (needle === '') return name
  const at = name.toLowerCase().indexOf(needle.toLowerCase())
  if (at < 0) return name
  return (
    <>
      {name.slice(0, at)}
      <strong className="slot-pop__hit">{name.slice(at, at + needle.length)}</strong>
      {name.slice(at + needle.length)}
    </>
  )
}

/** 候选那一行怎么显示：祖先淡一点 + 末级加粗（打「白色」要看得见它藏在哪一层） */
export function candidateLabel(candidate: SlotCandidate, query: string): ReactNode {
  const ancestors = candidate.path.slice(0, -1)
  const sep = commandVocab().pathSeparator
  return (
    <>
      {ancestors.length > 0 ? (
        <span className="dim">
          {ancestors.join(sep)}
          {sep}
        </span>
      ) : null}
      <span>{highlightMatch(candidate.name, query)}</span>
    </>
  )
}

export function SlotPopover({
  title,
  footer,
  rows,
  activeIndex,
  onPick,
  onHover,
  onTogglePin,
}: {
  title: string
  footer: string | null
  rows: SlotRow[]
  activeIndex: number
  onPick: (index: number) => void
  onHover: (index: number) => void
  /** 点某一行右边那颗星：置顶 / 取消置顶（**不**选中这一条、也不关弹层） */
  onTogglePin: (index: number) => void
}) {
  const { t } = useT()

  return (
    <div className="slot-pop" role="listbox" aria-label={title}>
      <div className="slot-pop__head">
        <span className="small">{title}</span>
        <span className="tiny dim">{t('ai.slotKeyboardHint')}</span>
      </div>

      {rows.length === 0 ? (
        <div className="slot-pop__empty tiny dim">{t('ai.slotEmpty')}</div>
      ) : (
        <ul className="slot-pop__list">
          {rows.map((row, index) => (
            /*
             * 一行是**两个**按钮（选它 / 置顶它），不是一个按钮里再嵌一个 ——
             * 按钮不能套按钮（HTML 不允许，点里面的那个会同时触发外面那个）。
             * 分开之后「点星星 = 置顶」和「点文字 = 选中」就是两件互不干扰的事。
             */
            <li
              key={row.key}
              className={`slot-pop__item${index === activeIndex ? ' is-active' : ''}`}
              onMouseEnter={() => onHover(index)}
            >
              <button
                type="button"
                role="option"
                /* 高亮挂在 li 上（见 pages.css），但「选中了哪一条」这个语义留在
                   这个按钮上：星号是**另一件事**，它的名字不该混进这一条的读屏名字里 */
                aria-selected={index === activeIndex}
                className={`slot-pop__row${row.isNew ? ' is-new' : ''}${
                  row.isLevel ? ' is-level' : ''
                }`}
                /* 不让输入框失焦：失焦了光标位置就没了，用户接着打字会跳回去 */
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onPick(index)}
              >
                <span className="slot-pop__label">{row.label}</span>
                {row.hint !== null ? <span className="slot-pop__hint tiny">{row.hint}</span> : null}
              </button>

              {row.pinnable ? (
                <PinButton
                  pinned={row.pinned}
                  name={typeof row.label === 'string' ? row.label : row.insert}
                  className="slot-pop__pin"
                  onClick={(event) => {
                    event.stopPropagation()
                    onTogglePin(index)
                  }}
                />
              ) : (
                /* 占位，让没有星星的那些行的文字宽度和别的行对齐 */
                <span className="slot-pop__pin slot-pop__pin--empty" aria-hidden="true" />
              )}
            </li>
          ))}
        </ul>
      )}

      {footer !== null ? <div className="slot-pop__foot tiny dim">{footer}</div> : null}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 三、发出前预检那一行                                                */
/* ------------------------------------------------------------------ */

/**
 * 「你写的这些位置/分类，在库里到底对不对得上」。
 *
 * 这一行**不是**在替模型理解你的话（那是模型的事），它只把程序本来就
 * 说了算的那件事提前说出来：路径对不上 = 会被标成「新位置 / 新分类」，
 * 而那种条目**默认不勾选**。用户最怕的就是「我明明说了，怎么没建出来」，
 * 这一行就是拦在那句话前面的。
 *
 * ── 三种状态，别混成两种 ────────────────────────────────────────
 *   1. 完全对上          → ✓（一句话说完）
 *   2. 没对上、但有很近的 → 说两边 + 让他看草稿（**不是**「会被当成新位置」）
 *   3. 确实没有          → 「会被当成新的，采纳时要勾一下」
 *
 * 第 2 种是用户实测报回来的：他打「蓝柜」而库里叫「蓝色柜」，模型处理对了，
 * 而原来那行字却在喊「库里没有」—— 假警报比不提示更糟，用户会开始不信它。
 *
 * 一个字都没写的时候不显示 —— 免得平时就有一条人在旁边念。
 */
export function DraftCheckLine({ check }: { check: DraftCheck }) {
  const { t, tc } = useT()

  const pieces: ReactNode[] = []
  if (check.newItemCount > 0) pieces.push(tc(check.newItemCount, 'ai.checkItems'))
  for (const place of check.places) {
    if (place.id !== null) {
      pieces.push(t('ai.checkPlaceOk', { path: place.pathText ?? place.query }))
    } else if (place.near !== null) {
      pieces.push(t('ai.checkPlaceNear', { query: place.query, path: place.near.pathText }))
    } else {
      pieces.push(t('ai.checkPlaceNew', { query: place.query }))
    }
  }
  for (const category of check.categories) {
    if (category.id !== null) {
      pieces.push(t('ai.checkCategoryOk', { path: category.pathText ?? category.query }))
    } else if (category.near !== null) {
      pieces.push(t('ai.checkCategoryNear', { query: category.query, path: category.near.pathText }))
    } else {
      pieces.push(t('ai.checkCategoryNew', { query: category.query }))
    }
  }

  const orphan = check.orphanNewPlaces.length > 0
  if (pieces.length === 0 && !orphan) return null

  /* 「会被当成新的」才算警告色；「有个很近的」只是提示，别一片红 */
  const warn =
    orphan ||
    check.places.some((place) => place.id === null && place.near === null) ||
    check.categories.some((category) => category.id === null && category.near === null)

  return (
    <div className={`ai-check${warn ? ' ai-check--warn' : ''}`} title={t('ai.checkFootnote')}>
      <span className="ai-check__lead small">{t('ai.checkLead')}</span>
      {pieces.map((piece, index) => (
        <span key={index} className="small">
          {index > 0 ? <span className="dim">{t('ai.checkJoin')}</span> : null}
          {piece}
        </span>
      ))}
      {orphan ? (
        <span className="small">
          {pieces.length > 0 ? <span className="dim">{t('ai.checkJoin')}</span> : null}
          {t('ai.checkOrphanNewPlace')}
        </span>
      ) : null}
    </div>
  )
}
