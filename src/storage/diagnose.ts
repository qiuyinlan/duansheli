/**
 * 本地数据体检。
 *
 * ── 为什么需要它 ──────────────────────────────────────────────────
 * 「我的数据没了」是这个应用最吓人的一句话，而它通常有三种完全不同的真相：
 *
 *   1. 数据好好的，只是你现在在**另一个网址**下（数据按网址隔离）
 *   2. 主记录真的没了，但**快照还在** —— 能一键找回
 *   3. 这个网址下确实什么都没存过
 *
 * 这三种情况在界面上长得一模一样（都是空列表），但处理方式完全不同。
 * 光靠猜没用，所以这里把「当前网址下到底有什么」直接读出来。
 *
 * ── 只读 ─────────────────────────────────────────────────────────
 * 这个模块**绝不写任何东西**。体检本身不能成为一次数据变更，
 * 否则「打开设置看看」都会悄悄产生快照。
 */

import type { AppData, Snapshot } from '../types'
import {
  APP_DATA_KEY,
  DB_NAME,
  STORE_APP,
  STORE_SNAPSHOTS,
  estimateUsage,
  idbGet,
  idbGetAll,
} from './idb'

/**
 * 体检结论。
 *
 *   ok         数据在，一切正常
 *   restorable 当前数据比快照少 —— 很可能能找回来
 *   empty      这个网址下从没存过数据
 *   unreadable 读的时候就出错了（浏览器不给读 / 库损坏）
 */
export type DiagnosisVerdict = 'ok' | 'restorable' | 'empty' | 'unreadable'

export interface DiagnosisSnapshotRef {
  id: string
  at: string
  itemCount: number
}

export interface LocalDiagnosis {
  /** 当前网址 —— 数据仓库的标识 */
  origin: string
  /** duansheli 这个库在不在。浏览器不支持查询时是 null（= 不知道） */
  dbExists: boolean | null
  app: {
    exists: boolean
    itemCount: number
    updatedAt: string | null
    schemaVersion: number | null
    readError: string | null
  }
  snapshots: {
    count: number
    newestAt: string | null
    oldestAt: string | null
    /** 所有快照里物品数的最大值 */
    maxItems: number
    /** 物品最多的那一份，供一键回退用 */
    best: DiagnosisSnapshotRef | null
    readError: string | null
  }
  usage: { usage: number; quota: number } | null
  /**
   * 这个网址下属于本应用的 localStorage **键名**（只有名，没有值 ——
   * 里面有一项是 API Key，绝不能读出来给人看）。
   */
  localKeys: string[]
  verdict: DiagnosisVerdict
}

/** localStorage 里本应用用的前缀，和 i18n / store 保持一致 */
const LOCAL_PREFIX = 'duansheli:'

/**
 * 体检要读的那几样东西。
 *
 * 抽成参数只有一个理由：**「读失败」这条分支在生产上没法按需触发**。
 * 而它恰恰是最要紧的一条 —— 读不出来和「本来就没有」在界面上必须分得开，
 * 否则这个体检自己也会变成第二个骗人的地方。注入一份会抛错的读法就能测它。
 */
export interface DiagnosisSource {
  getApp: () => Promise<AppData | undefined>
  getSnapshots: () => Promise<Snapshot[]>
  dbExists: () => Promise<boolean | null>
  estimate: () => Promise<{ usage: number; quota: number } | null>
}

const defaultSource: DiagnosisSource = {
  getApp: () => idbGet<AppData>(STORE_APP, APP_DATA_KEY),
  getSnapshots: () => idbGetAll<Snapshot>(STORE_SNAPSHOTS),
  dbExists: () => checkDbExists(),
  estimate: () => estimateUsage(),
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * 这个网址下存不存在 duansheli 库。
 *
 * `indexedDB.databases()` 不是所有浏览器都有（Firefox 较新版本才有），
 * 拿不到就返回 null，界面上说「查不了」比瞎猜一个结论强。
 */
async function checkDbExists(): Promise<boolean | null> {
  if (typeof indexedDB === 'undefined') return null
  const factory = indexedDB as IDBFactory & {
    databases?: () => Promise<Array<{ name?: string | null }>>
  }
  if (typeof factory.databases !== 'function') return null
  try {
    const list = await factory.databases()
    return list.some((db) => db.name === DB_NAME)
  } catch {
    return null
  }
}

/** 只收集键名。值是用户的东西，体检没有理由去看。 */
function readLocalKeys(): string[] {
  if (typeof localStorage === 'undefined') return []
  const keys: string[] = []
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i)
      if (key !== null && key.startsWith(LOCAL_PREFIX)) keys.push(key.slice(LOCAL_PREFIX.length))
    }
  } catch {
    return keys
  }
  return keys.sort()
}

/** 主记录里物品数的兜底：万一 items 不是数组，也不能让体检自己崩掉 */
function countItems(record: AppData | undefined): number {
  return Array.isArray(record?.items) ? record.items.length : 0
}

/** 快照里的物品数：优先信 itemCount，坏了就现场数一遍 data.items */
function snapshotItemCount(snap: Snapshot): number {
  if (typeof snap.itemCount === 'number' && Number.isFinite(snap.itemCount)) {
    return snap.itemCount
  }
  return Array.isArray(snap.data?.items) ? snap.data.items.length : 0
}

/**
 * 读一遍当前网址下的本地数据。
 *
 * 不抛错 —— 读失败本身就是一种结论（unreadable），如实报出来就行。
 */
export async function diagnoseLocalData(
  source: DiagnosisSource = defaultSource,
): Promise<LocalDiagnosis> {
  const origin = typeof window === 'undefined' ? '' : window.location.origin

  const result: LocalDiagnosis = {
    origin,
    dbExists: null,
    app: { exists: false, itemCount: 0, updatedAt: null, schemaVersion: null, readError: null },
    snapshots: {
      count: 0,
      newestAt: null,
      oldestAt: null,
      maxItems: 0,
      best: null,
      readError: null,
    },
    usage: null,
    localKeys: readLocalKeys(),
    verdict: 'empty',
  }

  result.usage = await source.estimate()

  /* ---------------- 主记录 ---------------- */
  try {
    const record = await source.getApp()
    if (record) {
      result.app = {
        exists: true,
        itemCount: countItems(record),
        updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : null,
        schemaVersion: typeof record.schemaVersion === 'number' ? record.schemaVersion : null,
        readError: null,
      }
    }
  } catch (err) {
    result.app.readError = errorText(err)
  }

  /* ---------------- 快照 ---------------- */
  try {
    const all = await source.getSnapshots()
    result.snapshots.count = all.length

    let best: DiagnosisSnapshotRef | null = null
    for (const snap of all) {
      if (typeof snap.at === 'string') {
        if (result.snapshots.newestAt === null || snap.at > result.snapshots.newestAt) {
          result.snapshots.newestAt = snap.at
        }
        if (result.snapshots.oldestAt === null || snap.at < result.snapshots.oldestAt) {
          result.snapshots.oldestAt = snap.at
        }
      }

      const count = snapshotItemCount(snap)
      if (count > result.snapshots.maxItems) result.snapshots.maxItems = count

      // 并列时取更新的那一份 —— 回退要回退到最近的状态
      if (best === null || count > best.itemCount || (count === best.itemCount && snap.at > best.at)) {
        best = { id: snap.id, at: snap.at, itemCount: count }
      }
    }
    result.snapshots.best = best
  } catch (err) {
    result.snapshots.readError = errorText(err)
  }

  /* ---------------- 结论 ---------------- */
  result.dbExists = await source.dbExists()

  const unreadable = result.app.readError !== null || result.snapshots.readError !== null

  if (unreadable) {
    result.verdict = 'unreadable'
  } else if (result.app.exists && (result.app.itemCount > 0 || result.snapshots.maxItems === 0)) {
    // 主记录在，而且要么有东西、要么本来就是个空库 —— 没什么可担心的。
    // 注意这里**不因为「快照比现在多」就报警**：删掉几件物品是正常操作，
    // 快照本来就会比当前状态多。只有「现在一件都没有」才值得喊。
    result.verdict = 'ok'
  } else if (result.snapshots.count > 0 && result.snapshots.maxItems > result.app.itemCount) {
    result.verdict = 'restorable'
  } else {
    result.verdict = 'empty'
  }

  return result
}
