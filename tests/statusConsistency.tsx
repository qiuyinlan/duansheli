/**
 * 状态显示的一致性 —— issue 13 的回归测试。
 *
 * 用户报的是：「手机的物品页面，预览页面它显示是闲置，其实上点进去是在用。」
 *
 * 也就是说：**列表里显示的状态和点进去看到的状态不是一个值**。
 * 这两处都在渲染同一份数据，所以只要它们真的读同一个字段，就不可能不一致。
 * 这个文件就是把这句话钉住：对每一种状态，把「列表页 / 闲置页 / 备用页 /
 * 详情页」四处都渲染一遍，断言它们说的是同一件事。
 *
 * 为什么值得单独一个文件：这类 bug 的症状（「怎么和刚才看到的不一样」）
 * 离病因（某处用了别的字段、或者漏了取词）很远，靠肉眼 review 很难发现，
 * 而它直接影响用户信不信这个应用显示的东西。
 */

import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { createDerived } from '../src/store/selectors'
import { useAppStore } from '../src/store/useAppStore'
import { setLang } from '../src/i18n'
import type { AppData, Item, ItemStatus } from '../src/types'
import { fixture, item, ok, suite, test, eq } from './harness'

const act: typeof import('react-dom/test-utils').act =
  (React as unknown as { act?: typeof import('react-dom/test-utils').act }).act ??
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  (await import('react-dom/test-utils')).act

/** 每个状态对应的**界面上那句话** —— 就是用户眼睛看到的 */
const LABEL: Record<ItemStatus, string> = {
  active: '在用',
  idle: '闲置',
  spare: '备用',
  discarded: '已舍弃',
}

/**
 * 渲染一个路由，把**整个 document.body** 拿回来。
 *
 * 不能用容器的 innerHTML：Modal 走 createPortal 挂到 body 上，
 * 用它就什么都看不到（详情页的状态三档在表单里，不在弹窗里，
 * 但选择器一类的在弹窗里，统一取 body 更稳）。
 */
async function renderRoute(path: string, data: AppData): Promise<string> {
  useAppStore.setState({
    status: 'ready',
    error: null,
    data,
    derived: createDerived(data),
    aiApiKey: '',
  })

  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const { AppRoutes } = await import('../src/App')

  try {
    await act(async () => {
      root.render(
        <MemoryRouter
          initialEntries={[path]}
          future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
        >
          <AppRoutes />
        </MemoryRouter>,
      )
    })
    return document.body.innerHTML
  } finally {
    await act(async () => {
      root.unmount()
    })
    container.remove()
  }
}

/** 详情页上那个状态分段控件当前选中的是哪一档 */
function selectedStatusInDetail(html: string): ItemStatus | null {
  /*
   * 分段控件的结构是 `segmented__item is-active` 包着那一档的文字。
   * 不用「html 里含不含『闲置』」来判断 —— 分组标题、按钮、提示条里
   * 都可能出现这个词，那正是这类 bug 容易藏身的地方。
   */
  const match = /segmented__item is-active"[^>]*>([^<]*)</.exec(html)
  const text = match?.[1]?.trim() ?? ''
  for (const [status, label] of Object.entries(LABEL) as Array<[ItemStatus, string]>) {
    if (text === label) return status
  }
  return null
}

/** 造一份「只有一件东西」的数据，免得别的条目干扰断言 */
function dataWith(one: Item): AppData {
  return { ...fixture(), items: [one] }
}

suite('状态一致性：列表里说什么，点进去就得是什么（issue 13）')

await test('闲置的物品：闲置页说「闲置」，点进详情还是「闲置」', async () => {
  const idle = item({
    id: 'only',
    name: '只有这一件的旧手机',
    status: 'idle',
    idleAt: new Date().toISOString(),
  })
  const data = dataWith(idle)

  const idleHtml = await renderRoute('/idle', data)
  ok(idleHtml.includes('只有这一件的旧手机'), '闲置页应该列出它')

  const detailHtml = await renderRoute('/items/only', data)
  eq(
    selectedStatusInDetail(detailHtml),
    'idle',
    '详情页的状态档必须也是「闲置」—— 不是的话，列表和详情就自相矛盾了',
  )
})

await test('闲置页上那条徽章也是「闲置」，不是别的词', async () => {
  const idle = item({
    id: 'only',
    name: '只有这一件的旧手机',
    status: 'idle',
    idleAt: new Date().toISOString(),
  })
  const html = await renderRoute('/idle', dataWith(idle))

  /*
   * ItemRow 只在状态不是「在用」时才画徽章。这里断言那一行的 meta 区里
   * 确实出现了「闲置」这个词 —— 少画了徽章的话，用户在列表上看到的
   * 就只是一件普通物品，点进去却发现它是闲置的。
   */
  const row = /<li class="list-row[\s\S]*?<\/li>/.exec(html)?.[0] ?? ''
  ok(row.includes('闲置'), `那一行必须标出「闲置」状态。实际那行是：${row.slice(0, 300)}`)

  /*
   * 而且徽章要带上「闲置」那一档的颜色类 —— 三档状态以前长得一模一样，
   * 扫一眼分不出「闲置」和「备用」（两者业务含义正好相反）。
   */
  ok(
    row.includes('badge--status-idle'),
    `闲置的徽章要带自己的语义色。实际那行是：${row.slice(0, 300)}`,
  )
})

await test('备用的物品：备用页说「备用」，点进详情也是「备用」', async () => {
  const spare = item({ id: 'only', name: '只有这一件的备用牙膏', status: 'spare', quantity: 2 })
  const data = dataWith(spare)

  const spareHtml = await renderRoute('/spare', data)
  ok(spareHtml.includes('只有这一件的备用牙膏'), '备用页应该列出它')

  const detailHtml = await renderRoute('/items/only', data)
  eq(selectedStatusInDetail(detailHtml), 'spare', '详情页也必须是「备用」')
})

await test('在用的物品：详情页说是「在用」', async () => {
  const active = item({ id: 'only', name: '天天用的杯子' })
  const html = await renderRoute('/items/only', dataWith(active))
  eq(selectedStatusInDetail(html), 'active', '详情页应该是「在用」')
})

await test('物品列表里那件闲置的没被显示，但提示条如实说藏了几件', async () => {
  /*
   * 这一条钉的是另一件容易搞混的事：物品列表默认收起闲置。
   * 提示条上的数字和「闲置页」的数字必须是同一份 ——
   * 一边说藏了 1 件、点过去一件都没有，是最典型的「数据好像丢了」。
   */
  const idle = item({
    id: 'only',
    name: '只有这一件的旧手机',
    status: 'idle',
    idleAt: new Date().toISOString(),
  })
  const data = dataWith(idle)

  const itemsHtml = await renderRoute('/items', data)
  ok(itemsHtml.includes('有 1 件被收起来了'), '物品列表要说清藏了几件')

  const idleHtml = await renderRoute('/idle', data)
  ok(idleHtml.includes('只有这一件的旧手机'), '提示条指向的那一页必须真有这件东西')
})

/* 收尾：别把语言留给后面的用例 */
setLang('zh')
