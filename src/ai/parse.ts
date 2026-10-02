/**
 * 解析并校验 AI 返回的内容。
 *
 * 模型虽然开了 JSON 模式，实际仍可能带回代码围栏、前言、多余的解释文字，
 * 字段类型也可能不完全听话。这一层负责把所有不确定性挡在业务代码之外：
 * 能救的救，救不了的给出明确原因，绝不把半个坏对象塞进数据库。
 */

import { AiError } from './deepseek'
import { fill } from './promptText'
import { t } from '../i18n'
import { normalizeExpiryDate } from '../lib/expiry'

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
    throw new AiError('bad_response', t('data.ai.emptyResponse'))
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
    fill(t('data.ai.noJsonFound'), { snippet: raw.slice(0, 120) }),
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
  /** 有效期至（YYYY-MM-DD）；AI 没提到、或写的日期认不出来，都是 null */
  expiresAt: string | null
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
    // 有效期：AI 可能写成 expiresAt / expires / 有效期 / 过期时间，
    // 也可能写成「明年3月」这种认不出来的东西 —— 认不出来就是 null，
    // 绝不能把坏字符串塞进数据库，更不能瞎猜一个日期。
    expiresAt: normalizeExpiryDate(
      raw.expiresAt ?? raw.expires ?? raw.有效期 ?? raw.过期时间 ?? raw.expiryDate,
    ),
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
      t('data.ai.noItemList'),
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
/* 对话整理：AI 返回修改后的完整草稿                                    */
/* ------------------------------------------------------------------ */

export interface RawRevisedItem extends RawExtractedItem {
  /** 草稿里原来的 id；新增的物品由 AI 自己起一个 */
  id: string
  /** AI 认为该删掉这一条 */
  removed: boolean
}

/**
 * AI 请求「把哪些现有物品拉进草稿」。
 *
 * 为什么要有这个：把用户全部物品塞进 prompt 太贵（500 件就是一万多 token）。
 * 所以 system 里只放**目录**（分类/位置 + 件数），AI 真需要具体条目时再要。
 * 程序收到这个请求会把对应物品放进草稿，并**自动再问 AI 一轮**。
 */
export interface LoadScopeRequest {
  /** 全部在用物品（不含已舍弃） */
  all?: boolean
  idle?: boolean
  uncategorized?: boolean
  unassigned?: boolean
  /** 已过期 + 快过期的（快过期的天数阈值由界面偏好决定） */
  expiring?: boolean
  /** 只看已过期的 */
  expired?: boolean
  /** 设置了有效期的（不管过没过期） */
  hasExpiry?: boolean
  /** 这些分类下的（含子分类） */
  categoryPaths?: string[][]
  /** 这些位置下的（含子位置） */
  locationPaths?: string[][]
}

export interface ParsedChatResponse {
  reply: string
  /** 只有**新增或改动过**的条目 */
  items: RawRevisedItem[]
  /** 要删掉的物品 id */
  removedIds: string[]
  /** 请求先把这些现有物品拉进草稿 */
  loadScope: LoadScopeRequest | null
  /** AI 什么都没做（纯问答），草稿应原样保留 */
  noChanges: boolean
}

function normalizeRevisedItem(raw: unknown): RawRevisedItem | null {
  const base = normalizeExtractedItem(raw)
  if (!base || !isRecord(raw)) return null

  const id = asString(raw.id ?? raw.标识)
  if (id === '') return null

  return { ...base, id, removed: raw.removed === true || raw.删除 === true }
}

function normalizeLoadScope(raw: unknown): LoadScopeRequest | null {
  if (!isRecord(raw)) return null

  const scope: LoadScopeRequest = {}
  if (raw.all === true) scope.all = true
  if (raw.idle === true) scope.idle = true
  if (raw.uncategorized === true) scope.uncategorized = true
  if (raw.unassigned === true) scope.unassigned = true
  if (raw.expiring === true) scope.expiring = true
  if (raw.expired === true) scope.expired = true
  if (raw.hasExpiry === true) scope.hasExpiry = true

  const categories = asPathListOfLists(raw.categoryPaths ?? raw.categories)
  if (categories.length > 0) scope.categoryPaths = categories

  const locations = asPathListOfLists(raw.locationPaths ?? raw.locations)
  if (locations.length > 0) scope.locationPaths = locations

  // 一个字都没给，就不算请求
  const empty =
    !scope.all &&
    !scope.idle &&
    !scope.uncategorized &&
    !scope.unassigned &&
    !scope.expiring &&
    !scope.expired &&
    !scope.hasExpiry &&
    !scope.categoryPaths &&
    !scope.locationPaths
  return empty ? null : scope
}

/**
 * 解析对话模式的回复。
 *
 * 三类宽容是刻意的：
 *   · AI 只回一句话、不带任何改动（用户只是问了个问题）→ 不算错
 *   · AI 只要数据不给改动（loadScope）→ 是正常的一步
 *   · AI 偷懒把整份草稿都返回了 → 也能正常处理，只是多花点 token
 */
export function parseChatResponse(payload: unknown): ParsedChatResponse {
  if (!isRecord(payload)) {
    throw new AiError('bad_response', t('data.ai.badShape'))
  }

  const reply = asString(payload.reply ?? payload.说明 ?? payload.message)
  const loadScope = normalizeLoadScope(payload.loadScope ?? payload.拉取范围)

  const rawItems = payload.items ?? payload.物品 ?? payload.list
  const rawRemoved = payload.removedIds ?? payload.removed ?? payload.删除的id

  const removedIds = Array.isArray(rawRemoved)
    ? rawRemoved.map(asString).filter((id) => id !== '')
    : []

  if (!Array.isArray(rawItems) && removedIds.length === 0) {
    if (loadScope) return { reply, items: [], removedIds: [], loadScope, noChanges: false }
    if (reply !== '') {
      return { reply, items: [], removedIds: [], loadScope: null, noChanges: true }
    }
    throw new AiError('bad_response', t('data.ai.noReplyOrItems'))
  }

  const items: RawRevisedItem[] = []
  if (Array.isArray(rawItems)) {
    for (const raw of rawItems) {
      const item = normalizeRevisedItem(raw)
      if (item) items.push(item)
    }
  }

  return { reply, items, removedIds, loadScope, noChanges: false }
}
