/**
 * 数据丢失的回归测试（issue 10）。
 *
 * 用户报的现象：「我发现他有时候莫名其妙会把我数据给弄丢，我不知道为什么，
 * 就我刚刚才新建的东西，过了一会他就不见了。」
 *
 * ── 查到的真凶 ────────────────────────────────────────────────────
 * `init()` 会**从 IndexedDB 重新读一遍、然后覆盖内存里的数据**。
 *
 * 而落盘是异步的、排队的（`writeChain`）。于是有这么一个窗口：
 *
 *   1. 用户新建了一件东西 → `commit()` 立刻改了内存，把「写盘」排进队列
 *   2. 这一步还没轮到（IndexedDB 是异步的，可能隔好几毫秒）
 *   3. `init()` 被再调用一次（组件重新挂载、用户点了「重试」、路由重建）
 *   4. `init` 读回来的是**没有那件东西的旧数据**，然后 set 进 store
 *   5. 用户眼睁睁看着刚录的东西消失，而且**没有任何提示**
 *
 * 第 5 步是最糟的部分：数据其实还在盘上（写入队列最后还是会成功），
 * 但界面上已经没了；如果用户接着又录了别的东西，那次 commit 会以
 * **丢掉那件东西的内存快照**为基准写盘 —— 东西就真的没了。
 *
 * 修法见 useAppStore 的 init：先 `await writeChain` 再读盘，
 * 并且「上一次写盘失败」时宁可**保留内存里那份**也不拿旧数据覆盖。
 *
 * ⚠️ 变异验证：把 init 里那行 `await writeChain` 去掉，本文件第 3 条用例立刻变红。
 */

import { APP_DATA_KEY, STORE_APP, idbGet, idbPut } from '../src/storage/idb'
import { createSeedData } from '../src/storage/seed'
import { __setRepositoryForTest, getRepository } from '../src/storage/repository'
import { clearSnapshots, createSnapshot } from '../src/storage/snapshots'
import { flushBeforeUnload, flushWrites, useAppStore } from '../src/store/useAppStore'
import { createDerived } from '../src/store/selectors'
import type { AppData } from '../src/types'
import { eq, must, ok, suite, test } from './harness'

function seedData(): AppData {
  return { ...createSeedData('zh'), items: [] }
}

/** 把 store 摆到「已经加载完、盘上也有一份」的状态 */
async function primeStore(): Promise<void> {
  const data = seedData()
  await idbPut(STORE_APP, data, APP_DATA_KEY)
  await flushWrites()
  useAppStore.setState({
    status: 'ready',
    error: null,
    saveFailure: null,
    data,
    derived: createDerived(data),
    toasts: [],
  })
}

suite('数据丢失：init 不能把还没落盘的新东西冲掉')

await test('先决条件：新建的东西最后确实落到了盘上', async () => {
  await primeStore()
  useAppStore.getState().addItem({ name: '刚录的一件' })
  await flushWrites()

  const saved = must(await idbGet<AppData>(STORE_APP, APP_DATA_KEY), '主记录应该还在')
  ok(
    saved.items.some((item) => item.name === '刚录的一件'),
    '正常路径（等写盘完成）下，新建的东西必须真的进盘',
  )
})

await test('★ 写盘还没完成时再 init 一次，刚新建的东西不能消失', async () => {
  await primeStore()

  /*
   * 关键的一步：**不等写盘完成**就立刻 init。
   *
   * 这就是真实场景 —— 用户录完一件、界面刚刷新出来那一下触发了
   * 一次重启（或者他手快点了设置页里的「重试」）。
   */
  useAppStore.getState().addItem({ name: '只录了一半时间的这一件' })

  // 注意：这里**故意没有** await flushWrites()
  await useAppStore.getState().init()

  const after = useAppStore.getState().data
  ok(
    after.items.some((item) => item.name === '只录了一半时间的这一件'),
    `init 之后那件东西必须还在。实际内存里的物品：${
      after.items.map((i) => i.name).join('、') || '（一件都没有）'
    }`,
  )

  // 而且最终要落到盘上 —— 内存里留着但盘上没有，刷新一次还是丢
  await flushWrites()
  const saved = must(await idbGet<AppData>(STORE_APP, APP_DATA_KEY), '主记录应该还在')
  ok(
    saved.items.some((item) => item.name === '只录了一半时间的这一件'),
    '它最终也必须落盘，否则刷新一次还是没了',
  )
})

await test('★ 连续快速新建之后再 init，一件都不能少', async () => {
  await primeStore()

  const store = useAppStore.getState
  store().addItem({ name: '快录-1' })
  store().addItem({ name: '快录-2' })
  store().addItem({ name: '快录-3' })

  // 这正是「连续录入同一个抽屉」的实际节奏 —— 三笔写入都还在排队
  await useAppStore.getState().init()
  await flushWrites()

  const after = useAppStore.getState().data
  for (const name of ['快录-1', '快录-2', '快录-3']) {
    ok(
      after.items.some((item) => item.name === name),
      `${name} 应该还在。实际：${after.items.map((i) => i.name).join('、')}`,
    )
  }

  const saved = must(await idbGet<AppData>(STORE_APP, APP_DATA_KEY), '主记录应该还在')
  eq(saved.items.length, 3, '盘上应该正好这三件')
})

await test('写盘失败时，init 不能拿旧数据覆盖内存里那份', async () => {
  /*
   * 「写盘失败」意味着盘上那份是旧的 —— 如果 init 照样去覆盖，
   * 就等于把「界面上还看得见、还有机会导出或重试」的东西真的弄丢。
   * 失败的横幅已经挂在界面上了（AppShell），用户知情，
   * 所以这时**保住内存里那份**才是对的。
   */
  await primeStore()

  const original = getRepository()
  try {
    // 让写盘永远失败：这就是「浏览器不给写」那类情况的替身
    __setRepositoryForTest({
      load: () => original.load(),
      save: () => Promise.reject(new Error('模拟：盘写不进去')),
      clear: () => original.clear(),
    })

    useAppStore.getState().addItem({ name: '写不进去的这一件' })
    await flushWrites()
    ok(useAppStore.getState().saveFailure !== null, '这一笔应该如实记为保存失败')

    await useAppStore.getState().init()

    const after = useAppStore.getState().data
    ok(
      after.items.some((item) => item.name === '写不进去的这一件'),
      `写盘失败时也要保住内存里那份 —— 覆盖掉就等于真的弄丢了。实际：${
        after.items.map((i) => i.name).join('、') || '（一件都没有）'
      }`,
    )
  } finally {
    __setRepositoryForTest(null)
    useAppStore.setState({ saveFailure: null, error: null })
  }
})

suite('数据丢失：页面要走了，得把待落盘的抢下来')

await test('★ 页面卸载时，内存里还没落盘的改动会被抢救写下去', async () => {
  /*
   * 用户的报法是「你更新完，我网页的数据就没了」。
   *
   * 一个真实存在的窗口：`commit` 先改内存、把写盘排进队列（IndexedDB 是异步的），
   * 而如果**那一刻页面被卸载**——用户自己刷新、或者开发时 Vite 因为改了
   * i18n 之类模块触发了一次整页重载——排队里那笔写就永远不会执行。
   *
   * 现在 store 在 `pagehide` / `beforeunload` 上挂了抢救写盘，这条验它真的管用。
   */
  await primeStore()

  useAppStore.getState().addItem({ name: '还没落盘就被关掉页面的这一件' })

  // 注意：**不等 writeChain**，直接触发卸载 —— 这就是那个窗口
  flushBeforeUnload()

  // 抢救写盘是异步发起的，给它一点时间
  await new Promise((resolve) => setTimeout(resolve, 30))
  await flushWrites()

  const saved = must(await idbGet<AppData>(STORE_APP, APP_DATA_KEY), '主记录应该还在')
  ok(
    saved.items.some((item) => item.name === '还没落盘就被关掉页面的这一件'),
    `★ 卸载前那笔待落盘的改动必须被写下去。盘上实际有：${
      saved.items.map((i) => i.name).join('、') || '（一件都没有）'
    }`,
  )
})

await test('没有待落盘的改动时不白写（幂等，不该反复写整份数据）', async () => {
  await primeStore()
  useAppStore.getState().addItem({ name: '一件正常的' })
  await flushWrites()

  const before = must(await idbGet<AppData>(STORE_APP, APP_DATA_KEY), '主记录')
  const beforeUpdatedAt = before.updatedAt

  // 已经落盘了，再触发卸载不该产生新写入
  flushBeforeUnload()
  await new Promise((resolve) => setTimeout(resolve, 30))

  const after = must(await idbGet<AppData>(STORE_APP, APP_DATA_KEY), '主记录')
  eq(after.updatedAt, beforeUpdatedAt, '没有脏数据时不该再写一遍')
})

/* ------------------------------------------------------------------ */
/* 醒来发现盘上少了东西 → 自动救回来                                    */
/* ------------------------------------------------------------------ */

suite('数据丢失：醒来发现盘上比快照少，自动恢复')

/** 把盘上写成一份只有 n 件物品的数据（模拟「没存完就关掉了页面」） */
async function writeDiskItems(items: Array<{ id: string; name: string }>): Promise<void> {
  const base = createSeedData('zh')
  await idbPut(
    STORE_APP,
    {
      ...base,
      items: items.map((i) => ({
        id: i.id,
        name: i.name,
        categoryIds: [],
        locationId: null,
        quantity: 1,
        status: 'active',
        tags: [],
        collectionIds: [],
        attrs: {},
        note: '',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        idleAt: null,
        discardedAt: null,
        expiresAt: null,
      })),
    },
    APP_DATA_KEY,
  )
}

await test('★ 盘上 2 件、最新自动快照里有 5 件 → 自动恢复成 5 件并说一声', async () => {
  /*
   * 这是「页面上数据莫名其妙没了」的最后一道防线。
   *
   * 快照是在每次修改**之前**存的，所以数据没丢时盘上那份的物品数一定
   * ≥ 最新的自动快照。反过来说：比它**严格更少**，就一定是丢东西了 ——
   * 一个真实会走到这里的场景是「写完还没落盘，页面就被卸载了」。
   *
   * 这时候与其让用户看到「我的东西没了」，不如把最新快照里的东西放回来，
   * 并如实告诉他发生了什么。
   */
  await clearSnapshots()

  // 先造一份「装满 5 件」的快照（自动快照 = 修改前的状态，也就是完整的那份）
  await createSnapshot(
    {
      ...createSeedData('zh'),
      items: ['甲', '乙', '丙', '丁', '戊'].map(
        (name, i) => ({ ...createSeedData('zh').items[0], id: `keep-${i}`, name }) as never,
      ),
    },
    'auto',
  )

  // 盘上只剩 2 件（模拟丢了一部分）
  await writeDiskItems([
    { id: 'keep-0', name: '甲' },
    { id: 'keep-1', name: '乙' },
  ])

  await useAppStore.getState().init()

  const after = useAppStore.getState().data
  eq(after.items.length, 5, '★ 应该从快照里恢复成 5 件')
  ok(
    after.items.some((i) => i.name === '戊'),
    '丢掉的「戊」必须回来',
  )
  ok(
    useAppStore
      .getState()
      .toasts.some((toast) => toast.message.includes('快照')),
    '要用一条提示如实说明「发现少了、已恢复」，不能悄悄发生',
  )

  await clearSnapshots()
})

await test('盘上和快照一样多 → 不碰它（不能拿旧东西覆盖新的）', async () => {
  await clearSnapshots()

  await createSnapshot(
    { ...createSeedData('zh'), items: [{ ...createSeedData('zh').items[0], id: 'a', name: '甲' } as never] },
    'auto',
  )
  await writeDiskItems([
    { id: 'a', name: '甲' },
    { id: 'b', name: '乙' },
  ])

  await useAppStore.getState().init()

  const after = useAppStore.getState().data
  eq(after.items.length, 2, '盘上更多就不该动 —— 那是用户后来加的')
  ok(after.items.some((i) => i.name === '乙'), '后加的那件必须留着')

  await clearSnapshots()
})

await test('盘上比快照**多** → 更不该动（那是用户新加的东西）', async () => {
  await clearSnapshots()

  await createSnapshot({ ...createSeedData('zh'), items: [] }, 'auto')
  await writeDiskItems([
    { id: 'a', name: '甲' },
    { id: 'b', name: '乙' },
    { id: 'c', name: '丙' },
  ])

  await useAppStore.getState().init()
  eq(useAppStore.getState().data.items.length, 3, '三件都得在')

  await clearSnapshots()
})

await test('主动「清空所有数据」之后重开，不会被快照救回来（那是用户自己要的）', async () => {
  /*
   * 这条守的是**误救**这个方向的风险，而且它是一次真实的测试失败提出来的：
   *
   * 清空之后盘上是 0 件，而快照列表里还躺着一份装满东西的
   * `destructive` 快照 —— 我第一版拿它当依据，于是「清空」变成
   * 「关掉重开又全回来了」，用户会以为清不掉。
   *
   * 现在只认**自动快照**：清空之后的第一笔写入就会存下一份新的
   * 自动快照（数量 0），它成了新的基线。
   */
  await clearSnapshots()

  // 先把「清空前」的样子存成 destructive 快照（clearEverything 就是这么做的）
  await createSnapshot(
    { ...createSeedData('zh'), items: [{ ...createSeedData('zh').items[0], id: 'x', name: '要被清掉的' } as never] },
    'destructive',
  )
  // 清空之后盘上是空的，而且有一份数量 0 的自动快照当新基线
  await createSnapshot({ ...createSeedData('zh'), items: [] }, 'auto')
  await writeDiskItems([])

  await useAppStore.getState().init()
  eq(useAppStore.getState().data.items.length, 0, '★ 清空就是清空，不该被救回来')

  await clearSnapshots()
})
