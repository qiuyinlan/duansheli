/**
 * 给 Node 装一个浏览器环境（jsdom）。
 *
 * 为什么不用 react-dom/server：zustand 在服务端渲染时读的是
 * 「store 创建时的初始状态」（getServerState || getInitialState），
 * 测试里 setState 完全不生效，页面永远渲染成空数据的样子。
 * 所以必须在真实 DOM 上用 createRoot 渲染。
 *
 * 这个模块必须在任何 react-dom 使用之前求值 —— 由 tests/index.ts 第一个 import。
 */

import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
})

/** 有些全局属性是只读的，赋值会抛错，这里统一兜住 */
function define(key: string, value: unknown): void {
  try {
    Object.defineProperty(globalThis, key, { value, writable: true, configurable: true })
  } catch {
    // 装不上就跳过：绝大多数情况下降级路径也能跑
  }
}

define('window', dom.window)
define('document', dom.window.document)
define('navigator', dom.window.navigator)
define('localStorage', dom.window.localStorage)
define('HTMLElement', dom.window.HTMLElement)
define('HTMLInputElement', dom.window.HTMLInputElement)
define('Element', dom.window.Element)
define('Node', dom.window.Node)
define('Event', dom.window.Event)
define('MouseEvent', dom.window.MouseEvent)
define('KeyboardEvent', dom.window.KeyboardEvent)
define('MutationObserver', dom.window.MutationObserver)
define('getComputedStyle', dom.window.getComputedStyle.bind(dom.window))

define('requestAnimationFrame', (callback: (time: number) => void) =>
  setTimeout(() => callback(Date.now()), 0),
)
define('cancelAnimationFrame', (handle: ReturnType<typeof setTimeout>) => clearTimeout(handle))

// React 18 要求显式声明「现在处于测试环境」，否则 act() 会警告
define('IS_REACT_ACT_ENVIRONMENT', true)

// jsdom 没实现 scrollTo，而 AppShell 切页时会调用它，会刷一屏 "Not implemented"
dom.window.scrollTo = (() => {}) as typeof dom.window.scrollTo

// jsdom 没有 IE 时代的 attachEvent / detachEvent。
// React 的 input 事件兜底逻辑在元素获得焦点时会调用这两个方法（即便是在现代浏览器里
// 也走同一条代码路径），缺了就会抛 "activeElement.detachEvent is not a function"。
// 补一对空实现即可 —— 测试不模拟真实输入，不影响结论。
interface LegacyElement {
  attachEvent?: (...args: unknown[]) => boolean
  detachEvent?: (...args: unknown[]) => void
}
const elementProto = dom.window.Element.prototype as unknown as LegacyElement
elementProto.attachEvent = () => false
elementProto.detachEvent = () => {}

/**
 * 语言固定成中文。
 *
 * jsdom 的 navigator.language 是 'en-US'，而 i18n 是「跟着浏览器语言走」的，
 * 不锁的话所有断言中文文案的测试都会莫名其妙变成英文。
 * 想测英文的用例自己调 setLang('en')，用完全部记得切回来 ——
 * 语言是模块级状态，会污染后面的用例，跟 API Key 那个坑一模一样。
 */
dom.window.localStorage.setItem('duansheli:lang', 'zh')

/*
 * ⚠️ 一个已知的环境限制，写测试之前请先知道：
 *
 * **在这个 Node + jsdom 组合里，React 的 onChange 收不到派发进去的输入事件。**
 * `dispatchEvent(new Event('input'))`、`'change'`、`new InputEvent('input')`
 * 三种都试过，全部静默无声（而 `click()` 是好的）。
 * 所以「用户在输入框里打字 / 选日期」这条路径**没法在这里模拟**。
 *
 * 变通办法（现有用例就是这么做的）：
 *   · 能靠点击走的路径就走点击 —— `click()` 可靠
 *   · 状态更新用点击驱动的往返来间接验证（例如「点一下快捷日期，清除按钮就出现了」）
 *   · 要验纯数据行为就直接调 store 的动作，在 store 上断言
 */

export { dom }
