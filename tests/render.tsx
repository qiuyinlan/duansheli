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
import { setLang } from '../src/i18n'
import { ConfirmDialog } from '../src/components/ui/primitives'
import type { AppData, Item } from '../src/types'
import { contains, eq, fail, fixture, must, ok, suite, test } from './harness'

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
/* 双语：在真实 DOM 上切一次语言                                        */
/* ------------------------------------------------------------------ */

suite('渲染冒烟：切换语言真的会换掉界面文字')

/**
 * 挂一页、点右上角的语言开关、再看文字变了没有。
 *
 * 为什么非要在真实 DOM 上测：语言是模块级状态 + useSyncExternalStore 订阅，
 * 「t() 能返回英文」这件事在纯函数层面早就测过了；
 * 真正容易坏的是**组件有没有订阅**——漏了 useT() 的组件切了语言不会重渲染，
 * 界面上就会留下半截中文。这个只能挂载才看得出来。
 */
function mountForSwitch(
  path: string,
  data: AppData,
): { container: HTMLElement; html: () => string; unmount: () => void } {
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

  act(() => {
    root.render(
      <MemoryRouter
        initialEntries={[path]}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <AppRoutes />
      </MemoryRouter>,
    )
  })

  return {
    container,
    html: () => container.innerHTML.replace(/<!--.*?-->/g, ''),
    unmount: () => {
      act(() => {
        root.unmount()
      })
      container.remove()
    },
  }
}

/** 找到语言开关里那个按钮并点它 */
function clickLangButton(container: HTMLElement, label: string): void {
  const buttons = [...container.querySelectorAll('.lang-switch__btn')]
  const target = buttons.find((b) => b.textContent?.trim() === label)
  ok(target !== undefined, `右上角应该有「${label}」这个按钮（实际有：${buttons.map((b) => b.textContent).join('/')}）`)
  act(() => {
    ;(target as HTMLButtonElement).click()
  })
}

await test('右上角有语言开关，点了之后整页文字从中文变英文', () => {
  const data = fixture()
  // 用物品列表页：这一页既有界面文案（工具条、筛选），又会显示用户自己录的物品名，
  // 正好一次把「界面要翻」和「用户数据不能翻」两件事都验了。
  const page = mountForSwitch('/items', data)
  try {
    ok(page.html().includes('概览'), '一开始侧栏是中文')
    ok(page.html().includes('物品'), '一开始侧栏是中文')

    clickLangButton(page.container, 'English')

    const html = page.html()
    ok(html.includes('Overview'), '切到英文后侧栏应该是 Overview')
    ok(html.includes('Items'), '切到英文后侧栏应该是 Items')
    ok(!html.includes('概览'), '不该还剩中文的「概览」—— 剩了就说明那个组件没订阅语言')
    // 用户自己的数据绝不能被翻译：这是整个双语功能最关键的一条边界
    ok(html.includes('灰色羊毛衫'), '用户录入的物品名必须原样保留')
    ok(html.includes('牛仔裤'), '用户录入的物品名必须原样保留')
  } finally {
    page.unmount()
    setLang('zh')
  }
})

await test('切回中文也正常，来回切不出问题', () => {
  const data = fixture()
  const page = mountForSwitch('/items', data)
  try {
    clickLangButton(page.container, 'English')
    ok(page.html().includes('Items'), '先切到英文')

    clickLangButton(page.container, '中文')
    ok(page.html().includes('物品'), '再切回中文')
    ok(!page.html().includes('Overview'), '中文下不该残留英文标题')
  } finally {
    page.unmount()
    setLang('zh')
  }
})

await test('语言开关在顶栏右侧，手机上也能看到', () => {
  const data = fixture()
  const page = mountForSwitch('/', data)
  try {
    const topbar = page.container.querySelector('.topbar')
    ok(topbar !== null, '应该有顶栏')
    const sw = must(topbar, '顶栏').querySelector('.lang-switch')
    ok(sw !== null, '语言开关应该在顶栏里')
    eq(sw?.querySelectorAll('.lang-switch__btn').length, 2, '两个语言各一个按钮')
  } finally {
    page.unmount()
  }
})

await test('有效期页在两种语言下都能渲染出来', () => {
  const data = fixture()
  data.items = [
    makeItem({ id: 'e1', name: '过期的药', expiresAt: '2020-01-01' }),
    makeItem({ id: 'e2', name: '快过期的面霜' }),
    makeItem({ id: 'e3', name: '没日期的锅' }),
  ]

  const page = mountForSwitch('/expiry', data)
  try {
    ok(page.html().includes('有效期'), '中文标题')
    clickLangButton(page.container, 'English')
    ok(page.html().includes('Expiry'), '英文标题')
  } finally {
    page.unmount()
    setLang('zh')
  }
})

await test('每个页面在英文下都挂得住（漏订阅语言的组件会在这里露出来）', () => {
  const data = fixture()
  setLang('en')
  const paths = [
    '/',
    '/items',
    '/items/new',
    '/locations',
    '/idle',
    '/expiry',
    '/collections',
    '/checklists',
    '/ai',
    '/more',
    '/categories',
    '/attributes',
    '/tags',
    '/settings',
  ]
  try {
    for (const path of paths) {
      const page = mountForSwitch(path, data)
      try {
        const html = page.html()
        eq(html.length > 0, true, `${path} 英文下渲染成了空页面`)
        // 页面级文案不该还留着中文。用户数据（夹具里的分类/位置名）允许是中文，
        // 所以这里只挑几个一定来自词典的界面词。
        for (const word of ['概览', '设置', '保存', '取消']) {
          if (html.includes(word)) {
            fail(`${path} 在英文下还残留中文界面词「${word}」`)
          }
        }
      } finally {
        page.unmount()
      }
    }
  } finally {
    setLang('zh')
  }
})

await test('确认框不传按钮文字时，也要跟着语言走（13 个调用点都靠这个默认值）', () => {
  // 这一条守的是一个很隐蔽的坏法：把默认值写成
  //   confirmLabel = '确定'
  // 而不是在渲染时取 t()。前者会在英文界面下弹出一个中文按钮，
  // 而且**只有打开某个确认框才看得见** —— 逐页挂载的冒烟测试抓不到，
  // 因为确认框默认是关着的。所以这里专门把它打开来验。
  //
  // 注意：Modal 是用 createPortal 挂到 document.body 上的，
  // 所以要看 document.body 的内容，而不是容器里的 innerHTML。
  const checkBoth = (lang: 'zh' | 'en') => {
    setLang(lang)
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    try {
      act(() => {
        root.render(
          <ConfirmDialog
            open
            title="T"
            message="M"
            onConfirm={() => {}}
            onCancel={() => {}}
          />,
        )
      })
      const text = document.body.textContent ?? ''
      if (lang === 'zh') {
        ok(text.includes('确定'), `中文下该有「确定」，实际正文：${text.slice(0, 120)}`)
        ok(text.includes('取消'), '中文下该有「取消」')
        ok(!text.includes('Confirm'), '中文下不该出现英文按钮')
      } else {
        ok(text.includes('Confirm'), `英文下该有 Confirm，实际正文：${text.slice(0, 120)}`)
        ok(text.includes('Cancel'), '英文下该有 Cancel')
        ok(!text.includes('确定'), '英文下不该出现中文按钮 —— 说明默认值是写死的常量')
      }
    } finally {
      act(() => {
        root.unmount()
      })
      container.remove()
    }
  }

  try {
    checkBoth('zh')
    checkBoth('en')
  } finally {
    setLang('zh')
  }
})

await test('语言开关在两种布局里各有一个，任何屏幕宽度下都看得见', () => {
  // ⚠️ 这一条守的是一个**只有真实浏览器才暴露**的坑，而且真踩过：
  // jsdom **不执行 CSS 媒体查询**，所以「元素在 DOM 里」不等于「用户看得见」。
  // 当初把开关只放进 `.topbar`，而 `.topbar` 在 ≥768px 是 display:none ——
  // 桌面用户打开网站，什么都看不到，可这里的所有断言却是绿的。
  //
  // 所以这里不去断言「有个 .lang-switch」，而是断言**两个互斥的容器里各有一个**：
  //   · `.sidebar` 在 ≥768px 显示、<768px 隐藏  → 管桌面
  //   · `.topbar`  在 <768px 显示、≥768px 隐藏  → 管手机
  // 只要这两个容器各自都有一个，任何宽度下就必然至少有一个可见。
  // 哪天有人把开关挪到别的容器里，这条会立刻红。
  const data = fixture()
  const page = mountForSwitch('/', data)
  try {
    const sidebar = must(page.container.querySelector('.sidebar'), '应该有侧栏')
    const topbar = must(page.container.querySelector('.topbar'), '应该有顶栏')

    const inSidebar = sidebar.querySelectorAll('.lang-switch').length
    const inTopbar = topbar.querySelectorAll('.lang-switch').length

    ok(
      inSidebar === 1,
      `侧栏底部该有一个语言开关（桌面端只有它可见），实际 ${inSidebar} 个`,
    )
    ok(inTopbar === 1, `顶栏该有一个语言开关（手机端只有它可见），实际 ${inTopbar} 个`)

    // 两个都要能点，而不是只有壳子
    for (const root of [sidebar, topbar]) {
      eq(
        root.querySelectorAll('.lang-switch__btn').length,
        2,
        '每个开关里都该有中文 / English 两个按钮',
      )
    }
  } finally {
    page.unmount()
  }
})

await test('活动页：空数据时给引导，有活动时列出来', () => {
  // 空活动
  withPage('/collections', createEmptyData(), (_container, html) => {
    contains(html, '还没有任何活动')
    contains(html, '新建活动')
  })

  // 两个活动，一个有内容一个是空的
  const data = fixture()
  data.collections = [
    { id: 'c1', name: '旅行', note: '', order: 0, createdAt: '2026-01-01T00:00:00.000Z' },
    { id: 'c2', name: '学习', note: '备考', order: 1, createdAt: '2026-01-01T00:00:00.000Z' },
  ]
  data.items[0] = { ...must(data.items[0], 'i1'), collectionIds: ['c1'] }

  withPage('/collections', data, (_container, html) => {
    contains(html, '旅行')
    contains(html, '学习')
    contains(html, '备考')
    // 空活动也要列出来，并且明说它是空的 —— 不能悄悄藏起来让用户以为没建上
    contains(html, '空的')
  })
})

await test('活动详情页：列出里面的东西，并给出「移出」而不是「删除」', () => {
  const data = fixture()
  data.collections = [
    { id: 'c1', name: '旅行', note: '三天两夜', order: 0, createdAt: '2026-01-01T00:00:00.000Z' },
  ]
  data.items[0] = { ...must(data.items[0], 'i1'), collectionIds: ['c1'] }

  withPage('/collections/c1', data, (_container, html) => {
    contains(html, '旅行')
    contains(html, '三天两夜')
    contains(html, '灰色羊毛衫', '活动里的东西要列出来')
    contains(html, '移出', '按钮该是「移出」，不是「删除」')
    contains(html, '全部活动', '要有回去的路')
  })
})

await test('活动详情页：活动不存在时给可读提示，而不是白屏', () => {
  withPage('/collections/根本不存在的id', fixture(), (_container, html) => {
    contains(html, '全部活动')
  })
})

await test('活动页在英文下也挂得住', () => {
  const data = fixture()
  data.collections = [
    { id: 'c1', name: '旅行', note: '', order: 0, createdAt: '2026-01-01T00:00:00.000Z' },
  ]
  setLang('en')
  try {
    withPage('/collections', data, (_container, html) => {
      contains(html, 'Collections')
      contains(html, 'New collection')
      // 用户自己起的活动名不能被翻译
      contains(html, '旅行')
    })

    // 空状态那一条换一份空数据来验
    withPage('/collections', createEmptyData(), (_container, html) => {
      contains(html, 'No collections yet')
    })
  } finally {
    setLang('zh')
  }
})

await test('清单页：空数据给引导，有清单时显示进度', () => {
  withPage('/checklists', createEmptyData(), (_container, html) => {
    contains(html, '还没有清单')
    contains(html, '新建清单')
  })

  const data = fixture()
  data.checklists = [
    {
      id: 'l1',
      name: '周末露营',
      fromCollectionId: null,
      createdAt: '2026-01-02T00:00:00.000Z',
      entries: [
        { id: 'e1', itemId: 'i1', name: '帐篷', quantity: 1, checked: true },
        { id: 'e2', itemId: null, name: '顺路买瓶水', quantity: 2, checked: false },
      ],
    },
  ]

  withPage('/checklists', data, (_container, html) => {
    contains(html, '周末露营')
    contains(html, '已打钩 1 / 2', '进度要显示出来')
  })
})

await test('清单详情页：列条目、能打钩、能加一条', () => {
  const data = fixture()
  data.checklists = [
    {
      id: 'l1',
      name: '周末露营',
      fromCollectionId: null,
      createdAt: '2026-01-02T00:00:00.000Z',
      entries: [
        { id: 'e1', itemId: 'i1', name: '帐篷', quantity: 1, checked: true },
        { id: 'e2', itemId: null, name: '顺路买瓶水', quantity: 2, checked: false },
      ],
    },
  ]

  withPage('/checklists/l1', data, (container, html) => {
    contains(html, '周末露营')
    contains(html, '帐篷')
    contains(html, '顺路买瓶水')
    contains(html, '加一条')
    contains(html, '全部清单', '要有回去的路')
    contains(html, '清掉打钩的 1 条', '有打钩的才显示清理按钮')

    // 勾选框的初始状态要对上
    const boxes = [...container.querySelectorAll('.checklist__check input')]
    eq(boxes.length, 2, '两条各一个勾选框')
    eq((boxes[0] as HTMLInputElement).checked, true, '画面上第一条是已打钩的')
    eq((boxes[1] as HTMLInputElement).checked, false)
  })
})

await test('清单详情页：清单一不存在就提示，不白屏', () => {
  withPage('/checklists/不存在的id', fixture(), (_container, html) => {
    contains(html, '全部清单')
  })
})

await test('清单页在英文下也挂得住', () => {
  const data = fixture()
  data.checklists = [
    {
      id: 'l1',
      name: '周末露营',
      fromCollectionId: null,
      createdAt: '2026-01-02T00:00:00.000Z',
      entries: [{ id: 'e1', itemId: null, name: '帐篷', quantity: 1, checked: false }],
    },
  ]
  setLang('en')
  try {
    withPage('/checklists', data, (_container, html) => {
      contains(html, 'Lists')
      contains(html, 'New list')
      contains(html, '周末露营', '用户自己起的清单名不该被翻译')
    })
  } finally {
    setLang('zh')
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
    expiresAt: partial.expiresAt ?? null,
    collectionIds: partial.collectionIds ?? [],
  }
}
