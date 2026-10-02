/**
 * 渲染冒烟测试 —— 在 jsdom 里用 createRoot 把每个页面真的挂载一遍。
 *
 * 没有浏览器可用，这是唯一能提前发现「白屏级」bug 的手段：
 * 少个必需属性、访问了 undefined 的字段、hook 用错，都会在这里炸出来。
 * 副作用也会真的执行（不像服务端渲染会跳过 useEffect），所以更接近真实运行。
 *
 * 注意：不能用 react-dom/server —— zustand 在服务端渲染时读的是 store
 * 创建时的初始状态，测试里的 setState 完全不生效。详见 tests/dom.ts。
 */

import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { App, AppRoutes } from '../src/App'
import { createEmptyData } from '../src/storage/seed'
import { createDerived } from '../src/store/selectors'
import { useAppStore } from '../src/store/useAppStore'
import type { AppData, Item } from '../src/types'
import { contains, eq, fixture, must, ok, suite, test } from './harness'

/** React 18.3 起 act 也挂在 React 上；两个入口都兼容一下 */
const act: typeof import('react-dom/test-utils').act =
  (React as unknown as { act?: typeof import('react-dom/test-utils').act }).act ??
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  (await import('react-dom/test-utils')).act

/* ------------------------------------------------------------------ */
/* 渲染工具                                                            */
/* ------------------------------------------------------------------ */

/**
 * 渲染一个 React 树，收集渲染期的 console.error，
 * 并在断言失败时确保容器被清理干净。
 */
function renderChecked(
  node: React.ReactElement,
  check: (container: HTMLElement, html: string) => void,
): void {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)

  const errors: string[] = []
  const originalConsoleError = console.error
  console.error = (...args: unknown[]) => {
    const text = args.map((a) => (a instanceof Error ? a.message : String(a))).join(' ')
    // act() 之外的异步 setState 只是噪音，不算问题
    if (text.includes('not wrapped in act')) return
    errors.push(text)
  }

  try {
    act(() => {
      root.render(node)
    })

    const html = container.innerHTML.replace(/<!--.*?-->/g, '')

    eq(
      errors.length,
      0,
      `渲染时产生了 ${errors.length} 条错误 / 警告：\n      ${errors.slice(0, 3).join('\n      ')}`,
    )

    check(container, html)
  } finally {
    console.error = originalConsoleError
    act(() => {
      root.unmount()
    })
    container.remove()
  }
}

/** 把 store 摆到「数据已加载」的状态，然后渲染指定路由 */
function withPage(
  path: string,
  data: AppData,
  check: (container: HTMLElement, html: string) => void,
): void {
  useAppStore.setState({
    status: 'ready',
    error: null,
    data,
    derived: createDerived(data),
    // 显式清掉 Key，让渲染结果可预期 ——
    // 否则前面哪个测试留了个 Key，这里就会渲染成「已填入」的样子
    aiApiKey: '',
  })

  renderChecked(
    <MemoryRouter
      initialEntries={[path]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <AppRoutes />
    </MemoryRouter>,
    check,
  )
}

/** 渲染完整的 App（含「加载中 / 出错」分支） */
function withApp(check: (container: HTMLElement, html: string) => void): void {
  renderChecked(
    <MemoryRouter
      initialEntries={['/']}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <App />
    </MemoryRouter>,
    check,
  )
}

const data = fixture()

/* ------------------------------------------------------------------ */
/* 用例                                                                */
/* ------------------------------------------------------------------ */

suite('渲染冒烟：每个路由都能渲染出来')

const ROUTES: Array<{ path: string; label: string }> = [
  { path: '/', label: '概览' },
  { path: '/items', label: '物品列表' },
  { path: '/items/new', label: '录入物品' },
  { path: '/items/i1', label: '物品详情' },
  { path: '/locations', label: '位置' },
  { path: '/idle', label: '闲置' },
  { path: '/ai', label: 'AI 助手' },
  { path: '/more', label: '更多' },
  { path: '/categories', label: '分类管理' },
  { path: '/attributes', label: '属性管理' },
  { path: '/tags', label: '标签管理' },
  { path: '/settings', label: '设置' },
]

for (const route of ROUTES) {
  await test(`${route.label}（${route.path}）`, () => {
    withPage(route.path, data, (_container, html) => {
      ok(html.length > 600, `渲染结果过短（${html.length} 字符），页面可能是空的`)
    })
  })
}

await test('未知路径被重定向到概览，而不是白屏', () => {
  withPage('/这个路径不存在', data, (_container, html) => {
    contains(html, '概览')
  })
})

suite('渲染冒烟：页面内容确实出现了')

await test('概览页显示物品总数与各分类统计', () => {
  withPage('/', data, (_container, html) => {
    contains(html, '件物品', '应有数量说明')
    contains(html, '按分类', '应有分类图表')
    contains(html, '按位置', '应有位置图表')
    contains(html, '衣物', '图表里应出现分类名')
    contains(html, '闲置占比', '应有闲置占比这一块')
  })
})

await test('物品列表页显示物品名与位置路径', () => {
  withPage('/items', data, (_container, html) => {
    contains(html, '灰色羊毛衫', '应显示物品名')
    contains(html, '牛仔裤')
    contains(html, '家 / 卧室 / 衣柜', '应显示位置路径')
  })
})

await test('位置页显示位置树与该位置的物品', () => {
  withPage('/locations', data, (_container, html) => {
    contains(html, '衣柜', '树里应有「衣柜」')
    contains(html, '未归位', '应有未归位这一项')
    contains(html, '含子位置', '应有包含子位置的开关')
  })
})

await test('闲置页显示闲置物品', () => {
  withPage('/idle', data, (_container, html) => {
    contains(html, '旧手机', '应显示闲置物品')
    contains(html, '件闲置')
  })
})

await test('录入页显示表单要素', () => {
  withPage('/items/new', data, (container, html) => {
    contains(html, '名称', '应有名称字段')
    contains(html, '添加属性', '应有属性入口')
    contains(html, '保存并继续录入', '应有主按钮')
    ok(container.querySelector('#item-name'), '应该有一个名称输入框')
    ok(container.querySelector('#item-quantity'), '应该有一个数量输入框')
  })
})

await test('编辑页会把已有数据填进表单', () => {
  withPage('/items/i1', data, (container, html) => {
    const nameInput = must(
      container.querySelector<HTMLInputElement>('#item-name'),
      '应该找得到名称输入框',
    )
    eq(nameInput.value, '灰色羊毛衫', '名称应预填')
    contains(html, '舍弃', '编辑时应有舍弃按钮')
    contains(html, '家 / 卧室 / 衣柜', '位置应显示为完整路径')
  })
})

await test('设置页显示各数据安全区块', () => {
  withPage('/settings', data, (_container, html) => {
    contains(html, '备份与恢复')
    contains(html, '导出 JSON')
    contains(html, '导入备份')
    contains(html, 'IndexedDB', '应有存储状态')
    contains(html, '自动快照')
    contains(html, '已舍弃回收站')
    contains(html, '清空所有数据', '应有危险区')
  })
})

await test('管理页显示已有条目', () => {
  withPage('/categories', data, (_container, html) => contains(html, '衣物'))
  withPage('/attributes', data, (_container, html) => contains(html, '品牌'))
  withPage('/tags', data, (_container, html) => contains(html, '想送人'))
})

await test('AI 助手页只剩一个对话框，模式切换已经去掉了', () => {
  withPage('/ai', data, (_container, html) => {
    contains(html, 'DeepSeek API Key', '应该有 Key 输入框')
    contains(html, '和 AI 商量', '应该有对话框')
    contains(html, '要录新的', '空状态要说明两种用法')
    contains(html, '要改现有的')
    contains(html, '保存在这台设备的浏览器里', '必须如实说明 Key 会存在本地')
    contains(html, 'api.deepseek.com', '应说明请求直连，不经过第三方')

    // 这三个模式是早期版本的设计（新建 vs 更新的实现边界漏到了界面上），
    // 已经合并成一个对话框，不该再出现
    ok(!html.includes('一次性录入'), '模式切换应该去掉了')
    ok(!html.includes('整理已有物品'), '模式切换应该去掉了')
    ok(!html.includes('对话整理'), '模式切换应该去掉了')
  })
})

suite('渲染冒烟：空数据与边界情况')

await test('完全没有数据时，每个页面都能渲染（显示引导而不是崩掉）', () => {
  const empty = createEmptyData()
  for (const route of ROUTES) {
    withPage(route.path, empty, (_container, html) => {
      ok(html.length > 600, `${route.label} 在空数据下渲染结果过短`)
    })
  }
})

await test('空数据时概览页给出录入引导', () => {
  withPage('/', createEmptyData(), (_container, html) => {
    contains(html, '还没有录入任何物品')
    contains(html, '录入第一件物品')
  })
})

await test('只有一件未归位、未分类的物品时也不会崩', () => {
  const minimal: AppData = {
    ...createEmptyData(),
    items: [makeItem({ id: 'only', name: '孤零零的东西' })],
  }
  for (const route of ROUTES) {
    withPage(route.path, minimal, (_container, html) => {
      ok(html.length > 600, `${route.label} 在这种极端数据下渲染失败`)
    })
  }
})

await test('引用了已删除位置 / 分类 / 属性的物品不会让页面崩掉', () => {
  const dangling: AppData = {
    ...createEmptyData(),
    items: [
      makeItem({
        id: 'dangling',
        name: '位置被删掉的东西',
        categoryIds: ['不存在的分类'],
        locationId: '不存在的位置',
        tags: ['已删除的标签'],
        attrs: { '不存在的属性': '值' },
      }),
    ],
  }
  for (const route of ROUTES) {
    withPage(route.path, dangling, (_container, html) => {
      ok(html.length > 600, `${route.label} 在悬空引用数据下渲染失败`)
    })
  }
})

await test('大量数据（300 件）也不会渲染出错', () => {
  const many: AppData = {
    ...createEmptyData(),
    items: Array.from({ length: 300 }, (_, i) =>
      makeItem({ id: `bulk-${i}`, name: `批量物品 ${i}`, quantity: (i % 5) + 1 }),
    ),
  }
  withPage('/items', many, (_container, html) => {
    contains(html, '批量物品 0')
    contains(html, '未归位')
  })
})

suite('渲染冒烟：App 的加载与出错分支')

await test('加载中显示提示而不是白屏', () => {
  const originalInit = useAppStore.getState().init
  // 把 init 换掉，免得它真的去读数据、把状态又改成 ready
  useAppStore.setState({ status: 'loading', init: async () => {} })
  try {
    withApp((_container, html) => {
      contains(html, '正在打开本地数据')
    })
  } finally {
    useAppStore.setState({ init: originalInit })
  }
})

await test('打不开本地存储时显示可读的说明与重试按钮', () => {
  const originalInit = useAppStore.getState().init
  useAppStore.setState({
    status: 'error',
    error: '当前浏览器不支持 IndexedDB',
    init: async () => {},
  })
  try {
    withApp((_container, html) => {
      contains(html, '无法打开本地数据')
      contains(html, '当前浏览器不支持 IndexedDB')
      contains(html, '无痕', '应提示无痕模式这个常见原因')
      contains(html, '重试')
    })
  } finally {
    useAppStore.setState({ init: originalInit })
  }
})

/* ------------------------------------------------------------------ */
/* 本地小工具                                                          */
/* ------------------------------------------------------------------ */

function makeItem(partial: Partial<Item> & { name: string }): Item {
  const now = new Date().toISOString()
  return {
    id: partial.id ?? `id-${partial.name}`,
    name: partial.name,
    categoryIds: partial.categoryIds ?? [],
    locationId: partial.locationId ?? null,
    quantity: partial.quantity ?? 1,
    status: partial.status ?? 'active',
    tags: partial.tags ?? [],
    attrs: partial.attrs ?? {},
    note: partial.note ?? '',
    createdAt: partial.createdAt ?? now,
    updatedAt: partial.updatedAt ?? now,
    idleAt: partial.idleAt ?? null,
    discardedAt: partial.discardedAt ?? null,
  }
}
