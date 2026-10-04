/**
 * CSV 物品清单的导入。
 *
 * ── 这一组为什么存在 ─────────────────────────────────────────────
 * CSV 本来是「只能看、不能拿来恢复」的格式（`exportCsv.ts` 顶部写着理由）。
 * 但真实情况是：用户可能只剩这一份 CSV 了。那时候「格式不完整」和
 * 「数据全没了」之间，前者显然好得多 —— 所以补上这条路。
 *
 * 因此这里守两件事：
 *   1. **真的能解析真实的 CSV** —— BOM、引号里的逗号、引号转义、CRLF、
 *      空单元格、中文/英文表头、带单位的属性列、缺名称的行
 *   2. **老实说它补不回什么** —— 活动、清单、分类层级、属性类型。
 *      看起来像一次完整恢复，比承认只能救回一部分危险得多
 */

import { buildCsv } from '../src/data/exportCsv'
import { looksLikeCsv, parseCsv, parseCsvToAppData } from '../src/data/csvImport'
import { createDerived } from '../src/store/selectors'
import { flushWrites, useAppStore } from '../src/store/useAppStore'
import { statusFromWords } from '../src/lib/statusWords'
import { item, eq, must, ok, contains, suite, test, fixture } from './harness'
import type { AppData } from '../src/types'

/* ------------------------------------------------------------------ */
/* 一、CSV 词法                                                        */
/* ------------------------------------------------------------------ */

suite('CSV 解析：真实的文件长什么样')

await test('BOM 要去掉，否则第一个表头会多一个看不见的字符', () => {
  const rows = parseCsv('\ufeff名称,数量\n牙刷,1')
  eq(rows[0]?.[0], '名称', '表头不该带 BOM')
})

await test('引号里的逗号不算分隔符', () => {
  const rows = parseCsv('名称,备注\n牙刷,"买了三支, 放盒子里"')
  eq(rows[1]?.[1], '买了三支, 放盒子里')
})

await test('引号里的换行不算换行', () => {
  const rows = parseCsv('名称,备注\n牙刷,"第一行\n第二行"')
  eq(rows.length, 2, '应该只有表头 + 一行')
  eq(rows[1]?.[1], '第一行\n第二行')
})

await test('两个连着的引号 = 一个字面引号', () => {
  const rows = parseCsv('名称,备注\n牙刷,"他说""这个不错"""')
  eq(rows[1]?.[1], '他说"这个不错"')
  eq(rows[1]?.[0], '牙刷', '引号关掉之后，后面的逗号要照常分隔')
})

await test('CRLF 和单独 LF 都能切行', () => {
  eq(parseCsv('a,b\r\nc,d\r\ne,f').length, 3)
  eq(parseCsv('a,b\nc,d\ne,f').length, 3)
})

await test('末尾的空行要丢掉（Excel 存盘常常留一行）', () => {
  eq(parseCsv('a,b\n1,2\n\n').length, 2)
})

await test('分辨「像 CSV」还是「像 JSON」看内容，不看扩展名', () => {
  // 文件名不可信 —— 有人会把 csv 改名成 json，也有人反过来
  ok(looksLikeCsv('名称,数量\n牙刷,1'))
  ok(!looksLikeCsv('{"format":"duansheli"}'))
  ok(!looksLikeCsv('[1,2,3]'))
  ok(looksLikeCsv('\ufeff名称,数量\n牙刷,1'), '带 BOM 也算')
})

/* ------------------------------------------------------------------ */
/* 二、转成数据                                                        */
/* ------------------------------------------------------------------ */

suite('CSV 导入：转成能用的数据')

/** 一份「本程序导出的清单」应该有的样子 */
const SAMPLE = [
  '\ufeff名称,数量,状态,有效期至,分类,位置,标签,备注,创建时间,最后修改,品牌,价格(元)',
  '灰色羊毛衫,1,在用,,衣物,家 / 卧室 / 衣柜,舍不得扔,妈妈送的,2026-01-01 10:00,2026-01-02 11:30,某品牌,199',
  '旧手机,1,闲置,,电子,家 / 书房 / 书桌,想送人,,2026-01-01 10:00,2026-01-03 09:00,,',
  '备用牙膏,3,备用,2027-01-01,日用品,家 / 储物间,,一买三管,2026-01-01 10:00,2026-01-04 08:00,,9.9',
  '扔掉的拖鞋,1,已舍弃,,日用品,,,,2026-01-01 10:00,2026-01-05 08:00,,',
  ',,,空行没名字,,,,,,,,',
  '牛仔裤,2,在用,,衣物 / 日用品,未归位,,,,2026-01-06 08:00,,',
].join('\r\n')

await test('整份清单能解析出来，各字段都对得上', () => {
  const result = parseCsvToAppData(SAMPLE)
  ok(result.ok, '应该解析成功')
  if (!result.ok) return

  eq(result.stats.items, 5, '有名称的 5 行（空行被跳过）')
  eq(result.stats.skipped, 1, '那一行没名称，要如实计数')

  const byName = (name: string) => must(result.data.items.find((i) => i.name === name), name)

  const sweater = byName('灰色羊毛衫')
  eq(sweater.quantity, 1)
  eq(sweater.status, 'active')
  eq(sweater.tags.length, 1)
  eq(sweater.tags[0], '舍不得扔')
  eq(sweater.note, '妈妈送的')
  eq(sweater.expiresAt, null, '空单元格 = 没设置有效期')

  eq(byName('旧手机').status, 'idle', '中文状态词要认得出来')
  eq(byName('备用牙膏').status, 'spare')
  eq(byName('备用牙膏').quantity, 3)
  eq(byName('备用牙膏').expiresAt, '2027-01-01')
  eq(byName('扔掉的拖鞋').status, 'discarded')
})

await test('闲置的物品要给一个 idleAt，否则「闲置了多久」会算成 0 天', () => {
  const result = parseCsvToAppData(SAMPLE)
  ok(result.ok)
  if (!result.ok) return

  const idleItem = must(result.data.items.find((i) => i.status === 'idle'), '应该有闲置的')
  ok(idleItem.idleAt !== null, '闲置时间不能空着')
  eq(idleItem.idleAt, idleItem.updatedAt, 'CSV 里没有那个时间点，用最后修改时间近似')

  const activeItem = must(result.data.items.find((i) => i.status === 'active'), '应该有在用的')
  eq(activeItem.idleAt, null, '在用的不该有闲置时间')
})

await test('位置是完整路径，能逐层还原成树', () => {
  const result = parseCsvToAppData(SAMPLE)
  ok(result.ok)
  if (!result.ok) return

  const names = result.data.locations.map((l) => l.name)
  ok(names.includes('家'), '要有「家」')
  ok(names.includes('卧室'), '要有「卧室」')
  ok(names.includes('衣柜'), '要有「衣柜」')
  ok(names.includes('储物间'))

  // 层级要对：衣柜的父级应该是卧室，卧室的父级是家
  const byName = (n: string) => must(result.data.locations.find((l) => l.name === n), n)
  const wardrobe = byName('衣柜')
  const bedroom = byName('卧室')
  eq(wardrobe.parentId, bedroom.id)
  eq(bedroom.parentId, byName('家').id)
  eq(byName('家').parentId, null, '顶层')

  const sweater = must(result.data.items.find((i) => i.name === '灰色羊毛衫'), '羊毛衫')
  eq(sweater.locationId, wardrobe.id)
})

await test('同一层位置只建一次，不会因为出现多次就重复', () => {
  const result = parseCsvToAppData(SAMPLE)
  ok(result.ok)
  if (!result.ok) return
  eq(result.data.locations.filter((l) => l.name === '家').length, 1)
  eq(result.data.locations.filter((l) => l.name === '书桌').length, 1)
})

await test('「未归位」和空单元格都算没有位置', () => {
  const result = parseCsvToAppData(SAMPLE)
  ok(result.ok)
  if (!result.ok) return
  eq(must(result.data.items.find((i) => i.name === '牛仔裤'), '牛仔裤').locationId, null)
  eq(must(result.data.items.find((i) => i.name === '扔掉的拖鞋'), '拖鞋').locationId, null)
})

await test('分类按名字建，多个分类是「多条」而不是一条路径', () => {
  const result = parseCsvToAppData(SAMPLE)
  ok(result.ok)
  if (!result.ok) return

  // 「衣物 / 日用品」在导出时是**两个分类名**拼起来的
  const jeans = must(result.data.items.find((i) => i.name === '牛仔裤'), '牛仔裤')
  eq(jeans.categoryIds.length, 2, '应该是两条分类')
  const names = jeans.categoryIds.map(
    (id) => must(result.data.categories.find((c) => c.id === id), '分类').name,
  )
  ok(names.includes('衣物'))
  ok(names.includes('日用品'))

  // 层级补不回来 —— 全是顶层，而且界面会明说
  ok(
    result.data.categories.every((c) => c.parentId === null),
    'CSV 里没有父子关系，所以一律是顶层分类',
  )
})

await test('属性列按名字建，单位从表头的括号里取', () => {
  const result = parseCsvToAppData(SAMPLE)
  ok(result.ok)
  if (!result.ok) return

  const price = must(result.data.attributeDefs.find((d) => d.name === '价格'), '应该有「价格」')
  eq(price.unit, '元', '「价格(元)」里的括号要当单位')
  eq(price.type, 'text', 'CSV 里没有类型信息，一律按文本建 —— 不猜')

  const brand = must(result.data.attributeDefs.find((d) => d.name === '品牌'), '应该有「品牌」')
  eq(brand.unit, '')

  const sweater = must(result.data.items.find((i) => i.name === '灰色羊毛衫'), '羊毛衫')
  eq(sweater.attrs[brand.id], '某品牌')
  eq(sweater.attrs[price.id], '199')
})

await test('空单元格不写进属性 —— 属性是稀疏的', () => {
  const result = parseCsvToAppData(SAMPLE)
  ok(result.ok)
  if (!result.ok) return
  const phone = must(result.data.items.find((i) => i.name === '旧手机'), '旧手机')
  eq(Object.keys(phone.attrs).length, 0, '两个属性列都是空的，就不该有键')
})

await test('时间能还原，而且按本地时间算（导出写的也是本地时间）', () => {
  const result = parseCsvToAppData(SAMPLE)
  ok(result.ok)
  if (!result.ok) return

  const sweater = must(result.data.items.find((i) => i.name === '灰色羊毛衫'), '羊毛衫')
  const created = new Date(sweater.createdAt)
  eq(created.getFullYear(), 2026)
  eq(created.getMonth(), 0, '一月')
  eq(created.getDate(), 1)
  eq(created.getHours(), 10, '10:00 —— 不能被时区挪走')
  eq(created.getMinutes(), 0)
})

await test('认不出来的时间用兜底值，而不是瞎编一个', () => {
  const csv = '名称,创建时间\n牙刷,不知道什么时候'
  const result = parseCsvToAppData(csv)
  ok(result.ok)
  if (!result.ok) return
  const toothbrush = must(result.data.items[0], '牙刷')
  ok(Number.isFinite(new Date(toothbrush.createdAt).getTime()), '要是合法时间')
})

await test('认不出来的状态退回「在用」，而不是整条丢掉', () => {
  const csv = '名称,状态\n牙刷,这个状态不存在'
  const result = parseCsvToAppData(csv)
  ok(result.ok)
  if (!result.ok) return
  eq(result.data.items[0]?.status, 'active')
})

await test('英文表头也认（英文界面导出来的清单）', () => {
  const csv = [
    'Name,Quantity,Status,Expires,Categories,Place,Tags,Note,Created,Last updated',
    'Toothbrush,2,Spare,2027-01-01,Daily,Home / Bathroom,Stocked up,,,,',
  ].join('\n')

  const result = parseCsvToAppData(csv)
  ok(result.ok, '英文表头必须也认 —— CSV 是按导出时的界面语言写的')
  if (!result.ok) return

  const item0 = must(result.data.items[0], '第一件')
  eq(item0.name, 'Toothbrush')
  eq(item0.quantity, 2)
  eq(item0.status, 'spare', '英文状态词也要认')
  eq(item0.expiresAt, '2027-01-01')
  eq(item0.tags[0], 'Stocked up')
  ok(result.data.locations.some((l) => l.name === 'Bathroom'), '位置路径也要还原')
})

/* ------------------------------------------------------------------ */
/* 三、必须老实说：哪些补不回来                                        */
/* ------------------------------------------------------------------ */

suite('CSV 导入：把「补不回什么」说清楚')

await test('提示里点明活动、清单、分类层级、属性类型四样', () => {
  const result = parseCsvToAppData(SAMPLE)
  ok(result.ok)
  if (!result.ok) return

  const text = result.warnings.join('\n')
  contains(text, '活动归属', '要说活动找不回来')
  contains(text, '清单', '要说清单找不回来')
  contains(text, '分类的层级', '要说分类层级找不回来')
  contains(text, '属性的类型', '要说属性类型找不回来')
  contains(text, '不是原始备份', '要一句话定性：这不是备份恢复')
})

await test('跳过的行数要如实报出来', () => {
  const result = parseCsvToAppData(SAMPLE)
  ok(result.ok)
  if (!result.ok) return
  ok(
    result.warnings.some((w) => w.includes('1')),
    `跳过了 1 行，提示里要说：${result.warnings.join(' / ')}`,
  )
})

await test('活动和清单确实是空的 —— 提示不是空话', () => {
  const result = parseCsvToAppData(SAMPLE)
  ok(result.ok)
  if (!result.ok) return
  eq(result.data.collections.length, 0)
  eq(result.data.checklists.length, 0)
})

/* ------------------------------------------------------------------ */
/* 四、失败要说得出为什么                                              */
/* ------------------------------------------------------------------ */

suite('CSV 导入：读不了的时候要说人话')

await test('空文件', () => {
  const result = parseCsvToAppData('')
  eq(result.ok, false)
  if (!result.ok) contains(result.error, '没有任何行')
})

await test('没有「名称」列 —— 说清这不是本程序导出的清单', () => {
  const result = parseCsvToAppData('foo,bar\n1,2')
  eq(result.ok, false)
  if (!result.ok) contains(result.error, '名称')
})

await test('有名称列但每一行都缺名称', () => {
  const result = parseCsvToAppData('名称,数量\n,1\n,2')
  eq(result.ok, false)
  if (!result.ok) contains(result.error, '没有解析出任何物品')
})

/* ------------------------------------------------------------------ */
/* 五、和导出对得上（往返）                                            */
/* ------------------------------------------------------------------ */

suite('CSV 导入：和导出的 CSV 对得上')

const RT = (): AppData => {
  const base = fixture()
  const clothing = must(base.categories.find((c) => c.name === '衣物'), '夹具缺少分类 衣物')
  const wardrobe = must(base.locations.find((l) => l.name === '衣柜'), '夹具缺少位置 衣柜')

  return {
    ...base,
    // 一个「衣物 › 上装」的子分类 —— 用来验证层级确实会丢
    categories: [
      ...base.categories,
      { id: 'cat-top', name: '上装', parentId: clothing.id, order: 0, createdAt: '2026-01-01T00:00:00.000Z' },
    ],
    // 一个活动、一份清单 —— CSV 里完全没有这两样
    collections: [
      { id: 'col1', name: '旅行', note: '', order: 0, createdAt: '2026-01-01T00:00:00.000Z' },
    ],
    checklists: [
      {
        id: 'list1',
        name: '周末露营',
        fromCollectionId: 'col1',
        createdAt: '2026-01-01T00:00:00.000Z',
        entries: [{ id: 'e1', itemId: 'r1', name: '帐篷', quantity: 1, checked: true }],
      },
    ],
    items: [
      item({
        id: 'r1',
        name: '灰色羊毛衫',
        quantity: 2,
        status: 'idle',
        locationId: wardrobe.id,
        categoryIds: ['cat-top'],
        collectionIds: ['col1'],
        tags: ['舍不得扔'],
        note: '妈妈送的, 很暖',
        expiresAt: '2027-03-15',
      }),
      item({ id: 'r2', name: '备用牙膏', quantity: 3, status: 'spare' }),
    ],
  }
}

await test('自己导出的 CSV，导回来之后物品还在、数量状态都对', () => {
  // 这条是「导出的格式和导入的解析器真的对得上」的硬校验 ——
  // 两边各改各的、没人对着跑一遍，是这类功能最容易坏的方式
  const data = RT()
  const csv = buildCsv(data, createDerived(data))

  const back = parseCsvToAppData(csv)
  ok(back.ok, `自己导出的清单必须能导回来：${back.ok ? '' : back.error}`)
  if (!back.ok) return

  eq(back.data.items.length, 2)
  const sweater = must(back.data.items.find((i) => i.name === '灰色羊毛衫'), '羊毛衫')
  eq(sweater.quantity, 2)
  eq(sweater.status, 'idle', '状态要原样回来')
  eq(sweater.expiresAt, '2027-03-15')
  eq(sweater.note, '妈妈送的, 很暖', '带逗号的备注要靠引号活下来')
  eq(sweater.tags[0], '舍不得扔')
  eq(must(back.data.items.find((i) => i.name === '备用牙膏'), '牙膏').status, 'spare')
})

await test('位置是路径，往返之后**能**还原（这一样没丢）', () => {
  const data = RT()
  const back = parseCsvToAppData(buildCsv(data, createDerived(data)))
  ok(back.ok)
  if (!back.ok) return

  const sweater = must(back.data.items.find((i) => i.name === '灰色羊毛衫'), '羊毛衫')
  ok(sweater.locationId !== null, '位置路径应该被还原出来')
  const path = must(
    back.data.locations.find((l) => l.id === sweater.locationId),
    '位置节点',
  )
  eq(path.name, '衣柜', '导出写的是完整路径（家 / 卧室 / 衣柜），所以末级能对上')
})

await test('**分类层级、活动、清单确实丢了** —— 把代价钉成用例', () => {
  /*
   * 这一条不是在测「能还原」，而是在**验证我们承认的那些损失真的存在**。
   *
   * 为什么值得这么写：界面上写给用户的提示说「活动 / 清单 / 分类层级找不回来」，
   * 那几句话必须是**真的**。哪天有人改了 CSV 让它带上这些字段，
   * 这条用例会红 —— 提醒他同时把提示改掉，别让界面继续说假话。
   */
  const data = RT()
  const back = parseCsvToAppData(buildCsv(data, createDerived(data)))
  ok(back.ok)
  if (!back.ok) return

  // 1. 分类层级：原来「上装」挂在「衣物」下面，回来之后是顶层
  const top = must(back.data.categories.find((c) => c.name === '上装'), '上装分类应该还在')
  eq(top.parentId, null, '层级找不回来 —— 变成顶层分类了')
  ok(
    !back.data.categories.some((c) => c.name === '衣物' && c.id === top.parentId),
    '不该硬猜一个父级出来',
  )

  // 2. 活动归属
  const sweater = must(back.data.items.find((i) => i.name === '灰色羊毛衫'), '羊毛衫')
  eq(sweater.collectionIds.length, 0, '活动归属找不回来')

  // 3. 清单
  eq(back.data.checklists.length, 0, '清单找不回来')
  eq(back.data.collections.length, 0, '活动本身也建不回来（CSV 里连名字都没有）')

  // 4. id 是重新生成的（CSV 里没有 id 这一列）
  ok(!back.data.items.some((i) => i.id === 'r1'), 'id 会重新生成')
})

/* ------------------------------------------------------------------ */
/* 六、走完整的落库流程                                                */
/* ------------------------------------------------------------------ */

suite('CSV 导入：真的落库')

await test('解析出来的数据能直接走现有的导入流程（replaceAll）', async () => {
  // 这是整个设计最要紧的一点：CSV 转出来的就是标准 AppData，
  // 所以快照、覆盖、报告全都自动继承，不需要另起一套写入口
  const result = parseCsvToAppData(SAMPLE)
  ok(result.ok)
  if (!result.ok) return

  await useAppStore.getState().replaceAll(result.data, 'import')
  await flushWrites()

  const state = useAppStore.getState()
  eq(state.data.items.length, 5)
  ok(
    state.data.items.some((i) => i.name === '灰色羊毛衫' && i.status === 'active'),
    '物品应该真的进库了',
  )
  ok(
    state.data.locations.some((l) => l.name === '衣柜'),
    '位置树也该建好',
  )
  eq(state.status, 'ready')
})

await test('状态词的对照表是共用的（AI 和 CSV 不能各认各的）', () => {
  // 两处各写一份的话迟早会漂，而「认不出来」的表现是状态悄悄没了，不是报错
  eq(statusFromWords('闲置'), 'idle')
  eq(statusFromWords('Spare'), 'spare')
  eq(statusFromWords('已舍弃'), 'discarded')
  eq(statusFromWords('  '), null)
  eq(statusFromWords(undefined), null)
})
