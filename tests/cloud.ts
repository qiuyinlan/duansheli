/**
 * 云端同步（Supabase）。
 *
 * ── 这个文件测什么 ────────────────────────────────────────────────
 * 全是**纯逻辑**：信封格式、删除墓碑、合并规则、两台设备会不会收敛。
 * 刻意不碰网络 —— 那是去测 Supabase，不是测这个项目（这条和 README 里
 * 「测试不覆盖网络请求本身」是一致的）。
 *
 * ── 为什么这些断言值得写 ──────────────────────────────────────────
 * 同步是这个项目里唯一一个「会把数据合到一起」的功能，而它出错的后果
 * 和别处不一样：不是界面难看，是**用户的东西没了，而且没有报错**。
 * 所以这里钉的是四条底线：
 *   1. 合并**只做加法** —— 两边的东西合完都得在（别人报过「合并反而变少」）
 *   2. 删除要**传得过去**，但不能把「删完之后又改过」的那种改动一起抹掉
 *   3. 两台设备来回同步之后必须**收敛**，而且再同步一次不再发生变化
 *      （不收敛 = 每次同步都推一遍，一直推下去）
 *   4. 远端那份形状不对时**绝不合并**，宁可报错
 */

import {
  type CloudEnvelope,
  applyTombstones,
  canonical,
  checkEnvelope,
  collectRemovals,
  hasAnyItems,
  makeEnvelope,
  mergeEnvelopes,
  mergeTombstones,
  pruneTombstones,
  sameContent,
  sameEnvelopeContent,
  TOMBSTONE_TTL_DAYS,
} from '../src/cloud/envelope'
import { createEmptyData, createSeedData } from '../src/storage/seed'
import { isSecretKey, evaluateConfig } from '../src/cloud/client'
import { probeCloud } from '../src/cloud/diagnose'
import type { AppData, Category, Item, Location } from '../src/types'
import { item as makeItem } from './harness'
import { eq, must, ok, suite, test } from './harness'

/* ------------------------------------------------------------------ */
/* 夹具：时间全部写死                                                  */
/* ------------------------------------------------------------------ */

/*
 * 时间戳**相对今天**算出来，不写死成具体日期。
 *
 * 为什么：墓碑有保留期（TOMBSTONE_TTL_DAYS），写死成 "2026-01-01" 这种日期，
 * 过半年这份测试就会开始红 —— 而且红的原因和被测代码一点关系都没有，
 * 是因为「夹具里的日期过期了」。相对时间无论哪天跑都成立。
 *
 * 三个值都必须落在保留期**之内**（所以用 1~3 天前，而不是几个月前）。
 */
const DAY_MS = 24 * 3600 * 1000
const NOW = Date.now()
const T0 = new Date(NOW - 3 * DAY_MS).toISOString()
const T1 = new Date(NOW - 2 * DAY_MS).toISOString()
const T2 = new Date(NOW - 1 * DAY_MS).toISOString()

function cat(id: string, name: string): Category {
  return { id, name, parentId: null, order: 0, createdAt: T0 }
}

function loc(id: string, name: string): Location {
  return { id, name, parentId: null, note: '', order: 0, createdAt: T0 }
}

/** 一室两物：ia 有分类和位置，ib 是光身子的一件 —— 覆盖「有引用」和「没引用」 */
function base(): AppData {
  const empty = createEmptyData()
  const ia: Item = makeItem({
    id: 'ia',
    name: '灰色羊毛衫',
    categoryIds: ['c1'],
    locationId: 'l1',
    updatedAt: T0,
    createdAt: T0,
  })
  const ib: Item = makeItem({ id: 'ib', name: '旧手机', updatedAt: T0, createdAt: T0 })
  return {
    ...empty,
    categories: [cat('c1', '衣物')],
    locations: [loc('l1', '衣柜')],
    items: [ia, ib],
  }
}

function withoutItem(data: AppData, id: string): AppData {
  return { ...data, items: data.items.filter((i) => i.id !== id) }
}

function envelope(data: AppData, deleted: Record<string, string> = {}, deviceId = 'dev-test') {
  return makeEnvelope(data, deleted, deviceId, T0)
}

/* ------------------------------------------------------------------ */
/* 信封本身                                                            */
/* ------------------------------------------------------------------ */

suite('云端同步 · 信封与校验')

await test('形状不对的远端数据一律拒绝（本地那份不能拿去合）', () => {
  eq(checkEnvelope(null).ok, false, 'null 必须被拒绝')
  eq(checkEnvelope([]).ok, false, '数组必须被拒绝')
  eq(checkEnvelope('随便一段字符串').ok, false, '字符串必须被拒绝')
  eq(checkEnvelope({}).ok, false, '空对象必须被拒绝')

  // 信封格式版本比自己高：以后加了字段，老程序读不懂
  eq(checkEnvelope({ v: 2, schemaVersion: 1, data: base(), deleted: {} }).reason, 'versionTooNew')

  // 数据结构版本比自己高：和导入备份是同一条规矩 —— 老程序明确拒绝，不静默丢字段
  eq(
    checkEnvelope({ v: 1, schemaVersion: 99, data: base(), deleted: {} }).reason,
    'badSchema',
  )

  // data 里少了一个集合
  eq(
    checkEnvelope({ v: 1, schemaVersion: 1, data: { items: [] }, deleted: {} }).reason,
    'badData',
  )

  // 墓碑的时间不是字符串
  eq(
    checkEnvelope({ v: 1, schemaVersion: 1, data: base(), deleted: { x: 123 } }).reason,
    'badDeleted',
  )

  eq(checkEnvelope(envelope(base())).ok, true, '正常信封必须通过')
})

await test('认得出「这台设备还没录东西」（首次同步靠它决定要不要问用户）', () => {
  // 脚手架铺好了（分类 / 位置 / 属性都有），但一件物品都没有 —— 就是新设备第一次打开的样子
  const scaffoldOnly = createSeedData('zh')
  eq(hasAnyItems(scaffoldOnly), false)
  ok(scaffoldOnly.categories.length > 0, '夹具本身要有分类，才说明这条测的是「只看物品」')

  eq(hasAnyItems(base()), true)
})

/* ------------------------------------------------------------------ */
/* 钥匙的安全检查                                                      */
/* ------------------------------------------------------------------ */

/**
 * 把一段载荷载进一个假 JWT 里（老格式的 anon / service_role 就是这种）。
 * base64url：+ 换成 -、/ 换成 _、去掉末尾的 =。
 */
function fakeJwt(payload: Record<string, unknown>): string {
  const body = btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${body}.c2ln`
}

suite('云端同步 · 钥匙的安全检查')

/*
 * ⚠️ 这个文件里**不许出现真实项目的地址和钥匙**。
 *
 * 我写这批用例时图省事，直接把手上那个项目的 URL 和 Publishable key 抄了进来，
 * 而其中一处还拿它当断言值 —— 结果就是「一个真人项目的身份」被焊进了
 * 要推到公开仓库的代码里。Publishable key 设计上确实是公开的（它会打进网页 JS），
 * 所以危害有限，但两件事都不该做：
 *   · 没必要把某个人的项目信息写进通用代码
 *   · 一旦哪天这把钥匙被换用途或项目被改成别的配置，这行注释会误导后来的人
 * 所以下面用的是**形状相同、内容是假的**的样例值。
 */
const SAMPLE_URL = 'https://sampleprojectref.supabase.co'
const SAMPLE_KEY = 'sb_publishable_sample-key-not-a-real-one'

await test('配好了没有：四种情况各归各位', () => {
  /*
   * 这段判断是**唯一**能拦住「把全库钥匙挂到网页上」的地方，所以要逐条钉住。
   * 用真实的取值形状来测 —— 新版控制台给的就是 sb_publishable_ 开头这种。
   */
  const good = evaluateConfig({
    VITE_SUPABASE_URL: SAMPLE_URL,
    VITE_SUPABASE_ANON_KEY: SAMPLE_KEY,
  })
  eq(good.problem, null, '正常的一套值不该被判成有问题')
  eq(good.config?.url, SAMPLE_URL)
  eq(good.config?.anonKey, SAMPLE_KEY)

  // 老格式的 anon（JWT）同样要能用 —— 老项目还在用
  const legacy = evaluateConfig({
    VITE_SUPABASE_URL: 'https://abcdefgh.supabase.co',
    VITE_SUPABASE_ANON_KEY: fakeJwt({ role: 'anon' }),
  })
  eq(legacy.problem, null)
  ok(legacy.config !== null)

  // 少一个就是「没配」
  eq(evaluateConfig({ VITE_SUPABASE_URL: 'https://abcdefgh.supabase.co' }).problem, 'missing')
  eq(evaluateConfig({}).problem, 'missing')
  // 只写了空格也不能算配好
  eq(
    evaluateConfig({
      VITE_SUPABASE_URL: 'https://abcdefgh.supabase.co',
      VITE_SUPABASE_ANON_KEY: '   ',
    }).problem,
    'missing',
  )

  // 还是模板里的示例值
  eq(
    evaluateConfig({
      VITE_SUPABASE_URL: 'https://xxxxxxxxxxxx.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'sb_publishable_xxxxxxxxxxxxxxxxxxxxxxxx',
    }).problem,
    'placeholder',
  )

  // 拿错钥匙：**不许**被当成配置好了、更不许拿去连
  const wrong = evaluateConfig({
    VITE_SUPABASE_URL: 'https://abcdefgh.supabase.co',
    VITE_SUPABASE_ANON_KEY: 'sb_secret_abcdefgh',
  })
  eq(wrong.problem, 'secretKey')
  eq(wrong.config, null, '危险的钥匙绝不能变成可用的配置')

  eq(
    evaluateConfig({
      VITE_SUPABASE_URL: 'https://abcdefgh.supabase.co',
      VITE_SUPABASE_ANON_KEY: fakeJwt({ role: 'service_role' }),
    }).problem,
    'secretKey',
  )
})

await test('Secret key 必须被认出来并拦住（拿错了等于把全库钥匙挂在网页上）', () => {
  /*
   * 为什么这条值得单独测：前端代码会被打进网页 JS，谁都能看到。
   * 填错成 Secret key 的后果不是「同步失败」，是**别人能读整个数据库**，
   * 而且那个页面可能已经部署出去了。所以这里认的不是「格式对不对」，
   * 是「这把钥匙能不能绕过安全规则」。
   */
  // 新格式：Secret key 与 Publishable key
  eq(isSecretKey('sb_secret_abcdefg'), true, 'sb_secret_ 开头的一律拦下')
  eq(isSecretKey(SAMPLE_KEY), false, 'publishable 是允许的')

  // 老格式：一段 JWT，payload 里写着角色
  eq(isSecretKey(fakeJwt({ role: 'service_role' })), true, '老的 service_role 也要拦')
  eq(isSecretKey(fakeJwt({ role: 'anon' })), false, '老的 anon 是允许的')

  // 认不出来的一律不误判（宁可让它去连、由服务端拒绝，也不要拦住正常配置）
  eq(isSecretKey(''), false)
  eq(isSecretKey('随便一段字符串'), false)
  eq(isSecretKey('eyJhbGciOiJIUzI1NiJ9.not-base64!!.sig'), false, '解不开的 JWT 不能误判成危险钥匙')
})

await test('键的顺序不同不算「变了」（jsonb 会重排键）', () => {
  /*
   * 这一条挡的是一个**死循环**：远端那份从 Postgres 的 jsonb 里取回来时
   * 键的顺序已经被重排过，用 JSON.stringify 比一定「不相等」，
   * 于是每次同步都判定「有变化」→ 推一遍 → 拉回来又觉得变了 → 一直推。
   */
  const a = { name: '羊毛衫', id: 'ia', quantity: 1 }
  const b = { quantity: 1, id: 'ia', name: '羊毛衫' }
  eq(canonical(a), canonical(b), '同样的内容、不同的键序，必须序列化成同一个字符串')

  // 数组顺序**必须**算差异：排序和清单条目的先后是有意义的
  ok(canonical([1, 2, 3]) !== canonical([3, 2, 1]), '数组顺序不能被视为等价')
})

await test('内容比对忽略 updatedAt（否则每合并一次都算「变了」）', () => {
  const a = base()
  const b = { ...base(), updatedAt: T2 }
  eq(sameContent(a, b), true)

  const c = { ...base(), items: [base().items[0]] }
  eq(sameContent(a, c), false)
})

await test('集合的先后不同不算「变了」（否则两台设备会互推个没完）', () => {
  /*
   * 这一条挡的是另一种死循环：合并是「以当前这份为主、对方新增的接在后面」，
   * 所以同一个结果在两台设备上的数组顺序天然不同。按数组位置比就是
   * 永远「不相等」→ 每次同步都推一遍、每次都重写一遍本地数据。
   */
  const a = base()
  const b = { ...base(), items: [...base().items].reverse() }
  eq(sameContent(a, b), true, '只有顺序不同 → 必须算作一样')

  // 但真的少了东西必须认得出
  eq(sameContent(a, { ...base(), items: [base().items[1]] }), false)

  // 标签只比名字集合：createdAt 是「第一次见到这个名字」的时间，两台设备必然不同
  const tagA: AppData = { ...base(), tags: [{ name: '舍不得扔', createdAt: T0 }] }
  const tagB: AppData = { ...base(), tags: [{ name: '舍不得扔', createdAt: T2 }] }
  eq(sameContent(tagA, tagB), true, '同名标签的时间差不算变化')

  const tagC: AppData = { ...base(), tags: [{ name: '想送人', createdAt: T0 }] }
  eq(sameContent(tagA, tagC), false, '标签名字不同必须认得出')
})

/* ------------------------------------------------------------------ */
/* 删除墓碑                                                            */
/* ------------------------------------------------------------------ */

suite('云端同步 · 删除要传得过去，改动不能白改')

await test('A 删掉的东西，合并到 B 那边也不见了', () => {
  const a = envelope(withoutItem(base(), 'ia'), { ia: T1 }, 'dev-a')
  const b = envelope(base(), {}, 'dev-b')

  const merged = mergeEnvelopes(b, a)
  eq(merged.data.items.length, 1, 'ia 应该被墓碑按下去，只剩 ib')
  eq(merged.data.items[0].id, 'ib')
  eq(merged.removed, 1)
})

await test('删掉之后又在另一台设备上改过 → 改动赢，不许静默抹掉', () => {
  const edited: AppData = {
    ...base(),
    items: base().items.map((i) => (i.id === 'ia' ? { ...i, name: '改过的羊毛衫', updatedAt: T2 } : i)),
  }
  const a = envelope(withoutItem(base(), 'ia'), { ia: T1 }, 'dev-a')
  const b = envelope(edited, {}, 'dev-b')

  const merged = mergeEnvelopes(b, a)
  const kept = must(
    merged.data.items.find((i) => i.id === 'ia'),
    '改动时间比删除时间新 —— 这一条必须留下',
  )
  eq(kept.name, '改过的羊毛衫')
})

await test('删分类 / 删位置之后，物品上指向它的引用会被摘掉', () => {
  /*
   * 注意这里是「把墓碑给它，看它怎么处理」——分类和位置都还在 data 里，
   * 由 applyTombstones 自己删掉（这才是真实路径：本机那份里也还有这个分类，
   * 是墓碑说明它在别处被删了）。
   */
  const applied = applyTombstones(base(), { c1: T1, l1: T1 })

  eq(applied.removed, 2, '分类和位置各算一次')
  eq(applied.data.categories.length, 0, '分类要被删掉')
  eq(applied.data.locations.length, 0, '位置要被删掉')

  const ia = must(
    applied.data.items.find((i) => i.id === 'ia'),
    'ia 应该还在（只是引用被摘掉）',
  )
  eq(ia.categoryIds.length, 0, '指向已删除分类的引用必须摘掉')
  eq(ia.locationId, null, '指向已删除位置的引用必须变成未归位')

  // 原先的 data 不能被就地改掉 —— 它可能正是 store 里正在渲染的那一份
  eq(base().items[0].categoryIds.length, 1, '原数据必须保持不变')
})

await test('两台设备各删各的，两边都要作数', () => {
  const a = envelope(withoutItem(base(), 'ia'), { ia: T1 }, 'dev-a')
  const b = envelope(withoutItem(base(), 'ib'), { ib: T2 }, 'dev-b')

  const merged = mergeEnvelopes(a, b)
  eq(merged.deleted.ia, T1)
  eq(merged.deleted.ib, T2)
  eq(merged.data.items.length, 0, '两边删掉的都要按下去')
})

await test('删除记录不会无限堆着（老墓碑会过期）', () => {
  const old = new Date(Date.now() - (TOMBSTONE_TTL_DAYS + 1) * 24 * 3600 * 1000).toISOString()
  const kept = pruneTombstones({ gone: old, recent: T2 }, createEmptyData())
  eq(kept.gone, undefined, '超过保留期的墓碑要清掉')
  eq(kept.recent, T2, '没过期的要留着')
})

await test('记录复活之后，那条墓碑自动作废', () => {
  const data: AppData = {
    ...base(),
    items: base().items.map((i) => (i.id === 'ia' ? { ...i, updatedAt: T2 } : i)),
  }
  const left = pruneTombstones({ ia: T1 }, data)
  eq(left.ia, undefined, '活得比墓碑新 → 墓碑没有意义了，丢掉')
})

await test('本机删除会被记成墓碑（比对前后两份数据的差）', () => {
  const before = base()
  const after = withoutItem(base(), 'ia')
  const removals = collectRemovals(before, after, T1)
  eq(removals.ia, T1)
  eq(Object.keys(removals).length, 1, '没删的东西不许乱记')

  // 只是改了名字 —— 一条墓碑都不该产生
  const renamed: AppData = {
    ...base(),
    items: base().items.map((i) => (i.id === 'ia' ? { ...i, name: '改名了' } : i)),
  }
  eq(Object.keys(collectRemovals(before, renamed, T1)).length, 0)
})

await test('合并只做加法：两台设备各自录的东西合完都在（issue 14 那条底线）', () => {
  const aItems = [...base().items, makeItem({ id: 'i-new-a', name: '电脑上录的', updatedAt: T2 })]
  const bItems = [...base().items, makeItem({ id: 'i-new-b', name: '手机上录的', updatedAt: T2 })]
  const a = envelope({ ...base(), items: aItems }, {}, 'dev-a')
  const b = envelope({ ...base(), items: bItems }, {}, 'dev-b')

  const merged = mergeEnvelopes(a, b)
  const ids = merged.data.items.map((i) => i.id).sort()
  eq(ids.join(','), 'i-new-a,i-new-b,ia,ib', '合并之后一件都不能少')
})

await test('同一个 id 两边都改过 → 改动时间较新的那份赢', () => {
  const older: AppData = {
    ...base(),
    items: base().items.map((i) => (i.id === 'ia' ? { ...i, name: '旧的改动', updatedAt: T1 } : i)),
  }
  const newer: AppData = {
    ...base(),
    items: base().items.map((i) => (i.id === 'ia' ? { ...i, name: '新的改动', updatedAt: T2 } : i)),
  }
  const merged = mergeEnvelopes(envelope(older, {}, 'dev-a'), envelope(newer, {}, 'dev-b'))
  eq(merged.data.items.find((i) => i.id === 'ia')?.name, '新的改动')
})

/* ------------------------------------------------------------------ */
/* 连接自检                                                            */
/* ------------------------------------------------------------------ */

/**
 * 一个假的 fetch：按 URL 里出现的片段挑返回值。
 *
 * 顺序有讲究 —— `app_data` 那条要排在 `/rest/v1/` 前面，
 * 因为前者的地址里也含后者。
 */
function fakeFetch(
  script: Record<string, { status: number; body?: string } | 'network-error'>,
): ((input: string) => Promise<{ status: number; text: () => Promise<string> }>) & { calls: string[] } {
  /*
   * 匹配顺序：**更具体的地址必须优先**。
   * `/rest/v1/app_data` 这个地址里也含 `/rest/v1/`，所以不能按长度排 ——
   * 按长度排的话 `/rest/v1/`（9 个字符）会先于 `app_data`（8 个字符）命中，
   * 于是「表的返回」被当成「根路径的返回」，两条断言就莫名其妙地红了。
   */
  const keys = Object.keys(script).sort((a, b) => {
    if (a === 'app_data') return -1
    if (b === 'app_data') return 1
    return b.length - a.length
  })
  const calls: string[] = []
  const fn = async (input: string) => {
    calls.push(input)
    for (const key of keys) {
      if (!input.includes(key)) continue
      const hit = script[key]
      if (hit === 'network-error') throw new Error('Failed to fetch')
      return { status: hit.status, text: async () => hit.body ?? '' }
    }
    throw new Error(`假的 fetch 没配这个地址：${input}`)
  }
  return Object.assign(fn, { calls })
}

const CONFIG = {
  url: 'https://abcdefgh.supabase.co',
  anonKey: 'sb_publishable_test',
}

suite('云端同步 · 连接自检')

await test('一切正常：连得上、表锁着、邮箱登录开着', async () => {
  const doFetch = fakeFetch({
    'auth/v1/settings': {
      status: 200,
      body: JSON.stringify({ external: { email: true }, mailer_autoconfirm: true, disable_signup: false }),
    },
    app_data: { status: 401, body: '{"code":"42501","message":"permission denied for table app_data"}' },
  })

  const checks = await probeCloud(CONFIG, doFetch)

  eq(checks.length, 3)
  eq(checks[0].outcome, 'ok')
  eq(checks[0].messageKey, 'cloud.probeReachOk')
  eq(checks[1].outcome, 'ok')
  eq(checks[1].messageKey, 'cloud.probeTableLocked', '「未登录读不到」是**好**结果')
  eq(checks[2].outcome, 'ok')
  eq(checks[2].messageKey, 'cloud.probeAuthAuto')
  eq(checks[2].noteKey, 'cloud.probeSignupOpen', '注册开着要提一句')

  /*
   * ★ 绝对不许去探 `/rest/v1/`（REST 的根路径）。
   *
   * 它在新钥匙体系下**只接受 Secret key**：拿 Publishable key 问它会得到
   * `{"message":"Secret API key required"}` —— 于是「一切正常」被报成
   * 「钥匙被拒绝」。这个坑踩过一次就够了，所以这里连「问过没有」都断言。
   */
  ok(
    doFetch.calls.every((url) => !/\/rest\/v1\/$/.test(url)),
    '探针不能去问 REST 根路径：它只认 Secret key，会把好配置报成坏钥匙',
  )
})

await test('请求根本没发出去 + 不带钥匙也不通 → 网络或全局拦截', async () => {
  const checks = await probeCloud(
    CONFIG,
    fakeFetch({ app_data: 'network-error' }),
    async () => false,
  )

  // 后面几步必然也是同样的失败，列三行一样的话只会让人以为是三个问题
  eq(checks.length, 1)
  eq(checks[0].outcome, 'fail')
  eq(checks[0].messageKey, 'cloud.probeBlocked')
  eq(checks[0].noteKey, 'cloud.probeBlockedHint')
  eq(checks[0].status, null)
})

await test('★ 不带钥匙能通、带钥匙不通 → 卡在预检，不是网络问题', async () => {
  /*
   * 这两件事的解决办法完全相反：
   *   · 网络不通      → 换网络 / 开代理
   *   · 预检被拦      → 关扩展 / 关代理或安全软件
   * 而 fetch 失败时抛的永远只有一句 "Failed to fetch"，光靠它分不出来。
   * 所以多问一次「不带自定义头的简单请求通不通」—— 简单请求不触发预检。
   */
  const checks = await probeCloud(
    CONFIG,
    fakeFetch({ app_data: 'network-error' }),
    async () => true,
  )

  eq(checks.length, 1)
  eq(checks[0].messageKey, 'cloud.probeBlockedWithKey')
  eq(checks[0].noteKey, 'cloud.probeBlockedWithKeyHint')
})

await test('没给「不带钥匙」的探针时，退回那条更保守的提示', async () => {
  const checks = await probeCloud(CONFIG, fakeFetch({ app_data: 'network-error' }))
  eq(checks[0].messageKey, 'cloud.probeBlocked')
  eq(checks[0].noteKey, 'cloud.probeBlockedHint')
})

await test('★ 401 + permission denied 是「访问规则生效」，**不是**「钥匙被拒绝」', async () => {
  /*
   * ── 这条是踩过坑之后补的（用户实测报回来的真实情况）──────────
   * 建表脚本里那句 `revoke all on public.app_data from anon` 会让未登录的请求
   * 拿到 401 —— 那是**我们要的效果**。可一开始探针把它误报成「钥匙被拒绝」，
   * 用户差点去控制台重发一把钥匙（越修越乱）。
   *
   * 判据是**报错正文**：「permission denied for table app_data」说明请求已经过了
   * 网关、被数据库按角色挡了下来 —— 钥匙是好的，访问规则也生效了。
   */
  const checks = await probeCloud(
    CONFIG,
    fakeFetch({
      'auth/v1/settings': {
        status: 200,
        body: JSON.stringify({
          external: { email: true },
          mailer_autoconfirm: false,
          disable_signup: false,
        }),
      },
      app_data: { status: 401, body: '{"code":"42501","message":"permission denied for table app_data"}' },
    }),
  )

  eq(checks[0].outcome, 'ok', 'anon 被挡下来说明网关认了这把钥匙')
  eq(checks[0].messageKey, 'cloud.probeReachOk')
  eq(checks[1].outcome, 'ok', 'anon 读不到表 → 访问规则在生效，不是错误')
  eq(checks[1].messageKey, 'cloud.probeTableLocked')
  eq(checks[2].messageKey, 'cloud.probeAuthConfirm')
})

await test('权限被改坏（拒绝的是 schema 不是表）→ 不硬给结论，把原文摆出来', async () => {
  /*
   * `permission denied for schema public` 是另一回事：权限被改坏了，
   * 而且这时候**表在不在其实没验证到**。判成「一切正常」会掩盖真问题。
   */
  const checks = await probeCloud(
    CONFIG,
    fakeFetch({
      app_data: { status: 401, body: '{"message":"permission denied for schema public"}' },
    }),
  )
  eq(checks.length, 1)
  eq(checks[0].outcome, 'warn', '不能判成 ok')
  eq(checks[0].messageKey, 'cloud.probeOdd')
})

await test('★ 真正的「钥匙被拒绝」长这样：网关直接说钥匙不对', async () => {
  const checks = await probeCloud(
    CONFIG,
    fakeFetch({ app_data: { status: 401, body: '{"message":"Invalid API key"}' } }),
  )
  eq(checks.length, 1, '钥匙不对时别的结论都没意义，只说这一条')
  eq(checks[0].outcome, 'fail')
  eq(checks[0].messageKey, 'cloud.probeReachDenied')
  eq(checks[0].status, 401)
})

await test('钥匙种类不对（拿 Publishable 去问只认 Secret 的接口）也要说清', async () => {
  /*
   * Supabase 的新钥匙体系下，`/rest/v1/` 这种「根路径」只接受 Secret key，
   * 返回的就是这句话。它属于「钥匙/接口不匹配」，不是「配置还没做完」。
   */
  const checks = await probeCloud(
    CONFIG,
    fakeFetch({
      app_data: {
        status: 401,
        body: '{"message":"Secret API key required","hint":"Only secret API keys can be used for this endpoint."}',
      },
    }),
  )
  eq(checks.length, 1)
  eq(checks[0].outcome, 'fail')
  eq(checks[0].messageKey, 'cloud.probeReachDenied')
})

await test('表还没建 → 直接告诉他去跑哪个脚本', async () => {
  const checks = await probeCloud(
    CONFIG,
    fakeFetch({
      'auth/v1/settings': { status: 200, body: '{"external":{"email":true}}' },
      app_data: {
        status: 404,
        body: `{"code":"PGRST205","message":"Could not find the table 'public.app_data' in the schema cache"}`,
      },
    }),
  )
  eq(checks[0].outcome, 'ok', '表不在不等于钥匙不对')
  eq(checks[1].outcome, 'fail')
  eq(checks[1].messageKey, 'cloud.probeTableMissing')
})

await test('★ 未登录竟然读到了数据 → 这是安全问题，必须说重话', async () => {
  /*
   * 这条是整组里最要紧的一个断言：同样是 HTTP 200，
   * 「能连上」是好事，而「没钥匙也能读到数据」是**别人能看到你全部东西**。
   * 判反了的话，界面上会高高兴兴地显示一切正常。
   */
  const checks = await probeCloud(
    CONFIG,
    fakeFetch({
      'auth/v1/settings': { status: 200, body: '{"external":{"email":true}}' },
      app_data: { status: 200, body: '[{"user_id":"someone"}]' },
    }),
  )
  eq(checks[1].outcome, 'warn')
  eq(checks[1].messageKey, 'cloud.probeTableOpen')
  eq(checks[1].noteKey, 'cloud.probeTableOpenNote')
})

await test('邮箱登录没开 / 要不要点邮件确认，都要说清', async () => {
  const off = await probeCloud(
    CONFIG,
    fakeFetch({
      'auth/v1/settings': { status: 200, body: '{"external":{"email":false}}' },
      app_data: { status: 401, body: '{"message":"permission denied for table app_data"}' },
    }),
  )
  eq(off[2].outcome, 'fail')
  eq(off[2].messageKey, 'cloud.probeAuthOff')

  const confirm = await probeCloud(
    CONFIG,
    fakeFetch({
      'auth/v1/settings': {
        status: 200,
        body: JSON.stringify({ external: { email: true }, mailer_autoconfirm: false, disable_signup: true }),
      },
      app_data: { status: 401, body: '{"message":"permission denied for table app_data"}' },
    }),
  )
  eq(confirm[2].outcome, 'ok')
  eq(confirm[2].messageKey, 'cloud.probeAuthConfirm', '要确认邮件的话必须提前说明')
  eq(confirm[2].noteKey, 'cloud.probeSignupClosed')
})

await test('拿不到登录设置时，不硬凑一条「邮箱登录」结论', async () => {
  const checks = await probeCloud(
    CONFIG,
    fakeFetch({
      // settings 返回了非 200 —— 解析不出设置
      'auth/v1/settings': { status: 500, body: 'upstream error' },
      app_data: { status: 401, body: '{"message":"permission denied for table app_data"}' },
    }),
  )
  eq(checks.length, 2, '没有设置数据就不给邮箱那一条结论')
  eq(checks[0].outcome, 'ok', '数据路径是通的')
  eq(checks[1].messageKey, 'cloud.probeTableLocked')
})

await test('没配云端时不发任何请求', async () => {
  const doFetch = fakeFetch({})
  const checks = await probeCloud(null, doFetch)
  eq(checks.length, 0)
  eq(doFetch.calls.length, 0)
})

/* ------------------------------------------------------------------ */
/* 两台设备的收敛                                                      */
/* ------------------------------------------------------------------ */

/**
 * 用一个假服务端把「两台设备 + 一份云端」跑起来。
 *
 * 它照着 sync.ts 里 runSync / reconcile 的顺序走：**先合并、再落地、最后推**。
 * 这样测的是「顺序对不对」，而不是某个函数单看对不对 —— 同步的错基本都错在顺序上。
 */
interface FakeServer {
  env: CloudEnvelope | null
  rev: number
}

interface FakeDevice {
  name: string
  env: CloudEnvelope
  /** 一共往上推了几次 —— 用来测「同步稳定之后不该再推」 */
  pushes: number
}

function device(name: string, data: AppData): FakeDevice {
  return { name, env: envelope(data, {}, name), pushes: 0 }
}

/** 本机改数据（含删除）—— 和 sync.ts 的 onLocalChange 走同一套函数 */
function editLocal(dev: FakeDevice, mutate: (data: AppData) => AppData, at: string): void {
  const next = mutate(dev.env.data)
  const removals = collectRemovals(dev.env.data, next, at)
  dev.env = {
    ...dev.env,
    data: next,
    deleted: mergeTombstones(dev.env.deleted, removals),
    savedAt: at,
  }
}

function syncDevice(dev: FakeDevice, server: FakeServer): void {
  if (server.env === null) {
    server.rev = 1
    server.env = dev.env
    dev.pushes++
    return
  }
  const merged = mergeEnvelopes(dev.env, server.env)
  dev.env = makeEnvelope(merged.data, merged.deleted, dev.name, dev.env.savedAt)
  if (!sameEnvelopeContent(dev.env, server.env)) {
    server.rev += 1
    server.env = dev.env
    dev.pushes++
  }
}

suite('云端同步 · 两台设备收敛（端到端）')

await test('电脑删掉一件东西 → 手机同步之后它也不见了', () => {
  const server: FakeServer = { env: null, rev: 0 }
  const pc = device('pc', base())
  const phone = device('phone', base())

  syncDevice(pc, server) // 电脑先上去
  syncDevice(phone, server) // 手机接上

  // 电脑删掉 ia
  editLocal(pc, (data) => withoutItem(data, 'ia'), T1)
  syncDevice(pc, server)
  syncDevice(phone, server)

  eq(phone.env.data.items.length, 1, '手机上 ia 应该也没了')
  eq(phone.env.data.items[0].id, 'ib')
  eq(server.env?.data.items.length, 1)
})

await test('两边离线各改各的 → 同步之后谁的东西都没丢', () => {
  const server: FakeServer = { env: null, rev: 0 }
  const pc = device('pc', base())
  const phone = device('phone', base())
  syncDevice(pc, server)
  syncDevice(phone, server)

  // 电脑上新增一样、改一样
  editLocal(
    pc,
    (data) => ({
      ...data,
      items: [
        ...data.items.map((i) => (i.id === 'ib' ? { ...i, name: '电脑改的', updatedAt: T1 } : i)),
        makeItem({ id: 'pc-new', name: '电脑上录的', updatedAt: T1 }),
      ],
    }),
    T1,
  )
  // 手机上新增另一样
  editLocal(
    phone,
    (data) => ({
      ...data,
      items: [...data.items, makeItem({ id: 'ph-new', name: '手机上录的', updatedAt: T2 })],
    }),
    T2,
  )

  syncDevice(pc, server)
  syncDevice(phone, server)
  syncDevice(pc, server)

  const ids = pc.env.data.items.map((i) => i.id).sort().join(',')
  eq(ids, 'ia,ib,pc-new,ph-new', '三台（含云端）应该都有这四件')
  eq(phone.env.data.items.find((i) => i.id === 'ib')?.name, '电脑改的', '改动要传过去')
  ok(sameContent(pc.env.data, phone.env.data), '两台设备最终必须一模一样')
  ok(sameContent(pc.env.data, server.env!.data), '云端也要一样')

  // 再来回同步几轮：不该再有任何推送（顺序差异不能让它一直推）
  const revAfter = server.rev
  const pushesAfter = pc.pushes + phone.pushes
  syncDevice(pc, server)
  syncDevice(phone, server)
  syncDevice(pc, server)
  syncDevice(phone, server)
  eq(server.rev, revAfter, '收敛之后云端版本号不该再涨')
  eq(pc.pushes + phone.pushes, pushesAfter, '收敛之后不该再推')
})

await test('一边新增、一边删除同时发生 → 新增留下、删除也生效', () => {
  const server: FakeServer = { env: null, rev: 0 }
  const pc = device('pc', base())
  const phone = device('phone', base())
  syncDevice(pc, server)
  syncDevice(phone, server)

  editLocal(pc, (data) => withoutItem(data, 'ia'), T1)
  editLocal(
    phone,
    (data) => ({ ...data, items: [...data.items, makeItem({ id: 'ph-new', name: '新录的', updatedAt: T2 })] }),
    T2,
  )

  syncDevice(phone, server)
  syncDevice(pc, server)
  syncDevice(phone, server)

  const ids = pc.env.data.items.map((i) => i.id).sort().join(',')
  eq(ids, 'ib,ph-new', '删掉的 ia 要没，新录的 ph-new 要在')
  ok(sameContent(pc.env.data, phone.env.data), '两台设备最终必须一模一样')
})

await test('收敛之后不再往上推（不收敛就是每次都推，一直推下去）', () => {
  const server: FakeServer = { env: null, rev: 0 }
  const pc = device('pc', base())
  const phone = device('phone', base())
  syncDevice(pc, server)
  syncDevice(phone, server)

  editLocal(pc, (data) => withoutItem(data, 'ia'), T1)
  syncDevice(pc, server)
  syncDevice(phone, server)
  syncDevice(pc, server)

  const revAfterConverge = server.rev
  const pushesBefore = pc.pushes + phone.pushes

  // 再各同步两轮 —— 什么都不该发生
  syncDevice(pc, server)
  syncDevice(phone, server)
  syncDevice(pc, server)
  syncDevice(phone, server)

  eq(server.rev, revAfterConverge, '收敛之后云端版本号不该再涨')
  eq(pc.pushes + phone.pushes, pushesBefore, '收敛之后不该再推')
})

await test('墓碑本身也要同步 —— 第三台设备接上时删除依然有效', () => {
  const server: FakeServer = { env: null, rev: 0 }
  const pc = device('pc', base())
  syncDevice(pc, server)

  editLocal(pc, (data) => withoutItem(data, 'ia'), T1)
  syncDevice(pc, server)

  // 现在来了一台从没同步过的设备（本地还带着 ia）
  const tablet = device('tablet', base())
  syncDevice(tablet, server)

  eq(tablet.env.data.items.length, 1, '新设备接上时必须也把 ia 按下去')
  ok(tablet.env.deleted.ia !== undefined, '新设备也要拿到那条墓碑')
})
