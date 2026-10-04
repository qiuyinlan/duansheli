/**
 * 把 AI 的原始输出对齐到用户现有的数据上。
 *
 * AI 只会给你「分类名」「位置名称路径」这类自然语言，而数据库里存的是 id。
 * 这一层负责：
 *   · 名称路径 → id 的匹配
 *   · 匹配不上的，标记为「AI 建议的新分类 / 新位置」，交给用户决定要不要建
 *   · 把本地不存在的属性名丢掉，避免污染数据
 *
 * 分类和位置现在都是树，匹配逻辑一模一样，所以用同一套 PathMatcher。
 */

import type { AppData, Item, TreeItem } from '../types'
import { EXPIRY_SOON_DEFAULT_DAYS, isExpired, isExpiring } from '../lib/expiry'
import { t } from '../i18n'
import type { DerivedContext } from '../store/selectors'
import { itemsInCategory, itemsInLocation } from '../store/selectors'
import type { DraftApplyItem } from '../store/useAppStore'
import type { TreeIndex } from '../lib/tree'
import { uid } from '../lib/id'
import type { LoadScopeRequest, AiStatus, RawExtractedItem } from './parse'

/* ------------------------------------------------------------------ */
/* 路径匹配                                                            */
/* ------------------------------------------------------------------ */

export interface PathMatcher {
  /** 完整路径（'化妆品/眼妆'）→ id */
  byPath: Map<string, string>
  /**
   * 路径后缀 → id 集合。
   * AI 有时只输出部分层级（给「眼妆」而不是「化妆品 / 眼妆」），
   * 用后缀能对上；但**只有当后缀唯一时**才敢用，有歧义就交给用户决定。
   */
  bySuffix: Map<string, Set<string>>
}

export interface MatchContext {
  categories: PathMatcher
  locations: PathMatcher
  /** 属性名（归一化）→ 真实属性名 */
  attributeRealName: Map<string, string>
  /**
   * 活动名（归一化）→ 活动 id。
   *
   * 活动是**平的**（没有层级），所以不需要 PathMatcher 那一套
   * 完整路径 / 后缀的降级匹配 —— 名字对得上就是它。
   */
  collections: Map<string, string>
}

function buildPathMatcher<T extends TreeItem>(index: TreeIndex<T>): PathMatcher {
  const byPath = new Map<string, string>()
  const bySuffix = new Map<string, Set<string>>()

  for (const node of index.byId.values()) {
    const rawPath = index.pathNames(node.id)
    if (rawPath.length === 0) continue

    // 每一段都做归一化（去首尾空格），否则 AI 写「 衣物 」就匹配不上了
    const path = rawPath.map(norm)
    byPath.set(path.join('/'), node.id)

    // 收录这条路径的所有真后缀：['化妆品','眼妆'] 会收录 '眼妆'
    for (let start = 1; start < path.length; start++) {
      const key = path.slice(start).join('/')
      const bucket = bySuffix.get(key)
      if (bucket) bucket.add(node.id)
      else bySuffix.set(key, new Set([node.id]))
    }
  }

  return { byPath, bySuffix }
}

const norm = (value: string) => value.trim()

export function createMatchContext(data: AppData, derived: DerivedContext): MatchContext {
  const attributeRealName = new Map<string, string>()
  for (const def of data.attributeDefs) {
    const key = norm(def.name)
    if (key !== '' && !attributeRealName.has(key)) attributeRealName.set(key, def.name)
  }

  return {
    categories: buildPathMatcher(derived.categoryIndex),
    locations: buildPathMatcher(derived.index),
    attributeRealName,
    collections: buildCollectionMatcher(data),
  }
}

/** 活动名 → id。同名活动理论上不该存在，真撞了就认第一个，不猜。 */
function buildCollectionMatcher(data: AppData): Map<string, string> {
  const out = new Map<string, string>()
  for (const collection of data.collections) {
    const key = norm(collection.name)
    if (key !== '' && !out.has(key)) out.set(key, collection.id)
  }
  return out
}

/**
 * 路径匹配，三级降级：
 *   1. 完整路径精确匹配
 *   2. 把 AI 给的路径当作已有路径的**后缀**匹配 —— 但只在后缀唯一时才用
 *   3. 都不行 → 返回 null，由调用方标记成「新建」
 *
 * 刻意**不做**「路径对不上就退回按末级名称找」——
 * 那看起来更"聪明"，实际很危险：AI 说「家 / 车库 / 货架」，
 * 而你树里另有一处「家 / 储物间 / 货架」，按名称匹配就会把东西
 * 悄悄挪到储物间去。宁可标成新建让你自己决定，也不要猜。
 *
 * 第 2 条之所以敢做，是因为它要求「唯一」：有歧义的一律不猜。
 */
function matchPath(path: string[], matcher: PathMatcher): string | null {
  // 跟 buildPathMatcher 用同一套归一化，否则「 衣物 」这种带空格的就对不上
  const normalized = path.map(norm).filter((part) => part !== '')
  if (normalized.length === 0) return null

  const key = normalized.join('/')
  const exact = matcher.byPath.get(key)
  if (exact) return exact

  const suffix = matcher.bySuffix.get(key)
  if (suffix && suffix.size === 1) return [...suffix][0]

  return null
}

/* ------------------------------------------------------------------ */
/* 一、批量录入的草稿                                                  */
/* ------------------------------------------------------------------ */

export interface ItemDraft {
  key: string
  /**
   * 有值 = 这条草稿来自**已经录入的物品**（值就是那件物品的 id）。
   * 采纳时会**更新**它，而不是新建一条。
   * 没值 = 这次新录入的，采纳时创建。
   */
  sourceItemId?: string
  name: string
  quantity: number
  /** 匹配到的已有位置的 id；没匹配上就是 null */
  locationId: string | null
  /** 展示用的位置文字 */
  locationLabel: string
  /** AI 给出、但本地还没有的位置路径 */
  newLocationPath: string[] | null
  matchedCategoryIds: string[]
  /** AI 建议、但本地还没有的分类路径（每条是从顶层到末级的名字） */
  newCategoryPaths: string[][]
  tags: string[]
  /** 只保留本地确实存在的属性名 */
  attrs: Record<string, string>
  /** 被丢掉的属性名（本地没有这个属性），界面上如实提示 */
  droppedAttrs: string[]
  note: string
  /** 有效期至（YYYY-MM-DD）；null = 没设置 */
  expiresAt: string | null
  /**
   * 状态（在用 / 闲置 / 备用）。
   *
   * 为什么草稿里非要有这一栏：用户说「这件改成闲置」，AI 得有地方放它。
   * 以前没有这一栏，模型只能把它塞进 tags —— 这就是那个 bug。
   *
   * `null` = **AI 没提到状态**，和「在用」是两回事：
   *   · 改已有物品时没提到 → 保留原来的状态（否则 AI 只改个名字，
   *     就会把一件闲置的东西悄悄变回「在用」）
   *   · 新建时没提到 → 按「在用」
   * 所以这里不能拿 'active' 当缺省值 —— 那正是上面那个坑。
   */
  status: AiStatus | null
  /** 匹配到的活动 id（活动是受控词表，只认已有的） */
  matchedCollectionIds: string[]
  /** 被丢掉的活动名（本地没有这个活动），界面上如实提示 */
  droppedCollections: string[]

  include: boolean
  /** 是否采纳 AI 建议的新分类（默认否 —— 分类是受控词表，得你点头） */
  adoptNewCategories: boolean
  /** 是否采纳 AI 建议的新位置 */
  adoptNewLocation: boolean
}

export function toItemDraft(
  raw: RawExtractedItem,
  ctx: MatchContext,
  derived: DerivedContext,
): ItemDraft {
  const locationId = raw.location ? matchPath(raw.location, ctx.locations) : null
  const newLocationPath = raw.location && !locationId ? raw.location : null

  const matchedCategoryIds: string[] = []
  const newCategoryPaths: string[][] = []
  for (const path of raw.categoryPaths) {
    const id = matchPath(path, ctx.categories)
    if (id) {
      if (!matchedCategoryIds.includes(id)) matchedCategoryIds.push(id)
    } else if (path.length > 0) {
      newCategoryPaths.push(path)
    }
  }

  const attrs: Record<string, string> = {}
  const droppedAttrs: string[] = []
  for (const [name, value] of Object.entries(raw.attributes)) {
    const realName = ctx.attributeRealName.get(norm(name))
    if (realName) attrs[realName] = value
    else droppedAttrs.push(name)
  }

  /*
   * 活动：只认已有的，**不新建**。
   *
   * 和分类的处理刻意不一样：分类允许 AI 提议新的（因为用户原文里的归类名
   * 是他自己的意图，而且界面上有「采纳新分类」的勾选让他点头）。
   * 活动没有这一层 —— 它是用户自己攒的「要凑齐哪些东西」的清单，
   * 让模型随口造一个，他会发现自己多出一堆从没建过的活动。
   * 认不出来的名字如实记进 droppedCollections，界面上提示出来，
   * 而不是默默丢掉。
   */
  const matchedCollectionIds: string[] = []
  const droppedCollections: string[] = []
  for (const name of raw.collections) {
    const id = ctx.collections.get(norm(name))
    if (id) {
      if (!matchedCollectionIds.includes(id)) matchedCollectionIds.push(id)
    } else {
      droppedCollections.push(name)
    }
  }

  const locationLabel = locationId
    ? derived.index.pathString(locationId, ' / ')
    : newLocationPath
      ? `${newLocationPath.join(' / ')}${t('common.newSuffix')}`
      : t('status.unassigned')

  return {
    key: uid(),
    name: raw.name,
    quantity: raw.quantity,
    locationId,
    locationLabel,
    newLocationPath,
    matchedCategoryIds,
    newCategoryPaths,
    tags: raw.tags,
    attrs,
    droppedAttrs,
    note: raw.note,
    expiresAt: raw.expiresAt,
    /*
     * 状态：**AI 没提就是 null**（不是「在用」）。
     *
     * 「已舍弃」也走 null —— 解析层把它单独拎出来了（RawStatus 里的
     * 'discarded'），由 mergeChatResponse 转成一次删除请求。
     */
    status: raw.status === null || raw.status === 'discarded' ? null : raw.status,
    matchedCollectionIds,
    droppedCollections,
    include: true,
    adoptNewCategories: false,
    adoptNewLocation: false,
  }
}

/* ------------------------------------------------------------------ */
/* 把已有物品拿进草稿（对话模式改现有数据用）                            */
/* ------------------------------------------------------------------ */

/** 物品的属性值：id 存的，发给 AI 要换成属性名 */
function attrNamesOf(item: Item, derived: DerivedContext): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [defId, value] of Object.entries(item.attrs)) {
    if (value === null || value === undefined || value === '') continue
    const def = derived.attrDefById.get(defId)
    if (def) out[def.name] = String(value)
  }
  return out
}

/**
 * 把数据库里的物品转成草稿。
 *
 * 用**物品自己的 id** 当草稿 key —— 这样下一轮发给 AI 的 id 就是稳定的，
 * AI 改完返回时也能对上，采纳时才知道该更新哪一件。
 */
export function draftsFromItems(
  items: Item[],
  ctx: MatchContext,
  derived: DerivedContext,
): ItemDraft[] {
  /*
   * 已舍弃的进不了草稿：草稿的状态栏只有 在用/闲置/备用 三档，
   * 硬塞进来要么编译不过，要么被悄悄改成「在用」—— 那等于让一件
   * 已经扔掉的东西复活。现成的调用方本来就只传没舍弃的
   * （itemsForLoadScope 会过滤），这里再挡一道。
   */
  return items
    .filter((item) => item.status !== 'discarded')
    .map((item) => {
      const draft = toItemDraft(
        {
          name: item.name,
          quantity: item.quantity,
          categoryPaths: item.categoryIds
            .map((id) => derived.categoryIndex.pathNames(id))
            .filter((path) => path.length > 0),
          location: item.locationId ? derived.index.pathNames(item.locationId) : null,
          tags: item.tags,
          attributes: attrNamesOf(item, derived),
          note: item.note,
          expiresAt: item.expiresAt,
          status: item.status,
          collections: item.collectionIds
            .map((id) => derived.collectionById.get(id)?.name)
            .filter((name): name is string => name !== undefined),
        },
        ctx,
        derived,
      )
      return { ...draft, key: item.id, sourceItemId: item.id }
    })
}

/** 一条草稿「要是落库，最终会写成什么」的指纹 */
function effectiveSignable(draft: ItemDraft, derived: DerivedContext): string {
  const locations = [
    ...draft.matchedCategoryIds.map((id) => derived.categoryIndex.pathNames(id).join('/')),
    ...(draft.adoptNewCategories
      ? draft.newCategoryPaths.map((path) => path.join('/'))
      : []),
  ]
    .filter(Boolean)
    .sort()
    .join('|')

  const location = draft.locationId
    ? derived.index.pathNames(draft.locationId).join('/')
    : draft.adoptNewLocation && draft.newLocationPath
      ? draft.newLocationPath.join('/')
      : ''

  return [
    draft.name.trim(),
    String(draft.quantity),
    locations,
    location,
    [...draft.tags].sort().join('|'),
    Object.entries(draft.attrs)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join('|'),
    draft.note.trim(),
    // 有效期也要进指纹。漏了它就会出这种鬼事：
    // AI 只把有效期改了，指纹没变 → 判定「没改动」→ 跳过 → 用户的修改凭空消失。
    draft.expiresAt ?? '',
    // 状态同理，而且更严重：用户说「这件改成闲置」，AI 乖乖填了 status，
    // 要是指纹里没有它，就会被判成「没改动」直接跳过 ——
    // 界面上什么都不会发生，用户只会觉得 AI 又没听懂。
    draft.status ?? '',
    // 活动同理：只加了活动、别的都没动，也是一种改动
    draft.matchedCollectionIds
      .map((id) => derived.collectionById.get(id)?.name ?? id)
      .sort()
      .join('|'),
  ].join('\u0000')
}

/** 已有物品的指纹（直接看数据库里那条） */
function itemSignature(item: Item, derived: DerivedContext): string {
  return [
    item.name.trim(),
    String(item.quantity),
    item.categoryIds
      .map((id) => derived.categoryIndex.pathNames(id).join('/'))
      .filter(Boolean)
      .sort()
      .join('|'),
    item.locationId ? derived.index.pathNames(item.locationId).join('/') : '',
    [...item.tags].sort().join('|'),
    Object.entries(item.attrs)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${derived.attrDefById.get(key)?.name ?? key}=${String(value)}`)
      .join('|'),
    item.note.trim(),
    item.expiresAt ?? '',
    item.status,
    item.collectionIds
      .map((id) => derived.collectionById.get(id)?.name ?? id)
      .sort()
      .join('|'),
  ].join('\u0000')
}

export interface DraftApplyResult {
  plan: DraftApplyItem[]
  /** 要软删除的已有物品 id（移入回收站，可恢复） */
  discardIds: string[]
  /** 已经是已有物品、且内容变了 → 会被更新 */
  updating: number
  /** 新录入的 → 会被创建 */
  creating: number
  /** 被删掉的已有物品数 */
  discarding: number
  /** 已有物品但内容没动 → 跳过，不去动它的 updatedAt */
  untouched: number
}

/**
 * 草稿 → 落库计划。
 *
 * 三个关键点：
 *   · 带 sourceItemId 的走**更新**，不带的走**新建**
 *   · 已有物品里**内容没变的直接跳过** —— 否则你把 74 件药品拉进来只改了 3 件，
 *     落库时那 74 件的修改时间全被刷新，排序和「最近修改」就全乱了
 *   · 被移出草稿的已有物品 → **软删除**（进回收站），不是硬删
 */
export function draftsToApply(
  drafts: ItemDraft[],
  currentItems: Item[],
  derived: DerivedContext,
  removedKeys: readonly string[] = [],
): DraftApplyResult {
  const byId = new Map(currentItems.map((item) => [item.id, item]))
  const plan: DraftApplyItem[] = []
  let updating = 0
  let creating = 0
  let untouched = 0

  for (const draft of drafts) {
    if (!draft.include || draft.name.trim() === '') continue

    const categoryPaths = [
      ...draft.matchedCategoryIds.map((id) => derived.categoryIndex.pathNames(id)),
      ...(draft.adoptNewCategories ? draft.newCategoryPaths : []),
    ].filter((path) => path.length > 0)

    const locationPath = draft.locationId
      ? derived.index.pathNames(draft.locationId)
      : draft.adoptNewLocation && draft.newLocationPath
        ? draft.newLocationPath
        : null

    const entry: DraftApplyItem = {
      name: draft.name.trim(),
      quantity: draft.quantity,
      categoryPaths,
      locationPath,
      tags: draft.tags,
      attrs: draft.attrs,
      note: draft.note,
      expiresAt: draft.expiresAt,
      // undefined = 没提到 → applyDraftItems 会保留物品原来的状态
      status: draft.status ?? undefined,
      collectionIds: draft.matchedCollectionIds,
    }

    if (draft.sourceItemId) {
      const existing = byId.get(draft.sourceItemId)
      if (!existing) continue // 期间被删了，跳过
      if (effectiveSignable(draft, derived) === itemSignature(existing, derived)) {
        untouched++
        continue
      }
      plan.push({ ...entry, existingId: draft.sourceItemId })
      updating++
      continue
    }

    plan.push(entry)
    creating++
  }

  // 只有确实存在于数据库里的 key 才去软删，AI 编的 id 一律忽略
  const discardIds = removedKeys.filter((key) => byId.has(key))

  return { plan, discardIds, updating, creating, discarding: discardIds.length, untouched }
}

/* ------------------------------------------------------------------ */
/* 按 AI 的请求挑出现有物品（loadScope）                                 */
/* ------------------------------------------------------------------ */

/** 名称路径 → id。跟匹配规则一样保守：完整路径优先，其次后缀唯一，有歧义就不选。 */
function resolvePathToId<T extends TreeItem>(path: string[], index: TreeIndex<T>): string | null {
  const wanted = path.map((part) => part.trim()).filter((part) => part !== '')
  if (wanted.length === 0) return null

  const exact = [...index.byId.values()].find(
    (node) => index.pathNames(node.id).join('/') === wanted.join('/'),
  )
  if (exact) return exact.id

  const suffixMatches = [...index.byId.values()].filter((node) => {
    const names = index.pathNames(node.id)
    if (names.length < wanted.length) return false
    const tail = names.slice(names.length - wanted.length)
    return tail.every((name, i) => name === wanted[i])
  })

  return suffixMatches.length === 1 ? (suffixMatches[0] as TreeItem).id : null
}

/**
 * 把 AI 的 loadScope 请求解析成实际物品。
 *
 * 几种条件取**并集**：AI 说「药品下的和未分类的」，两块都要。
 * 同一件物品命中多个条件只会出现一次。
 */
export function itemsForLoadScope(
  scope: LoadScopeRequest,
  data: AppData,
  derived: DerivedContext,
  /** 「快过期」的天数阈值。从界面偏好传进来，默认 30 —— 见 lib/expiry.ts */
  soonDays: number = EXPIRY_SOON_DEFAULT_DAYS,
): Item[] {
  const live = data.items.filter((item) => item.status !== 'discarded')
  const picked = new Map<string, Item>()
  const add = (items: Item[]) => {
    for (const item of items) picked.set(item.id, item)
  }

  if (scope.all) add(live)
  if (scope.idle) add(live.filter((item) => item.status === 'idle'))
  if (scope.spare) add(live.filter((item) => item.status === 'spare'))
  if (scope.uncategorized) {
    add(live.filter((item) => item.categoryIds.filter((id) => derived.categoryIndex.has(id)).length === 0))
  }
  if (scope.unassigned) {
    add(live.filter((item) => !item.locationId || !derived.index.has(item.locationId)))
  }
  if (scope.hasExpiry) add(live.filter((item) => item.expiresAt !== null))
  if (scope.expired) add(live.filter((item) => isExpired(item.expiresAt)))
  if (scope.expiring) {
    add(live.filter((item) => isExpiring(item.expiresAt, soonDays)))
  }

  for (const path of scope.categoryPaths ?? []) {
    const id = resolvePathToId(path, derived.categoryIndex)
    if (id) add(itemsInCategory(live, id, true, derived))
  }

  for (const path of scope.locationPaths ?? []) {
    const id = resolvePathToId(path, derived.index)
    if (id) add(itemsInLocation(live, id, true, derived))
  }

  return [...picked.values()]
}

