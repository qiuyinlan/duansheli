import type { AppData, Snapshot, SnapshotMeta, SnapshotReason } from '../types'
import { uid } from '../lib/id'
import { t } from '../i18n'
import { STORE_SNAPSHOTS, idbClear, idbDelete, idbDeleteMany, idbGet, idbGetAll, idbPut } from './idb'

/** 最多保留多少份快照 */
export const MAX_SNAPSHOTS = 30

/** 每种「非自动」原因至少保底保留几份，即使它们很旧 */
const RESERVED_NON_AUTO = 5

/**
 * 快照原因的说法，用在设置页的徽章上。
 *
 * 写成 getter 而不是普通属性：语言是运行时能切的，而这是个拿 `[reason]`
 * 直接取值的地方（`SNAPSHOT_REASON_LABEL[snap.reason]`），
 * 每次读都重新取词，切换语言后才不会留半截中文。
 */
export const SNAPSHOT_REASON_LABEL: Record<SnapshotReason, string> = {
  get auto() {
    return t('data.snapshot.reasonAuto')
  },
  get import() {
    return t('data.snapshot.reasonImport')
  },
  get manual() {
    return t('data.snapshot.reasonManual')
  },
  get destructive() {
    return t('data.snapshot.reasonDestructive')
  },
}

/** ISO 时间戳取到分钟，用于「同一分钟只留一份自动快照」的分桶 */
function minuteBucket(iso: string): string {
  return iso.slice(0, 16)
}

/** 列出全部快照的元信息，按时间从新到旧 */
export async function listSnapshots(): Promise<SnapshotMeta[]> {
  const all = await idbGetAll<Snapshot>(STORE_SNAPSHOTS)
  return all
    .map(({ id, at, reason, itemCount, data }): SnapshotMeta => ({
      id,
      at,
      reason,
      /*
       * 物品数**以 data 为准**，存的那份只是缓存。
       *
       * 为什么不信缓存：这个数字是用户决定「回退到哪一份」时唯一的依据
       * （issue 16：「设置里的快照显示的物品数量有误，我点击回退后发现
       * 物品数量跟上面显示的不一样」）。一个和内容对不上的数字，
       * 会让他在最需要判断的那一刻判断错。
       *
       * 老快照（或者被手工改过的备份）里可能没有 data.items —— 那就只能退回缓存值。
       */
      itemCount: Array.isArray(data?.items) ? data.items.length : itemCount,
    }))
    .sort((a, b) => b.at.localeCompare(a.at))
}

export async function getSnapshot(id: string): Promise<Snapshot | undefined> {
  return idbGet<Snapshot>(STORE_SNAPSHOTS, id)
}

export async function countSnapshots(): Promise<number> {
  const all = await idbGetAll<Snapshot>(STORE_SNAPSHOTS)
  return all.length
}

/**
 * 创建一份快照。
 *
 * 自动快照做了「同一分钟只留一份」的节流 —— 否则连续录入 20 件物品
 * 会瞬间产生 20 份几乎相同的快照，把存储塞满。
 * 非自动快照（导入前 / 删除前 / 手动）不受节流限制，永远照存。
 */
export async function createSnapshot(
  data: AppData,
  reason: SnapshotReason,
): Promise<Snapshot | null> {
  const at = new Date().toISOString()

  if (reason === 'auto') {
    const metas = await listSnapshots()
    const bucket = minuteBucket(at)
    if (metas.some((m) => m.reason === 'auto' && minuteBucket(m.at) === bucket)) {
      return null // 这一分钟已经存过了
    }
  }

  const snapshot: Snapshot = {
    id: uid(),
    at,
    reason,
    /*
     * 数一遍再写。**不要在调用方那边算、然后传进来** ——
     * 传进来的东西迟早会和 data 对不上，而这个数字是用户判断回退目标
     * 时唯一的依据（见 listSnapshots 里那段说明）。
     */
    itemCount: Array.isArray(data.items) ? data.items.length : 0,
    data,
  }

  await idbPut(STORE_SNAPSHOTS, snapshot)
  await pruneSnapshots()
  return snapshot
}

/**
 * 淘汰旧快照。
 * 规则：总数上限 MAX_SNAPSHOTS；先为每种非自动原因保底留 RESERVED_NON_AUTO 份，
 * 剩余名额再用最新的快照补满。
 */
export async function pruneSnapshots(): Promise<number> {
  const metas = await listSnapshots()
  if (metas.length <= MAX_SNAPSHOTS) return 0

  const keep = new Set<string>()
  const usedPerReason = new Map<SnapshotReason, number>()

  for (const m of metas) {
    if (m.reason === 'auto') continue
    const used = usedPerReason.get(m.reason) ?? 0
    if (used < RESERVED_NON_AUTO) {
      keep.add(m.id)
      usedPerReason.set(m.reason, used + 1)
    }
  }

  for (const m of metas) {
    if (keep.size >= MAX_SNAPSHOTS) break
    keep.add(m.id)
  }

  const remove = metas.filter((m) => !keep.has(m.id)).map((m) => m.id)
  if (remove.length > 0) await idbDeleteMany(STORE_SNAPSHOTS, remove)
  return remove.length
}

export async function deleteSnapshot(id: string): Promise<void> {
  await idbDelete(STORE_SNAPSHOTS, id)
}

export async function clearSnapshots(): Promise<void> {
  await idbClear(STORE_SNAPSHOTS)
}
