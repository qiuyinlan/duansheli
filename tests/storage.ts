/**
 * 存储层的韧性：连接被关掉之后还能不能写。
 *
 * ── 这一组守的是用户报上来的那个错 ────────────────────────────────
 *   「保存到本地失败：Failed to execute 'transaction' on 'IDBDatabase':
 *     The database connection is closing.」
 *
 * IndexedDB 的连接**不是我们能独占的东西**：另一个标签页要升级数据库、
 * 浏览器回收存储、用户清了站点数据 —— 都会把它从底下关掉。
 * 这些都不是 bug，是浏览器的正常行为。
 *
 * 以前的代码对此毫无防备：`openDb()` 缓存了那个连接，
 * 一旦它被关掉，缓存里就是个死连接，`db.transaction()` 直接抛错，
 * 而且要**一直抛到页面刷新为止** —— 那期间每一次改动都存不进去。
 * 用户看到的就是那句报错，而其实重开一个连接就没事了。
 *
 * 这里的做法是**真的把连接关掉**（不是打桩），然后断言写操作照样成功。
 * 这是那个错误最直接的复现。
 *
 * ⚠️ 变异验证过，而且结果值得记下来：把 idb.ts 里的重试关掉，
 * 这一组 8 条全红、报的就是那个 InvalidStateError —— 但也**顺带弄红了
 * 另外 26 条**（体检、会话、导出……所有还要读 IndexedDB 的用例）。
 * 原因很直白：连接是全局共享的，被关掉之后如果没有重试，
 * 后面每一个碰存储的用例都会失败。
 * 所以以后看到一大片无关用例同时红，先怀疑这里。
 */

import { APP_DATA_KEY, STORE_APP, STORE_SNAPSHOTS, idbClear, idbGet, idbGetAll, idbPut, openDb } from '../src/storage/idb'
import { createEmptyData, createSeedData } from '../src/storage/seed'
import { createSnapshot, listSnapshots } from '../src/storage/snapshots'
import { LocalRepository } from '../src/storage/localRepository'
import { flushWrites, useAppStore } from '../src/store/useAppStore'
import { createDerived } from '../src/store/selectors'
import type { AppData, Snapshot } from '../src/types'
import { eq, item, must, ok, suite, test } from './harness'

function fixtureData(): AppData {
  return {
    ...createSeedData('zh'),
    items: [item({ id: 'k1', name: '一条测试物品', quantity: 2 })],
  }
}

/* ------------------------------------------------------------------ */
/* 连接被关掉之后                                                      */
/* ------------------------------------------------------------------ */

suite('存储韧性：连接被关掉之后照样能写')

await test('连接被关掉之后，写进去不会抛「connection is closing」', async () => {
  // 先确保连接已经建立、并且被缓存住了
  const db = await openDb()
  await idbGet(STORE_APP, APP_DATA_KEY)

  /*
   * 模拟真实触发场景：另一个标签页 / 浏览器 / 开发者工具把连接关了。
   * 关掉之后缓存里那个连接就是死的 —— 旧代码在这里就会抛
   * InvalidStateError: The database connection is closing.
   */
  db.close()

  // 旧代码会在这里炸；现在应该自动重开连接、把这次写入完成
  await idbPut(STORE_APP, fixtureData(), APP_DATA_KEY)

  const readBack = await idbGet<AppData>(STORE_APP, APP_DATA_KEY)
  ok(readBack !== undefined, '数据应该真的写进去了')
  eq(readBack?.items.length, 1)
})

await test('读操作同理：连接死了也能自己恢复', async () => {
  const db = await openDb()
  db.close()

  const all = await idbGetAll<Snapshot>(STORE_SNAPSHOTS)
  ok(Array.isArray(all), '读应该成功返回一个数组，而不是抛错')
})

await test('连续关两次也扛得住（不是只兜住第一次）', async () => {
  const first = await openDb()
  first.close()
  await idbPut(STORE_APP, fixtureData(), APP_DATA_KEY)

  const second = await openDb()
  second.close()
  await idbPut(STORE_APP, fixtureData(), APP_DATA_KEY)

  ok(true, '两次都该顺利完成')
})

await test('整个 store 的落盘链路也扛得住 —— 用户报的错就是从这条路上来的', async () => {
  // 用户的报错文案来自 commit 里的 catch，所以这里走完整的 store 路径：
  // 改数据 → commit → 快照 → 落盘
  useAppStore.setState({
    status: 'ready',
    data: fixtureData(),
    derived: createDerived(fixtureData()),
    error: null,
    saveFailure: null,
    toasts: [],
  })

  // 把连接关掉，再让 store 去存
  const db = await openDb()
  db.close()

  useAppStore.getState().addTag('测试标签')
  await flushWrites()

  const state = useAppStore.getState()
  eq(state.saveFailure, null, '不该记录「保存失败」——连接已经自动重开了')
  ok(
    !state.toasts.some((toast) => toast.message.includes('保存到本地失败')),
    `不该弹保存失败的提示，实际弹了：${state.toasts.map((toast) => toast.message).join(' / ')}`,
  )

  // 真的落盘了才算数
  const saved = must(await idbGet<AppData>(STORE_APP, APP_DATA_KEY), '主记录应该还在')
  ok(
    saved.tags.some((tag) => tag.name === '测试标签'),
    '这次改动应该真的写进本地了',
  )
})

await test('快照也走同一条韧性路径（它同样是写操作）', async () => {
  await idbClear(STORE_SNAPSHOTS)
  const db = await openDb()
  db.close()

  const created = await createSnapshot(fixtureData(), 'manual')
  ok(created !== null, '快照应该建成功')

  const listed = await listSnapshots()
  eq(listed.length, 1, '而且真的存下来了')
})

await test('Repository 那一层也一样（它是 store 落盘的入口）', async () => {
  const repo = new LocalRepository()
  const db = await openDb()
  db.close()

  const data = fixtureData()
  await repo.save(data)

  const loaded = await repo.load()
  eq(loaded?.items.length, 1, '存进去的东西要能读回来')
})

/* ------------------------------------------------------------------ */
/* 别把「真失败」也当成连接问题重试                                    */
/* ------------------------------------------------------------------ */

suite('存储韧性：不该吞掉真正的错误')

await test('不是连接问题就照常抛出去，不会被无声吞掉', async () => {
  // 重试只针对「连接没了」这一类。别的错误（比如参数不对）
  // 必须原样抛出去 —— 否则就成了「默默失败」，那比报错危险得多。
  let caught: unknown = null
  try {
    // 传一个不存在的 store，会抛 NotFoundError
    await idbGet('这个表不存在', 'x')
  } catch (err) {
    caught = err
  }

  ok(caught !== null, '不该被吞掉')
  ok(
    caught instanceof Error && caught.name !== 'InvalidStateError',
    '抛出来的应该是原始错误',
  )
})

await test('连接被关之后，正常读到的还是刚写进去的东西', async () => {
  // 防止「重试时开了一个空的新库」这种更隐蔽的错 ——
  // 重开的是**同一个库**，不是新建一个空的。
  await idbClear(STORE_APP)
  const seed = createEmptyData()
  await idbPut(STORE_APP, seed, APP_DATA_KEY)

  const db = await openDb()
  db.close()

  const readBack = await idbGet<AppData>(STORE_APP, APP_DATA_KEY)
  ok(readBack !== undefined, '数据还在 —— 重开的必须是同一个数据库')
  eq(readBack?.items.length, 0)
})
