/**
 * Prompt 构建。
 *
 * 结果好不好用，八成取决于这里 —— 核心是**把用户已有的分类和位置树一起发过去**，
 * 让 AI 优先复用，而不是天马行空地自创一套跟现有数据对不上的词汇。
 */

import type { AppData, TreeItem } from '../types'
import { UNASSIGNED_ID, UNCATEGORIZED_ID } from '../types'
import type { DerivedContext } from '../store/selectors'
import {
  countByCategoryIncludingDescendants,
  countByLocationIncludingDescendants,
} from '../store/selectors'
import type { TreeIndex, TreeNode } from '../lib/tree'
import type { ChatMessage } from './deepseek'
import { fill, promptText } from './promptText'

/* ------------------------------------------------------------------ */
/* 上下文（用户现有的分类 / 位置 / 属性 / 标签）                        */
/* ------------------------------------------------------------------ */

export interface AiContext {
  /** 每条是一条从顶层到末级的分类名称路径，如 ['化妆品','眼妆'] */
  categoryPaths: string[][]
  /** 每条都是一个完整位置名称路径，如 ['家','卧室','衣柜'] */
  locationPaths: string[][]
  attributes: string[]
  tags: string[]
  /** 是否因为太多而被截断（界面上要如实提示） */
  truncated: boolean
}

/**
 * 用户现有物品的「目录」：每个分类 / 位置下有多少件。
 *
 * 这一份是给对话模式用的 —— 让 AI 在用户说「把药品改成…」时，
 * 知道「药品」是什么、有多少件，从而能主动要求把这些条目拉进来。
 * 只放名字和数量，很便宜（20 个分类约一百多 token），
 * 而且因为放在 system 里、前缀稳定，能命中缓存。
 */
export interface InventoryDigest {
  totalItems: number
  categories: Array<{ path: string[]; count: number }>
  /** 没有分类的物品数 */
  uncategorized: number
  locations: Array<{ path: string[]; count: number }>
  /** 没有位置的物品数 */
  unassigned: number
  idle: number
}

export interface ContextLimits {
  categories: number
  locations: number
  attributes: number
  tags: number
}

const DEFAULT_LIMITS: ContextLimits = {
  categories: 60,
  locations: 250,
  attributes: 30,
  tags: 40,
}

export function buildAiContext(
  data: AppData,
  derived: DerivedContext,
  limits: ContextLimits = DEFAULT_LIMITS,
): AiContext {
  // 分类和位置都是树，都按**显示顺序**输出完整路径 —— 层级本身就是重要信息
  const categoryPaths = derived.categoryFlat.map((node) =>
    derived.categoryIndex.pathNames(node.node.id),
  )
  const locationPaths = derived.flat.map((node) => derived.index.pathNames(node.node.id))

  const attributeNames = [...data.attributeDefs]
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'zh-CN'))
    .map((d) => d.name)

  const tagNames = data.tags.map((t) => t.name)

  const truncated =
    categoryPaths.length > limits.categories ||
    locationPaths.length > limits.locations ||
    attributeNames.length > limits.attributes ||
    tagNames.length > limits.tags

  return {
    categoryPaths: categoryPaths.slice(0, limits.categories),
    locationPaths: locationPaths.slice(0, limits.locations),
    attributes: attributeNames.slice(0, limits.attributes),
    tags: tagNames.slice(0, limits.tags),
    truncated,
  }
}

function listOrEmpty(values: string[], emptyHint: string): string {
  return values.length > 0 ? values.join(promptText().ctxListSeparator) : emptyHint
}

export function renderContextBlock(ctx: AiContext): string {
  const p = promptText()
  const categories = ctx.categoryPaths.map((path) => path.join(' / ')).join('\n')
  const locations = ctx.locationPaths.map((path) => path.join(' / ')).join('\n')

  return [
    p.ctxCategoriesHead,
    p.ctxNoteIntro,
    p.ctxNote1,
    p.ctxNote2a,
    p.ctxNote2b,
    p.ctxNote2c,
    ctx.categoryPaths.length > 0 ? categories : p.ctxCategoriesEmpty,
    '',
    p.ctxLocationsHead,
    p.ctxLocationsNote,
    ctx.locationPaths.length > 0 ? locations : p.ctxLocationsEmpty,
    '',
    p.ctxAttributesHead,
    listOrEmpty(ctx.attributes, p.ctxAttributesEmpty),
    '',
    p.ctxTagsHead,
    listOrEmpty(ctx.tags, p.ctxTagsEmpty),
    ctx.truncated ? `\n${p.ctxTruncated}` : '',
  ]
    .filter((line) => line !== '')
    .join('\n')
}

/* ------------------------------------------------------------------ */
/* 现有物品的目录（对话模式用）                                          */
/* ------------------------------------------------------------------ */

/** 每个节点下的物品数（含子孙），以及「未分类 / 未归位」的数量 */
export function buildInventoryDigest(data: AppData, derived: DerivedContext): InventoryDigest {
  const live = data.items.filter((item) => item.status !== 'discarded')

  // 这两个函数已经算好了「含子孙的合计」和「未分类 / 未归位」的计数，直接复用
  const categoryCounts = countByCategoryIncludingDescendants(live, derived)
  const locationCounts = countByLocationIncludingDescendants(live, derived)

  const toEntries = <T extends TreeItem>(
    index: TreeIndex<T>,
    flat: TreeNode<T>[],
    counts: Map<string, number>,
  ): Array<{ path: string[]; count: number }> =>
    flat
      .filter((node) => (counts.get(node.node.id) ?? 0) > 0)
      .map((node) => ({
        path: index.pathNames(node.node.id),
        count: counts.get(node.node.id) ?? 0,
      }))

  return {
    totalItems: live.length,
    categories: toEntries(derived.categoryIndex, derived.categoryFlat, categoryCounts),
    uncategorized: categoryCounts.get(UNCATEGORIZED_ID) ?? 0,
    locations: toEntries(derived.index, derived.flat, locationCounts),
    unassigned: locationCounts.get(UNASSIGNED_ID) ?? 0,
    idle: live.filter((item) => item.status === 'idle').length,
  }
}

/**
 * 把目录渲染成给 AI 看的一段文字。
 * 只放名字和数量，不放具体条目 —— 具体条目等 AI 要的时候再拉。
 */
export function renderInventoryDigest(digest: InventoryDigest): string {
  const p = promptText()

  if (digest.totalItems === 0) {
    return p.digestEmpty
  }

  const renderList = (entries: Array<{ path: string[]; count: number }>, empty: string) =>
    entries.length > 0
      ? entries
          .map((entry) => fill(p.digestEntry, { path: entry.path.join(' / '), count: entry.count }))
          .join(p.ctxListSeparator)
      : empty

  const categories = renderList(digest.categories, p.digestNoCategories)
  const locations = renderList(digest.locations, p.digestNoLocations)

  return [
    fill(p.digestTitle, { total: digest.totalItems }),
    fill(p.digestByCategory, { list: categories }),
    digest.uncategorized > 0 ? fill(p.digestUncategorized, { count: digest.uncategorized }) : '',
    fill(p.digestByLocation, { list: locations }),
    digest.unassigned > 0 ? fill(p.digestUnassigned, { count: digest.unassigned }) : '',
    digest.idle > 0 ? fill(p.digestIdle, { count: digest.idle }) : '',
    '',
    p.digestFootnote1,
    p.digestFootnote2,
  ]
    .filter((line) => line !== '')
    .join('\n')
}

/* ------------------------------------------------------------------ */
/* 一、从自由文字里批量抽取物品                                        */
/* ------------------------------------------------------------------ */

/**
 * 抽取用的 messages。
 *
 * 提示词本身（角色、规则、全部示例）在 src/ai/promptText/ 下按语言分开存放 ——
 * 提示词是 AI 质量的地基，两种语言各留一份完整的，比混排更可靠。
 */
export function buildExtractionMessages(
  context: AiContext,
  chunkText: string,
  chunkInfo?: { index: number; total: number },
): ChatMessage[] {
  const p = promptText()
  const header =
    chunkInfo && chunkInfo.total > 1
      ? fill(p.extractChunkHeader, { index: chunkInfo.index, total: chunkInfo.total })
      : ''

  return [
    { role: 'system', content: p.extractionSystem },
    {
      role: 'user',
      content: [
        renderContextBlock(context),
        '',
        header,
        p.extractInputLabel,
        '<<<',
        chunkText,
        '>>>',
      ]
        .filter((line) => line !== '')
        .join('\n'),
    },
  ]
}

/* ------------------------------------------------------------------ */
/* 分批                                                                */
/* ------------------------------------------------------------------ */

/**
 * 按行把长文本切成若干段，每段不超过 maxChars。
 *
 * 为什么要切：一次塞进去，输出 JSON 会因为 max_tokens 被截断，
 * 而截断的 JSON 是解析不了的 —— 用户会以为「AI 认不出来」，
 * 实际是结果被砍掉了后半截。
 */
export function splitIntoChunks(text: string, maxChars: number): string[] {
  const trimmed = text.trim()
  if (trimmed === '') return []
  if (trimmed.length <= maxChars) return [trimmed]

  const chunks: string[] = []
  let current = ''

  const flush = () => {
    if (current.trim() !== '') chunks.push(current.trim())
    current = ''
  }

  for (const line of trimmed.split(/\r?\n/)) {
    // 单独一行就超长，硬切开
    if (line.length > maxChars) {
      flush()
      let index = 0
      while (index < line.length) {
        const piece = line.slice(index, index + maxChars)
        index += maxChars
        if (index < line.length) chunks.push(piece)
        else current = piece
      }
      continue
    }

    if (current !== '' && current.length + line.length + 1 > maxChars) flush()
    current = current === '' ? line : `${current}\n${line}`
  }

  flush()
  return chunks
}

/** 把物品列表按每批多少个切开 */
export function chunkItems<T>(items: T[], size: number): T[][] {
  if (size <= 0) return [items]
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out.length > 0 ? out : [[]]
}
