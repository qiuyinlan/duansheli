import type { AppData } from '../types'
import { t } from '../i18n'
import { LocalRepository } from './localRepository'

/**
 * 存储层抽象 —— 应用程序只认这个接口，不关心数据实际存在哪。
 *
 * ── 现状：只有一个实现，而且这不影响云端同步 ──────────────────────
 * 这里原先写着「v2 接 Supabase 时只需新增一个 SupabaseRepository 实现，
 * 业务代码零改动」。真做同步时发现那个预判不成立，所以**没有**走这条路：
 *
 *   · `save()` 是**整份覆盖**。两台设备都用它就成了「谁后写谁赢」——
 *     手机上刚录的东西会被电脑上那份整份盖掉，而且是静默的。
 *     要不出这种事就必须合并，而合并得同时拿着**本地**和**远端**两份数据，
 *     单一入口的 `save(data)` 装不下。
 *   · 如果 `load/save` 变成网络调用，**断网就开不了应用** ——
 *     这个项目是 PWA、离线优先，为了一个可选功能砸掉离线是倒过来的。
 *
 * 所以云端同步是**另加一层**（`src/cloud/`）：本地 IndexedDB 仍然是唯一主副本，
 * 云端是「另一台设备的副本」，两边合完再落回本地。见 docs/设计文档.md 8.2 的补充。
 *
 * 'supabase' 这个 kind 留着但会抛错：它是那条**没有走**的路的入口。
 * 留着是为了让「想换后端的人」一眼看到这里曾经想过什么、为什么没这么做，
 * 而不是照着注释白写一个 SupabaseRepository 出来。
 */
export interface Repository {
  /** 读取全量数据；首次使用返回 null */
  load(): Promise<AppData | null>
  /** 写入全量数据 */
  save(data: AppData): Promise<void>
  /** 清空（危险操作，仅用于「清空所有数据」） */
  clear(): Promise<void>
}

export type RepositoryKind = 'local' | 'supabase'

let instance: Repository | null = null

export function createRepository(kind: RepositoryKind = 'local'): Repository {
  if (kind === 'supabase') {
    throw new Error(t('data.storage.cloudNotReady'))
  }
  return new LocalRepository()
}

export function getRepository(): Repository {
  // 测试可以临时插一个假的进来（见下面的说明）—— 生产路径永远是本地仓库
  if (override !== null) return override
  if (!instance) instance = createRepository('local')
  return instance
}

/**
 * 仅供测试：临时换掉仓储实现。
 *
 * 为什么需要它：有几件事只有在**写盘失败**时才看得出来
 * （最要紧的一条是「写不进去时不能拿盘上的旧数据覆盖内存」，见 useAppStore.init）。
 * 而 ESM 的模块命名空间是只读的 —— 测试里没法直接 `module.getRepository = ...`，
 * 所以留一个显式的口子，而不是为了让测试能打桩去改生产代码的形状。
 *
 * 传 null 恢复。**生产代码里没有任何地方调用它。**
 */
let override: Repository | null = null

export function __setRepositoryForTest(repo: Repository | null): void {
  override = repo
}
