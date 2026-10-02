import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  buildAiContext,
  buildExtractionMessages,
  buildTidyMessages,
  chunkItems,
  splitIntoChunks,
  type TidyInputItem,
} from '../ai/prompts'
import {
  createMatchContext,
  draftsToBulkAddItems,
  draftsToBulkUpdates,
  toItemDraft,
  toTidyDraft,
  type ItemDraft,
  type TidyDraft,
} from '../ai/convert'
import { AiError, chat, createRequestController, type AiUsage } from '../ai/deepseek'
import {
  extractJson,
  parseAssignments,
  parseExtraction,
  type RawAssignment,
  type RawExtractedItem,
} from '../ai/parse'
import { AiExtractPreview } from '../components/AiExtractPreview'
import { AiKeyPanel } from '../components/AiKeyPanel'
import { AiTidyPreview } from '../components/AiTidyPreview'
import { IconAlert, IconCheck } from '../components/ui/icons'
import { Button } from '../components/ui/primitives'
import { liveItems } from '../store/selectors'
import { useAppStore } from '../store/useAppStore'
import type { Item } from '../types'

/** 每批最多多少字 —— 太大输出会被 max_tokens 截断，截断的 JSON 是解析不了的 */
const MAX_CHARS_PER_CHUNK = 2500

/** 整理已有物品时，每批发给 AI 多少件 */
const TIDY_BATCH_SIZE = 40

/** 一次整理最多处理多少件，防止一把梭把上下文撑爆 */
const TIDY_MAX_ITEMS = 200

type Mode = 'extract' | 'tidy'
type TidyScope = 'active' | 'idle' | 'uncategorized' | 'unassigned' | 'category'

const EMPTY_USAGE: AiUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }

function addUsage(a: AiUsage, b: AiUsage): AiUsage {
  return {
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens,
    totalTokens: a.totalTokens + b.totalTokens,
  }
}

function errorText(err: unknown): string {
  if (err instanceof AiError) return err.message
  return err instanceof Error ? err.message : String(err)
}

export function Ai() {
  const navigate = useNavigate()

  const data = useAppStore((s) => s.data)
  const derived = useAppStore((s) => s.derived)
  const aiApiKey = useAppStore((s) => s.aiApiKey)
  const bulkAddItems = useAppStore((s) => s.bulkAddItems)
  const bulkUpdateItems = useAppStore((s) => s.bulkUpdateItems)
  const notify = useAppStore((s) => s.notify)

  const [mode, setMode] = useState<Mode>('extract')

  /* ---------------- 批量录入 ---------------- */
  const [text, setText] = useState('')
  const [extractDrafts, setExtractDrafts] = useState<ItemDraft[] | null>(null)
  const [extractError, setExtractError] = useState<string | null>(null)
  const [extractNotes, setExtractNotes] = useState<string[]>([])

  /* ---------------- 整理已有 ---------------- */
  const [scope, setScope] = useState<TidyScope>('active')
  const [scopeCategoryId, setScopeCategoryId] = useState('')
  const [tidyDrafts, setTidyDrafts] = useState<TidyDraft[] | null>(null)
  const [tidyError, setTidyError] = useState<string | null>(null)

  /* ---------------- 共用运行状态 ---------------- */
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [usage, setUsage] = useState<AiUsage>(EMPTY_USAGE)
  const cancelRef = useRef<(() => void) | null>(null)

  const chunks = useMemo(
    () => (text.trim() === '' ? [] : splitIntoChunks(text, MAX_CHARS_PER_CHUNK)),
    [text],
  )

  const live = useMemo(() => liveItems(data), [data])

  const scopeItems = useMemo(() => {
    switch (scope) {
      case 'idle':
        return live.filter((item) => item.status === 'idle')
      case 'uncategorized':
        return live.filter((item) => item.categoryIds.length === 0)
      case 'unassigned':
        return live.filter((item) => !item.locationId)
      case 'category':
        return scopeCategoryId === ''
          ? []
          : live.filter((item) => item.categoryIds.includes(scopeCategoryId))
      case 'active':
      default:
        return live
    }
  }, [live, scope, scopeCategoryId])

  /* ---------------- 运行：批量录入 ---------------- */

  const runExtract = async () => {
    if (aiApiKey.trim() === '') {
      notify('请先填入 DeepSeek API Key', 'error')
      return
    }
    if (text.trim() === '') {
      notify('先粘贴一些文字', 'error')
      return
    }

    setRunning(true)
    setExtractError(null)
    setExtractDrafts(null)
    setExtractNotes([])
    setUsage(EMPTY_USAGE)

    const controller = createRequestController()
    cancelRef.current = controller.cancel

    try {
      const context = buildAiContext(data, derived)
      const parts = splitIntoChunks(text, MAX_CHARS_PER_CHUNK)
      const collected: RawExtractedItem[] = []
      const notes: string[] = []
      let dropped = 0
      let spent = EMPTY_USAGE

      for (let i = 0; i < parts.length; i++) {
        setProgress({ done: i, total: parts.length })

        const result = await chat({
          apiKey: aiApiKey,
          messages: buildExtractionMessages(context, parts[i], {
            index: i + 1,
            total: parts.length,
          }),
          signal: controller.signal,
        })

        spent = addUsage(spent, result.usage)
        setUsage(spent)

        if (result.finishReason === 'length') {
          notes.push(
            `第 ${i + 1} 批的结果被截断了（这一段的物品可能没认全）。建议把文字拆成更小的段再试。`,
          )
        }

        const parsed = parseExtraction(extractJson(result.content))
        collected.push(...parsed.items)
        dropped += parsed.dropped
      }

      setProgress({ done: parts.length, total: parts.length })

      if (dropped > 0) {
        notes.push(`有 ${dropped} 条因为缺少名称被丢弃。`)
      }
      if (collected.length === 0) {
        notes.push('这段文字里没有识别出任何物品。可以写得更具体一点，例如「衣柜里有一件灰色羊毛衫、两条牛仔裤」。')
      }

      const fresh = useAppStore.getState()
      const matchCtx = createMatchContext(fresh.data, fresh.derived)
      setExtractDrafts(collected.map((raw) => toItemDraft(raw, matchCtx, fresh.derived)))
      setExtractNotes(notes)
    } catch (err) {
      setExtractError(errorText(err))
    } finally {
      setRunning(false)
      controller.dispose()
      cancelRef.current = null
    }
  }

  const applyExtract = () => {
    if (!extractDrafts) return
    const selected = extractDrafts.filter((draft) => draft.include && draft.name.trim() !== '')
    if (selected.length === 0) {
      notify('没有勾选任何条目', 'error')
      return
    }

    const fresh = useAppStore.getState()
    const matchCtx = createMatchContext(fresh.data, fresh.derived)
    const plan = draftsToBulkAddItems(selected, matchCtx, fresh.derived)
    const result = bulkAddItems(plan)

    const extras: string[] = []
    if (result.createdCategories > 0) extras.push(`新建 ${result.createdCategories} 个分类`)
    if (result.createdLocations > 0) extras.push(`新建 ${result.createdLocations} 个位置`)
    notify(
      `已录入 ${result.items} 件物品${extras.length > 0 ? `，${extras.join('、')}` : ''}`,
      'success',
    )

    setExtractDrafts(null)
    setText('')
    navigate('/items')
  }

  /* ---------------- 运行：整理已有 ---------------- */

  const runTidy = async () => {
    if (aiApiKey.trim() === '') {
      notify('请先填入 DeepSeek API Key', 'error')
      return
    }
    if (scopeItems.length === 0) {
      notify('这个范围里没有物品', 'error')
      return
    }

    setRunning(true)
    setTidyError(null)
    setTidyDrafts(null)
    setUsage(EMPTY_USAGE)

    const controller = createRequestController()
    cancelRef.current = controller.cancel

    try {
      const context = buildAiContext(data, derived)
      const targets = scopeItems.slice(0, TIDY_MAX_ITEMS)
      const batches = chunkItems(targets, TIDY_BATCH_SIZE)

      const assignments: RawAssignment[] = []
      let spent = EMPTY_USAGE

      for (let i = 0; i < batches.length; i++) {
        setProgress({ done: i, total: batches.length })

        const inputs: TidyInputItem[] = batches[i].map((item) => ({
          id: item.id,
          name: item.name,
          quantity: item.quantity,
          categoryNames: item.categoryIds
            .map((id) => derived.categoryById.get(id)?.name)
            .filter((name): name is string => Boolean(name)),
          locationPath: item.locationId ? derived.index.pathString(item.locationId, ' / ') : null,
          tags: item.tags,
        }))

        const result = await chat({
          apiKey: aiApiKey,
          messages: buildTidyMessages(context, inputs, {
            index: i + 1,
            total: batches.length,
          }),
          signal: controller.signal,
        })

        spent = addUsage(spent, result.usage)
        setUsage(spent)
        assignments.push(...parseAssignments(extractJson(result.content)))
      }

      setProgress({ done: batches.length, total: batches.length })

      const fresh = useAppStore.getState()
      const matchCtx = createMatchContext(fresh.data, fresh.derived)
      const byId = new Map<string, Item>(fresh.data.items.map((item) => [item.id, item]))

      const drafts = assignments
        .map((assignment) => {
          const item = byId.get(assignment.id)
          return item ? toTidyDraft(assignment, item, matchCtx, fresh.derived) : null
        })
        .filter((draft): draft is TidyDraft => draft !== null)

      setTidyDrafts(drafts)
      if (drafts.length === 0) {
        notify('AI 觉得现有的分类和位置都挺合适，没有需要改的', 'success')
      }
    } catch (err) {
      setTidyError(errorText(err))
    } finally {
      setRunning(false)
      controller.dispose()
      cancelRef.current = null
    }
  }

  const applyTidy = () => {
    if (!tidyDrafts) return
    const selected = tidyDrafts.filter((draft) => draft.include)
    if (selected.length === 0) {
      notify('没有勾选任何一条建议', 'error')
      return
    }

    const fresh = useAppStore.getState()
    const matchCtx = createMatchContext(fresh.data, fresh.derived)
    const updates = draftsToBulkUpdates(selected, matchCtx, fresh.derived)
    const result = bulkUpdateItems(updates)

    const extras: string[] = []
    if (result.createdCategories > 0) extras.push(`新建 ${result.createdCategories} 个分类`)
    if (result.createdLocations > 0) extras.push(`新建 ${result.createdLocations} 个位置`)
    notify(
      `已修改 ${result.items} 件物品${extras.length > 0 ? `，${extras.join('、')}` : ''}`,
      'success',
    )

    setTidyDrafts(null)
  }

  const cancel = () => {
    cancelRef.current?.()
  }

  /* ---------------- 渲染 ---------------- */

  const isExtract = mode === 'extract'

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-header__title">AI 助手</div>
          <div className="page-header__sub">
            让 DeepSeek 帮你把一段文字变成录好的物品 —— 结果会先给你过目，确认后才写入
          </div>
        </div>
      </div>

      <AiKeyPanel />

      {/* ---------------- 模式切换 ---------------- */}
      <div className="segmented" style={{ marginBottom: 'var(--gap-5)' }}>
        <button
          type="button"
          className={`segmented__item${isExtract ? ' is-active' : ''}`}
          onClick={() => setMode('extract')}
        >
          批量录入
        </button>
        <button
          type="button"
          className={`segmented__item${!isExtract ? ' is-active' : ''}`}
          onClick={() => setMode('tidy')}
        >
          整理已有物品
        </button>
      </div>

      {/* ================= 批量录入 ================= */}
      {isExtract ? (
        <div className="stack">
          <div className="field">
            <label className="field__label" htmlFor="ai-text">
              把要录入的东西一次性写在这里
            </label>
            <textarea
              id="ai-text"
              className="textarea ai-textarea"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={
                '随便怎么写都行，比如：\n\n' +
                '衣柜里有一件灰色的羊毛衫，还有两条牛仔裤。\n' +
                '床头柜上放着一个旧手机，已经不用了。\n' +
                '厨房的橱柜里有一个平底锅，大概两百块买的。'
              }
              disabled={running}
            />
            <div className="row-between wrap">
              <span className="field__hint">
                {text.trim() === ''
                  ? '写得越具体，AI 认出来的东西越准。提到位置和分类它会自动对上你已有的。'
                  : `共 ${text.trim().length} 字，将分成 ${chunks.length} 批识别`}
              </span>
              {text !== '' && !running ? (
                <Button size="sm" variant="ghost" onClick={() => setText('')}>
                  清空
                </Button>
              ) : null}
            </div>
          </div>

          <div className="row wrap">
            <Button
              variant="primary"
              size="lg"
              onClick={() => void runExtract()}
              disabled={running || text.trim() === '' || aiApiKey.trim() === ''}
            >
              {running ? '识别中…' : '开始识别'}
            </Button>
            {running ? <Button size="lg" onClick={cancel}>取消</Button> : null}
            {aiApiKey.trim() === '' ? (
              <span className="small dim">先在上面填入 API Key</span>
            ) : null}
          </div>

          {running ? <ProgressLine progress={progress} usage={usage} /> : null}

          {extractError !== null ? (
            <div className="notice notice--alert">
              <span className="notice__icon">
                <IconAlert />
              </span>
              <span className="notice__body">{extractError}</span>
            </div>
          ) : null}

          {!running && usage.totalTokens > 0 ? (
            <UsageLine usage={usage} />
          ) : null}

          {extractNotes.length > 0 ? (
            <div className="notice">
              <span className="notice__icon">
                <IconAlert />
              </span>
              <span className="notice__body">
                {extractNotes.map((note, index) => (
                  <div key={index}>{note}</div>
                ))}
              </span>
            </div>
          ) : null}

          {extractDrafts !== null && extractDrafts.length > 0 ? (
            <>
              <hr className="divider" />
              <AiExtractPreview drafts={extractDrafts} onChange={setExtractDrafts} />
              <div className="row wrap" style={{ paddingTop: 'var(--gap-3)' }}>
                <Button variant="primary" size="lg" onClick={applyExtract}>
                  确认录入 {extractDrafts.filter((d) => d.include).length} 件
                </Button>
                <Button size="lg" onClick={() => setExtractDrafts(null)}>
                  放弃
                </Button>
              </div>
            </>
          ) : null}

          {extractDrafts === null && !running && extractError === null && usage.totalTokens === 0 ? (
            <div className="ai-tips">
              <div className="ai-tips__title">怎么写效果最好</div>
              <ul>
                <li>一次写一个区域（一个抽屉、一个柜子），比一次铺开写整间屋子更容易对准位置。</li>
                <li>提到位置时用你已有的叫法，比如「衣柜」「床头柜」，AI 会自动对上你的位置树。</li>
                <li>说清楚数量：「两条牛仔裤」比「牛仔裤」更好。</li>
                <li>认出来的结果<strong>不会直接写进去</strong> —— 你可以在预览里逐条改完再确认。</li>
              </ul>
            </div>
          ) : null}
        </div>
      ) : (
        /* ================= 整理已有物品 ================= */
        <div className="stack">
          <div className="field">
            <span className="field__label">要整理哪些物品</span>
            <div className="picker-grid">
              {(
                [
                  ['active', '全部在用物品'],
                  ['idle', '仅闲置物品'],
                  ['uncategorized', '未分类的'],
                  ['unassigned', '未归位的'],
                  ['category', '某个分类…'],
                ] as Array<[TidyScope, string]>
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={`chip${scope === value ? ' is-active' : ''}`}
                  onClick={() => setScope(value)}
                >
                  {label}
                </button>
              ))}
            </div>

            {scope === 'category' ? (
              <select
                className="select"
                style={{ marginTop: 'var(--gap-2)', maxWidth: 260 }}
                value={scopeCategoryId}
                onChange={(e) => setScopeCategoryId(e.target.value)}
                aria-label="选择分类"
              >
                <option value="">请选择分类…</option>
                {[...data.categories]
                  .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'zh-CN'))
                  .map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
              </select>
            ) : null}

            <div className="field__hint">
              这个范围里有 <strong className="numeric">{scopeItems.length}</strong> 件物品
              {scopeItems.length > TIDY_MAX_ITEMS
                ? `，本次只处理前 ${TIDY_MAX_ITEMS} 件`
                : ''}
              。AI 只会对「明显可以改进」的给出建议，已经很合理的会跳过。
            </div>
          </div>

          <div className="row wrap">
            <Button
              variant="primary"
              size="lg"
              onClick={() => void runTidy()}
              disabled={running || scopeItems.length === 0 || aiApiKey.trim() === ''}
            >
              {running ? '整理中…' : '开始整理'}
            </Button>
            {running ? <Button size="lg" onClick={cancel}>取消</Button> : null}
          </div>

          {running ? <ProgressLine progress={progress} usage={usage} /> : null}

          {tidyError !== null ? (
            <div className="notice notice--alert">
              <span className="notice__icon">
                <IconAlert />
              </span>
              <span className="notice__body">{tidyError}</span>
            </div>
          ) : null}

          {!running && usage.totalTokens > 0 ? <UsageLine usage={usage} /> : null}

          {tidyDrafts !== null && tidyDrafts.length > 0 ? (
            <>
              <hr className="divider" />
              <AiTidyPreview drafts={tidyDrafts} onChange={setTidyDrafts} />
              <div className="row wrap" style={{ paddingTop: 'var(--gap-3)' }}>
                <Button variant="primary" size="lg" onClick={applyTidy}>
                  应用 {tidyDrafts.filter((d) => d.include).length} 项修改
                </Button>
                <Button size="lg" onClick={() => setTidyDrafts(null)}>
                  放弃
                </Button>
              </div>
            </>
          ) : null}

          {tidyDrafts === null && !running && tidyError === null && usage.totalTokens === 0 ? (
            <div className="ai-tips">
              <div className="ai-tips__title">这个功能会做什么</div>
              <ul>
                <li>把你已有的物品连同当前分类和位置一起发给 AI，让它提出更合理的归类。</li>
                <li>只会显示「有变化」的建议，没建议就说明现有的已经很合理。</li>
                <li>每条都是「当前 → 建议」的对照，逐条勾选后才写入。</li>
                <li>
                  最实用的起手式：选「未分类的」或「未归位的」，先把最乱的那批收拾干净。
                </li>
              </ul>
            </div>
          ) : null}
        </div>
      )}
    </>
  )
}

/* ------------------------------------------------------------------ */
/* 小片段                                                              */
/* ------------------------------------------------------------------ */

function ProgressLine({
  progress,
  usage,
}: {
  progress: { done: number; total: number } | null
  usage: AiUsage
}) {
  const percent = progress && progress.total > 0 ? (progress.done / progress.total) * 100 : 0

  return (
    <div className="ai-progress">
      <div className="row-between">
        <span className="small">
          {progress
            ? `正在识别第 ${Math.min(progress.done + 1, progress.total)} / ${progress.total} 批…`
            : '正在等待 DeepSeek 响应…'}
        </span>
        <span className="tiny dim numeric">已用 {usage.totalTokens} tokens</span>
      </div>
      <div className="ai-progress__track">
        <div className="ai-progress__fill" style={{ width: `${percent}%` }} />
      </div>
    </div>
  )
}

function UsageLine({ usage }: { usage: AiUsage }) {
  return (
    <div className="notice">
      <span className="notice__icon">
        <IconCheck />
      </span>
      <span className="notice__body small">
        本次共消耗 <strong className="numeric">{usage.totalTokens}</strong> tokens
        （输入 {usage.promptTokens} / 输出 {usage.completionTokens}）。
        乘以官方单价就是这次的实际花费 —— 我不在这里写死价格，因为官方调过几次。
      </span>
    </div>
  )
}
