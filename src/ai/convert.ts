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
  /**
   * 名字撞上了库里的某件东西时，用户选的那个「就是它」。
   *
   * 这个字段存在的唯一理由，就是 issue 2 那个 bug：用户说「我仓库里有」，
   * AI 却新建了一条一模一样的。有值 → 采纳时**更新**那件已有物品；
   * 没值且名字仍然撞着 → 界面上必须先问，程序自己不猜。
   *
   * 它是**用户的选择**，所以 AI 的每一轮返回都不该动它 —— 见
   * mergeChatResponse 里那一串「保留用户手动做过的选择」。
   */
  duplicateOf?: string
  /**
   * AI 说「这一条删掉」，而且用户还没点采纳 —— **待删**。
   *
   * ── 为什么是标记，而不是直接从草稿里删掉 ──────────────────────
   * 这里原来是「把这条草稿从数组里删掉」。那会造成一台很坑的戏：
   *
   *   AI：「已把「钱包卡片」下的 13 件物品全部移入回收站」
   *   用户：「ok，你帮我删除啊」
   *   AI：「已经全部移入回收站了」（其实一件都没动）
   *
   * 根因：条目一从草稿里消失，**下一轮 AI 就看不见它了**。用户接着催，
   * AI 手里那个草稿是空白的，它既不知道要删什么、也没有落库的能力，
   * 只能编一句「已经删了」。
   *
   * 打成标记之后：AI 下一轮明确看到「这 13 条带着 removed」，
   * 于是它说的是「等你点采纳」而不是「已经删好了」。
   *
   * 采纳时由 `draftsToApply` 把它变成真正的软删除（进回收站）；
   * 采纳完 `settleApplied` 才把它从草稿里移走 —— 那时它已经是事实了。
   */
  removed?: boolean
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
  /**
   * 计划里第 i 条对应哪一条草稿 —— 采纳之后要拿它去结算会话
   * （把已落库的草稿从预览里移走）。两边顺序一一对应。
   */
  planKeys: string[]
  /**
   * **计划里第 i 条**要更新哪件已有物品（而不是新建）。
   *
   * 和 plan / planKeys / appliedIds 同一套下标，可以直接喂给
   * `applyDraftItems({ duplicates })`。用计划下标而不是草稿下标是刻意的：
   * 计划会跳过「没勾选」和「还在等确认」的条目，两套下标混用会让确认
   * 落到别的条目上 —— 那种错位很难查，而且后果是「改错东西 / 又多一件」。
   */
  duplicates: Map<number, string>
  /** 被软删除的已有物品 id（移入回收站，可恢复） */
  discardIds: string[]
  /**
   * 用户要求删、但数据库里已经找不到的那些 id。
   *
   * 这些是**静默丢失**的入口：以前它们被 `filter` 一声不响地过滤掉，
   * 用户点了采纳、界面说「移入回收站 3」，其实一件都没动。
   * 现在数出来，界面上如实说一句。
   */
  missingDiscards: string[]
  /** 要被删的那些**还没落库**（AI 说要删，但用户还没点采纳） */
  pendingDiscards: number
  /** 已经被 AI 移出草稿、采纳时会真进回收站的草稿 key */
  discardKeys: string[]
  /** 已经是已有物品、且内容变了 → 会被更新 */
  updating: number
  /** 新录入的 → 会被创建 */
  creating: number
  /** 被删掉的已有物品数 */
  discarding: number
  /** 已有物品但内容没动 → 跳过，不去动它的 updatedAt */
  untouched: number
  /** 名字撞上已有物品的条目 —— 界面上必须先让用户选「改它」还是「另建一条新的」 */
  collisions: DraftNameCollision[]
}

/**
 * 一条「名字和库里已有物品撞了」的草稿。
 *
 * 这是 issue 2 的正脸：用户说「我仓库里有」，AI 却新建了一条一模一样的。
 * 这里把撞上的那件东西找出来，交给界面**逼用户点一下**：
 *   · 默认是**更新**那件已有的（`duplicateOf`），因为绝大多数情况下
 *     「我仓库里有」就是「改那一条」
 *   · 真想再放一件同名的（比如第二根充电线），界面上可以明确选「新建一条」
 * 绝不允许程序自己猜 —— 猜错了就是用户报的那个 bug：悄悄多出一件东西。
 */
export interface DraftNameCollision {
  draftKey: string
  draftName: string
  /** 撞上的那件已有物品 */
  existingId: string
  /** 已有物品现在的位置文字，帮用户确认「是不是同一件」 */
  existingLocationLabel: string
}

/** 名字比对用的归一化：去掉首尾空白、内部空白压成一个、大小写拉平 */
export function normName(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase()
}

/**
 * 名字撞车检查（只针对**要新建**的草稿）。
 *
 * 带 sourceItemId 的草稿本来就是「改这一条」，不存在撞车问题。
 */
export function findNameCollisions(
  drafts: ItemDraft[],
  currentItems: Item[],
  derived: DerivedContext,
): DraftNameCollision[] {
  const live = currentItems.filter((item) => item.status !== 'discarded')
  const byName = new Map<string, Item>()
  for (const item of live) {
    const key = normName(item.name)
    if (key !== '' && !byName.has(key)) byName.set(key, item)
  }

  const out: DraftNameCollision[] = []
  for (const draft of drafts) {
    if (!draft.include || draft.sourceItemId) continue
    const name = draft.name.trim()
    if (name === '') continue
    const existing = byName.get(normName(name))
    if (!existing) continue
    out.push({
      draftKey: draft.key,
      draftName: name,
      existingId: existing.id,
      existingLocationLabel: existing.locationId
        ? derived.index.pathString(existing.locationId, ' / ')
        : t('status.unassigned'),
    })
  }
  return out
}

/**
 * 草稿 → 落库计划。
 *
 * 三个关键点：
 *   · 带 sourceItemId 的走**更新**，不带的走**新建**
 *   · 已有物品里**内容没变的直接跳过** —— 否则你把 74 件药品拉进来只改了 3 件，
 *     落库时那 74 件的修改时间全被刷新，排序和「最近修改」就全乱了
 *   · 被移出草稿的已有物品 → **软删除**（进回收站），不是硬删
 *
 * ── collisionMode 是 issue 2 的那道闸 ────────────────────────────────
 * 要新建的草稿里，名字和库里某件东西撞上时：
 *   · 'ask'   —— 默认**不动**（列表里给 collisions，界面上必须让用户点头）。
 *                宁可什么都不做，也绝不悄悄多出一件重名的东西
 *   · 'update'—— 用户已经确认「就是它」→ 改成更新那一条
 *   · 'create'—— 用户明确说「就是要新建」→ 照新建（他可能真有两根一样的数据线）
 */
export function draftsToApply(
  drafts: ItemDraft[],
  currentItems: Item[],
  derived: DerivedContext,
  removedKeys: readonly string[] = [],
  collisionMode: 'ask' | 'update' | 'create' = 'ask',
  /**
   * 「计划里的第 i 条」= 落到哪件已有物品上。
   *
   * ⚠️ 下标是**传进来这批草稿**的下标，不是最后那份 plan 的下标。
   * 这一点很要紧：下面会按顺序把还留在候选里的草稿收进 plan，
   * 两套下标不小心混用的话，「哪条新建、哪条更新」会错位到别的条目上。
   */
  duplicates?: ReadonlyMap<number, string>,
): DraftApplyResult {
  const byId = new Map(currentItems.map((item) => [item.id, item]))
  const collisions = findNameCollisions(drafts, currentItems, derived)
  const collisionByKey = new Map(collisions.map((c) => [c.draftKey, c]))
  const plan: DraftApplyItem[] = []
  const planKeys: string[] = []
  /** 计划下标 → 要更新的已有物品 id（用计划下标，见 DraftApplyResult.duplicates） */
  const planDuplicates = new Map<number, string>()
  let updating = 0
  let creating = 0
  let untouched = 0

  drafts.forEach((draft, index) => {
    if (!draft.include || draft.name.trim() === '') return

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
      if (!existing) return // 期间被删了，跳过
      if (effectiveSignable(draft, derived) === itemSignature(existing, derived)) {
        untouched++
        return
      }
      plan.push({ ...entry, existingId: draft.sourceItemId })
      planKeys.push(draft.key)
      updating++
      return
    }

    // ---- 要新建的这一支：先看名字撞不撞，再看用户有没有定过 ----
    const collision = collisionByKey.get(draft.key)
    /*
     * `duplicateOf` = 用户已经点过界面上那个「就是它」，是**最明确**的一条指令；
     * 其次是调用方按条目注入的 `duplicates`（界面上的选择）；
     * 最后才是全局的 `collisionMode`。
     */
    const targetId =
      draft.duplicateOf ??
      duplicates?.get(index) ??
      (collisionMode === 'update' ? collision?.existingId : undefined)

    if (targetId !== undefined) {
      const existing = byId.get(targetId)
      if (existing) {
        plan.push({ ...entry, existingId: existing.id })
        planKeys.push(draft.key)
        planDuplicates.set(plan.length - 1, existing.id)
        updating++
        return
      }
      // 那件东西在这中间被删了 → 退回新建，免得整条丢掉
    } else if (collision !== undefined && collisionMode === 'ask') {
      return // 等用户点头，这一步什么都不做
    }

    plan.push(entry)
    planKeys.push(draft.key)
    creating++
  })
  /*
   * 要被软删的：
   *   · `removedKeys` —— 会话里累计的「要删」清单（AI 说删了的那些）
   *   · 草稿上带 `removed` 标记的 —— 同一条信息的另一份记录，
   *     只有确实指得到数据库里某件东西时才算数
   *
   * ⚠️ 这里**不能**一声不响地 filter 掉找不到的：用户点了采纳、
   * 界面说「移入回收站 3」，其实那 3 条早就不在了 —— 那就是
   * 「说做了、没做、还不说」。找不到的数出来交给界面。
   */
  const wantedDiscards = [...new Set([
    ...removedKeys,
    ...drafts.filter((draft) => draft.removed).map((draft) => draft.sourceItemId ?? draft.key),
  ])].filter((key) => key !== '')
  const discardIds = wantedDiscards.filter((key) => byId.has(key))
  const missingDiscards = wantedDiscards.filter((key) => !byId.has(key))

  return {
    plan,
    planKeys,
    duplicates: planDuplicates,
    discardIds,
    discardKeys: [...discardIds],
    missingDiscards,
    pendingDiscards: discardIds.length,
    updating,
    creating,
    discarding: discardIds.length,
    untouched,
    collisions,
  }
}

/* ------------------------------------------------------------------ */
/* 草稿与当前数据对齐（拉进来之后、以及每次落库之前都要跑一遍）          */
/* ------------------------------------------------------------------ */

export interface ReconcileResult {
  drafts: ItemDraft[]
  /** 有 sourceItemId、但那件物品已经不在库里的草稿数 */
  droppedSources: number
}

/**
 * 把草稿重新对齐到**当前**的数据上。
 *
 * 为什么必须有这一层：草稿是「针对某一份数据的计划」，而用户完全可能
 * 在聊天的同时自己删掉几件东西、或者用 AI 采纳了上一批。这时候草稿里的
 * `sourceItemId` 就指不到任何东西了，而 `draftsToApply` 对这种情况是
 * **静默跳过**的 —— 用户点「采纳」会得到一个悄悄少了几条的结果。
 *
 * 所以：指不到的，就地**摘掉那个标记**、变成一条普通的新建草稿，
 * 并且报出数量，界面上如实说一句。默默少做一部分是这个项目一直在避免的事。
 */
export function reconcileDrafts(
  drafts: ItemDraft[],
  currentItems: Item[],
  derived: DerivedContext,
): ReconcileResult {
  const live = new Map(
    currentItems.filter((item) => item.status !== 'discarded').map((item) => [item.id, item]),
  )
  let droppedSources = 0

  const next = drafts.map((draft) => {
    if (!draft.sourceItemId) return draft
    if (live.has(draft.sourceItemId)) return draft
    droppedSources++
    return {
      ...draft,
      sourceItemId: undefined,
      key: draft.key,
    }
  })

  // derived 目前只用来保证签名一致；留着这个参数是为了让调用方一眼看出
  // 「对齐这件事是跟数据有关的」，而不是纯粹的数组操作。
  void derived

  return { drafts: next, droppedSources }
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

  /*
   * 按名字找（issue 8 的主力）。
   *
   * 为什么必须有这一条：用户说「我仓库里有棉签」，而 AI 手里只有
   * 「哪个分类有多少件」的统计 —— 棉签可能在「日用」也可能在「药品」，
   * 它猜不到该拉哪一支，于是回一句「没找到」。用户看到的就是
   * 「我明明有，它说找不到」。
   *
   * 匹配用**子串**（忽略大小写和空白）：AI 说「棉签」，库里那条叫
   * 「碘伏棉签」也应该被拉进来 —— 这正是用户希望的那件事。
   * 宁可多拉几条让 AI 自己判断，也不要因为叫法差一点就找不到。
   */
  for (const name of scope.names ?? []) {
    const wanted = normName(name)
    if (wanted === '') continue
    add(live.filter((item) => normName(item.name).includes(wanted)))
  }

  return [...picked.values()]
}

