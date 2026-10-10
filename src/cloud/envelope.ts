/**
 * 云端信封 —— 同步的**数据格式**与**合并规则**，全是纯函数。
 *
 * 这个文件刻意不碰网络、不碰 store、不碰 IndexedDB：
 * 「两台设备的同一份数据怎么合」是整件事里最容易出错、也最需要被测试钉住的部分，
 * 把它隔离出来才能用普通的单元测试逐条验（见 tests/cloud.ts）。
 *
 * ── 信封里装什么 ──────────────────────────────────────────────────
 *   data     本体，就是导出的那份 AppData（不加任何字段进去 ——
 *            它还要能原样导出、原样导入，混进同步专用的字段会污染那两条路）
 *   deleted  删除墓碑：id → 删除时间
 *   deviceId 最后写这份信封的设备
 *   savedAt  写入时间
 *
 * ── 为什么非要删除墓碑不可 ────────────────────────────────────────
 * 合并算法（data/importData.ts 的 mergeAppData）有一条硬规矩：**只做加法**，
 * 本地有而对方没有的东西一律留着。这条规矩对「导入备份」是对的
 * （用户报过「合并反而让东西变少」），但对同步是灾难：
 * 在电脑上删掉一件东西，同步时手机会把它当成「我这儿有、你那儿没有」——原样加回来。
 * 于是删除变成了「删了又回来」。
 *
 * 所以删除必须**有痕迹地**传播：删掉一个东西时记一条墓碑，
 * 合并时「墓碑 → 把那条东西按下去」。墓碑本身也要合并（两台设备各删各的）。
 *
 * ── 时间怎么比 ────────────────────────────────────────────────────
 * 一条记录有「最后一次动它的时间」：
 *   · 物品有 updatedAt
 *   · 分类 / 位置 / 活动 / 清单 / 属性只有 createdAt
 * 墓碑只有在**比这个时间更新**时才生效。
 * 于是「删掉之后又在另一台设备上改了它」不会被静默抹掉 ——
 * 改动更晚，改动赢。这条和合并算法「updatedAt 较新者胜」是同一个原则。
 */

import type { AppData } from '../types'
import { SCHEMA_VERSION } from '../types'
import { mergeAppData } from '../data/importData'

/** 信封格式版本。结构变了就 +1，老客户端读到更高的版本会拒绝处理 */
export const ENVELOPE_VERSION = 1

/** 删除墓碑保留多久。超过这个时间没同步过的设备，删除可能失效（见 pruneTombstones） */
export const TOMBSTONE_TTL_DAYS = 180

export interface CloudEnvelope {
  v: number
  /** AppData 的结构版本 —— 老客户端不许往新数据上写 */
  schemaVersion: number
  data: AppData
  deleted: Record<string, string>
  deviceId: string
  savedAt: string
}

/** 会「被删掉」而且各带 id 的集合。标签没有 id（按名字走），所以不在里面 */
export const ID_COLLECTIONS = [
  'items',
  'categories',
  'locations',
  'attributeDefs',
  'collections',
  'checklists',
] as const

export type IdCollection = (typeof ID_COLLECTIONS)[number]

/** 只取「有 id 的集合」里那些节点 —— 合并、墓碑、比对都按这个形状写 */
interface TimedNode {
  id: string
  createdAt?: string
  updatedAt?: string
}

/**
 * 一条记录「最后一次被动过」的时间。
 *
 * 物品优先看 updatedAt（它才反映改动），其余集合只有 createdAt。
 * 都没有就返回空串 —— 空串比任何时间都小，于是「没有时间的记录」会被墓碑删掉，
 * 这是这里想要的保守结果。
 */
function nodeTime(node: TimedNode): string {
  return node.updatedAt ?? node.createdAt ?? ''
}

function nodesOf(data: AppData, key: IdCollection): TimedNode[] {
  const value = data[key]
  return Array.isArray(value) ? (value as unknown as TimedNode[]) : []
}

function idsOf(data: AppData, key: IdCollection): Set<string> {
  return new Set(nodesOf(data, key).map((node) => node.id))
}

/* ------------------------------------------------------------------ */
/* 信封构造与校验                                                      */
/* ------------------------------------------------------------------ */

export function makeEnvelope(
  data: AppData,
  deleted: Record<string, string>,
  deviceId: string,
  savedAt: string = new Date().toISOString(),
): CloudEnvelope {
  return { v: ENVELOPE_VERSION, schemaVersion: SCHEMA_VERSION, data, deleted, deviceId, savedAt }
}

export interface EnvelopeCheck {
  ok: boolean
  /** 不通过的原因（英文代号，由调用方翻成人话给用户看） */
  reason?: 'notObject' | 'versionTooNew' | 'badSchema' | 'badData' | 'badDeleted'
}

/**
 * 远端拿到的这份信封能不能用。
 *
 * 为什么非校验不可：远端那一行是**别的设备写上去的**，也可能是手工改坏的，
 * 甚至可能是以后某个更新版本写的。不校验就 merge 的话，形状不对的东西
 * 会一路混进本地数据 —— 而本地数据是用户唯一的那份东西。
 * 这里的默认答案必须是「宁可拒绝，不要合」。
 */
export function checkEnvelope(value: unknown): EnvelopeCheck {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, reason: 'notObject' }
  }
  const env = value as Partial<CloudEnvelope>

  if (typeof env.v !== 'number' || env.v > ENVELOPE_VERSION) {
    return { ok: false, reason: 'versionTooNew' }
  }
  if (typeof env.schemaVersion !== 'number' || env.schemaVersion > SCHEMA_VERSION) {
    return { ok: false, reason: 'badSchema' }
  }
  const data = env.data
  if (typeof data !== 'object' || data === null) return { ok: false, reason: 'badData' }
  for (const key of ID_COLLECTIONS) {
    if (!Array.isArray((data as unknown as Record<string, unknown>)[key])) {
      return { ok: false, reason: 'badData' }
    }
  }
  if (!Array.isArray((data as unknown as AppData).tags)) return { ok: false, reason: 'badData' }

  const deleted = env.deleted ?? {}
  if (typeof deleted !== 'object' || deleted === null || Array.isArray(deleted)) {
    return { ok: false, reason: 'badDeleted' }
  }
  for (const value of Object.values(deleted)) {
    if (typeof value !== 'string') return { ok: false, reason: 'badDeleted' }
  }

  return { ok: true }
}

/* ------------------------------------------------------------------ */
/* 比对                                                                */
/* ------------------------------------------------------------------ */

/**
 * 把值序列化成「和键的顺序无关」的字符串。
 *
 * ── 为什么不能直接用 JSON.stringify ──────────────────────────────
 * 远端那份数据是从 Postgres 的 **jsonb** 里取回来的，而 jsonb 存的是解析后的
 * 结构，**不保留键的书写顺序**（它会按长度、字节序重排）。
 * 于是「本地这份」和「刚从云端取回来的同一份」用 JSON.stringify 比出来是**不相等**的。
 *
 * 后果不是显示问题，是一个死循环：判断「没有变化 → 不用推」永远失败，
 * 每次同步都推一遍，推完再拉回来又觉得变了，一直推下去。
 *
 * 数组顺序**必须保留**（排序、清单条目的先后是有意义的），只排对象的键。
 */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(record[k])}`).join(',')}}`
}

/**
 * 把数据整理成「与顺序无关」的形状，专供内容比对用。
 *
 * ── 为什么非做这一步不可 ────────────────────────────────────────
 * 合并算法（mergeAppData）是「以当前这份为主、把对方新增的接到后面」。
 * 于是同一个结果，两台设备合出来的**数组顺序不一样**：
 *   电脑合： [原有…, 电脑新增的, 手机新增的]
 *   手机合： [原有…, 手机新增的, 电脑新增的]
 * 内容明明一致，按数组位置比就是「不相等」→ 判定有变化 → 推上去 →
 * 对方拉下来又判定有变化 → 再推……**两台设备会永远互推下去**，
 * 每次都顺手重写一遍本地数据。
 *
 * 所以比对必须按**集合**比：这几个集合的先后本身没有意义
 * （物品列表是当场按名称 / 时间 / 位置排出来的，不按数组顺序渲染），
 * 只有节点内部的字段才有意义 —— 树的 order、清单条目的先后都在字段里，不受影响。
 *
 * 标签只比**名字集合**：标签的 createdAt 是「第一次见到这个名字」的时间，
 * 两台设备各自加同一个标签时它必然不同，而它不影响任何显示。
 */
function comparableShape(data: AppData): unknown {
  const out: Record<string, unknown> = {}
  for (const key of ID_COLLECTIONS) {
    out[key] = [...nodesOf(data, key)].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  }
  out.tags = [...(Array.isArray(data.tags) ? data.tags : [])]
    .map((tag) => tag.name)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  return out
}

/**
 * 两份数据的**内容**是不是一样。
 *
 * 忽略 `updatedAt`：每次合并都会把它刷成「现在」（mergeAppData 就是这么写的），
 * 拿它比等于每合并一次都判定「变了」，又会绕回上面那个死循环。
 */
export function sameContent(a: AppData, b: AppData): boolean {
  return canonical(comparableShape(a)) === canonical(comparableShape(b))
}

export function sameTombstones(a: Record<string, string>, b: Record<string, string>): boolean {
  return canonical(a) === canonical(b)
}

/**
 * 「这份信封推上去有用吗」。
 *
 * 比的是**内容**，不比 deviceId / savedAt —— 那两个每次都不一样，
 * 拿它们比等于每次都推。
 */
export function sameEnvelopeContent(a: CloudEnvelope, b: CloudEnvelope): boolean {
  return sameContent(a.data, b.data) && sameTombstones(a.deleted, b.deleted)
}

/* ------------------------------------------------------------------ */
/* 删除墓碑                                                            */
/* ------------------------------------------------------------------ */

/**
 * 对比前后两份数据，把「消失了的 id」记成墓碑。
 *
 * 只在**本机自己的改动**里调用（见 sync.ts 的订阅）。合并结果落地时不能调用它，
 * 否则「别的设备删掉的东西」会被本机当成自己的删除再记一遍，来回传播。
 */
export function collectRemovals(
  prev: AppData,
  next: AppData,
  at: string,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const key of ID_COLLECTIONS) {
    const before = idsOf(prev, key)
    if (before.size === 0) continue
    const after = idsOf(next, key)
    for (const id of before) {
      if (!after.has(id)) out[id] = at
    }
  }
  return out
}

/** 两边各删各的 —— 按 id 取并集，同一个 id 保留更晚的那次删除时间 */
export function mergeTombstones(
  a: Record<string, string>,
  b: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = { ...b }
  for (const [id, at] of Object.entries(a)) {
    const existing = out[id]
    if (existing === undefined || at > existing) out[id] = at
  }
  return out
}

/**
 * 把墓碑落到实处：删掉「最后一次改动早于删除时间」的那些记录。
 *
 * 返回新的 data 和删掉了几条。**不改原对象**（合并结果要拿来和本地做比对）。
 */
export function applyTombstones(
  data: AppData,
  deleted: Record<string, string>,
): { data: AppData; removed: number } {
  const ids = Object.keys(deleted)
  if (ids.length === 0) return { data, removed: 0 }

  let removed = 0
  const next: AppData = { ...data }

  for (const key of ID_COLLECTIONS) {
    const nodes = nodesOf(data, key)
    let dirty = false
    const kept = nodes.filter((node) => {
      const at = deleted[node.id]
      if (at === undefined) return true
      // 删掉之后又被改过 → 改动赢，这条删除令作废（物品的 updatedAt 就是为这个用的）
      if (nodeTime(node) > at) return true
      removed++
      dirty = true
      return false
    })
    if (dirty) {
      // 这里必须换一个数组，不能就地改 —— data 可能是 store 里正在渲染的那份
      ;(next as unknown as Record<string, unknown>)[key] = kept
    }
  }

  if (removed === 0) return { data, removed: 0 }

  // 删掉分类 / 位置之后，物品上指向它们的引用就成了悬空引用
  // （分类页会显示成一个点不动的名字）。这里就地把引用摘掉，
  // 和导入校验里「悬空位置改为未归位」是同一种处理。
  const liveCategories = new Set(nodesOf(next, 'categories').map((n) => n.id))
  const liveLocations = new Set(nodesOf(next, 'locations').map((n) => n.id))
  const liveAttributes = new Set(nodesOf(next, 'attributeDefs').map((n) => n.id))
  const liveCollections = new Set(nodesOf(next, 'collections').map((n) => n.id))

  let itemsChanged = false
  const items = nodesOf(next, 'items').map((raw) => {
    const item = raw as unknown as AppData['items'][number]
    const categoryIds = item.categoryIds.filter((id) => liveCategories.has(id))
    const collectionIds = item.collectionIds.filter((id) => liveCollections.has(id))
    const locationId = item.locationId && !liveLocations.has(item.locationId) ? null : item.locationId
    const attrs: AppData['items'][number]['attrs'] = {}
    for (const [attrId, value] of Object.entries(item.attrs)) {
      if (liveAttributes.has(attrId)) attrs[attrId] = value
    }
    const same =
      categoryIds.length === item.categoryIds.length &&
      collectionIds.length === item.collectionIds.length &&
      locationId === item.locationId &&
      Object.keys(attrs).length === Object.keys(item.attrs).length
    if (same) return item
    itemsChanged = true
    return { ...item, categoryIds, collectionIds, locationId, attrs }
  })
  if (itemsChanged) next.items = items

  return { data: next, removed }
}

/**
 * 丢掉「已经不用再记」的墓碑。
 *
 * 两种可以丢：
 *   1. 那条记录已经不在数据里了，而且墓碑也够老了 —— 老到可以认为
 *      所有设备都同步过了。这是给墓碑总数封顶的，否则它只增不减。
 *   2. 那条记录还活着（因为它的改动时间比删除时间新，改动赢了）——
 *      这时候墓碑留着也没有意义，反而会在下次合并里再判一次。
 */
export function pruneTombstones(
  deleted: Record<string, string>,
  data: AppData,
  now: Date = new Date(),
): Record<string, string> {
  const cutoff = new Date(now.getTime() - TOMBSTONE_TTL_DAYS * 24 * 3600 * 1000).toISOString()
  const live = new Set<string>()
  for (const key of ID_COLLECTIONS) {
    for (const node of nodesOf(data, key)) {
      // 只有「改动时间比墓碑新」的才算复活，其余的就该被删掉，不能被这里误判成活
      const at = deleted[node.id]
      if (at !== undefined && nodeTime(node) > at) live.add(node.id)
    }
  }

  const out: Record<string, string> = {}
  for (const [id, at] of Object.entries(deleted)) {
    if (live.has(id)) continue
    if (at < cutoff) continue
    out[id] = at
  }
  return out
}

/* ------------------------------------------------------------------ */
/* 合并                                                                */
/* ------------------------------------------------------------------ */

export interface EnvelopeMerge {
  /** 合并之后的完整数据 */
  data: AppData
  /** 合并之后的墓碑 */
  deleted: Record<string, string>
  /** 数据内容和本地那份比，变了没有（变了才需要写回内存 / 落盘） */
  dataChanged: boolean
  /** 墓碑变了没有 */
  tombstonesChanged: boolean
  /** 被墓碑按下去的条数，用来在界面上说人话 */
  removed: number
  /** 合并过程中补建的分类 / 位置（importData 的报告） */
  warnings: string[]
}

/**
 * 把远端信封合进本地信封。
 *
 * 顺序很要紧：
 *   1. 先把两份数据**求并集**（复用导入那条路：id 去重、updatedAt 较新者胜、
 *      位置与分类按名称路径对齐、悬空引用补建）
 *   2. 再把墓碑**并起来**（两台设备各删各的，一条都不能丢）
 *   3. 最后让墓碑去按——**这一步必须在并集之后**。
 *      反过来的话，远端删掉的东西会先被墓碑按掉，
 *      接着又被并集当成「本地有、远端没有」加回来，删除就白删了。
 */
export function mergeEnvelopes(local: CloudEnvelope, remote: CloudEnvelope): EnvelopeMerge {
  const union = mergeAppData(local.data, remote.data)
  const merged = mergeTombstones(local.deleted, remote.deleted)
  const applied = applyTombstones(union.data, merged)
  const deleted = pruneTombstones(merged, applied.data)

  return {
    data: applied.data,
    deleted,
    dataChanged: !sameContent(applied.data, local.data),
    tombstonesChanged: !sameTombstones(deleted, local.deleted),
    removed: applied.removed,
    warnings: union.report.warnings,
  }
}

/**
 * 这份数据里有没有**物品**。
 *
 * 判断「要不要问用户用哪边」用的就是它（见 sync.ts）。为什么只看物品、
 * 不看分类和位置：一台新设备首次打开时会被铺一套脚手架（10 个分类、
 * 一整套位置树），但**物品是空的**。对用户来说那台设备就是「还没录东西」，
 * 不该拿「这台设备 vs 云端」这种二选一来吓他一下 —— 而且这时候合并
 * 只会做加法，本来也没有可丢的东西。
 */
export function hasAnyItems(data: AppData): boolean {
  return Array.isArray(data.items) && data.items.length > 0
}
