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
import { statusFromWords } from '../lib/statusWords'
import type { ItemStatus } from '../types'

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

/* ------------------------------------------------------------------ */
/* 状态：AI 能说的话                                                    */
/* ------------------------------------------------------------------ */

/**
 * AI **能**表达的状态。
 *
 * 「已舍弃」刻意不在这里 —— 它的正当路径是 `removedIds`（进回收站，可恢复）。
 * 让模型在一个数组元素里顺手说出「已舍弃」，等于把「扔东西」变成一个
 * 可以随口带出来的副作用，那太轻率了。
 */
export type AiStatus = Exclude<ItemStatus, 'discarded'>

/**
 * 解析出来的状态：`'discarded'` 是**单独一档**，因为它要被转成一次删除请求，
 * 不是被塞进物品的字段。
 */
export type RawStatus = ItemStatus | null

/**
 * 状态词的别名表搬到了 `lib/statusWords.ts`。
 *
 * 因为 CSV 导入那边也要认同一批词（导出时写的就是**界面上的词**），
 * 各写一份迟早会漂 —— 而「认不出来」的表现是状态悄悄没了，不是报错。
 */
function asAiStatus(value: unknown): RawStatus {
  return statusFromWords(value)
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
  /**
   * 状态（在用 / 闲置 / 备用）。
   *
   * 这个字段存在的理由就是那个 bug：用户说「这个改成闲置」，而输出格式里
   * 根本没有能装「闲置」的地方 —— 于是模型唯一能做的就是把它塞进 tags。
   * 有了这一栏，它才**有地方可放**。
   *
   * null = AI 没提状态（新建时按「在用」，改已有物品时保持原样）。
   */
  status: RawStatus
  /**
   * 活动的名字（旅行 / 学习 这类），只可能命中已有活动 —— 活动是用户
   * 自己维护的清单，不让模型随口造一个新的。
   */
  collections: string[]
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
    status: asAiStatus(raw.status ?? raw.状态),
    /*
     * 活动的别名里刻意**不含「清单」**。
     *
     * 清单（checklists）是另一件东西：一次性待办，用户在物品列表里勾选后
     * 自己建的。把 AI 说的「清单」当成活动，会把它塞进一个完全不同的实体里。
     */
    collections: uniq(asStringList(raw.collections ?? raw.活动 ?? raw.合集 ?? raw.所属活动)),
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
  /** 备用（特意囤着等用的那些） */
  spare?: boolean
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
  /**
   * **按名字找**。
   *
   * 这一条是给 issue 8 兜底的：用户说「我仓库里有棉签」，AI 却找不到 ——
   * 因为它手里只有「哪个分类有多少件」的统计，而棉签可能在「日用」也可能在
   * 「药品」，它猜不到该拉哪个分类。
   *
   * 有了这一条，它可以直接说「把名字里有『棉签』的都拉进来」，
   * 程序按名字子串匹配（忽略大小写和空格）。拉进来之后那些草稿**带着
   * sourceItemId**，于是下一轮改它们就是「更新」，不会再新建一件同名的。
   */
  names?: string[]
}

/**
 * 解析层眼里的分类改动：全是**名称路径**，没有一个 id。
 *
 * 和物品那边同一个规矩：AI 只认人话，程序负责翻译成 id ——
 * 让模型碰 id 只会让它编。
 */
export interface CategoryChangeIntent {
  kind: 'create' | 'rename' | 'move' | 'delete'
  path: string[]
  newName?: string
  newParentPath?: string[]
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
  /**
   * AI 想对**分类**做的改动。
   *
   * 用户要的能力：「我希望 ai 可以编辑分类，我可以让它帮我整理已有的分类。」
   *
   * 刻意和 items 那条路**分开**：分类是结构，改错了很难复原，
   * 而 items 那条路的语义是「这条物品长什么样」。混在一起的话，
   * 一个字段要同时表达「改这件物品」和「动这棵树」，解析和提示词都会含糊。
   *
   * 这一层只做**形状**解析。至于「这个路径指的是哪个分类、这件事能不能做」
   * 属于业务判断，要在**当时的分类树**上算 —— 交给 `ai/categoryEdit.ts`。
   */
  categoryChanges: CategoryChangeIntent[]
}

/**
 * 分类改动的形状解析。
 *
 * 宽容是刻意的（和物品那边一致）：模型可能写成
 * `{ kind, path, newName }`，也可能写成中文键名、或者把路径写成
 * `"衣物 / 眼妆"` 这种字符串。三种都认，认不出来就丢掉这一条 ——
 * 丢一条总比把半截坏对象塞进树里好。
 */
function normalizeCategoryChanges(raw: unknown): CategoryChangeIntent[] {
  if (!Array.isArray(raw)) return []
  const out: CategoryChangeIntent[] = []

  for (const entry of raw) {
    if (!isRecord(entry)) continue

    const kindText = asString(entry.kind ?? entry.action ?? entry.操作 ?? entry.动作).toLowerCase()
    const kind: CategoryChangeIntent['kind'] | null =
      kindText === 'create' || kindText === '新建' || kindText === 'add'
        ? 'create'
        : kindText === 'rename' || kindText === '改名' || kindText === '重命名'
          ? 'rename'
          : kindText === 'move' || kindText === '移动' || kindText === '挪动'
            ? 'move'
            : kindText === 'delete' || kindText === '删除' || kindText === 'remove'
              ? 'delete'
              : null
    if (kind === null) continue

    // 路径允许是数组，也允许是 "衣物 / 眼妆" 这种字符串
    let path = asPathList(entry.path ?? entry.分类 ?? entry.路径 ?? entry.name ?? entry.名称)
    const newName = asString(entry.newName ?? entry.新名字 ?? entry.改名后 ?? entry.rename)

    /*
     * 新建时模型常常只给名字、不给路径（`{kind:'create', newName:'衣服'}`）。
     * 那就把名字当作路径的末级 —— 也就是新建一个顶层分类。
     */
    if (path.length === 0 && newName !== '') path = [newName]
    if (path.length === 0) continue

    const parentRaw = entry.newParentPath ?? entry.parentPath ?? entry.父级 ?? entry.上级分类
    /*
     * 父级这一项的解析有个**必须区分**的地方：
     *   · 字段根本没出现 → `undefined`（= 没提这件事）
     *   · 出现了但是空数组（或者空字符串）→ `[]`（= 明确提出「挪到顶层」）
     * 混起来的话，AI 想说「提到顶层」的那个请求会变成什么都不做，
     * 而用户看到的是「它说改了、界面上没变」。
     */
    const parentPresent = parentRaw !== undefined && parentRaw !== null
    const newParentPath = parentPresent
      ? asPathList(parentRaw).filter((part) => part !== '')
      : undefined

    out.push({
      kind,
      path,
      ...(newName !== '' ? { newName } : {}),
      ...(newParentPath !== undefined ? { newParentPath } : {}),
    })
  }

  return out
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
  if (raw.spare === true) scope.spare = true
  if (raw.uncategorized === true) scope.uncategorized = true
  if (raw.unassigned === true) scope.unassigned = true
  if (raw.expiring === true) scope.expiring = true
  if (raw.expired === true) scope.expired = true
  if (raw.hasExpiry === true) scope.hasExpiry = true

  const categories = asPathListOfLists(raw.categoryPaths ?? raw.categories)
  if (categories.length > 0) scope.categoryPaths = categories

  const locations = asPathListOfLists(raw.locationPaths ?? raw.locations)
  if (locations.length > 0) scope.locationPaths = locations

  const names = asStringList(raw.names ?? raw.search ?? raw.名称 ?? raw.名字)
  if (names.length > 0) scope.names = names

  // 一个字都没给，就不算请求
  const empty =
    !scope.all &&
    !scope.idle &&
    !scope.spare &&
    !scope.uncategorized &&
    !scope.unassigned &&
    !scope.expiring &&
    !scope.expired &&
    !scope.hasExpiry &&
    !scope.categoryPaths &&
    !scope.locationPaths &&
    !scope.names
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
  const categoryChanges = normalizeCategoryChanges(
    payload.categoryChanges ?? payload.分类改动 ?? payload.categories_edit,
  )

  const removedIds = Array.isArray(rawRemoved)
    ? rawRemoved.map(asString).filter((id) => id !== '')
    : []

  /*
   * 「什么都没做」的判定要把分类改动算进去。
   *
   * 漏了它的话，「只整理分类」那一轮会被当成纯问答（noChanges），
   * 界面上只会显示一句话，分类改动**被默默丢掉** ——
   * 用户看到的是「AI 说改好了、但树没变」。
   */
  if (!Array.isArray(rawItems) && removedIds.length === 0 && categoryChanges.length === 0) {
    if (loadScope) {
      return { reply, items: [], removedIds: [], loadScope, noChanges: false, categoryChanges }
    }
    if (reply !== '') {
      return {
        reply,
        items: [],
        removedIds: [],
        loadScope: null,
        noChanges: true,
        categoryChanges,
      }
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

  return { reply, items, removedIds, loadScope, noChanges: false, categoryChanges }
}
