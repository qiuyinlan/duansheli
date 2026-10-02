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
  return values.length > 0 ? values.join('、') : emptyHint
}

export function renderContextBlock(ctx: AiContext): string {
  const categories = ctx.categoryPaths.map((path) => path.join(' / ')).join('\n')
  const locations = ctx.locationPaths.map((path) => path.join(' / ')).join('\n')

  return [
    '【已有分类】（categories 优先从这里挑，用「化妆品 / 眼妆」这样的完整路径，不要造同义词）',
    '注意两点：',
    '① 分类是多级的，物品可以挂在任意一级，所以单独一个「化妆品」也是合法的。',
    '② 如果原文自己写了归类名（如「化妆品：」），必须用它 —— 即使不在下面这个清单里。',
    '   下面这些只是「可以复用的选项」，不是「必须从中二选一的选项」。',
    '   宁可新建一个分类，也不要把东西塞进不相干的已有分类。',
    ctx.categoryPaths.length > 0
      ? categories
      : '（还没有分类，你可以自由创建，但每一级的名字都要短而通用）',
    '',
    '【已有位置】（location 必须从下面这些路径里挑，或者输出 null）',
    '位置同样可以挂在任意一级，路径从顶层写起。',
    ctx.locationPaths.length > 0 ? locations : '（还没有位置，请一律输出 null）',
    '',
    '【已有属性】（attributes 的 key 只能使用下面这些名字）',
    listOrEmpty(ctx.attributes, '（还没有属性，请把 attributes 输出为空对象）'),
    '',
    '【已有标签】（可以参考，也可以新增）',
    listOrEmpty(ctx.tags, '（还没有标签）'),
    ctx.truncated ? '\n（注意：上面的清单因为太长做了截断，可能不完整）' : '',
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
  if (digest.totalItems === 0) {
    return '【你现有的物品】一件都还没有。'
  }

  const categories =
    digest.categories.length > 0
      ? digest.categories.map((entry) => `${entry.path.join(' / ')}（${entry.count}）`).join('、')
      : '（没有任何分类）'

  const locations =
    digest.locations.length > 0
      ? digest.locations.map((entry) => `${entry.path.join(' / ')}（${entry.count}）`).join('、')
      : '（没有任何位置）'

  return [
    `【你现有的物品】共 ${digest.totalItems} 件（不含已舍弃）`,
    `· 按分类：${categories}`,
    digest.uncategorized > 0 ? `· 其中未分类 ${digest.uncategorized} 件` : '',
    `· 按位置：${locations}`,
    digest.unassigned > 0 ? `· 其中未归位 ${digest.unassigned} 件` : '',
    digest.idle > 0 ? `· 其中标记为闲置 ${digest.idle} 件` : '',
    '',
    '注意：上面只是**统计**，你手里还没有这些物品的具体条目。',
    '要修改它们，你需要用 loadScope 先让程序把它们拉进来（见下面的说明）。',
  ]
    .filter((line) => line !== '')
    .join('\n')
}

/* ------------------------------------------------------------------ */
/* 一、从自由文字里批量抽取物品                                        */
/* ------------------------------------------------------------------ */

const EXTRACTION_SYSTEM = `你是「断舍离」这款个人物品整理工具里的录入助手。
用户会给你一段自然语言（可能是清单，也可能是一段随口描述），
你要从中抽取出物品，并输出严格的 json。

输出格式（一个 json 对象，不要输出任何解释性文字）：
{
  "items": [
    {
      "name": "灰色羊毛衫",
      "quantity": 1,
      "categories": [["衣物"]],
      "location": ["家", "卧室", "衣柜"],
      "tags": ["舍不得扔"],
      "attributes": { "品牌": "某品牌" },
      "note": ""
    }
  ]
}

抽取规则：
1. name 要具体。原文只写「毛衣」时，结合上下文补全为「灰色羊毛衫」这类可辨认的名字。
   但不要编造原文没有依据的信息（没有依据就不要写颜色、品牌）。
2. quantity：原文说「三双袜子」就是 3；没提到数量就填 1。
3. categories 是一个**二维数组** —— 每一项是一条分类路径，从顶层写到末级。
   例如 [["化妆品","眼妆"]] 表示这件东西归到「化妆品」下面的「眼妆」。
   按这个**优先级**决定用哪条路径：

   a) **原文自己给出了归类名** —— 比如写了「化妆品：」「药：」「衣柜里的：」这样的标题 ——
      就**必须**用那个名字作为分类，**即使它不在【已有分类】里**。
      那是用户自己写的意图，比你从清单里挑一个更可信。
   b) 原文没给归类时，再看【已有分类】里有没有**语义相符**的。
   c) 都没有，才自己起一条新路径；每一级的名字都要短而通用。

   **绝对不要为了避开新建分类，就把物品塞进一个不相干的已有分类。**
   把「口红」归到「日用品」是错的，正确做法是新建「化妆品」。
   分类清单里的名字只是「可以复用的选项」，不是「必须从中二选一的选项」。

   如果原文的归类比较宽（比如只写了「化妆品」），而里面的东西明显能再分
   （眼影、口红、卸妆），就写成两级路径，例如 ["化妆品","眼妆"]、["化妆品","唇妆"]。
   分类是多级的，物品也可以只挂在上一层，所以 [["化妆品"]] 同样合法。
   一件物品允许有多个分类，但大多数情况一个就够。
4. location 必须从【已有位置】里挑，输出从顶层到末级的名称数组。
   位置同样可以挂在任意一级。
   原文没有提到位置就填 null —— 不要猜、不要编。
5. tags：记录「情境」而不是「是什么」，例如 想送人、待维修、舍不得扔。没有就填 []。
6. attributes：key 只能使用【已有属性】里的名字。原文没提到相关信息就不要写这一项。
7. note：原文里关于这件物品的补充说明，例如「妈妈送的」「有点漏水」。没有就填空字符串。
8. 不要把一件物品拆成多条，也不要把描述同一件物品的几句话拆开。
9. 如果这段文字里完全没有物品信息，返回 {"items": []}。`

export function buildExtractionMessages(
  context: AiContext,
  chunkText: string,
  chunkInfo?: { index: number; total: number },
): ChatMessage[] {
  const header =
    chunkInfo && chunkInfo.total > 1
      ? `这是用户输入的第 ${chunkInfo.index} / ${chunkInfo.total} 段，只处理这一段里的物品。`
      : ''

  return [
    { role: 'system', content: EXTRACTION_SYSTEM },
    {
      role: 'user',
      content: [
        renderContextBlock(context),
        '',
        header,
        '【待识别的文字】',
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
