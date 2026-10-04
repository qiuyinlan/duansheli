/**
 * IndexedDB 薄封装 —— 直接用原生 API，零依赖。
 *
 * 数据库结构（详见 docs/设计文档.md 8.3）：
 *   duansheli
 *     ├─ "app"        无 keyPath，用固定 key "data" 存整个 AppData
 *     ├─ "snapshots"  keyPath: "id"，索引 "at"
 *     └─ "kv"         无 keyPath，存界面偏好等小数据
 */

// 这里抛出的错误会一路显示给用户（「存不进去了」是最让人慌的一类），
// 所以取词写在抛的那一刻，不能先算在模块顶层。
import { t } from '../i18n'

export const DB_NAME = 'duansheli'
const DB_VERSION = 1

export const STORE_APP = 'app'
export const STORE_SNAPSHOTS = 'snapshots'
export const STORE_KV = 'kv'

/** app 存储里存放全量数据用的固定 key */
export const APP_DATA_KEY = 'data'

let dbPromise: Promise<IDBDatabase> | null = null

export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error(t('data.storage.noIndexedDb')))
      return
    }

    let req: IDBOpenDBRequest
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION)
    } catch (err) {
      reject(err instanceof Error ? err : new Error(t('data.storage.openFailed')))
      return
    }

    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_APP)) {
        db.createObjectStore(STORE_APP)
      }
      if (!db.objectStoreNames.contains(STORE_SNAPSHOTS)) {
        const s = db.createObjectStore(STORE_SNAPSHOTS, { keyPath: 'id' })
        s.createIndex('at', 'at', { unique: false })
      }
      if (!db.objectStoreNames.contains(STORE_KV)) {
        db.createObjectStore(STORE_KV)
      }
    }

    req.onsuccess = () => {
      const db = req.result
      // 另一个标签页要升级版本时，主动让路，避免卡住对方
      db.onversionchange = () => {
        db.close()
        dbPromise = null
      }
      resolve(db)
    }

    req.onerror = () => reject(req.error ?? new Error(t('data.storage.openError')))
    req.onblocked = () => reject(new Error(t('data.storage.blocked')))
  })

  // 打开失败时不缓存失败的 Promise，否则永远无法恢复
  dbPromise.catch(() => {
    dbPromise = null
  })

  return dbPromise
}

type Req<T> = IDBRequest<T>

/** 在单事务里跑一个请求，事务提交后 resolve */
function run<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => Req<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        let result: T
        let settled = false
        const fail = (err: unknown) => {
          if (settled) return
          settled = true
          reject(err instanceof Error ? err : new Error(String(err)))
        }

        let tx: IDBTransaction
        try {
          tx = db.transaction(storeName, mode)
        } catch (err) {
          fail(err)
          return
        }

        tx.oncomplete = () => {
          if (settled) return
          settled = true
          resolve(result)
        }
        tx.onerror = () => fail(tx.error)
        tx.onabort = () => fail(tx.error ?? new Error(t('data.storage.transactionAborted')))

        let req: Req<T>
        try {
          req = fn(tx.objectStore(storeName))
        } catch (err) {
          fail(err)
          return
        }
        req.onsuccess = () => {
          result = req.result
        }
        req.onerror = () => fail(req.error)
      }),
  )
}

/** 在单事务里跑多个请求（批量写、跨 key 操作） */
function runBatch(
  ops: Array<{ store: string; fn: (s: IDBObjectStore) => void }>,
  mode: IDBTransactionMode = 'readwrite',
): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        if (ops.length === 0) {
          resolve()
          return
        }
        let settled = false
        const fail = (err: unknown) => {
          if (settled) return
          settled = true
          reject(err instanceof Error ? err : new Error(String(err)))
        }

        let tx: IDBTransaction
        try {
          // 同一个事务需要覆盖所有涉及的 store
          const unique = [...new Set(ops.map((o) => o.store))]
          tx = db.transaction(unique, mode)
        } catch (err) {
          fail(err)
          return
        }

        tx.oncomplete = () => {
          if (settled) return
          settled = true
          resolve()
        }
        tx.onerror = () => fail(tx.error)
        tx.onabort = () => fail(tx.error ?? new Error(t('data.storage.transactionAborted')))

        try {
          for (const op of ops) op.fn(tx.objectStore(op.store))
        } catch (err) {
          fail(err)
        }
      }),
  )
}

export function idbGet<T>(store: string, key: IDBValidKey): Promise<T | undefined> {
  return run<T | undefined>(store, 'readonly', (s) => s.get(key) as Req<T | undefined>)
}

export function idbGetAll<T>(store: string): Promise<T[]> {
  return run<T[]>(store, 'readonly', (s) => s.getAll() as Req<T[]>)
}

export async function idbPut(store: string, value: unknown, key?: IDBValidKey): Promise<void> {
  // put() 的返回值是写入的 key，这里用不上，但类型上要匹配
  await run<IDBValidKey>(store, 'readwrite', (s) =>
    key === undefined ? s.put(value) : s.put(value, key),
  )
}

export function idbDelete(store: string, key: IDBValidKey): Promise<void> {
  return run<void>(store, 'readwrite', (s) => s.delete(key) as Req<void>)
}

export function idbClear(store: string): Promise<void> {
  return run<void>(store, 'readwrite', (s) => s.clear() as Req<void>)
}

export function idbCount(store: string): Promise<number> {
  return run<number>(store, 'readonly', (s) => s.count() as Req<number>)
}

/** 批量删除（同一事务，比逐条快且更安全） */
export function idbDeleteMany(store: string, keys: IDBValidKey[]): Promise<void> {
  return runBatch(keys.map((key) => ({ store, fn: (s: IDBObjectStore) => s.delete(key) })))
}

/** 估计当前站点已用存储空间（部分浏览器不支持，返回 null） */
export async function estimateUsage(): Promise<{ usage: number; quota: number } | null> {
  if (!navigator.storage?.estimate) return null
  try {
    const est = await navigator.storage.estimate()
    return { usage: est.usage ?? 0, quota: est.quota ?? 0 }
  } catch {
    return null
  }
}
