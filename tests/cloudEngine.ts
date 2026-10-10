/**
 * 云端同步引擎 —— 接一个**假云端**跑真实的引擎代码。
 *
 * ── 为什么不连真的 Supabase ──────────────────────────────────────
 * 一是那样测的是 Supabase 而不是这个项目；二是这几条路径**没法靠人点出来**
 * （版本冲突要两个设备在同一个几十毫秒的窗口里各写一次）。
 * 所以这里把传输层换成假的（`__setCloudTransportForTest`），
 * 引擎、store、IndexedDB 全是真的。
 *
 * ── 这里钉的是三条「会悄悄毁数据」的规矩 ──────────────────────────
 *   1. **首次绑定、两边都有数据时，引擎不许自己决定** —— 只能把选择摆出来，
 *      在用户选之前，云端和本地一个字节都不能动。
 *   2. **推的时候撞上版本冲突，必须先合并再推** —— 不许无条件覆盖。
 *      无条件覆盖就是「手机上刚录的东西被电脑整份盖掉」。
 *   3. **远端数据版本比本程序高时拒绝同步** —— 硬同步会丢掉新版本才认识的字段。
 *
 * 另外还验两件小事：同步落地会真的写进 IndexedDB，而且**不会生成快照**
 * （否则每次同步都吃一份快照名额，30 份很快就被它占满）。
 *
 * 这个文件放在最后导入（见 tests/index.ts）：它会写 store 状态和 IndexedDB，
 * 放前面会污染别的用例。
 */

import {
  __resetCloudForTest,
  __setCloudConfiguredForTest,
  __setCloudTransportForTest,
  __tombstonesForTest,
  currentDeviceId,
  getCloudState,
  initCloud,
  resolveFirstSync,
  syncNow,
  type CloudTransport,
} from '../src/cloud/sync'
import { type CloudEnvelope, makeEnvelope, sameContent } from '../src/cloud/envelope'
import { SCHEMA_VERSION, type AppData } from '../src/types'
import { createEmptyData } from '../src/storage/seed'
import { STORE_KV, idbDelete } from '../src/storage/idb'
import { getRepository } from '../src/storage/repository'
import { listSnapshots } from '../src/storage/snapshots'
import { createDerived } from '../src/store/selectors'
import { useAppStore } from '../src/store/useAppStore'
import { eq, must, ok, suite, test } from './harness'
import { item as makeItem } from './harness'

const DAY_MS = 24 * 3600 * 1000
const T0 = new Date(Date.now() - 2 * DAY_MS).toISOString()
const T1 = new Date(Date.now() - 1 * DAY_MS).toISOString()

/** 一份只有指定几件物品的数据（引擎用例不关心分类与位置） */
function dataWith(...ids: string[]): AppData {
  const empty = createEmptyData()
  return {
    ...empty,
    items: ids.map((id) => makeItem({ id, name: `物品 ${id}`, createdAt: T0, updatedAt: T0 })),
  }
}

function setStoreData(data: AppData): void {
  useAppStore.setState({
    status: 'ready',
    data,
    derived: createDerived(data),
    error: null,
    toasts: [],
    saveFailure: null,
  })
}

/**
 * 一个假云端：一行数据 + 一个版本号，行为对着 supabase/schema.sql 里的
 * `rev` 乐观并发来（`baseRev` 对不上就返回 null = 冲突）。
 */
function fakeCloud(initial?: { doc: CloudEnvelope; rev: number }) {
  const cloud: { doc: CloudEnvelope | null; rev: number } = initial
    ? { doc: initial.doc, rev: initial.rev }
    : { doc: null, rev: 0 }

  /** 下一次 push 之前先干这件事 —— 用来模拟「推的瞬间另一台设备也写了」 */
  let beforeNextPush: (() => void) | null = null

  return {
    cloud,
    /** 让**下一次** push 撞上版本冲突（对方已经写过了） */
    conflictOnNextPush(concurrentWrite: () => void) {
      beforeNextPush = concurrentWrite
    },
    transport(userId: string, email = 'me@example.com'): CloudTransport {
      return {
        userId,
        email,
        pull: async () => ({ envelope: cloud.doc, rev: cloud.rev }),
        push: async (envelope, baseRev) => {
          if (beforeNextPush !== null) {
            const write = beforeNextPush
            beforeNextPush = null
            write()
          }
          if (cloud.doc === null) {
            if (baseRev !== 0) return null
          } else if (baseRev !== cloud.rev) {
            return null
          }
          cloud.doc = envelope
          cloud.rev = cloud.rev + 1
          return cloud.rev
        },
      }
    },
  }
}

/* ------------------------------------------------------------------ */

suite('云端同步引擎 · 接假云端')

await test('云端还是空的：第一次同步把本机推上去', async () => {
  __setCloudConfiguredForTest(true)
  __resetCloudForTest()
  const fake = fakeCloud()
  __setCloudTransportForTest(fake.transport('user-first'))

  setStoreData(dataWith('ia', 'ib'))
  await syncNow('manual')

  const doc = must(fake.cloud.doc, '云端应该被写进去了')
  eq(fake.cloud.rev, 1, '第一次写上去是第 1 版')
  eq(doc.data.items.length, 2, '两台设备的物品都要在里面')
  eq(doc.deviceId, currentDeviceId(), '信封要记下是哪台设备写的')
  eq(getCloudState().phase, 'idle')
  ok(getCloudState().lastSyncAt !== null, '要记下上次同步时间')
})

await test('两边都有数据、又是第一次 → 问用户，并且什么都不许动', async () => {
  const fake = fakeCloud({ doc: makeEnvelope(dataWith('theirs'), {}, 'other-device', T1), rev: 3 })
  __setCloudTransportForTest(fake.transport('user-choice'))

  const mine = dataWith('mine')
  setStoreData(mine)
  await syncNow('manual')

  const choice = must(getCloudState().choice, '必须停下来问用户')
  eq(choice.localItems, 1)
  eq(choice.remoteItems, 1)
  eq(choice.remoteAt, T1)

  // ★ 关键：用户还没选，两边都必须原封不动
  eq(fake.cloud.rev, 3, '云端不许被覆盖')
  eq(fake.cloud.doc?.data.items.length, 1, '云端还是原来那一件')
  eq(fake.cloud.doc?.data.items[0].id, 'theirs')
  eq(useAppStore.getState().data.items[0].id, 'mine', '本地也不许被覆盖')

  await resolveFirstSync('merge')

  const ids = useAppStore
    .getState()
    .data.items.map((i) => i.id)
    .sort()
    .join(',')
  eq(ids, 'mine,theirs', '合并之后两边的都在')
  const pushed = must(fake.cloud.doc, '合并之后云端要有数据')
  ok(
    sameContent(pushed.data, useAppStore.getState().data),
    '推上去的那份要和本地落地的那份一致',
  )
  eq(getCloudState().choice, null, '选完就不该再问')
})

await test('远端数据版本比本程序高 → 拒绝同步，一个字节都不动', async () => {
  const local = dataWith('mine')
  const futureDoc: CloudEnvelope = {
    ...makeEnvelope(dataWith('newer-app'), {}, 'future-device', T1),
    schemaVersion: SCHEMA_VERSION + 1,
  }
  const fake = fakeCloud({ doc: futureDoc, rev: 2 })
  __setCloudTransportForTest(fake.transport('user-outdated'))

  setStoreData(local)
  await syncNow('manual')

  eq(getCloudState().phase, 'outdated')
  eq(fake.cloud.rev, 2, '不许往更新的数据上写')
  ok(sameContent(useAppStore.getState().data, local), '本地数据不许被改动')
})

await test('推的时候撞上版本冲突 → 先合并再推，两边的改动都保住', async () => {
  const fake = fakeCloud()
  __setCloudTransportForTest(fake.transport('user-conflict'))

  // 正常的第一次同步（云端还是空的）—— 顺带把「这台设备已经绑过这个账号」记下来
  setStoreData(dataWith('ia', 'ib'))
  await syncNow('manual')
  eq(fake.cloud.rev, 1)

  setStoreData(dataWith('ia', 'ib', 'mine'))

  // 我们推上去的那一刻，另一台设备也写了一份（带它自己的新物品）
  fake.conflictOnNextPush(() => {
    fake.cloud.doc = makeEnvelope(dataWith('ia', 'ib', 'theirs'), {}, 'other-device', T1)
    fake.cloud.rev = 2
  })

  await syncNow('manual')

  eq(getCloudState().phase, 'idle', '冲突该被自己消化掉，不该报错')
  eq(getCloudState().lastError, null)

  const serverIds = must(fake.cloud.doc, '云端应该有数据')
    .data.items.map((i) => i.id)
    .sort()
    .join(',')
  eq(serverIds, 'ia,ib,mine,theirs', '冲突之后云端必须同时有双方的改动')

  const localIds = useAppStore
    .getState()
    .data.items.map((i) => i.id)
    .sort()
    .join(',')
  eq(localIds, 'ia,ib,mine,theirs', '本地也要拿到对方的改动（不能只有我覆盖它）')
  ok(fake.cloud.rev >= 3, '冲突之后要重新推一次，版本号往前走')
})

await test('同步落地会写进本机数据库，而且不生成快照', async () => {
  const snapshotsBefore = (await listSnapshots()).length
  const fake = fakeCloud()
  __setCloudTransportForTest(fake.transport('user-persist'))

  // 先正常同步一次（绑定这台设备），再让「另一台设备」往云端加一件东西
  setStoreData(dataWith('ia', 'mine'))
  await syncNow('manual')

  fake.cloud.doc = makeEnvelope(dataWith('ia', 'theirs'), {}, 'other-device', T1)
  fake.cloud.rev = fake.cloud.rev + 1

  await syncNow('manual')

  const saved = must(await getRepository().load(), '同步结果要落盘')
  ok(
    sameContent(saved, useAppStore.getState().data),
    '落盘的那份要和内存里那份一致（否则刷新就退回旧数据）',
  )
  eq(useAppStore.getState().data.items.length, 3, '对方加的那件要拉下来（ia + mine + theirs）')
  ok(
    useAppStore.getState().data.items.some((i) => i.id === 'theirs'),
    '对方加的东西必须在本地',
  )

  /*
   * 快照数量不许因为同步而增加。
   * 理由：快照上限只有 30 份，而它是用户判断「回退到哪一份」的唯一依据；
   * 后台同步每次都塞一份进去，很快就把有用的旧快照挤掉了。
   */
  eq((await listSnapshots()).length, snapshotsBefore, '同步不该生成快照')
})

await test('本机删掉的东西会被记成墓碑，并跟着推上去', async () => {
  const fake = fakeCloud()
  __setCloudTransportForTest(fake.transport('user-tomb'))
  __resetCloudForTest()
  __setCloudConfiguredForTest(true)
  __setCloudTransportForTest(fake.transport('user-tomb'))
  initCloud() // 挂上「本地一变就记墓碑」那条订阅

  setStoreData(dataWith('ia', 'ib'))
  await syncNow('manual')
  eq(fake.cloud.doc?.data.items.length, 2)

  // 本机删掉 ia —— 走的是 store 的 setState，和用户点「删除」之后落到的状态一样
  setStoreData(dataWith('ib'))

  const tombstones = __tombstonesForTest()
  ok(tombstones.ia !== undefined, '删除必须被记成墓碑，否则另一端会把它加回来')

  await syncNow('manual')
  eq(fake.cloud.doc?.data.items.length, 1, '推上去之后云端也只剩一件')
  eq(fake.cloud.doc?.data.items[0].id, 'ib')
  ok(fake.cloud.doc?.deleted.ia !== undefined, '墓碑本身也要同步过去')
})

/* ------------------------------------------------------------------ */
/* 清理：这个文件写过的 store 状态、IndexedDB、开关，全部还原            */
/* ------------------------------------------------------------------ */

__setCloudTransportForTest(null)
__resetCloudForTest()
__setCloudConfiguredForTest(null)
__setCloudTransportForTest(null)

for (const userId of ['user-first', 'user-choice', 'user-outdated', 'user-conflict', 'user-persist', 'user-tomb']) {
  await idbDelete(STORE_KV, `cloud:bound:${userId}`)
  await idbDelete(STORE_KV, `cloud:tombstones:${userId}`)
}
await getRepository().clear()
const blank = createEmptyData()
useAppStore.setState({
  status: 'ready',
  data: blank,
  derived: createDerived(blank),
  error: null,
  toasts: [],
})
