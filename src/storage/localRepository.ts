import type { AppData } from '../types'
import { APP_DATA_KEY, STORE_APP, idbDelete, idbGet, idbPut } from './idb'
import type { Repository } from './repository'

/**
 * 本地存储实现 —— 把整个 AppData 当作一条记录整体读写。
 *
 * 为什么不做表结构：数据量极小（约 250 件物品 ≈ 60KB），
 * 整体读写让「导出 = 序列化」「导入 = 反序列化」「快照 = 存副本」
 * 三件事都变成零成本操作（详见 docs/设计文档.md 8.1）。
 */
export class LocalRepository implements Repository {
  async load(): Promise<AppData | null> {
    const data = await idbGet<AppData>(STORE_APP, APP_DATA_KEY)
    return data ?? null
  }

  async save(data: AppData): Promise<void> {
    await idbPut(STORE_APP, data, APP_DATA_KEY)
  }

  async clear(): Promise<void> {
    await idbDelete(STORE_APP, APP_DATA_KEY)
  }
}
