import type { AppData } from '../types'
import { t } from '../i18n'
import { LocalRepository } from './localRepository'

/**
 * 存储层抽象 —— 应用程序只认这个接口，不关心数据实际存在哪。
 *
 * v1 只有 LocalRepository（IndexedDB）。
 * v2 接入 Supabase 时，只需新增一个 SupabaseRepository 实现，
 * 在 createRepository() 里加一个分支即可，业务代码零改动。
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
