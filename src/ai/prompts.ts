/**
 * Prompt 构建。
 *
 * 结果好不好用，八成取决于这里 —— 核心是**把用户已有的分类和位置树一起发过去**，
 * 让 AI 优先复用，而不是天马行空地自创一套跟现有数据对不上的词汇。
 */

import type { AppData } from '../types'
import type { DerivedContext } from '../store/selectors'
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
/* 二、整理已有物品                                                    */
/* ------------------------------------------------------------------ */

export interface TidyInputItem {
  id: string
  name: string
  quantity: number
  /** 当前分类的完整名称路径 */
  categoryPaths: string[][]
  /** 完整位置路径字符串，未归位时为 null */
  locationPath: string | null
  tags: string[]
}

const TIDY_SYSTEM = `你是「断舍离」的物品整理助手。
用户会给你一批他已经录入的物品，请你为其中「明显可以改进」的，建议更合适的分类和位置。

输出格式（一个 json 对象，不要输出任何解释性文字）：
{
  "assignments": [
    {
      "id": "原样返回物品的 id，一个字都不能改",
      "categories": [["衣物"]],
      "location": ["家", "卧室", "衣柜"],
      "reason": "不超过 15 个字的中文理由"
    }
  ]
}

规则：
1. id 必须原样返回，不能修改、不能遗漏、不能编造。
2. categories 是一个**二维数组**，每一项是一条分类路径（从顶层到末级）。
   分类是多级的，物品可以挂在任意一级。
   如果物品当前的分类**明显不合适**（比如「口红」被归到了「日用品」），
   就改成正确的路径 —— **该新建就新建**，不要因为清单里没有就把错就错。
   除此之外，优先复用【已有分类】里语义相符的，不要造同义词。
3. location 只能从【已有位置】里挑，输出名称路径。拿不准就填 null。
4. **只对明显可以改进的物品给出建议。** 已经很合理的直接跳过，
   不要为了显得有用而硬改。宁可少给建议，也不要给错的建议。
5. reason 用不超过 15 个字说明为什么这么改。`

export function buildTidyMessages(
  context: AiContext,
  items: TidyInputItem[],
  chunkInfo?: { index: number; total: number },
): ChatMessage[] {
  const lines = items.map((item) =>
    [
      `id: ${item.id}`,
      `名称: ${item.name}`,
      item.quantity > 1 ? `数量: ${item.quantity}` : '',
      `当前分类: ${
        item.categoryPaths.length > 0
          ? item.categoryPaths.map((path) => path.join(' / ')).join('、')
          : '（未分类）'
      }`,
      `当前位置: ${item.locationPath ?? '（未归位）'}`,
      item.tags.length > 0 ? `标签: ${item.tags.join('、')}` : '',
    ]
      .filter((line) => line !== '')
      .join(' | '),
  )

  const header =
    chunkInfo && chunkInfo.total > 1
      ? `这是第 ${chunkInfo.index} / ${chunkInfo.total} 批，只处理下面这些物品。`
      : ''

  return [
    { role: 'system', content: TIDY_SYSTEM },
    {
      role: 'user',
      content: [
        renderContextBlock(context),
        '',
        header,
        '【待整理的物品】',
        ...lines,
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
