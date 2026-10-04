/**
 * 数据体检的用例。
 *
 * 这里守的是一件很具体的事：**体检不能撒谎**。
 *
 * 「数据在另一个网址下」「主记录没了但快照还在」「本来就没存过东西」
 * 是三个完全不同的结论，处理方式也完全不同，但它们在界面上长得一模一样 ——
 * 都是一张空列表。分错一个，用户要么白折腾一场，要么在真能救回来的时候放弃。
 *
 * 所以这些用例全部走**真实的 IndexedDB**（fake-indexeddb），
 * 只有「读失败」那一类走注入的假读法 —— 那种情况生产上没法按需触发。
 */

import { diagnoseLocalData, type DiagnosisSource } from '../src/storage/diagnose'
import {
  APP_DATA_KEY,
  STORE_APP,
  STORE_SNAPSHOTS,
  idbClear,
  idbGetAll,
  idbPut,
} from '../src/storage/idb'
import { createEmptyData } from '../src/storage/seed'
import type { AppData, Snapshot } from '../src/types'
import { eq, item, must, ok, suite, test } from './harness'

/* ------------------------------------------------------------------ */
/* 直接摆弄真实的 IndexedDB                                            */
/* ------------------------------------------------------------------ */

async function resetStores(): Promise<void> {
  await idbClear(STORE_APP)
  await idbClear(STORE_SNAPSHOTS)
}

function withItems(count: number): AppData {
  return {
    ...createEmptyData(),
    items: Array.from({ length: count }, (_, i) => item({ id: `a${i}`, name: `物品 ${i}` })),
  }
}

/**
 * 造一份「装着 itemCount 件物品」的快照。
 * 里面的物品是真的，免得出现「计数说有 5 件、实际一件没有」这种自相矛盾的夹具。
 */
function snapshot(id: string, at: string, itemCount: number): Snapshot {
  const data = createEmptyData()
  data.items = Array.from({ length: itemCount }, (_, i) =>
    item({ id: `${id}-${i}`, name: `${id} 的第 ${i} 件` }),
  )
  return { id, at, reason: 'auto', itemCount, data }
}

async function putSnapshots(snaps: Snapshot[]): Promise<void> {
  for (const snap of snaps) await idbPut(STORE_SNAPSHOTS, snap)
}

/* ------------------------------------------------------------------ */
/* 四种结论                                                            */
/* ------------------------------------------------------------------ */

suite('数据体检：四种结论必须分得清')

await test('主记录在 → ok，报出物品数与更新时间', async () => {
  await resetStores()
  await idbPut(STORE_APP, withItems(3), APP_DATA_KEY)

  const d = await diagnoseLocalData()
  eq(d.verdict, 'ok')
  eq(d.app.exists, true)
  eq(d.app.itemCount, 3)
  eq(d.snapshots.count, 0)
  ok(d.app.updatedAt !== null, '应该报出最后更新时间')
})

await test('主记录整个没了，但快照里还有货 → restorable', async () => {
  await resetStores()
  await putSnapshots([
    snapshot('s1', '2026-01-01T00:00:00.000Z', 4),
    snapshot('s2', '2026-01-05T00:00:00.000Z', 9),
    snapshot('s3', '2026-01-03T00:00:00.000Z', 9),
  ])

  const d = await diagnoseLocalData()
  eq(d.app.exists, false, '主记录确实没了')
  eq(d.verdict, 'restorable')
  eq(d.snapshots.count, 3)
  eq(d.snapshots.maxItems, 9)
  eq(d.snapshots.oldestAt, '2026-01-01T00:00:00.000Z')
  eq(d.snapshots.newestAt, '2026-01-05T00:00:00.000Z')

  const best = must(d.snapshots.best, '应该挑出物品最多的那一份来救')
  eq(best.itemCount, 9)
  eq(best.at, '2026-01-05T00:00:00.000Z', '并列时要取更新的那一份 —— 回退要回到最近的状态')
})

await test('主记录还在但一件都没有，快照里却有一堆 → 也算 restorable', async () => {
  await resetStores()
  await idbPut(STORE_APP, withItems(0), APP_DATA_KEY)
  await putSnapshots([snapshot('s1', '2026-02-01T00:00:00.000Z', 12)])

  const d = await diagnoseLocalData()
  eq(d.app.exists, true)
  eq(d.app.itemCount, 0)
  eq(d.verdict, 'restorable')
})

await test('这个网址下什么都没有 → empty（多半是「数据在别的网址下」）', async () => {
  await resetStores()

  const d = await diagnoseLocalData()
  eq(d.app.exists, false)
  eq(d.snapshots.count, 0)
  eq(d.verdict, 'empty')
})

await test('全新的空库不算出事：0 件物品、0 份快照时说 ok，不报警', async () => {
  await resetStores()
  await idbPut(STORE_APP, withItems(0), APP_DATA_KEY)

  const d = await diagnoseLocalData()
  eq(d.verdict, 'ok', '刚装好还没录东西，不是「数据丢了」')
  eq(d.app.itemCount, 0)
})

await test('快照比现在多、但当前不为空 → 照样 ok，不能乱报警', async () => {
  // 删掉几件物品是再正常不过的操作，快照本来就会比当前状态多。
  // 这里要是报「可恢复」，那用户每删一件东西就被吓一次，
  // 警报一多就没人信了 —— 那才是真的危险。
  await resetStores()
  await idbPut(STORE_APP, withItems(3), APP_DATA_KEY)
  await putSnapshots([snapshot('s1', '2026-03-01T00:00:00.000Z', 40)])

  const d = await diagnoseLocalData()
  eq(d.verdict, 'ok')
})

await test('只剩一堆空快照（每份都是 0 件）→ empty，说「能找回」是骗人', async () => {
  // 这一条守的是条件里那个 `maxItems > itemCount`。
  // 「有没有快照」和「快照里有没有东西」是两件事：
  // 清空数据之后随手产生的快照，物品数是 0 —— 回退过去什么也拿不回来。
  // 只看 count 就报「可恢复」，等于让用户白折腾一趟，还搭上一次回退。
  await resetStores()
  await putSnapshots([
    snapshot('s1', '2026-06-01T00:00:00.000Z', 0),
    snapshot('s2', '2026-06-02T00:00:00.000Z', 0),
  ])

  const d = await diagnoseLocalData()
  eq(d.snapshots.count, 2, '快照确实有')
  eq(d.snapshots.maxItems, 0, '但里面一件东西都没有')
  eq(d.verdict, 'empty', '回退到 0 件物品什么也找不回来，不该说能恢复')
})

/* ------------------------------------------------------------------ */
/* 读失败：体检自己也不许撒谎                                          */
/* ------------------------------------------------------------------ */

suite('数据体检：读不出来就说读不出来')

await test('快照读失败 → unreadable，并且不会假装成「没有快照」', async () => {
  const source: DiagnosisSource = {
    getApp: async () => withItems(2),
    getSnapshots: async () => {
      throw new Error('事务被中断')
    },
    dbExists: async () => true,
    estimate: async () => null,
  }

  const d = await diagnoseLocalData(source)
  eq(d.verdict, 'unreadable')
  eq(d.snapshots.readError, '事务被中断')
  eq(d.snapshots.count, 0)
  // 关键区别就在这：count 是 0，但 readError 有值。
  // 界面必须靠 readError 把「没有备份」和「没读到备份」分开 ——
  // 混成一句话，用户就会在真的还有备份的时候放弃。
  ok(d.snapshots.readError !== null, '失败必须留下痕迹')
})

await test('主记录读失败 → unreadable', async () => {
  const d = await diagnoseLocalData({
    getApp: async () => {
      throw new Error('打不开库')
    },
    getSnapshots: async () => [],
    dbExists: async () => false,
    estimate: async () => null,
  })

  eq(d.verdict, 'unreadable')
  eq(d.app.readError, '打不开库')
})

await test('不是 Error 对象也兜得住（抛字符串、抛 undefined）', async () => {
  const d = await diagnoseLocalData({
    getApp: async () => undefined,
    getSnapshots: async () => {
      throw '出了点事'
    },
    dbExists: async () => null,
    estimate: async () => null,
  })

  eq(d.verdict, 'unreadable')
  eq(d.snapshots.readError, '出了点事', '非 Error 的抛出物也要变成可读的文本')
  eq(d.dbExists, null, '浏览器查不了时应该是 null，而不是硬猜一个 true/false')
})

/* ------------------------------------------------------------------ */
/* 只读、以及不碰用户的东西                                            */
/* ------------------------------------------------------------------ */

suite('数据体检：只读，且不碰不该碰的东西')

await test('跑三次体检，库里的东西一个不多一个不少', async () => {
  // 体检绝不能被做成一次数据变更 —— 否则「打开设置随便看看」
  // 都会产生快照、顶掉真正有价值的旧快照。
  await resetStores()
  await idbPut(STORE_APP, withItems(4), APP_DATA_KEY)
  await putSnapshots([snapshot('s1', '2026-05-01T00:00:00.000Z', 2)])

  await diagnoseLocalData()
  await diagnoseLocalData()
  const d = await diagnoseLocalData()

  eq(d.app.itemCount, 4, '物品数不该变')
  eq(d.snapshots.count, 1, '体检不该产生任何快照')
  eq((await idbGetAll<Snapshot>(STORE_SNAPSHOTS)).length, 1, '直接数一遍也是 1 份')
})

await test('只报告本应用的键名，而且绝不把 API Key 的值读出来', async () => {
  // 体检结果是要显示在界面上的。要是顺手把 localStorage 的值也读出来，
  // 那个值里就有 API Key —— 等于把一个密钥直接印在屏幕上。
  await resetStores()
  localStorage.setItem('duansheli:ai-key', 'sk-绝不能出现在体检结果里')
  localStorage.setItem('别的应用的键', 'x')
  try {
    const d = await diagnoseLocalData()

    ok(d.localKeys.includes('ai-key'), `应该报出 ai-key 这个键名，实际：${d.localKeys.join('/')}`)
    ok(!d.localKeys.includes('duansheli:ai-key'), '前缀该被去掉')
    ok(!d.localKeys.includes('别的应用的键'), '不该报告别的应用的键')

    ok(
      !JSON.stringify(d).includes('sk-绝不能出现在体检结果里'),
      '体检结果里出现了 API Key 的值 —— 那等于把它显示在界面上',
    )
  } finally {
    localStorage.removeItem('duansheli:ai-key')
    localStorage.removeItem('别的应用的键')
  }
})

await test('报出当前网址 —— 「数据在哪儿」只能靠这个坐标', async () => {
  await resetStores()

  const d = await diagnoseLocalData()
  eq(d.origin, window.location.origin)
  ok(d.origin.length > 0, '网址不该是空的')
})

/* ------------------------------------------------------------------ */
/* 快照数据本身坏了也要能兜住                                          */
/* ------------------------------------------------------------------ */

suite('数据体检：快照数据本身有问题时也不崩')

await test('快照缺 itemCount 时，现场数 data.items 顶上去', async () => {
  await resetStores()
  const broken = snapshot('s1', '2026-04-01T00:00:00.000Z', 5) as unknown as {
    itemCount?: number
  }
  delete broken.itemCount
  await idbPut(STORE_SNAPSHOTS, broken)

  const d = await diagnoseLocalData()
  eq(d.snapshots.maxItems, 5, 'itemCount 没了就该回退去数 data.items')
})

await test('快照的 at 不是字符串也不会把体检搞崩', async () => {
  await resetStores()
  const broken = snapshot('s1', '2026-04-01T00:00:00.000Z', 3) as unknown as { at: unknown }
  broken.at = 12345
  await idbPut(STORE_SNAPSHOTS, broken)

  const d = await diagnoseLocalData()
  eq(d.snapshots.count, 1)
  eq(d.snapshots.newestAt, null, '时间读不出来就当没有，不要编一个出来')
  eq(d.snapshots.maxItems, 3)

  /*
   * ⚠️ 必须清掉这条畸形快照再走。
   *
   * 它是个只可能出现在测试里的东西，但后面那些用例（aiSession）会调用
   * restoreFromSnapshot → pruneSnapshots → listSnapshots，那里按 at 排序 ——
   * 撞上这个 12345 就直接抛「localeCompare is not a function」。
   * 症状离病因非常远（体检测试把会话测试搞红了），我自己就踩了一次。
   */
  await idbClear(STORE_SNAPSHOTS)
})
