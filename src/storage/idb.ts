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

/**
 * 连接代号：每次丢掉缓存的连接就 +1。
 *
 * 用途是判断「这次操作期间，我手里那个连接是不是已经废了」——
 * 光看错误名不够，见 withFreshRetry 的注释。
 */
let dbToken = 0

/** 丢掉缓存的连接。下次 openDb() 会重新开一个。 */
function forgetDb(): void {
  dbPromise = null
  dbToken += 1
}

/**
 * 判断一个错误是不是「连接已经废了」那一类。
 *
 * `InvalidStateError` 就是用户报的那个：
 * `Failed to execute 'transaction' on 'IDBDatabase':
 *  The database connection is closing.`
 */
function isConnectionLost(err: unknown): boolean {
  return err instanceof Error && err.name === 'InvalidStateError'
}

/**
 * 跑一次操作；如果是「连接没了」导致的失败，**重开连接再试一次**。
 *
 * ── 为什么必须有这一层 ──────────────────────────────────────────
 * IndexedDB 的连接不是我们能独占的东西。下面这些情况都会让它被关掉，
 * 而它们**都不是 bug**，是浏览器的正常行为：
 *   · 另一个标签页要升级数据库版本（会先触发 versionchange）
 *   · 浏览器在回收存储空间
 *   · 用户在开发者工具里点了「清除站点数据」
 *   · 页面在后台被挂起太久
 *
 * 连接一关，`db.transaction()` 就会抛「connection is closing」。
 * 用户看到的就是那句吓人的报错，而其实**重开一个连接就没事了**。
 * 以前没有这一层，缓存里那个死连接会一直用到页面刷新为止 ——
 * 那期间每一次改动都存不进去。
 *
 * ── 为什么重试是安全的 ──────────────────────────────────────────
 * 这个模块上的写操作**全都是幂等的**：整条记录 put、按 id put 快照、
 * 按键 delete、clear。重试一遍最多是把同样的东西再写一次。
 * 所以「第一次其实写成功了、只是连接在完成前挂了」也不会写坏。
 *
 * 只试两次。第二次还失败就如实抛出去 —— 那时候多半是真出问题了，
 * 界面会挂着「没存进去」的横幅（见 AppShell）。
 */
async function withFreshRetry<T>(attempt: () => Promise<T>): Promise<T> {
  const tokenBefore = dbToken
  try {
    return await attempt()
  } catch (err) {
    /*
     * 两种情况都算「连接没了」：
     *   1. 报错本身就说连接正在关闭（最典型的那个）
     *   2. 这次操作**进行期间**连接被废掉了 —— 比如写到一半连接被关，
     *      事务 abort 抛出来的错误名不是 InvalidStateError，
     *      光看名字会漏掉。这时 dbToken 已经变了，用它兜住。
     */
    const connectionGone = isConnectionLost(err) || dbToken !== tokenBefore
    if (!connectionGone) throw err

    forgetDb()
    return attempt()
  }
}

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
      // 另一个标签页要升级版本时，主动让路 —— 但**必须同时把缓存丢掉**，
      // 否则后面拿到的还是这个已经关掉的连接，就是用户报的那个错。
      db.onversionchange = () => {
        db.close()
        forgetDb()
      }
      /*
       * 连接被**单方面**关掉时也会走到这里（存储被清、被浏览器回收）。
       * 这个事件在部分浏览器上没有，所以它只是「多一层保险」——
       * 真正的兜底是 withFreshRetry。
       */
      db.onclose = () => {
        forgetDb()
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
  return withFreshRetry(() =>
    run<T | undefined>(store, 'readonly', (s) => s.get(key) as Req<T | undefined>),
  )
}

export function idbGetAll<T>(store: string): Promise<T[]> {
  return withFreshRetry(() => run<T[]>(store, 'readonly', (s) => s.getAll() as Req<T[]>))
}

export async function idbPut(store: string, value: unknown, key?: IDBValidKey): Promise<void> {
  // put() 的返回值是写入的 key，这里用不上，但类型上要匹配
  await withFreshRetry(() =>
    run<IDBValidKey>(store, 'readwrite', (s) =>
      key === undefined ? s.put(value) : s.put(value, key),
    ),
  )
}

export function idbDelete(store: string, key: IDBValidKey): Promise<void> {
  return withFreshRetry(() => run<void>(store, 'readwrite', (s) => s.delete(key) as Req<void>))
}

export function idbClear(store: string): Promise<void> {
  return withFreshRetry(() => run<void>(store, 'readwrite', (s) => s.clear() as Req<void>))
}

export function idbCount(store: string): Promise<number> {
  return withFreshRetry(() => run<number>(store, 'readonly', (s) => s.count() as Req<number>))
}

/** 批量删除（同一事务，比逐条快且更安全） */
export function idbDeleteMany(store: string, keys: IDBValidKey[]): Promise<void> {
  return withFreshRetry(() =>
    runBatch(keys.map((key) => ({ store, fn: (s: IDBObjectStore) => s.delete(key) }))),
  )
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
