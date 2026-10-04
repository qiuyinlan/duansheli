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
import { APP_DATA_KEY, STORE_APP, idbPut } from '../src/storage/idb'
import { ErrorBoundary } from '../src/components/ErrorBoundary'
import { resetBootGuardForTest, showBootError } from '../src/lib/bootGuard'
import { createDerived } from '../src/store/selectors'
import { flushWrites, useAppStore } from '../src/store/useAppStore'
import { clearAiSession, useAiSessionStore } from '../src/store/useAiSessionStore'
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
  { path: '/spare', label: '备用' },
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

await test('切到别的页面再回 AI，对话和没采纳的草稿都还在', () => {
  // 这条守的是用户实际报上来的问题：AI 页的会话状态原来是组件里的 useState，
  // 去别的页面转一圈（比如去设置看数据体检）回来就全空了 ——
  // 聊到一半的对话没了，AI 已经提取好、**还没采纳**的草稿也没了，
  // 只能重新让 AI 整理一遍，白烧一整轮 token。
  //
  // 这里用「挂载 → 卸载 → 再挂载」来模拟那次来回（每次 withPage 结束都会卸载）。
  // 只要状态还在组件里，第二次挂载就会退回空状态，这条立刻红。
  clearAiSession()
  useAiSessionStore.setState({
    bubbles: [
      { id: 'b1', role: 'user', text: '衣柜里有一件灰色的羊毛衫' },
      { id: 'b2', role: 'assistant', text: '记下了，还要加别的吗', meta: '新增 1' },
    ],
    drafts: [
      {
        key: 'k1',
        name: '灰色的羊毛衫',
        quantity: 1,
        locationId: null,
        locationLabel: '',
        newLocationPath: null,
        matchedCategoryIds: [],
        newCategoryPaths: [],
        tags: [],
        attrs: {},
        droppedAttrs: [],
        note: '',
        expiresAt: null,
        status: null,
        matchedCollectionIds: [],
        droppedCollections: [],
        include: true,
        adoptNewCategories: false,
        adoptNewLocation: false,
      },
    ],
  })

  try {
    withPage('/ai', data, (_container, html) => {
      contains(html, '衣柜里有一件灰色的羊毛衫', '第一次挂载应该看得到对话')
    })

    // 中间去别的页面转一圈 —— 这一步会卸载 AI 页面
    withPage('/settings', data, (_container, html) => {
      contains(html, '数据体检')
    })

    withPage('/ai', data, (_container, html) => {
      contains(html, '衣柜里有一件灰色的羊毛衫', '切页面回来对话不该消失')
      contains(html, '记下了，还要加别的吗', '助手那一条也该还在')
      contains(html, '灰色的羊毛衫', '没采纳的草稿也该还在')
      ok(!html.includes('要录新的'), '有会话就不该退回空状态')
    })
  } finally {
    clearAiSession()
  }
})

await test('「新对话」按钮真的能把会话清掉', () => {
  // 会话现在活得比页面久了，所以这个按钮成了唯一的重置开关 ——
  // 它要是失灵，用户就再也没法把累积的历史清掉，而历史每一轮都会进 prompt，
  // 等于每一轮都在为它多付一点 token。
  //
  // 所以这里**真的去点那个按钮**（而不是直接调 clearAiSession）：
  // 要验的正是「按钮 → 确认框 → store」这条链路还通着。
  // 确认框是 createPortal 挂到 document.body 上的，所以要去 body 里找。
  clearAiSession()
  useAiSessionStore.setState({
    bubbles: [{ id: 'b1', role: 'user', text: '一段想清掉的话' }],
    drafts: [],
  })

  const page = mountForSwitch('/ai', data)
  try {
    ok(page.html().includes('一段想清掉的话'), '先得有内容才谈得上清')

    const newChat = [...page.container.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === '新对话',
    )
    ok(newChat !== undefined, '应该找得到「新对话」按钮')
    act(() => {
      ;(newChat as HTMLButtonElement).click()
    })

    // 确认按钮上的字是 ai.resetConfirm（不是默认的「确定」）——
    // 这里故意用它的真实文案，免得以后文案改了这条断言还在假绿
    const confirm = [...document.body.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === '开始新对话',
    )
    ok(confirm !== undefined, '应该弹出确认框，并有一个「开始新对话」按钮')
    act(() => {
      ;(confirm as HTMLButtonElement).click()
    })

    eq(useAiSessionStore.getState().bubbles.length, 0, '确认之后 store 里该清空')
    ok(!page.html().includes('一段想清掉的话'), '界面上也该不见了')
    ok(page.html().includes('要录新的'), '应该回到空状态')
  } finally {
    page.unmount()
    clearAiSession()
  }
})

suite('落盘失败的横幅（不许悄悄丢数据）')

/**
 * 落盘失败是**最危险的静默失败**：界面已经按新数据渲染好了，
 * 看起来一切正常，但刷新就没了。
 *
 * 所以这里验的是两件事：
 *   · 失败时横幅**一直挂着**（而不是弹一条会消失的提示就算了）
 *   · 横幅上给出两条出路：重试、以及把数据导出来带走
 */
const SAVE_FAILURE = { message: '数据库连接正在关闭', at: new Date().toISOString() }

await test('存不进去时，横幅挂出来并给出两条出路', () => {
  useAppStore.setState({ saveFailure: SAVE_FAILURE })
  try {
    withPage('/', fixture(), (_container, html) => {
      contains(html, '没能存进本地')
      contains(html, '数据库连接正在关闭', '要把真实原因原样写出来')
      contains(html, '刷新就会丢', '必须说清后果 —— 否则用户不会当回事')
      contains(html, '重试保存')
      contains(html, '先导出备份', '导出是把数据带走的最后一条路')
    })
  } finally {
    useAppStore.setState({ saveFailure: null })
  }
})

await test('它在壳上，所以每一页都看得到', () => {
  // 挂在某一页上是不够的：用户可能正在别的页面改东西
  useAppStore.setState({ saveFailure: SAVE_FAILURE })
  try {
    for (const path of ['/', '/items', '/settings', '/spare']) {
      withPage(path, fixture(), (_container, html) => {
        contains(html, '没能存进本地', `${path} 上也该看得到`)
      })
    }
  } finally {
    useAppStore.setState({ saveFailure: null })
  }
})

await test('一切正常时不显示（不能天天吓人）', () => {
  useAppStore.setState({ saveFailure: null })
  withPage('/', fixture(), (_container, html) => {
    ok(!html.includes('没能存进本地'), '没出问题就不该有这条横幅')
  })
})

await test('点「重试保存」真的能存进去，横幅随之消失', () => {
  useAppStore.setState({
    saveFailure: SAVE_FAILURE,
    data: fixture(),
    derived: createDerived(fixture()),
  })

  const page = mountForSwitch('/', fixture())
  try {
    ok(page.html().includes('没能存进本地'), '先得有横幅')

    const retry = [...page.container.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === '重试保存',
    )
    ok(retry !== undefined, '应该找得到「重试保存」按钮')

    return (async () => {
      await act(async () => {
        ;(retry as HTMLButtonElement).click()
        await flushWrites()
      })

      eq(useAppStore.getState().saveFailure, null, '存成功之后状态要清掉')
      ok(!page.html().includes('没能存进本地'), '横幅也该消失')
    })()
  } finally {
    page.unmount()
    useAppStore.setState({ saveFailure: null })
  }
})

suite('白屏和死转圈：必须有出路，而且要说出原因')

/**
 * 这一组守的是用户报的「打不开了」。
 *
 * 白屏和无限转圈是**最难查**的两种失败：屏幕上什么都没有，
 * 用户既不知道能不能自救，我也拿不到任何信息。
 * 所以这里验的不是「不会出错」，而是「出错了要说人话」。
 */

/** 一个一定会抛错的组件 —— 用来验 ErrorBoundary 真的兜得住 */
function Boom(): JSX.Element {
  throw new Error('故意炸一下：分类树少了一层')
}

await test('渲染出错时画出一段能读的说明，而不是白屏', () => {
  // React 18 里渲染期异常会卸载整棵树 —— 没有 ErrorBoundary 就是一片空白
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const originalConsoleError = console.error
  // 这次错误是**故意**的，别让它把测试输出弄脏
  console.error = () => {}

  try {
    act(() => {
      root.render(
        <ErrorBoundary>
          <Boom />
        </ErrorBoundary>,
      )
    })

    const text = container.textContent ?? ''
    contains(text, '这一页出错了', '要有一个人话标题')
    contains(text, '故意炸一下', '要把原始错误贴出来 —— 那是唯一能定位的东西')
    contains(text, '数据没有丢', '要安抚：数据还在本地库里')
    contains(text, '回概览', '要给出回到正常状态的入口')
    ok(container.querySelector('.crash-detail') !== null, '原始错误要单独成块，方便复制')
  } finally {
    console.error = originalConsoleError
    act(() => {
      root.unmount()
    })
    container.remove()
  }
})

await test('启动兜底：模块级错误也能画出说明（不依赖 React 和 i18n）', () => {
  // 这是「白屏」的另一种成因：模块加载就抛，React 根本还没开始跑
  const root = document.getElementById('root')
  ok(root !== null, '应该有 #root')

  try {
    showBootError('TypeError: Cannot read properties of undefined (reading map)')

    const text = root?.textContent ?? ''
    contains(text, '启动失败', '要有标题')
    contains(text, 'reading map', '要把原始错误原样贴出来')
    ok(
      text.includes('Failed to start'),
      '双语都要有 —— 这时候无从知道用户选了哪门语言',
    )
    ok(
      (root?.querySelector('#dsh-boot-fallback') as HTMLElement | null) !== null,
      '面板要挂在 #root 里',
    )
  } finally {
    // 收拾干净，别影响后面的用例
    if (root !== null) root.textContent = ''
  }
})

await test('启动兜底是**自己装上**的 —— 没人调用它也已经就位', () => {
  /*
   * 这条守的是一个很容易写错、而且写错了就白干的地方。
   *
   * ES 模块的求值顺序是「先把所有 import 求值完，再跑本模块正文」。
   * 所以如果兜底只在 main.tsx 的正文里被调用，而 `./App` 那条依赖链
   * 在求值期间就抛错，main.tsx 的正文根本不会执行 —— 兜底没装上，
   * 用户看到的还是白屏。而「模块加载期就抛」正是白屏最常见的成因。
   *
   * 所以这里**故意不调用 installBootGuard()**：只 import 过它，
   * 然后直接派发一个 error 事件。装上了才应该画得出面板。
   */
  const root = document.getElementById('root')
  ok(root !== null, '应该有 #root')

  // 重新武装：这条用例必须在「还没挂载过」的状态下跑，
  // 而不是靠「它恰好排在别的渲染用例前面」
  resetBootGuardForTest()

  try {
    window.dispatchEvent(
      new ErrorEvent('error', {
        error: new Error('模拟：模块求值期间就抛了'),
        message: '模拟：模块求值期间就抛了',
      }),
    )

    const text = root?.textContent ?? ''
    contains(text, '启动失败', '光 import 过它就该已经装好了')
    contains(text, '模块求值期间就抛了', '要把原始错误贴出来')
  } finally {
    if (root !== null) root.textContent = ''
  }
})

await test('启动兜底不会重复画（一次启动可能连报好几个错）', () => {
  const root = document.getElementById('root')
  showBootError('第一个错误')
  showBootError('第二个错误')
  const panels = root?.querySelectorAll('#dsh-boot-fallback')
  eq(panels?.length, 1, '只该有一块面板')
  contains(root?.textContent ?? '', '第一个错误', '保留最开始那个 —— 通常它才是因')
  if (root !== null) root.textContent = ''
})

await test('打开本地数据卡住时给出说明和重试，而不是永远转圈', async () => {
  // 把超时调成 0，这样不用真的等 10 秒
  const originalInit = useAppStore.getState().init
  useAppStore.setState({ status: 'loading', init: async () => {} })

  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)

  try {
    await act(async () => {
      root.render(
        <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <App initSlowMs={0} />
        </MemoryRouter>,
      )
    })

    // 超时是个 setTimeout，得让那个宏任务真的跑起来才会有下一步渲染
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
    })

    const text = container.textContent ?? ''
    contains(text, '正在打开本地数据', '正常情况下还是那个进度提示')
    contains(text, '卡住了', '超时之后要说明状况')
    contains(text, '另一个标签页', '要点出常见原因，用户才好自救')
    contains(text, '数据不会因此丢失', '要安抚')
    contains(text, '重试')

    const buttons = [...container.querySelectorAll('button')].map((b) => b.textContent?.trim())
    ok(buttons.includes('重新加载'), `要有「重新加载」，实际按钮：${buttons.join('/')}`)
  } finally {
    act(() => {
      root.unmount()
    })
    container.remove()
    useAppStore.setState({ init: originalInit })
  }
})

suite('升级路径：浏览器里那份老数据也得能打开')

/**
 * 这一组守的是一件**只会在真实用户那里发生**的事。
 *
 * 所有别的用例用的都是刚造出来的完整夹具 —— 什么字段都有。
 * 但用户浏览器里躺着的是**几个版本之前写进去的数据**：
 * 没有 collections（v4 才有）、没有 checklists（v5 才有）、
 * 甚至可能有当时不存在、现在已经认不出来的状态值。
 *
 * `init()` 会把这类数据过一遍 normalizeShape 再放进 store，
 * 所以这里走**完整的那条路**：塞进 IndexedDB → init() → 渲染每一页。
 * 这是「升级之后打不开」最直接的复现方式。
 */
const LEGACY_DATA = {
  schemaVersion: 3,
  items: [
    {
      id: 'old1',
      name: '老版本录的东西',
      categoryIds: [],
      locationId: null,
      quantity: 1,
      status: 'active',
      tags: [],
      attrs: {},
      note: '',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      idleAt: null,
      discardedAt: null,
      expiresAt: null,
      // 注意：没有 collectionIds（v4 才加的）
    },
    {
      id: 'old2',
      name: '躺在备份里的备用',
      categoryIds: [],
      locationId: null,
      quantity: 2,
      status: 'spare',
      tags: [],
      attrs: {},
      note: '',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      idleAt: null,
      discardedAt: null,
      expiresAt: null,
    },
  ],
  categories: [],
  locations: [],
  attributeDefs: [],
  tags: [],
  updatedAt: '2024-01-01T00:00:00.000Z',
  // 注意：没有 collections、没有 checklists
}

await test('老数据经过 init() 之后，每一页都能渲染（升级路径不能崩）', async () => {
  await idbPut(STORE_APP, LEGACY_DATA, APP_DATA_KEY)
  await useAppStore.getState().init()

  eq(useAppStore.getState().status, 'ready', '不该卡在加载中，也不该进错误态')

  const loaded = useAppStore.getState().data
  ok(Array.isArray(loaded.collections), 'collections 要被补成数组，不能是 undefined')
  ok(Array.isArray(loaded.checklists), 'checklists 同理')

  for (const route of ROUTES) {
    withPage(route.path, loaded, (_container, html) => {
      ok(html.length > 600, `${route.label}（${route.path}）在老数据下渲染失败`)
    })
  }
})

await test('认不出来的状态值也不会让页面崩', async () => {
  // 最坏的情况：备份是别人手改过的，或者来自一个我们没见过的版本
  await idbPut(
    STORE_APP,
    {
      ...LEGACY_DATA,
      items: [{ ...LEGACY_DATA.items[0], status: '这个状态不存在' }],
    },
    APP_DATA_KEY,
  )
  await useAppStore.getState().init()

  const data = useAppStore.getState().data
  for (const route of ROUTES) {
    withPage(route.path, data, (_container, html) => {
      ok(html.length > 600, `${route.label} 在未知状态下渲染失败`)
    })
  }
})

suite('崩溃的根因：状态里少了个键也不能崩')

await test('**saveFailure 是 undefined 时也不能崩**（用户报的那个白屏）', () => {
  /*
   * 这一条是照着一个真实事故写的。
   *
   * 当时的代码是 `saveFailure !== null ? ... saveFailure.message ...`，
   * 而 **`undefined !== null` 是 true** —— 于是只要它是 undefined，
   * 下一行读 `.message` 就抛
   * 「Cannot read properties of undefined (reading 'message')」，
   * ErrorBoundary 兜住之前，那就是一整片白屏。
   *
   * undefined 从哪来：开发时 Vite 热更新会留下**旧版本的 store 实例**，
   * 新加的字段在老实例上根本不存在。这类「状态里少了个键」的情况
   * 在生产里也可能出现（比如从旧版本的结构化存储里恢复状态）。
   *
   * 本来该用 `!=` 或者 `?? null` 归一化 —— 一个字符的事，
   * 但纯靠脑子想是想不到的，所以把它钉成用例。
   */
  useAppStore.setState({ saveFailure: undefined as unknown as null })
  try {
    for (const route of ROUTES) {
      withPage(route.path, fixture(), (_container, html) => {
        ok(html.length > 600, `${route.label} 在 saveFailure 为 undefined 时崩了`)
      })
    }
  } finally {
    useAppStore.setState({ saveFailure: null })
  }
})

await test('出错屏上要指出是哪个组件崩的（只有 message 不够用）', () => {
  // 「读了 undefined 的某个属性」这种错误，光看 message 根本看不出是哪一行。
  // 组件栈直接点名，这是复现和自己修的关键线索。
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const originalConsoleError = console.error
  console.error = () => {}

  try {
    act(() => {
      root.render(
        <ErrorBoundary>
          <Boom />
        </ErrorBoundary>,
      )
    })

    const text = container.textContent ?? ''
    contains(text, '出错的位置', '要有一个小标题说明下面这段是什么')
    contains(text, 'Boom', '组件栈里应该点名是 Boom 崩的')
  } finally {
    console.error = originalConsoleError
    act(() => {
      root.unmount()
    })
    container.remove()
  }
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

await test('闲置默认从物品列表里收起来，但必须显示「收了几件、去哪看」', () => {
  // 夹具里的 i3（旧手机）是闲置的
  const data = fixture()
  const idle = data.items.filter((i) => i.status === 'idle')
  eq(idle.length, 1, '夹具里应该刚好有一件闲置')

  // 默认（hideIdle 默认开）：列表里看不到它，但提示条必须出现
  withPage('/items', data, (_container, html) => {
    ok(!html.includes('旧手机'), '闲置的东西默认不该出现在物品列表里')
    contains(html, '这里默认不显示闲置的东西', '必须明确告诉用户东西被收起来了')
    contains(html, '去闲置页', '要给出去哪看的入口')
    contains(html, '就在这看', '也要能就地显示出来')
  })

  // 把设置关掉 → 照常显示
  const original = useAppStore.getState().ui
  useAppStore.setState({ ui: { ...original, hideIdle: false } })
  try {
    withPage('/items', data, (_container, html) => {
      contains(html, '旧手机', '关掉设置后该照常显示')
      ok(!html.includes('这里默认不显示闲置的东西'), '没藏东西就不该有那条提示')
    })
  } finally {
    useAppStore.setState({ ui: original })
  }
})

await test('闲置页照常显示 —— 那里正是它们的家', () => {
  withPage('/idle', fixture(), (_container, html) => {
    contains(html, '旧手机')
  })
})

/* ------------------------------------------------------------------ */
/* 备用                                                                */
/* ------------------------------------------------------------------ */

suite('备用：一个新栏目，和闲置分开')

/** 夹具里塞一条备用：牙膏 ×2，收在衣柜 */
function withSpare(base: AppData = fixture()): AppData {
  const wardrobe = must(
    base.locations.find((l) => l.name === '衣柜'),
    '夹具缺少位置 衣柜',
  ).id
  return {
    ...base,
    items: [
      ...base.items,
      makeItem({
        id: 'spare1',
        name: '备用牙膏',
        quantity: 2,
        status: 'spare',
        locationId: wardrobe,
      }),
    ],
  }
}

await test('备用页按位置分组，每条都给出「取用一件」和件数', () => {
  withPage('/spare', withSpare(), (_container, html) => {
    contains(html, '备用牙膏')
    contains(html, '取用一件', '每一行都要能取用')
    contains(html, '衣柜', '应该按位置分组 —— 备用是收在盒子里的')
    contains(html, '备用 2 件', '要显示这条囤了几件，不是只有「一条」')
  })
})

await test('备用页**不**说闲置那一套话（两页的情绪正好相反）', () => {
  // 闲置页在推动你处理（「闲置越久越说明它不该留在这里」「能扔的就点已处理」），
  // 备用是你特意留的。这些话要是漏到备用页上，就是在劝你扔掉自己囤的东西。
  //
  // 注意这里查的是闲置页**那几句具体的推动性文案**，不是「闲置」两个字 ——
  // 备用页的说明里本来就要提一句「不算闲置」，那是澄清，不是同一件事。
  withPage('/spare', withSpare(), (_container, html) => {
    ok(!html.includes('件闲置'), '备用页不该有「N 件闲置」那个汇总')
    ok(!html.includes('能扔的就点'), '不该出现闲置页的推动语')
    ok(!html.includes('占全部物品的'), '不该有闲置占比那句话')
    contains(html, '不算闲置', '要明确说清备用不算闲置')
  })
})

await test('备用页空的时候给引导，并说清东西怎么放进来', () => {
  withPage('/spare', fixture(), (_container, html) => {
    contains(html, '备用区是空的')
    contains(html, '标记备用', '要告诉用户整条搬进来的入口')
    contains(html, '拆出备用', '也要告诉「买多了」那个入口')
  })
})

await test('物品列表默认收起备用，并显示「收了几件、去哪看」', () => {
  withPage('/items', withSpare(), (_container, html) => {
    ok(!html.includes('备用牙膏'), '备用默认不该混进日常清单')
    contains(html, '这里默认不显示备用的东西', '必须明说东西被收起来了')
    contains(html, '去备用页', '要给出去哪看的入口')
    contains(html, '就在这看', '也要能就地显示出来')
  })

  // 关掉开关 → 照常显示
  const original = useAppStore.getState().ui
  useAppStore.setState({ ui: { ...original, hideSpare: false } })
  try {
    withPage('/items', withSpare(), (_container, html) => {
      contains(html, '备用牙膏', '关掉开关后该照常显示')
      ok(!html.includes('这里默认不显示备用的东西'), '没藏东西就不该有那条提示')
    })
  } finally {
    useAppStore.setState({ ui: original })
  }
})

await test('物品列表选中东西后，批量条里有「标记备用」和「拆出备用」', () => {
  const page = mountForSwitch('/items', withSpare())
  try {
    ok(!page.html().includes('标记备用'), '没选中时不显示批量条')

    const selectAll = must(
      page.container.querySelector('.checkbox input'),
      '物品列表上方应该有全选勾选框',
    )
    act(() => {
      ;(selectAll as HTMLInputElement).click()
    })

    contains(page.html(), '标记备用', '整条搬进备用区的入口')
    contains(page.html(), '拆出备用', '「买多了」那个入口')
  } finally {
    page.unmount()
  }
})

await test('设置页有独立的「隐藏备用」开关，和闲置那个是两回事', () => {
  withPage('/settings', withSpare(), (_container, html) => {
    contains(html, '物品列表里默认不显示备用的东西')
    contains(html, '物品列表里默认不显示闲置的东西', '两个开关都要在')
  })
})

await test('英文下备用页也挂得住，而且不叫 idle', () => {
  // 这是这一整组里最要紧的一条翻译边界：
  // 备用一旦被翻成 idle，英文用户看到的就是「该处理的东西」，
  // 而那正是中文版刻意避开的意思。
  setLang('en')
  try {
    withPage('/spare', withSpare(), (_container, html) => {
      contains(html, 'Spares')
      contains(html, 'Take one')
      contains(html, '备用牙膏', '用户自己起的名字不该被翻译')
      ok(!html.includes('idle items'), '备用页不该出现闲置页的说法')
      ok(!html.includes('of everything you own'), '也不该有闲置占比那句话')
      contains(html, 'not counted as idle', '要明确说清备用不算闲置')
    })
  } finally {
    setLang('zh')
  }
})

await test('物品详情页的状态是三选一，不是开关', () => {
  // 开关只能表达「是 / 不是」，而备用是第三条支线。
  // 而「已舍弃」不在三选一里 —— 它是流程出口，不是随手可选的档位。
  withPage('/items/i1', withSpare(), (_container, html) => {
    contains(html, '在用')
    contains(html, '闲置')
    contains(html, '备用')
    ok(!html.includes('标记为闲置 ——'), '旧的二选一开关文案该没了')
  })
})

await test('设置页有「默认隐藏闲置」开关，并显示当前网址', () => {
  withPage('/settings', fixture(), (_container, html) => {
    contains(html, '物品列表里默认不显示闲置的东西')
    contains(html, '当前网址', '要让用户看得出自己在哪个地址上')
    contains(html, '互不相通的数据仓库', '这句话是给「数据好像丢了」准备的')
  })
})

await test('设置页有数据体检，文案里没有漏到界面上的加粗星号', () => {
  // t() 只做 {变量} 插值，不认 markdown。
  // 文案里写 `**网址**` 是把「加粗」误当成了渲染语法 ——
  // 界面上会原样显示两个星号，而且中英都写星号时，词典对齐、占位符
  // 也全都对得上（scripts/audit-i18n.mjs 里那条 markdown 检查就为这个加的）。
  // 这一条从渲染结果再兜一次，因为「拆成三段拼」的写法也可能拼错。
  withPage('/settings', fixture(), (_container, html) => {
    contains(html, '数据体检', '应该有数据体检这一块')
    contains(html, 'duansheli 数据库', '体检要摆出库的状态')
    contains(html, '主数据记录', '体检要摆出主记录的状态')
    contains(html, '快照', '体检要摆出快照的状态')
    ok(!html.includes('**'), '界面上出现了字面的星号 —— 有文案把 markdown 当渲染语法了')
  })
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
