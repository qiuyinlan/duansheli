/**
 * 解析并校验 AI 返回的内容。
 *
 * 模型虽然开了 JSON 模式，实际仍可能带回代码围栏、前言、多余的解释文字，
 * 字段类型也可能不完全听话。这一层负责把所有不确定性挡在业务代码之外：
 * 能救的救，救不了的给出明确原因，绝不把半个坏对象塞进数据库。
 */

import { AiError } from './deepseek'

/* ------------------------------------------------------------------ */
/* 从文本里抠出 JSON                                                   */
/* ------------------------------------------------------------------ */

const FENCE = /```(?:json|JSON)?\s*([\s\S]*?)```/

/** 找出第一个 { 到最后一个 } 之间的内容（应对模型加了前言/后记的情况） */
function sliceBraces(text: string): string | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  return text.slice(start, end + 1)
}

function sliceBrackets(text: string): string | null {
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start === -1 || end === -1 || end <= start) return null
  return text.slice(start, end + 1)
}

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/**
 * 尽量从模型输出里拿到一个 JSON 值。
 * 依次尝试：直接解析 → 去掉代码围栏 → 截取大括号 → 截取中括号。
 */
export function extractJson(raw: string): unknown {
  const text = raw.trim()
  if (text === '') {
    throw new AiError('bad_response', 'DeepSeek 返回了空内容。')
  }

  const direct = tryParse(text)
  if (direct !== undefined) return direct

  const fenced = FENCE.exec(text)
  if (fenced?.[1]) {
    const parsed = tryParse(fenced[1].trim())
    if (parsed !== undefined) return parsed
  }

  const braced = sliceBraces(text)
  if (braced) {
    const parsed = tryParse(braced)
    if (parsed !== undefined) return parsed
  }

  const bracketed = sliceBrackets(text)
  if (bracketed) {
    const parsed = tryParse(bracketed)
    if (parsed !== undefined) return parsed
  }

  throw new AiError(
    'bad_response',
    `没能从 AI 的回复里找到 JSON。原始回复开头是：${raw.slice(0, 120)}`,
  )
}

/* ------------------------------------------------------------------ */
/* 取值助手：字段缺失或类型不对时一律降级，而不是抛错                   */
/* ------------------------------------------------------------------ */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asString(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

/** 允许 "家 / 卧室" 这种字符串，也允许 ["家","卧室"] 这种数组 */
function asPathList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(asString).filter((part) => part !== '')
  }
  const text = asString(value)
  if (text === '') return []
  return text
    .split(/[/>»·]/)
    .map((part) => part.trim())
    .filter((part) => part !== '')
}

function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map(asString)
      .flatMap((part) => (part.includes(',') || part.includes('，') ? part.split(/[,，]/) : [part]))
      .map((part) => part.trim())
      .filter((part) => part !== '')
  }
  return asPathList(value)
}

function asQuantity(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(1, Math.round(value))
  }
  const text = asString(value)
  if (text === '') return 1
  // 常见的中文数字也认一下
  const numerals: Record<string, number> = {
    一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5,
    六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
  }
  if (numerals[text] !== undefined) return numerals[text]
  const parsed = Number.parseFloat(text)
  return Number.isFinite(parsed) ? Math.max(1, Math.round(parsed)) : 1
}

function asAttributeMap(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {}
  const out: Record<string, string> = {}
  for (const [key, raw] of Object.entries(value)) {
    const name = key.trim()
    if (name === '') continue
    const text = asString(raw)
    if (text === '') continue
    out[name] = text
  }
  return out
}

function uniq(values: string[]): string[] {
  return [...new Set(values)]
}

/**
 * 分类字段的解析。
 *
 * 分类现在是树，所以理想输出是「路径的数组」：`[["化妆品","眼妆"]]`。
 * 但模型有时会只给一组平铺的名字：`["衣物"]`，或者写成 `["化妆品/眼妆"]`。
 * 三种写法都要能认，所以统一成 `string[][]`。
 */
function asPathListOfLists(value: unknown): string[][] {
  if (value === null || value === undefined) return []

  if (!Array.isArray(value)) {
    const single = asPathList(value)
    return single.length > 0 ? [single] : []
  }

  const out: string[][] = []
  const seen = new Set<string>()
  for (const entry of value) {
    const path = asPathList(entry)
    if (path.length === 0) continue
    const key = path.join('/')
    if (seen.has(key)) continue
    seen.add(key)
    out.push(path)
  }
  return out
}

/* ------------------------------------------------------------------ */
/* 批量录入的结果                                                      */
/* ------------------------------------------------------------------ */

export interface RawExtractedItem {
  name: string
  quantity: number
  /** 每条是一条从顶层到末级的分类名称路径；AI 只给一个名字时就是单元素路径 */
  categoryPaths: string[][]
  /** 从顶层到末级的位置名称路径；没有提到位置就是 null */
  location: string[] | null
  tags: string[]
  /** 属性名 → 值，只可能命中已有属性名 */
  attributes: Record<string, string>
  note: string
}

export interface ParsedExtraction {
  items: RawExtractedItem[]
  /** 因为没有名称而被丢弃的条目数 */
  dropped: number
}

function normalizeExtractedItem(raw: unknown): RawExtractedItem | null {
  if (!isRecord(raw)) return null

  const name = asString(raw.name ?? raw.名称 ?? raw.item ?? raw.title)
  if (name === '') return null

  const location = asPathList(raw.location ?? raw.位置 ?? raw.locationPath)

  return {
    name,
    quantity: asQuantity(raw.quantity ?? raw.数量 ?? raw.count),
    categoryPaths: asPathListOfLists(raw.categories ?? raw.分类 ?? raw.category),
    location: location.length > 0 ? location : null,
    tags: uniq(asStringList(raw.tags ?? raw.标签 ?? raw.tag)),
    attributes: asAttributeMap(raw.attributes ?? raw.属性 ?? raw.attrs),
    note: asString(raw.note ?? raw.备注 ?? raw.remark),
  }
}

/**
 * 解析批量抽取结果。
 * 兼容三种常见形状：{items:[...]}、{物品:[...]}、直接一个数组。
 */
export function parseExtraction(payload: unknown): ParsedExtraction {
  let list: unknown[] | null = null

  if (Array.isArray(payload)) {
    list = payload
  } else if (isRecord(payload)) {
    const candidate =
      payload.items ?? payload.物品 ?? payload.list ?? payload.data ?? payload.result
    if (Array.isArray(candidate)) list = candidate
  }

  if (list === null) {
    throw new AiError(
      'bad_response',
      'AI 的回复里没有找到物品列表。可能是这段文字里没有可识别的物品。',
    )
  }

  const items: RawExtractedItem[] = []
  let dropped = 0
  for (const raw of list) {
    const item = normalizeExtractedItem(raw)
    if (item) items.push(item)
    else dropped++
  }

  return { items, dropped }
}

/* ------------------------------------------------------------------ */
/* 整理已有物品的结果                                                  */
/* ------------------------------------------------------------------ */

export interface RawAssignment {
  id: string
  categoryPaths: string[][]
  location: string[] | null
  reason: string
}

export function parseAssignments(payload: unknown): RawAssignment[] {
  let list: unknown[] | null = null

  if (Array.isArray(payload)) {
    list = payload
  } else if (isRecord(payload)) {
    const candidate =
      payload.assignments ?? payload.items ?? payload.物品 ?? payload.list ?? payload.data
    if (Array.isArray(candidate)) list = candidate
  }

  if (list === null) {
    throw new AiError('bad_response', 'AI 的回复里没有找到整理建议。')
  }

  const out: RawAssignment[] = []
  for (const raw of list) {
    if (!isRecord(raw)) continue
    const id = asString(raw.id ?? raw.物品id)
    if (id === '') continue
    const location = asPathList(raw.location ?? raw.位置)
    out.push({
      id,
      categoryPaths: asPathListOfLists(raw.categories ?? raw.分类 ?? raw.category),
      location: location.length > 0 ? location : null,
      reason: asString(raw.reason ?? raw.理由),
    })
  }
  return out
}
