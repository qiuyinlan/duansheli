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
  if (!instance) instance = createRepository('local')
  return instance
}
