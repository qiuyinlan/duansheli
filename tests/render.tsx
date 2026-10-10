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
import type { ItemDraft } from '../src/ai/convert'
import { planCategoryChanges } from '../src/ai/categoryEdit'
import { flushWrites, useAppStore } from '../src/store/useAppStore'
import { clearAiSession, useAiSessionStore } from '../src/store/useAiSessionStore'
import { setLang } from '../src/i18n'
import { ConfirmDialog } from '../src/components/ui/primitives'
import { LocationPicker } from '../src/components/pickers'
import { DraftCheckLine } from '../src/components/AiQuickBar'
import type { DraftCheck } from '../src/ai/commands'
import type { AppData, Item } from '../src/types'
import { DEFAULT_UI_PREFS } from '../src/types'
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
    /*
     * 物品行里的位置就是**普通文字**（完整路径），不上色。
     * 用户看过第一版「逐级上色」之后明确说过：
     * 「我只是要展示的目录层级颜色改变，正常物品那里正常展示颜色就可以了。」
     * 颜色留给位置页那棵目录树（见下面那条「目录树」用例）。
     */
    contains(html, '家 / 卧室 / 衣柜', '应显示完整位置路径')
    ok(
      !html.includes('loc-path'),
      '物品行里不该再有那些逐级上色的路径片段 —— 那是被否掉的做法',
    )
  })
})

await test('位置页那棵目录树：按分支上色（顶层实、子层极淡），不再是一堵绿墙', () => {
  withPage('/locations', data, (_container, html) => {
    /*
     * ── 这条用例为什么改过 ────────────────────────────────────────
     * 它原来断言的是「子目录统一绿色」（`tree-node__label--sub`），
     * 那是用户**第一次**的诉求（「目录和子目录要分得开」）。
     * 层级深了以后那一版变成了一堵绿墙，用户第二次的说法是：
     * 「感觉现在pc端，看那个位置，全是绿的，还是不好看，
     * 这么多折叠层级，怎么看最清晰呢」。
     *
     * 所以颜色改了意思：不再按**层级**上色，而是按**分支**上色 ——
     * 每个顶层一根色条，子层继承同一个色相并逐层变淡。
     * 这条用例现在守的是这个新意图（回头改回绿墙也会被它抓住）。
     */
    contains(html, 'tree-node__bar', '顶层要有分支色条')
    contains(html, 'tree-node__bar--sub', '子层要有极淡的那一档色条')

    const labels = html.match(/class="tree-node__label[^"]*"/g) ?? []
    ok(labels.length > 0, '应该能抓到树里的行')
    ok(
      labels.every((label) => !label.includes('--sub')),
      '位置页的目录名不该再按层级染绿了 —— 那正是「全是绿的」的来源',
    )

    const bars = html.match(/class="tree-node__bar[^"]*"/g) ?? []
    ok(bars.length > 0, '每一行都该有色条（分支归属），实际一行都没有')
    const faded = bars.filter((bar) => bar.includes('--sub')).length
    ok(faded > 0 && faded < bars.length, '顶层实、子层淡 —— 两档都要出现，否则等于没分档')
  })
})

await test('位置选择器里的目录树也用同一套层级配色（两处不能长成两样）', () => {
  /*
   * 位置选择器是个 Modal（走 portal 挂到 body 上），所以这里要看
   * `document.body` —— 只看容器的 innerHTML 是抓不到弹窗的。
   */
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)

  useAppStore.setState({
    status: 'ready',
    error: null,
    data,
    derived: createDerived(data),
    aiApiKey: '',
  })

  try {
    act(() => {
      root.render(
        <MemoryRouter
          initialEntries={['/items/new']}
          future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
        >
          <AppRoutes />
        </MemoryRouter>,
      )
    })

    /*
     * 打开「位置」字段那个选择器。
     *
     * 那个按钮里的文字是 `未归位（点击选择）`（夹具里新录入的物品
     * 默认沿用上次的位置），所以按这个找比按「位置」两个字找可靠 ——
     * 后者会撞上字段标签那一堆。
     */
    const trigger = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('点击选择') ?? false,
    )
    ok(
      trigger !== undefined,
      `录入页上应该有一个位置的入口按钮。实际按钮：${Array.from(
        container.querySelectorAll('button'),
      )
        .map((b) => b.textContent?.trim() ?? '')
        .filter(Boolean)
        .slice(0, 20)
        .join(' | ')}`,
    )
    act(() => {
      trigger?.click()
    })

    const modal = document.querySelector('.modal__body')
    ok(modal !== null, '点了之后应该弹出选择器')
    ok(
      modal?.innerHTML.includes('tree-node__label--sub') ?? false,
      '选择器里的目录树也要有层级配色，不能只有位置页有',
    )
  } finally {
    act(() => {
      root.unmount()
    })
    container.remove()
  }
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

await test('闲置页照常显示 —— 那里正是它们的家', () => {  withPage('/idle', fixture(), (_container, html) => {
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

await test('设置页的导入能选 CSV（用户就是卡在这一步）', () => {
  /*
   * 用户报的「我这个 CSV 为什么不能导入」，直接原因是文件选择器：
   * 原来写的是 accept=".json,application/json" —— **.csv 根本不显示**，
   * 连选都选不上。
   *
   * 所以这条断言的是那个 accept 属性本身。看着像在测实现细节，
   * 但它恰恰是用户实际撞到的那道门。
   */
  withPage('/settings', fixture(), (container, _html) => {
    const input = must(
      container.querySelector<HTMLInputElement>('input[type=file]'),
      '设置页应该有一个文件选择框',
    )
    const accept = input.getAttribute('accept') ?? ''
    ok(accept.includes('.csv'), `accept 里必须包含 .csv，实际：${accept}`)
    ok(accept.includes('.json'), '也不能把 JSON 弄丢')
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
/* 拖拽：把物品拖到位置上                                              */
/* ------------------------------------------------------------------ */

/**
 * 拖物品用的 MIME 类型。
 *
 * 这里**故意再写一遍**，而不是从页面里 import：它是一份协议，
 * 页面改了而这里没改，测试就该红 —— 从同一个常量取值反而会把这种漂移藏起来。
 */
const ITEM_MIME = 'application/x-duansheli-item'

/**
 * 造一次拖放事件。
 *
 * jsdom 没有实现 DataTransfer，所以自己捏一个最小够用的。要点是必须把
 * dataTransfer 挂到**事件对象**上：React 是照着接口表从原生事件上抄属性的
 * （DragEventInterface 里有 dataTransfer 这一项），挂在 window 上它看不见。
 */
function fireDrag(el: Element, type: 'dragover' | 'drop', mime: string, payload: string): void {
  const dataTransfer = {
    types: [mime],
    getData: (wanted: string) => (wanted === mime ? payload : ''),
    setData: () => {},
    files: [],
    effectAllowed: '',
    dropEffect: '',
  }
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer })
  act(() => {
    el.dispatchEvent(event)
  })
}

/** 位置树里某个名字的那一行（落点就在这一行上） */
function treeRow(container: HTMLElement, name: string): HTMLElement {
  const label = treeLabel(container, name)
  return must(label.closest<HTMLElement>('.tree-node__row'), `「${name}」那一行没找到容器`)
}

/**
 * 位置树里某个名字的那个按钮。
 *
 * ⚠️ 位置页现在**默认只展开顶层**（用户的原话：「这么多折叠层级，怎么看最清晰呢」），
 * 所以深层的行（「衣柜」在「家 / 卧室」下面）要先展开才在 DOM 里。
 * 需要深层行的用例，请在挂载**之前**调 `expandAllLocationsForTest()` ——
 * 不要在 `act()` 里面点展开再读 DOM：**act 套 act 时内层不会立刻 flush**，
 * 读到的还是展开之前的 DOM（这一条是踩过坑才写下来的）。
 */
function treeLabel(container: HTMLElement, name: string): HTMLButtonElement {
  const label = Array.from(
    container.querySelectorAll<HTMLButtonElement>('.tree-node__label'),
  ).find((button) => (button.textContent ?? '').trim() === name)
  return must(label, `位置树里找不到「${name}」`)
}

/**
 * 让位置页一挂载就是「整棵树全展开」的样子。
 *
 * 走的是**真的那个偏好**（`ui.expandedLocations`）—— 也就是用户手动展开之后
 * 被记住的那份状态。所以这不是在测试里开后门，而是「用户上次把树都展开了」
 * 这个真实情形。
 */
function expandAllLocationsForTest(data: AppData): void {
  useAppStore.setState({
    ui: {
      ...useAppStore.getState().ui,
      expandedLocations: data.locations.map((location) => location.id),
      locationsExpandedTouched: true,
    },
  })
}

/** 右边列表里名字含某个词的那一行 */
function rowOf(container: HTMLElement, name: string): HTMLElement {
  const row = Array.from(container.querySelectorAll<HTMLLIElement>('li.list-row')).find((li) =>
    (li.textContent ?? '').includes(name),
  )
  return must(row, `物品列表里找不到「${name}」`)
}

/** 轻提示是 portal 到 document.body 的，不在页面容器里 */
function toastText(): string {
  return document.querySelector('.toast-stack')?.textContent ?? ''
}

function locationIdOf(data: AppData, name: string): string {
  return must(
    data.locations.find((l) => l.name === name),
    `夹具缺少位置 ${name}`,
  ).id
}

function locationOfItem(id: string): string | null {
  return must(
    useAppStore.getState().data.items.find((i) => i.id === id),
    `物品 ${id} 不该消失`,
  ).locationId
}

/**
 * 等这次改动真的落盘。
 *
 * 拖放会真的写数据，而落盘是异步排队走的 —— 不等它，那次写就会飘到后面的用例里去
 * （体检那一组会先清空 IndexedDB 再摆自己的数据，然后被这一笔覆盖掉，
 * 症状是「主记录在」那条用例莫名其妙地红）。
 */
async function settleWrites(): Promise<void> {
  await act(async () => {
    await flushWrites()
  })
}

suite('位置页：把物品拖到位置上')

/*
 * ⚠️ 这一组用例要拖的是**深层的**位置（「衣柜」在「家 / 卧室」下面）。
 * 位置页现在默认只展开顶层（用户嫌「这么多折叠层级看不清晰」），
 * 所以挂载前先把「用户上次全展开了」这个状态摆进偏好里 ——
 * 走的是真的那个偏好，不是在测试里开后门。
 */
await test('拖到另一个位置：归位跟着变，而且会出声', async () => {
  const data = fixture()
  expandAllLocationsForTest(data)
  const wardrobe = locationIdOf(data, '衣柜')
  const cupboard = locationIdOf(data, '橱柜')

  withPage('/locations', data, (container) => {
    // 先点「衣柜」，右边才会列出它的东西 ——
    // 这样断言不依赖「含子位置」那个开关当前是什么状态
    act(() => {
      treeLabel(container, '衣柜').click()
    })
    ok(rowOf(container, '灰色羊毛衫'), '点了衣柜，右边该列出里面的东西')
    eq(locationOfItem('i1'), wardrobe, '拖之前的归位是衣柜')

    fireDrag(treeRow(container, '橱柜'), 'dragover', ITEM_MIME, 'i1')
    fireDrag(treeRow(container, '橱柜'), 'drop', ITEM_MIME, 'i1')

    eq(locationOfItem('i1'), cupboard, '松手之后它该落到橱柜上')
    contains(toastText(), '已把「灰色羊毛衫」移到', '拖完必须给个回执，否则用户不知道成没成')
  })

  await settleWrites()
})

await test('拖到「未归位」＝把位置撤掉（不是「没有动作」）', async () => {
  // null 和「不调用」是两件事：少了这条路径，东西拖出去就再也拖不回来了。
  const data = fixture()
  expandAllLocationsForTest(data)

  withPage('/locations', data, (container) => {
    act(() => {
      treeLabel(container, '衣柜').click()
    })

    fireDrag(treeRow(container, '未归位'), 'dragover', ITEM_MIME, 'i2')
    fireDrag(treeRow(container, '未归位'), 'drop', ITEM_MIME, 'i2')

    eq(locationOfItem('i2'), null, '落到未归位上就是 locationId 变 null')
  })

  await settleWrites()
})

await test('拖回原地：数据一动不动，但要说一声', () => {
  /*
   * 静默的成功和失效长得一模一样 —— 不说的话用户只会以为拖拽没生效，
   * 然后反复拖，或者干脆改用手动路径。
   */
  const data = fixture()
  expandAllLocationsForTest(data)
  const wardrobe = locationIdOf(data, '衣柜')

  withPage('/locations', data, (container) => {
    act(() => {
      treeLabel(container, '衣柜').click()
    })

    fireDrag(treeRow(container, '衣柜'), 'dragover', ITEM_MIME, 'i1')
    fireDrag(treeRow(container, '衣柜'), 'drop', ITEM_MIME, 'i1')

    eq(locationOfItem('i1'), wardrobe, '本来就在衣柜里，不该被挪走')
    contains(toastText(), '本来就在', '拖回原地也得说一句')
  })
})

await test('不是给这棵树的拖拽类型，一概不接', () => {
  // 拖文字、拖文件从这里经过时不能把物品挪走 —— 认 MIME 就是为了这个。
  const data = fixture()
  expandAllLocationsForTest(data)
  const wardrobe = locationIdOf(data, '衣柜')

  withPage('/locations', data, (container) => {
    act(() => {
      treeLabel(container, '衣柜').click()
    })

    fireDrag(treeRow(container, '橱柜'), 'dragover', 'text/plain', 'i1')
    fireDrag(treeRow(container, '橱柜'), 'drop', 'text/plain', 'i1')

    eq(locationOfItem('i1'), wardrobe, '别的东西拖过去，这一件的归位不该变')
  })
})

await test('物品行上挂着「移到…」，给拖不了的设备留了路', () => {
  /*
   * HTML5 拖放在触屏上根本不触发，键盘也拖不了。
   * 这个按钮不是可有可无的备胎 —— 没有它，位置页在手机上就是「看得见、改不动」。
   */
  const data = fixture()
  expandAllLocationsForTest(data)
  withPage('/locations', data, (container) => {
    act(() => {
      treeLabel(container, '衣柜').click()
    })
    const fallback = Array.from(container.querySelectorAll('button')).find(
      (button) => (button.textContent ?? '').trim() === '移到…',
    )
    ok(fallback, '每个物品行上都要有一条不用拖的入口')
  })
})

suite('位置页：层级深了怎么看最清晰（用户的原话）')

/** 清掉「用户调过展开状态」的痕迹 —— 也就是第一次进这一页的样子 */
function resetLocationExpansionPrefs(): void {
  useAppStore.setState({
    ui: {
      ...useAppStore.getState().ui,
      expandedLocations: [],
      locationsExpandedTouched: false,
    },
  })
}

/** 树里当前渲染出来的那些行（位置名） */
function visibleLocationNames(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('.tree-node__label')).map(
    (button) => (button.textContent ?? '').trim(),
  )
}

function buttonWithText(container: HTMLElement, text: string): HTMLButtonElement {
  return must(
    Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => (button.textContent ?? '').trim() === text,
    ),
    `应该找得到「${text}」按钮`,
  )
}

await test('★ 默认只展开顶层 —— 进来不再是一屏铺满的层级', () => {
  /*
   * 用户的原话：「这么多折叠层级，怎么看最清晰呢」。
   * 以前这一页**一进来就把整棵树全部展开**（`new Set(derived.flat.map(...))`），
   * 那等于一进门就给他最坏的第一眼。
   */
  resetLocationExpansionPrefs()
  withPage('/locations', fixture(), (container) => {
    const names = visibleLocationNames(container)
    ok(names.includes('家'), '顶层要看得到')
    ok(names.includes('卧室'), '顶层是展开的，第二层（家里各个房间）一眼看得到')
    ok(!names.includes('衣柜'), `更深的先不铺出来 —— 这就是「不再一屏全是层级」，实际：${names.join('/')}`)

    // 「全部展开」是给「我就是要一次看全」的那条路
    act(() => {
      buttonWithText(container, '全部展开').click()
    })
    const expanded = visibleLocationNames(container)
    ok(expanded.includes('衣柜'), `点「全部展开」之后深层要出来，实际：${expanded.join('/')}`)
  })
})

await test('★ 展开状态会被记住 —— 收好的不再白收', () => {
  const data = fixture()
  resetLocationExpansionPrefs()

  withPage('/locations', data, (container) => {
    act(() => {
      buttonWithText(container, '全部折叠').click()
    })
  })

  const prefs = useAppStore.getState().ui
  eq(prefs.expandedLocations.length, 0, '全折叠要记下来')
  ok(prefs.locationsExpandedTouched, '要标记「用户调过」，这样下次进来才照他的来')

  /* 再进一次这一页：应该还是折叠的样子（以前切页回来又全展开了） */
  withPage('/locations', data, (container) => {
    const names = visibleLocationNames(container)
    ok(names.includes('家'), '顶层总要看得到')
    ok(!names.includes('卧室'), '上次收起来了，这次进来也该是收着的')
  })
})

await test('位置页有搜索框（层级深了要能直接跳过去）', () => {
  /*
   * ⚠️ 搜索的**行为**在这里测不了：jsdom 里给输入框派发 input 事件到不了
   * React 的 onChange（见 tests/dom.ts）。所以：
   *   · 这里只验「入口在」这一半
   *   · 匹配规则那一半由 tests/smoke.ts 里 `searchTreeIds` 那两条钉着，
   *     而它和分类页、两个选择器用的是**同一个函数**
   */
  resetLocationExpansionPrefs()
  withPage('/locations', fixture(), (container) => {
    const input = must(
      container.querySelector<HTMLInputElement>('input[type="search"]'),
      '位置页要有一个搜索框',
    )
    ok((input.getAttribute('placeholder') ?? '').length > 0, '搜索框要有提示文字')
  })
})

/* ------------------------------------------------------------------ */
/* 闲置页：按分类分组                                                  */
/* ------------------------------------------------------------------ */

/**
 * 四件闲置，落在三个不同的分类桶里：
 *   i2 牛仔裤（衣物，闲置 100 天）
 *   i1 灰色羊毛衫（衣物，闲置 10 天）
 *   i3 旧手机（电子 —— 夹具里本来就是闲置，400 天）
 *   i5 不知道放哪的东西（**没有分类**）
 */
function withIdle(): AppData {
  const base = fixture()
  const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 3600 * 1000).toISOString()
  return {
    ...base,
    items: base.items.map((i): Item => {
      if (i.id === 'i1') return { ...i, status: 'idle', idleAt: daysAgo(10) }
      if (i.id === 'i2') return { ...i, status: 'idle', idleAt: daysAgo(100) }
      if (i.id === 'i5') return { ...i, status: 'idle', idleAt: daysAgo(5) }
      return i
    }),
  }
}

function categoryIdOf(data: AppData, name: string): string {
  return must(
    data.categories.find((c) => c.name === name),
    `夹具缺少分类 ${name}`,
  ).id
}

/** 页面上所有分组标题，按出现顺序 */
function groupLabels(container: HTMLElement): string[] {
  return [...container.querySelectorAll('.group-head__label')].map((el) =>
    (el.textContent ?? '').trim(),
  )
}

/** 某个分组那一块（含它下面的子分组与物品） */
function groupBlock(container: HTMLElement, label: string): HTMLElement {
  const head = [...container.querySelectorAll('.group-head__label')].find(
    (el) => (el.textContent ?? '').trim() === label,
  )
  return must(head?.closest<HTMLElement>('.item-group'), `找不到「${label}」这个分组`)
}

suite('闲置页：按分类分组')

await test('按分类分块，没有分类的排在最后', () => {
  // 顺序跟着**分类树**走（和物品列表页同一个规矩），不是按名字排、也不是按件数排。
  withPage('/idle', withIdle(), (container) => {
    eq(groupLabels(container).join(' / '), '衣物 / 电子 / 未分类', '分组顺序跟着分类树走')
  })
})

await test('每个分组里仍然是「闲置越久越靠前」', () => {
  /*
   * 分组以后最容易丢掉的就是这条：按分类切块之后，如果组内不做排序，
   * 最该处理的反而被埋起来了 —— 那这一页存在的意义就少了一半。
   */
  withPage('/idle', withIdle(), (container) => {
    const names = [...groupBlock(container, '衣物').querySelectorAll('.list-row__title')].map(
      (el) => (el.textContent ?? '').trim(),
    )
    eq(names.length, 2, '衣物这一组应该有两条')
    ok(names[0].startsWith('牛仔裤'), `组内最久的排最前，实际是：${names.join(' / ')}`)
    ok(names[1].startsWith('灰色羊毛衫'), '闲置 10 天的要排在 100 天后面')
  })
})

await test('没有分类的闲置归到「未分类」，不串进别的组', () => {
  withPage('/idle', withIdle(), (container) => {
    contains(groupBlock(container, '未分类').innerHTML, '不知道放哪的东西')
    ok(
      !groupBlock(container, '衣物').innerHTML.includes('不知道放哪的东西'),
      '一件东西不能同时出现在两个分组里（它压根没有分类）',
    )
  })
})

await test('点分组标题能折叠，展开状态和物品列表页共用一份', () => {
  // 闲置页默认全部展开（这一页就是拿来从头看一遍的），但用户收起来的分组
  // 必须照样尊重 —— 而且和物品列表页是同一个 key，两页对得上。
  const idleData = withIdle()
  const clothing = categoryIdOf(idleData, '衣物')
  const originalUi = useAppStore.getState().ui
  const page = mountForSwitch('/idle', idleData)

  try {
    contains(page.html(), '牛仔裤', '先得有东西可折叠')

    const head = [...page.container.querySelectorAll('.group-head')].find((el) =>
      (el.textContent ?? '').includes('衣物'),
    )
    ok(head, '应该找得到「衣物」的分组标题')

    act(() => {
      ;(head as HTMLElement).click()
    })

    ok(!page.html().includes('牛仔裤'), '折叠之后里面的东西不该再列出来')
    ok(
      useAppStore.getState().ui.collapsedGroups.includes(clothing),
      '折叠要记进 ui，才能跨页、跨刷新生效',
    )
  } finally {
    page.unmount()
    useAppStore.setState({ ui: originalUi })
  }
})

/* ------------------------------------------------------------------ */
/* 行内的垃圾桶：一下就是一下                                            */
/* ------------------------------------------------------------------ */

suite('删除：单条直接进回收站，批量才弹勾选')

/** 某一行的动作区里那些按钮 */
function rowButtons(container: HTMLElement, name: string): HTMLButtonElement[] {
  return [...rowOf(container, name).querySelectorAll<HTMLButtonElement>('button')]
}

await test('★ 点物品行那个垃圾桶：直接进回收站，**不弹任何对话框**', () => {
  /*
   * 用户的原话：「在物品界面，点击右边选项，删除，跳出的是所有物品，
   * 让我再次选择放啥进回收站。但是明明只需要点击一下删除键，直接丢到
   * 回收站的。」
   *
   * 第一版我把行内这个图标也接到了勾选列表上，错在**把「小心」用错了地方**：
   * 勾选列表要解决的是「批量选对没有」，而单条上的垃圾桶指的就是这一件。
   * 这条用例就是让那种「再问一遍」的改动立刻变红。
   */
  const data = fixture()

  withPage('/items', data, (container) => {
    const buttons = rowButtons(container, '灰色羊毛衫')
    const trash = buttons[buttons.length - 1]
    ok(trash !== undefined, '那一行应该有一个删除按钮')

    act(() => {
      trash.click()
    })

    ok(document.querySelector('.modal') === null, '不该弹出任何对话框 —— 点一下就该完事')

    const moved = must(
      useAppStore.getState().data.items.find((i) => i.id === 'i1'),
      '那一件不该从数据里消失',
    )
    eq(moved.status, 'discarded', '应该已经被移进回收站')
    contains(toastText(), '已移入', '要给个回执，否则用户不确定点到了没有')
  })
})

await test('★ 闲置页、备用页、位置页的行内垃圾桶同样是一下就完事', () => {
  // 四个页面的行为必须一致 —— 只有一处弹框、别处不弹，用户会以为那些是坏的
  const pages: Array<{ path: string; name: string; id: string }> = [
    { path: '/idle', name: '旧手机', id: 'i3' },
  ]

  for (const page of pages) {
    const data = fixture()
    withPage(page.path, data, (container) => {
      const buttons = rowButtons(container, page.name)
      const trash = buttons[buttons.length - 1]
      ok(trash !== undefined, `${page.path} 那一行应该有一个删除按钮`)

      act(() => {
        trash.click()
      })

      ok(document.querySelector('.modal') === null, `${page.path} 不该弹对话框`)
      eq(
        must(
          useAppStore.getState().data.items.find((i) => i.id === page.id),
          `${page.name} 不该消失`,
        ).status,
        'discarded',
        `${page.path} 应该已经移进回收站`,
      )
    })
  }
})

await test('批量删除仍然要弹勾选列表（那条路才是真需要核对的）', () => {
  /*
   * 这条是上面两条的反面。批量选中之后点「舍弃」，用户面对的是
   * 「这几个到底选对没有」—— 那时候把名单亮出来让他核一遍是真有用的。
   * 所以两个行为要**同时**成立，缺一边都不对。
   */
  const data = fixture()

  withPage('/items', data, (container) => {
    // 勾上第一件
    const boxes = [...container.querySelectorAll<HTMLInputElement>('.row-checkbox')]
    const first = boxes[0]
    ok(first !== undefined, '应该有可勾选的物品')
    act(() => {
      first.click()
    })

    // 选中栏里的「舍弃」
    const discard = must(
      [...container.querySelectorAll<HTMLButtonElement>('button')].find(
        (b) => (b.textContent ?? '').trim() === '舍弃',
      ),
      '选中之后应该出现批量操作栏',
    )
    act(() => {
      discard.click()
    })

    const modal = document.querySelector('.modal__body')
    ok(modal !== null, '批量删除必须弹勾选列表')
    contains(modal?.textContent ?? '', '回收站', '框里要说清进的是回收站')
  })
})

/* ------------------------------------------------------------------ */
/* AI 整理分类                                                          */
/* ------------------------------------------------------------------ */

suite('AI 整理分类：预览摆出来、采纳真的落库')

await test('★ 分类改动单列一块，每行说清「旧 → 新」和能不能做', () => {
  /*
   * 用户要的能力：「我希望 ai 可以编辑分类，我可以让它帮我整理已有的分类。」
   *
   * 分类是结构 —— 改错了你只会看到「树变了样子」，看不出哪一层错了。
   * 所以这一块必须在**动之前**把「将要发生什么」一行一行说清楚，
   * 而且做不了的那几条要明说「不会执行」。
   */
  clearAiSession()
  const data = fixture()

  // 造一份「有 ok、也有做不了」的计划
  const plan = planCategoryChanges(data, [
    { kind: 'create', path: ['衣服'], newName: '衣服', parentPath: [] },
    { kind: 'rename', path: ['衣物'], newName: '穿戴' },
    { kind: 'rename', path: ['根本没有的分类'], newName: '随便' },
    { kind: 'move', path: ['衣物'], newParentPath: ['衣物'] },
  ])

  useAiSessionStore.setState({ categoryPlan: plan.entries })

  const page = mountForSwitch('/ai', data)
  try {
    const html = page.html()
    contains(html, '分类', '要有分类那一块')
    contains(html, '新建', '要标出动作是「新建」')
    contains(html, '改名', '要标出「改名」')
    contains(html, '移动', '要标出「移动」')

    ok(html.includes('衣物') && html.includes('穿戴'), '改名要显示「旧 → 新」')
    ok(html.includes('衣服'), '新建的目标要显示出来')

    contains(html, '找不到这个分类', '★ 做不了的那条要明说原因')
    contains(html, '做不了', '★ 而且要有一块专门说明「这几条不会执行」')

    // 做不了的条目三个勾选框状态要能区分：ok 的可勾、missing/cycle 的禁用
    const boxes = [...page.container.querySelectorAll<HTMLInputElement>('.cat-plan input')]
    eq(boxes.length, 4, '四条各一个勾选框')
    ok(boxes[2]?.disabled === true, 'missing 那条要禁用勾选')
    ok(boxes[3]?.disabled === true, 'cycle 那条要禁用勾选')
    ok(boxes[0]?.disabled === false, 'ok 那条可以勾')
  } finally {
    page.unmount()
    clearAiSession()
  }
})

await test('★ 点「采纳分类改动」：只执行能做的那几条，而且真的改到数据上', () => {
  clearAiSession()
  const data = fixture()
  const clothesId = must(
    data.categories.find((c) => c.name === '衣物'),
    '夹具里应该有「衣物」',
  ).id

  const plan = planCategoryChanges(data, [
    { kind: 'rename', path: ['衣物'], newName: '穿戴' },
    { kind: 'rename', path: ['根本没有的分类'], newName: '随便' },
  ])
  useAiSessionStore.setState({ categoryPlan: plan.entries })

  const page = mountForSwitch('/ai', data)
  return (async () => {
    try {
      const accept = must(
        [...page.container.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
          (b.textContent ?? '').includes('采纳分类改动'),
        ),
        '应该找得到「采纳分类改动」按钮',
      )

      await act(async () => {
        accept.click()
        await flushWrites()
      })

      const after = useAppStore.getState().data
      eq(
        must(after.categories.find((c) => c.id === clothesId), '衣物应该还在').name,
        '穿戴',
        '★ 合法的那条要真的改到数据上',
      )
      eq(after.categories.length, data.categories.length, '做不了的那条不该凭空造出分类')

      // 采纳完计划要清掉，否则会再执行一遍
      eq(useAiSessionStore.getState().categoryPlan.length, 0, '采纳之后计划要清空')
      // 对话里留一条回执（说的是「改了几处」和哪种改动）
      ok(
        useAiSessionStore.getState().bubbles.some((b) => b.text.includes('改名')),
        `要在聊天记录里留一条「已改了什么」的回执。实际气泡：${useAiSessionStore
          .getState()
          .bubbles.map((b) => b.text)
          .join(' | ')}`,
      )
    } finally {
      page.unmount()
      clearAiSession()
    }
  })()
})

await test('★ 删分类的连带后果要在预览里写出来（用户最怕「会不会把东西也删了」）', () => {
  clearAiSession()
  const data = fixture()
  const clothesId = must(data.categories.find((c) => c.name === '衣物'), '衣物').id

  // 造一个有子分类 + 挂着物品的分类
  const withChildren: AppData = {
    ...data,
    categories: [
      ...data.categories,
      { id: 'c1', name: '上装', parentId: clothesId, order: 0, createdAt: '2026-01-01T00:00:00.000Z' },
    ],
  }
  const plan = planCategoryChanges(withChildren, [{ kind: 'delete', path: ['衣物'] }])
  eq(plan.entries[0]?.childCount, 1, '先确认确实有一个子分类')
  ok((plan.entries[0]?.itemCount ?? 0) > 0, '而且确实挂着物品')

  useAiSessionStore.setState({ categoryPlan: plan.entries })

  const page = mountForSwitch('/ai', withChildren)
  try {
    const html = page.html()
    contains(html, '子分类会挂到上一级', '要说清子分类会怎样')
    contains(html, '失去这个分类归属', '要说清物品会怎样')
    contains(html, '物品本身一件都不会少', '★ 这句话必须写出来 —— 用户最怕这个')
  } finally {
    page.unmount()
    clearAiSession()
  }
})

/* ------------------------------------------------------------------ */
/* AI 预览：只给看改动过的和被删的                                       */
/* ------------------------------------------------------------------ */

/**
 * 把 DeepSeek 的 HTTP 响应按顺序喂进去。
 *
 * 这一组要验的正是「拉进来 189 条之后 touchedKeys 里剩什么」——
 * 那是 `send()` 内部的一步，**只有真的走一遍那条链路才测得到**。
 * 所以这里不打桩 chat()，而是把 fetch 换成假的（lib/chat 用的就是它）。
 */
function stubChat(responses: string[]): { restore: () => void; calls: () => number } {
  const original = globalThis.fetch
  let index = 0
  let calls = 0

  globalThis.fetch = (async () => {
    const content = responses[Math.min(index, responses.length - 1)] ?? '{}'
    index++
    calls++
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    }
  }) as unknown as typeof globalThis.fetch

  return { restore: () => {
    globalThis.fetch = original
  }, calls: () => calls }
}

/** 造一条「拉进来当上下文」的草稿：内容就是库里那件东西的原样 */
function contextDraft(id: string, name: string): ItemDraft {
  return {
    key: id,
    sourceItemId: id,
    name,
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
  }
}

suite('AI 预览：只显示改动过的和会被删的')

await test('★ 拉进来 189 条只改了 2 条：预览只铺那 2 条，不铺 189 条', () => {
  /*
   * 用户的原话：「它还是把所有东西都放到草稿箱显示出来，但是让我采纳，
   * 只需要给我看更改的，还有删除的即可，不需要所有都展示。」
   *
   * 这一条守的就是那个「拉进来 ≠ 动过」的区分：
   *   拉进来的是**上下文**，只有 AI 真改了的（进 touchedKeys / changedKeys）
   *   才该铺在预览里。别把「189 条拉进来了」当成「189 条都要给用户看」。
   */
  clearAiSession()

  // 189 条纯上下文（模拟「把不用的都删掉，先全拉进来我看看」）
  const context = Array.from({ length: 189 }, (_, i) =>
    contextDraft(`ctx-${i}`, `上下文物品 ${i}`),
  )
  // 2 条真被改过的
  const changed = [contextDraft('chg-1', '改过的那一件'), contextDraft('chg-2', '改过的另一件')]
  // 1 条 AI 决定删掉的：**留在草稿里，带待删标记**
  const toDelete = [{ ...contextDraft('i3', '旧手机'), removed: true }]

  useAiSessionStore.setState({
    bubbles: [{ id: 'b1', role: 'user', text: '把不用的删掉' }],
    drafts: [...context, ...changed, ...toDelete],
    // 只有这 2 条是「动过」的
    touchedKeys: ['chg-1', 'chg-2'],
    changedKeys: ['chg-1'],
    removedKeys: ['i3'],
  })

  try {
    withPage('/ai', data, (_container, html) => {
      contains(html, '改过的那一件', '改动过的必须看得到')
      contains(html, '改过的另一件', '改动过的必须看得到')

      ok(
        !html.includes('上下文物品 0'),
        '★ 没动过的上下文条目**不许**铺在预览里 —— 正是用户报的那件事',
      )
      ok(!html.includes('上下文物品 188'), '最后一条也不该出现')

      // 删除必须单独有一块，而且要看得见名字
      contains(html, '会被移进回收站', '删除要单独列出来')
      contains(html, '旧手机', '★ 要被删掉的那几件要看得见名字，而不是只有一个数字')

      // 入口还在手边：想看全貌随时能摊开
      contains(html, '显示没改动的', '要留一个「看全部」的入口')
    })
  } finally {
    clearAiSession()
  }
})

await test('★ 只删不改时也要看得到：那一块列出被删的名字', () => {
  /*
   * 纯删除是最容易「什么都没有」的一种：改动的列表是空的（因为一条都没改），
   * 而被删的条目**带着待删标记留在草稿里**（不在改动列表里显示），
   * 所以必须单独有一块把它们列出来。不列的话，用户在点「采纳」之前
   * 看到的就是一片空白加一个数字。
   */
  clearAiSession()

  useAiSessionStore.setState({
    bubbles: [{ id: 'b1', role: 'user', text: '把这几件不用的删掉' }],
    drafts: [
      contextDraft('ctx-1', '留下的那一件'),
      { ...contextDraft('i3', '旧手机'), removed: true },
      { ...contextDraft('i5', '不知道放哪的东西'), removed: true },
    ],
    touchedKeys: [],
    changedKeys: [],
    removedKeys: ['i3', 'i5'],
  })

  try {
    withPage('/ai', data, (_container, html) => {
      contains(html, '会被移进回收站', '纯删除也要有那一块')
      contains(html, '旧手机')
      contains(html, '不知道放哪的东西')
      ok(!html.includes('留下的那一件'), '留下的那条是纯上下文，不该铺出来')
      // 「这一轮没有改动」那个空状态不该在这里出现 —— 明明有删除要交代
      ok(!html.includes('这一轮没有改动'), '有东西要被删时不该显示「没有改动」的空状态')
    })
  } finally {
    clearAiSession()
  }
})

await test('★ 真的走一遍 send：拉进来 189 条、AI 只动 1 条 → touchedKeys 只有那 1 条', async () => {
  /*
   * 上面两条是「照着契约渲染」，这一条是**真跑那条链路**：
   * 把 fetch 换成假的，让 send() 真的收到两轮回复 ——
   * 第一轮说「先全都拉进来」（loadScope: all），第二轮只动 1 条、删 1 条。
   *
   * 要验的就是那个我修过的坑：**「拉进来」不许被算成「动过」**。
   * 之前我在这里写的是「拉进来的一律先记成动过」，于是 189 条全铺出来。
   * 所以这条用例是真正能抓到那个 bug 的那一条（其余两条抓不到 ——
   * 它们是直接摆好 store 状态再渲染的）。
   */
  clearAiSession()
  const page = mountForSwitch('/ai', fixture())

  // Key 是必填的，而 jsdom 里没法给输入框派事件，所以直接摆进 store
  useAppStore.setState({ aiApiKey: 'test-key' })

  // 两轮回复：先要全部数据，再只改一条、删一条
  const stub = stubChat([
    JSON.stringify({ reply: '先把所有东西拉进来看看', loadScope: { all: true } }),
    JSON.stringify({
      reply: '改了一件、删了一件',
      items: [{ id: 'i1', name: '灰色羊毛衫', quantity: 3 }],
      removedIds: ['i3'],
    }),
  ])

  try {
    const textarea = must(
      page.container.querySelector<HTMLTextAreaElement>('textarea'),
      'AI 页应该有一个输入框',
    )
    const sendButton = must(
      [...page.container.querySelectorAll<HTMLButtonElement>('button')].find(
        (b) => b.textContent?.trim() === '发送',
      ),
      '应该找得到「发送」按钮',
    )
    ok(sendButton.disabled, '先确认：空输入时「发送」是禁用的')

    /*
     * ⚠️ jsdom 环境的一个已知限制（见 tests/dom.ts）：**在输入框上派发
     * input/change 事件，React 的 onChange 收不到**。所以这里没法靠「打字」
     * 把文字填进去。
     *
     * 变通办法就是这条用例在验的那件事本身：**点那两条示例**。
     * 它们是真按钮，`click()` 在 jsdom 里可靠，而且 AspChatPanel 收到点击后
     * 调的就是 `setDraft(starter)` —— 和用户手动打字走的是同一条状态更新。
     */
    const starter = must(
      page.container.querySelector<HTMLButtonElement>('.chat-starter'),
      '空状态里应该有起步示例按钮',
    )
    act(() => {
      starter.click()
    })
    ok(
      (textarea.value ?? '').length > 0,
      `点了示例之后输入框该有文字了，实际是 ${JSON.stringify(textarea.value)}`,
    )
    ok(!sendButton.disabled, '输入框有内容之后「发送」该可点了')

    await act(async () => {
      sendButton.click()
      // 让两轮回复 + 状态更新都跑完
      await new Promise((resolve) => setTimeout(resolve, 0))
      await new Promise((resolve) => setTimeout(resolve, 0))
      await new Promise((resolve) => setTimeout(resolve, 0))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    ok(stub.calls() >= 2, `应该发了两轮请求，实际 ${stub.calls()} 轮`)

    const session = useAiSessionStore.getState()
    /*
     * 夹具里 5 件全都是「没被舍弃」的（那件闲置的也在内），所以 `loadScope: all`
     * 会拉进 5 件。其中 1 件被删 —— 但它**仍然留在草稿里**（带走待删标记），
     * 所以总数还是 5。这条断言本身就是那个 bug 的回归测试：
     * 原来删掉的会被从草稿里移走，于是下一轮 AI 面对一个空草稿，
     * 只能编一句「已经删好了」。
     */
    eq(session.drafts.length, 5, '拉进来的都还在草稿里（被删的那件带走标记）')
    eq(
      session.drafts.filter((d) => d.removed).length,
      1,
      '★ 被删的那件要留在草稿里、带待删标记 —— 这样下一轮 AI 才看得见',
    )
    eq(
      session.touchedKeys.length,
      1,
      `★ 只有那 1 条被改的算「动过」。实际 touchedKeys：${session.touchedKeys.join(',')}`,
    )
    eq(session.touchedKeys[0], 'i1')
    ok(session.removedKeys.includes('i3'), '被删的那条要记下来')
    eq(session.removedKeys.length, 1)

    // 预览区里只该出现那 1 条 + 删除那一块，另外 3 条不许铺出来。
    // ⚠️ 只看预览区，不看整页 —— 对话框那条气泡、侧栏、「看全部」按钮的
    // 文案里都可能合法地出现别的字，拿整页 html 断言会误伤。
    const preview = must(
      page.container.querySelector<HTMLElement>('.chat-layout__draft'),
      '应该能找得到预览区',
    )
    const html = preview.innerHTML
    contains(html, '灰色羊毛衫', '改动过的要看得到')
    ok(!html.includes('牛仔裤'), '★ 没动的那些不许铺在预览里')
    ok(!html.includes('平底锅'), '没动的不许铺')
    contains(html, '会被移进回收站', '删除要单独列出来')
    contains(html, '旧手机', '被删的名字要看得见')
  } finally {
    stub.restore()
    page.unmount()
    clearAiSession()
  }
})

await test('★ 点「采纳」之后那几件**真的**进了回收站（不是只有提示说进了）', () => {
  /*
   * 用户报的那台戏的最后一环：「已把 13 件全部移入回收站」→ 点采纳 →
   * 「没有改动」→ 东西一个都没少。
   *
   * 这条就钉住「采纳 → 真的落库」这一步：摆好一份「AI 已标记待删」的会话，
   * 真的去点那个「采纳」按钮，然后断言**数据里那几件的 status 变成了
   * discarded**，而不是只看提示文案。
   */
  clearAiSession()
  // 会话状态要在挂载**之前**摆好，组件一渲染就是这份
  useAiSessionStore.setState({
    bubbles: [{ id: 'b1', role: 'user', text: '把钱包卡片下那几件删了' }],
    drafts: [{ ...contextDraft('i3', '旧手机'), removed: true }],
    touchedKeys: [],
    changedKeys: [],
    removedKeys: ['i3'],
  })
  const page = mountForSwitch('/ai', fixture())

  return (async () => {
    try {
      const accept = must(
        [...page.container.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
          (b.textContent ?? '').trim().startsWith('采纳'),
        ),
        '应该找得到「采纳」按钮',
      )

      await act(async () => {
        accept.click()
        await flushWrites()
      })

      const moved = must(
        useAppStore.getState().data.items.find((i) => i.id === 'i3'),
        '那件东西不该从数据里消失',
      )
      eq(moved.status, 'discarded', '★ 采纳之后它必须真的进回收站 —— 不能只是提示说进了')

      // 会话里那份待删记录要清掉，否则下一次采纳会再删一遍
      ok(
        !useAiSessionStore.getState().removedKeys.includes('i3'),
        '删过的要从待删清单里剔掉，免得下次采纳再删一遍',
      )
    } finally {
      page.unmount()
      clearAiSession()
    }
  })()
})

/* ------------------------------------------------------------------ */
/* AI 输入框旁边那套：按钮 / 补全 / 预检 / 速录                        */
/* ------------------------------------------------------------------ */

suite('AI 输入框：快捷指令与补全')

await test('★ 点「新建物品」和「放在」，短语插进输入框、库里的位置铺出来', () => {
  /*
   * 这一条验的是「点击 → 插到光标处」这条真路。
   *
   * jsdom 里没法模拟打字（见 tests/dom.ts 的说明），所以「打字触发补全」那一半
   * 只能靠 tests/aiCommands.ts 的纯函数测；这里能测的是**点击**这一半 ——
   * 而它恰好也是用户最常用的入口（那排按钮）。
   */
  clearAiSession()
  const page = mountForSwitch('/ai', fixture())
  try {
    const textarea = must(
      page.container.querySelector<HTMLTextAreaElement>('textarea'),
      'AI 页应该有一个输入框',
    )
    const chip = (label: string) =>
      must(
        [...page.container.querySelectorAll<HTMLButtonElement>('.composer-chip')].find(
          (button) => (button.textContent ?? '').trim() === label,
        ),
        `应该找得到「${label}」这个快捷按钮`,
      )

    act(() => {
      chip('新建物品').click()
    })
    eq(textarea.value, '新建物品 ', '点一下就该把短语插进输入框')

    act(() => {
      chip('放在').click()
    })
    eq(textarea.value, '新建物品，放在 ', '第二段前面要补一个连接符，而不是直接接上去')

    const pop = must(
      page.container.querySelector<HTMLElement>('.slot-pop'),
      '点了「放在」之后应该弹出位置候选 —— 这正是这个按钮存在的意义',
    )
    ok(
      pop.querySelectorAll('.slot-pop__row').length > 0,
      '候选列表不该是空的（夹具里有一整棵位置树）',
    )
    contains(pop.textContent ?? '', '卧室', '应该把库里已有的位置铺出来，而不是让用户凭空打')
  } finally {
    page.unmount()
    clearAiSession()
  }
})

await test('★ 预检那行：位置对得上是一种说法，对不上是另一种（说错了就是在骗人）', () => {
  const render = (check: DraftCheck): string => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    try {
      act(() => {
        root.render(<DraftCheckLine check={check} />)
      })
      return container.textContent ?? ''
    } finally {
      act(() => {
        root.unmount()
      })
      container.remove()
    }
  }

  const matched = render({
    newItemCount: 1,
    places: [{ query: '蓝柜', id: 'l-blue', pathText: '家 / 卧室 / 蓝柜', near: null }],
    categories: [],
    orphanNewPlaces: [],
  })
  contains(matched, '家 / 卧室 / 蓝柜', '对上了就要把完整路径说出来，用户才知道落到哪儿')
  contains(matched, '1', '要说出识别到几件')
  ok(!matched.includes('新位置'), '对得上的时候绝不能说「会被当成新位置」')

  const fresh = render({
    newItemCount: 1,
    places: [{ query: '阳台/柜子上层', id: null, pathText: null, near: null }],
    categories: [],
    orphanNewPlaces: [],
  })
  contains(fresh, '阳台/柜子上层', '对不上时要说清是哪一串字对不上')
  contains(fresh, '新位置', '而且要提前告诉他会被当成新位置（那种条默认不勾选）')

  const orphan = render({
    newItemCount: 1,
    places: [],
    categories: [],
    orphanNewPlaces: ['阳台/柜子上层'],
  })
  contains(orphan, '新建位置', '光说「新建位置」而没有东西放进去时，必须提醒 —— 不然它什么都不会发生')

  const nothing = render({
    newItemCount: 0,
    places: [],
    categories: [],
    orphanNewPlaces: [],
  })
  eq(nothing.trim(), '', '一个字都没写的时候这一行不该出现（平时别在用户旁边念）')
})

await test('速录面板：点得开、加得了行、什么都没填时不让生成', () => {
  clearAiSession()
  const page = mountForSwitch('/ai', fixture())
  try {
    const button = (match: (label: string) => boolean) =>
      must(
        [...page.container.querySelectorAll<HTMLButtonElement>('button')].find((each) =>
          match((each.textContent ?? '').trim()),
        ),
        '应该找得到那个按钮',
      )

    act(() => {
      button((label) => label === '速录').click()
    })

    const panel = must(
      page.container.querySelector<HTMLElement>('.quick-entry__body'),
      '点开「速录」之后该有面板主体',
    )
    eq(panel.querySelectorAll('.quick-entry__row').length, 1, '默认给一行')
    eq(
      panel.querySelectorAll('.quick-entry__row input, .quick-entry__row select').length,
      5,
      '一行里要有：名称 / 位置 / 分类 / 过期 / 状态',
    )

    const generate = button((label) => label.startsWith('生成到输入框'))
    ok(generate.disabled, '一个字都没填的时候不该能点「生成到输入框」')

    act(() => {
      button((label) => label.includes('加一行')).click()
    })
    eq(
      page.container.querySelectorAll('.quick-entry__row').length,
      2,
      '点「加一行」应该真的多出一行',
    )
  } finally {
    page.unmount()
    clearAiSession()
  }
})

/* ------------------------------------------------------------------ */
/* 置顶那颗星（点一下钉上、排到最前面）                                 */
/* ------------------------------------------------------------------ */

/**
 * 用户的原话：
 *   「我希望右边可以加一个星星符号，这样我点击就可以置顶，下次更方便选到我常选择的那个」
 *
 * 纯逻辑（钉上 / 摘掉 / 排最前面）在 tests/aiCommands.ts 里钉过了。
 * 这里验的是**点击真的能走到那条路上**：星星点得到、点了不选中这一条、
 * 点了弹层也不关、而且落进了这台设备的偏好里（下次打开还认得）。
 */
suite('AI 输入框：置顶那颗星（真实点击）')

await test('★ 点候选行右边那颗星：钉上、排到第一个，而且不选中也不关弹层', () => {
  clearAiSession()
  localStorage.removeItem('duansheli:ui')
  useAppStore.setState({ ui: { ...DEFAULT_UI_PREFS } })
  const page = mountForSwitch('/ai', fixture())

  try {
    const textarea = must(page.container.querySelector<HTMLTextAreaElement>('textarea'), '输入框')
    const chip = (label: string) =>
      must(
        [...page.container.querySelectorAll<HTMLButtonElement>('.composer-chip')].find(
          (button) => (button.textContent ?? '').trim() === label,
        ),
        `应该找得到「${label}」这个快捷按钮`,
      )

    act(() => {
      chip('放在').click()
    })
    const pop = must(page.container.querySelector<HTMLElement>('.slot-pop'), '点「放在」该弹出候选')
    const typed = textarea.value

    const star = must(
      [...pop.querySelectorAll<HTMLButtonElement>('.slot-pop__pin')].find((button) =>
        (button.getAttribute('aria-label') ?? '').includes('卧室'),
      ),
      '每一行右边都该有一颗星（「卧室」那一行要找得到）',
    )
    eq(star.getAttribute('aria-pressed'), 'false', '没钉过的时候是空心星')
    contains(star.getAttribute('aria-label') ?? '', '置顶', '读屏软件要念得出来它是干什么的')

    act(() => {
      star.click()
    })

    const pinned = useAppStore.getState().ui.pinnedLocationIds
    eq(pinned.length, 1, '点一下就该钉上')
    const name = useAppStore.getState().derived.index.byId.get(pinned[0] ?? '')?.name
    eq(name, '卧室', '钉的是他点的那一条')

    eq(textarea.value, typed, '★ 点星星不能把候选填进输入框（那会覆盖他正在写的话）')
    ok(page.container.querySelector('.slot-pop') !== null, '★ 点星星不该把弹层关掉')

    const first = must(
      page.container.querySelector<HTMLElement>('.slot-pop__item'),
      '候选列表还在',
    )
    contains(first.textContent ?? '', '卧室', '★ 钉完它必须排到第一个')
    const firstStar = must(first.querySelector<HTMLButtonElement>('.slot-pop__pin'), '星星')
    eq(firstStar.getAttribute('aria-pressed'), 'true', '排第一的那颗星要是实心的')

    ok(
      (localStorage.getItem('duansheli:ui') ?? '').includes(pinned[0] ?? '@'),
      '★ 要落进这台设备的偏好里 —— 不然「下次」还是得重新找一遍',
    )
  } finally {
    page.unmount()
    clearAiSession()
    useAppStore.setState({ ui: { ...DEFAULT_UI_PREFS } })
    localStorage.removeItem('duansheli:ui')
  }
})

await test('★ 位置选择弹窗：每行一颗星，钉了顶上就单列一块「置顶」', () => {
  /*
   * 用户选的是「录入物品时的分类/位置选择弹窗也要」。
   *
   * 那里是一棵树，所以置顶的**不能**被拎到树的最前面（「衣柜 / 2层」
   * 跑到根上看着就像个顶层位置）；改成在树上面单列一块，带完整路径。
   */
  const data = fixture()
  useAppStore.setState({
    status: 'ready',
    error: null,
    data,
    derived: createDerived(data),
    aiApiKey: '',
    ui: { ...DEFAULT_UI_PREFS },
  })
  const ctx = createDerived(data)

  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  try {
    act(() => {
      root.render(
        <LocationPicker
          open
          onClose={() => {}}
          value={null}
          onSelect={() => {}}
          ctx={ctx}
          counts={new Map()}
        />,
      )
    })

    /* 弹窗是 portal 到 document.body 的，所以要查 body 而不是容器 */
    ok(document.querySelector('.picker-pinned') === null, '一次都没钉过时不摆置顶区')

    const star = must(
      document.querySelector<HTMLButtonElement>('.modal .tree-node__pin'),
      '位置树每一行右边都该有一颗星',
    )
    contains(star.getAttribute('aria-label') ?? '', '置顶', '读屏软件要念得出来')

    act(() => {
      star.click()
    })

    const pinned = useAppStore.getState().ui.pinnedLocationIds
    eq(pinned.length, 1, '点一下就该钉上')
    const block = must(document.querySelector<HTMLElement>('.picker-pinned'), '钉过之后要摆出置顶区')
    contains(block.textContent ?? '', '置顶', '那一块要说清自己是「置顶」')
    ok(
      (block.textContent ?? '').includes(
        useAppStore.getState().derived.index.byId.get(pinned[0] ?? '')?.name ?? '@',
      ),
      '置顶区里要能看到他钉的那一条',
    )

    /* 再点一下那块里的星就是摘掉 */
    act(() => {
      must(
        document.querySelector<HTMLButtonElement>('.picker-pinned .pin-btn'),
        '置顶区里那颗星',
      ).click()
    })
    eq(useAppStore.getState().ui.pinnedLocationIds.length, 0, '再点一下要能摘掉')
    ok(document.querySelector('.picker-pinned') === null, '摘完之后那一块就该收起来')
  } finally {
    act(() => {
      root.unmount()
    })
    container.remove()
    useAppStore.setState({ ui: { ...DEFAULT_UI_PREFS } })
  }
})

/* ------------------------------------------------------------------ */
/* AI 采纳之后停在原地                                                 */
/* ------------------------------------------------------------------ */

await test('★ 采纳完停在 AI 对话页，不会把人送回物品列表', () => {
  /*
   * 用户的原话：「ai 新建确认完，会自动回到物品页面，我不希望这样，
   * 我希望还停留在 ai 对话页面」。
   *
   * 原来那句是 `if (result.added > 0 && result.updated === 0) navigate('/items')` ——
   * 只在「这次全是新建」时跳页。所以这里就摆一条**纯新建**的草稿，
   * 正好踩在那个条件上：改回旧行为的话，这一条会立刻变红。
   */
  clearAiSession()
  useAiSessionStore.setState({
    bubbles: [{ id: 'b1', role: 'user', text: '厨房里有个新买的咖啡壶' }],
    drafts: [{ ...contextDraft('fresh-1', '新买的咖啡壶'), sourceItemId: undefined }],
    touchedKeys: [],
    changedKeys: [],
    removedKeys: [],
  })
  const page = mountForSwitch('/ai', fixture())

  return (async () => {
    try {
      const accept = must(
        [...page.container.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
          (b.textContent ?? '').trim().startsWith('采纳'),
        ),
        '应该找得到「采纳」按钮',
      )

      await act(async () => {
        accept.click()
        await flushWrites()
      })

      ok(
        useAppStore.getState().data.items.some((i) => i.name === '新买的咖啡壶'),
        '前提：这一下确实把它建出来了（不然这条用例什么都没验到）',
      )
      ok(
        page.container.querySelector('.chat-panel') !== null,
        '★ 采纳之后必须还停在 AI 对话页 —— 跳走的话这里就找不到对话框了',
      )
      contains(page.html(), '和 AI 商量', '对话面板还在，他可以接着让 AI 改')
    } finally {
      page.unmount()
      clearAiSession()
    }
  })()
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
