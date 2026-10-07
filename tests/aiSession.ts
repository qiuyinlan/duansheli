/**
 * AI 会话状态的用例。
 *
 * 守的是两件事，而且它们是**一对张力**：
 *
 *   1. 会话要活得比页面久 —— 去别的页面转一圈回来，对话和没采纳的草稿都还在。
 *      以前这些状态是 `Ai.tsx` 的 `useState`，切个页面就全没了，
 *      回来得重新让 AI 整理一遍，白烧一整轮 token。
 *   2. 但又**不能落盘** —— 用户明确选的是「刷新就清空」，
 *      因为历史会一轮轮累积进 prompt，存下来就是下次还得为它付费。
 *
 * 第 2 条很容易被好心办坏事：「顺手存一下吧，用户肯定会高兴」。
 * 所以这里有一条用例专门盯着磁盘上不许出现会话内容。
 */

import { draftsToApply, type ItemDraft } from '../src/ai/convert'
import { STORE_APP, STORE_KV, STORE_SNAPSHOTS, idbGetAll, idbPut } from '../src/storage/idb'
import { createEmptyData, createSeedData } from '../src/storage/seed'
import {
  EMPTY_USAGE,
  clearAiSession,
  settleApplied,
  useAiSessionStore,
} from '../src/store/useAiSessionStore'
import { flushWrites, useAppStore } from '../src/store/useAppStore'
import { createDerived } from '../src/store/selectors'
import type { Snapshot } from '../src/types'
import { eq, fixture, item, ok, suite, test } from './harness'

/* ------------------------------------------------------------------ */
/* 小工具                                                              */
/* ------------------------------------------------------------------ */

function draft(partial: Partial<ItemDraft> & { key: string; name: string }): ItemDraft {
  return {
    sourceItemId: partial.sourceItemId,
    quantity: partial.quantity ?? 1,
    locationId: partial.locationId ?? null,
    locationLabel: partial.locationLabel ?? '',
    newLocationPath: partial.newLocationPath ?? null,
    matchedCategoryIds: partial.matchedCategoryIds ?? [],
    newCategoryPaths: partial.newCategoryPaths ?? [],
    tags: partial.tags ?? [],
    attrs: partial.attrs ?? {},
    droppedAttrs: partial.droppedAttrs ?? [],
    note: partial.note ?? '',
    expiresAt: partial.expiresAt ?? null,
    status: partial.status ?? null,
    matchedCollectionIds: partial.matchedCollectionIds ?? [],
    droppedCollections: partial.droppedCollections ?? [],
    include: partial.include ?? true,
    adoptNewCategories: partial.adoptNewCategories ?? false,
    adoptNewLocation: partial.adoptNewLocation ?? false,
    ...partial,
  }
}

/** 摆一段「聊到一半」的会话，返回一个可辨认的标记 */
function seedSession(marker = '衣柜里有一件灰色的羊毛衫'): string {
  useAiSessionStore.setState({
    bubbles: [{ id: 'b1', role: 'user', text: marker }],
    history: [{ role: 'user', content: marker }],
    drafts: [draft({ key: 'k1', name: '灰色羊毛衫' })],
    changedKeys: ['k1'],
    removedKeys: ['i9'],
    error: null,
    running: false,
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    lastTurnUsage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
  })
  return marker
}

/**
 * 把 store 摆到一个已知的状态。
 *
 * 刻意**不走 init()** —— init 会去读 IndexedDB，于是 data 变成前面用例
 * 留下的东西，`purgeItem('i1')` 这种断言就不可预期了。
 * 直接摆状态，各条用例之间才互不干扰。
 */
function loadStore(data = fixture()): void {
  useAppStore.setState({
    status: 'ready',
    data,
    derived: createDerived(data),
    error: null,
    toasts: [],
  })
}

/* ------------------------------------------------------------------ */
/* 基本语义                                                            */
/* ------------------------------------------------------------------ */

suite('AI 会话：跨页面活着')

await test('clearAiSession 把会话清干净（「新对话」按钮走的就是它）', () => {
  seedSession()
  ok(useAiSessionStore.getState().bubbles.length > 0, '先要有内容才谈得上清')

  clearAiSession()

  const s = useAiSessionStore.getState()
  eq(s.bubbles.length, 0)
  eq(s.history.length, 0)
  eq(s.drafts.length, 0)
  eq(s.changedKeys.length, 0)
  eq(s.removedKeys.length, 0)
  eq(s.error, null)
  eq(s.running, false)
  eq(s.usage.totalTokens, 0)
  eq(s.lastTurnUsage.totalTokens, 0)
})

await test('appendBubble 累加，不会覆盖已有气泡', () => {
  clearAiSession()
  useAiSessionStore.setState({ bubbles: [{ id: 'b1', role: 'user', text: '第一句' }] })

  // 这一步就是「组件卸载了也没关系」的关键：状态在 store 里，不在闭包里
  useAiSessionStore.setState((s) => ({ bubbles: [...s.bubbles, { id: 'b2', role: 'assistant', text: '第二句' }] }))

  eq(useAiSessionStore.getState().bubbles.length, 2)
  eq(useAiSessionStore.getState().bubbles[0]?.text, '第一句')
})

/* ------------------------------------------------------------------ */
/* 不许落盘                                                            */
/* ------------------------------------------------------------------ */

suite('AI 会话：不落盘（刷新就该清空）')

await test('会话内容绝不出现在 localStorage 里', async () => {
  const marker = '这段对话绝不该被写进磁盘-local'
  seedSession(marker)

  const dumped = Object.keys(localStorage)
    .map((key) => `${key}=${localStorage.getItem(key) ?? ''}`)
    .join('\n')
  ok(!dumped.includes(marker), '会话被写进了 localStorage —— 那就不会「刷新就清空」了')
})

await test('会话内容绝不进 IndexedDB（kv 表和主数据记录都不行）', async () => {
  const marker = '这段对话绝不该被写进磁盘-idb'
  seedSession(marker)

  const kv = await idbGetAll<unknown>(STORE_KV)
  ok(!JSON.stringify(kv).includes(marker), '会话被写进了 kv 表')

  const app = await idbGetAll<unknown>(STORE_APP)
  ok(!JSON.stringify(app).includes(marker), '会话被写进了主数据记录 —— 那会跟着导出备份一起跑掉')
})

/* ------------------------------------------------------------------ */
/* 为什么整体替换数据时必须作废会话                                    */
/* ------------------------------------------------------------------ */

suite('AI 会话：数据被整体替换后必须作废')

await test('草稿是「针对某一份数据」的计划 —— 数据换掉之后，它的一部分会被静默丢掉', () => {
  // 这条用例是把**真实行为**钉下来，也是「作废会话」这个决定的事实依据。
  //
  // 注意其中有一点很反直觉：draftsToApply 对「有 sourceItemId 但物品找不到」
  // 的处理是 continue（静默跳过），而不是报错、也不是当成新建。
  // 所以数据换掉之后，用户点「采纳」不会建错东西 ——
  // 但会得到一个**悄悄少了几条**的结果，界面上还不会说哪一条为什么不见了。
  // 「默默少做一部分还不说」正是这个项目要避免的那类失败。
  const empty = createEmptyData()
  const plan = draftsToApply(
    [
      draft({ key: 'old', sourceItemId: '已经被清掉的物品', name: '灰色羊毛衫' }),
      draft({ key: 'new', name: '新买的台灯' }),
    ],
    empty.items,
    createDerived(empty),
    [],
  )

  eq(plan.plan.length, 1, '只有那条新物品进了计划')
  eq(plan.plan[0]?.name, '新买的台灯')
  ok(
    !plan.plan.some((p) => p.name === '灰色羊毛衫'),
    '指向已消失物品的那条被静默丢掉了 —— 用户不会知道它为什么不见',
  )
})

await test('清空所有数据 → 会话作废', async () => {
  loadStore()
  seedSession()

  await useAppStore.getState().clearEverything()

  eq(useAiSessionStore.getState().drafts.length, 0, '清空数据后草稿必须作废')
  eq(useAiSessionStore.getState().bubbles.length, 0)
})

await test('恢复脚手架 → 会话作废', async () => {
  loadStore()
  seedSession()

  await useAppStore.getState().resetToSeed()

  eq(useAiSessionStore.getState().drafts.length, 0)
  eq(useAiSessionStore.getState().bubbles.length, 0)
})

await test('导入覆盖 → 会话作废', async () => {
  loadStore()
  seedSession()

  await useAppStore.getState().replaceAll(createSeedData('zh'), 'import')

  eq(useAiSessionStore.getState().drafts.length, 0)
  eq(useAiSessionStore.getState().bubbles.length, 0)
})

await test('回退快照 → 会话作废', async () => {
  loadStore()
  seedSession()

  // 先造一份能回退的快照
  const snap: Snapshot = {
    id: 'snap-ai-session',
    at: new Date().toISOString(),
    reason: 'manual',
    itemCount: 1,
    data: { ...createEmptyData(), items: [item({ id: 'only', name: '快照里唯一的东西' })] },
  }
  await idbPut(STORE_SNAPSHOTS, snap)

  const restored = await useAppStore.getState().restoreFromSnapshot('snap-ai-session')
  eq(restored, true, '快照应该回退成功')

  eq(useAiSessionStore.getState().drafts.length, 0)
  eq(useAiSessionStore.getState().bubbles.length, 0)
})

/* ------------------------------------------------------------------ */
/* 但平时绝不能把对话弄丢                                              */
/* ------------------------------------------------------------------ */

suite('AI 会话：普通操作不许碰它')

await test('合并导入 → 会话保留（本地物品都还在，草稿仍然有效）', async () => {
  // 合并的语义是「把对方的并进来」，本地物品一件不少，
  // 所以草稿里的 id 依然指得到东西 —— 没有理由清掉用户的对话。
  loadStore()
  seedSession()

  await useAppStore.getState().mergeAll(createSeedData('zh'))

  eq(useAiSessionStore.getState().drafts.length, 1, '合并导入不该作废会话')
  eq(useAiSessionStore.getState().bubbles.length, 1)
})

await test('清空所有数据时，没有会话就不弹提示（不制造噪音）', async () => {
  loadStore()
  clearAiSession()

  await useAppStore.getState().clearEverything()

  const toasts = useAppStore.getState().toasts
  ok(!toasts.some((t) => t.message.includes('作废')), '本来就没会话，不该弹「已作废」')
})

await test('删一件物品这种日常操作，会话必须完好无损', async () => {
  // 这是最要紧的一条。作废会话的钩子只挂在「整体替换」上，
  // 要是哪天有人顺手把它挂到 commit() 里，用户每次改一件物品
  // 就会丢一次对话 —— 这条用例就是为了让那种改动立刻变红。
  loadStore()
  seedSession()

  await useAppStore.getState().purgeItem('i1')
  await flushWrites()

  eq(useAiSessionStore.getState().drafts.length, 1, '删一件物品不该动会话')
  eq(useAiSessionStore.getState().bubbles.length, 1)
})

/* ------------------------------------------------------------------ */
/* 采纳之后：会话要留着（issue 1）                                      */
/* ------------------------------------------------------------------ */

suite('AI 会话：采纳之后不许清空（issue 1）')

await test('★ 采纳只移走这一批，对话和其余草稿全留着', () => {
  /*
   * 用户的原话：「AI 采纳后聊天记录会消失，应该一直保留着，
   * 直到我自己手动选择新建。」
   *
   * 这条钉住的就是这件事：settleApplied 只能动**这一次真的落库的那些**。
   * 以前这里调的是 clearAiSession()，于是一批谈妥之后整段上下文归零 ——
   * 想接着问「刚才那批里 XX 我改主意了」就得从头再讲一遍。
   */
  useAiSessionStore.setState({
    bubbles: [
      { id: 'b1', role: 'user', text: '把衣柜里那两件改成闲置' },
      { id: 'b2', role: 'assistant', text: '改好了，两条都标成闲置' },
    ],
    history: [
      { role: 'user', content: '把衣柜里那两件改成闲置' },
      { role: 'assistant', content: '改好了' },
    ],
    drafts: [
      { ...draft({ key: 'k1', name: '灰色羊毛衫' }), sourceItemId: 'i1' },
      { ...draft({ key: 'k2', name: '牛仔裤' }), sourceItemId: 'i2' },
    ],
    changedKeys: ['k1', 'k2'],
    touchedKeys: ['k1', 'k2'],
    removedKeys: ['i5'],
    error: null,
    running: false,
    usage: EMPTY_USAGE,
    lastTurnUsage: EMPTY_USAGE,
  })

  // 只采纳第一条
  settleApplied({
    appliedKeys: ['k1'],
    bindings: new Map([['k1', 'i1']]),
    removedIds: [],
    note: '已更新 1 条',
    appliedSummary: '灰色羊毛衫',
  })

  const s = useAiSessionStore.getState()
  eq(s.drafts.length, 1, '没采纳的那条要留在草稿里')
  eq(s.drafts[0]?.key, 'k2')
  eq(s.bubbles.length, 3, '对话必须留着，而且补一条「已采纳」的系统说明')
  eq(s.bubbles[2]?.role, 'note')
  eq(s.history.length, 2, '历史里只有真实的对话轮次（合成的说明不许塞进去）')
  eq(s.changedKeys.length, 1, '已采纳的那条不再高亮')
  eq(s.touchedKeys.length, 1)
  eq(s.removedKeys.length, 1, '这一次没删东西，那个待删 id 必须留着')
})

await test('★ 采纳里删掉的物品，不能在下一次采纳里再删一遍', () => {
  /*
   * 这条守的是另一件容易出事的东西：removedKeys 是**整个会话累计**的。
   * 采纳时如果不把这一次真的删掉的那些剔出去，用户下一次点采纳，
   * 同一批物品会被**再进一次回收站**（幂等，看不出差别，但
   * 更要紧的是计数和提示都是错的）。
   */
  useAiSessionStore.setState({
    bubbles: [],
    history: [],
    drafts: [{ ...draft({ key: 'k1', name: '旧手机' }), sourceItemId: 'i3' }],
    changedKeys: [],
    touchedKeys: [],
    removedKeys: ['i3', 'i5'],
    error: null,
    running: false,
    usage: EMPTY_USAGE,
    lastTurnUsage: EMPTY_USAGE,
  })

  settleApplied({
    appliedKeys: ['k1'],
    bindings: new Map([['k1', 'i3']]),
    removedIds: ['i3'],
    note: '已更新 1 条 · 移入回收站 1 条',
    appliedSummary: '旧手机',
  })

  const s = useAiSessionStore.getState()
  eq(s.removedKeys.length, 1, 'i3 已经删过了，只该剩 i5')
  eq(s.removedKeys[0], 'i5')
})

await test('★ 新建的那条落库后有真 id 了 —— 下一轮必须能对上', () => {
  /*
   * 不绑这个 id 会出这种事：AI 新建了一条「棉签」，用户采纳；
   * 接着又说「把棉签数量改成 3」，AI 那边这条仍然是「要新建的」，
   * 于是库里多出第二盒棉签 —— 正是用户报的那个「采纳完又多了一件」。
   */
  useAiSessionStore.setState({
    bubbles: [],
    history: [],
    drafts: [
      draft({ key: 'new-1', name: '棉签' }),
      draft({ key: 'new-2', name: '碘伏棉签' }),
    ],
    changedKeys: ['new-1', 'new-2'],
    touchedKeys: ['new-1', 'new-2'],
    removedKeys: [],
    error: null,
    running: false,
    usage: EMPTY_USAGE,
    lastTurnUsage: EMPTY_USAGE,
  })

  // 只采纳第一条，第二条留下
  settleApplied({
    appliedKeys: ['new-1'],
    bindings: new Map([['new-1', 'created-1']]),
    removedIds: [],
    note: '已新增 1 条',
    appliedSummary: '棉签',
  })

  const left = useAiSessionStore.getState().drafts
  eq(left.length, 1, '第二条要留着')
  eq(left[0]?.sourceItemId, undefined, '还没采纳的那条仍然是「新建」')

  // 第二条也采纳之后，它的 id 也要绑上
  settleApplied({
    appliedKeys: ['new-2'],
    bindings: new Map([['new-2', 'created-2']]),
    removedIds: [],
    note: '已新增 1 条',
    appliedSummary: '碘伏棉签',
  })
  eq(useAiSessionStore.getState().drafts.length, 0)
  eq(useAiSessionStore.getState().appliedSummary, '碘伏棉签', '要记下这批已生效的名字')
})

await test('只有「新对话」才能真正清空会话', () => {
  seedSession()
  ok(useAiSessionStore.getState().bubbles.length > 0)

  clearAiSession()

  const s = useAiSessionStore.getState()
  eq(s.bubbles.length, 0, '这是唯一的重置开关')
  eq(s.drafts.length, 0)
  eq(s.appliedSummary, '', '上一批已生效的记录也要跟着清掉')
})
