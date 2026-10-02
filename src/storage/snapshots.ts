import type { AppData, Snapshot, SnapshotMeta, SnapshotReason } from '../types'
import { uid } from '../lib/id'
import { STORE_SNAPSHOTS, idbClear, idbDelete, idbDeleteMany, idbGet, idbGetAll, idbPut } from './idb'

/** 最多保留多少份快照 */
export const MAX_SNAPSHOTS = 30

/** 每种「非自动」原因至少保底保留几份，即使它们很旧 */
const RESERVED_NON_AUTO = 5

export const SNAPSHOT_REASON_LABEL: Record<SnapshotReason, string> = {
  auto: '自动',
  import: '导入前',
  manual: '手动备份',
  destructive: '删除前',
}

/** ISO 时间戳取到分钟，用于「同一分钟只留一份自动快照」的分桶 */
function minuteBucket(iso: string): string {
  return iso.slice(0, 16)
}

/** 列出全部快照的元信息，按时间从新到旧 */
export async function listSnapshots(): Promise<SnapshotMeta[]> {
  const all = await idbGetAll<Snapshot>(STORE_SNAPSHOTS)
  return all
    .map(({ id, at, reason, itemCount }): SnapshotMeta => ({ id, at, reason, itemCount }))
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
    itemCount: data.items.length,
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
