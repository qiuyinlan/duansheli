/**
 * 启动兜底。
 *
 * ── 为什么需要它 ────────────────────────────────────────────────
 * React 18 里，渲染期抛出的异常会让 React **把整棵树卸载掉** ——
 * 用户看到的就是一片空白，而且**屏幕上没有任何线索**。
 * 更早一点的失败（模块加载时就抛，比如某个顶层常量算错了）
 * 连 React 都还没开始跑，同样是白屏。
 *
 * 白屏是最糟的失败形态：用户不知道该干什么，我也拿不到任何信息。
 * 所以这里装两个全局兜底，把「什么都没有」变成「写清楚了的一段话」。
 *
 * ── 为什么是纯 DOM + 写死的双语文案 ─────────────────────────────
 * 这段代码要在**应用已经挂掉**的时候还能跑出来。而挂掉的
 * 很可能正是 i18n 或 React 本身 —— 所以它不能 import 它们，
 * 也不能依赖 CSS 有没有加载。只能是最土的那套：
 * 原生 DOM + 行内样式 + 两种语言都写上（因为我们无从知道用户选了哪门语言）。
 *
 * scripts/audit-i18n.mjs 里为这个文件开了白名单，理由就是上面这段。
 */

/** 兜底面板的 id —— 同时也是「已经显示过了」的标记 */
const PANEL_ID = 'dsh-boot-fallback'

/**
 * 应用是否已经成功挂载过。
 *
 * 挂载之后就不再插手了：那时候的错误由 React 的 ErrorBoundary 负责，
 * 它的界面好看得多，也更知道该怎么引导用户。
 */
let booted = false

export function markBooted(): void {
  booted = true
}

/**
 * 仅供测试：把兜底重新武装起来。
 *
 * 为什么需要它：`booted` 是模块级状态，而「兜底是自己装上的」那条用例
 * 必须在「还没挂载过」的前提下跑。靠测试文件的顺序来保证太脆 ——
 * 有人调整一下顺序，就会看到一条莫名其妙的红，而病因离现象很远。
 * 名字里带 ForTest 就是为了让人一眼看出它不是给生产代码用的。
 */
export function resetBootGuardForTest(): void {
  booted = false
}

function describe(err: unknown): string {
  if (err instanceof Error) {
    const where = err.stack?.split('\n')[1]?.trim()
    return where ? `${err.name}: ${err.message}\n${where}` : `${err.name}: ${err.message}`
  }
  if (typeof err === 'string' && err !== '') return err
  try {
    const text = JSON.stringify(err)
    if (text !== undefined) return text
  } catch {
    // 循环引用之类，落到下面那行
  }
  return String(err)
}

/** 把一段可读的说明画进 #root，替换掉那片空白 */
export function showBootError(detail: string): void {
  if (typeof document === 'undefined') return
  // 已经画过了就别重复画（一次启动可能连报好几个错）
  if (document.getElementById(PANEL_ID) !== null) return

  const root = document.getElementById('root')
  if (root === null) return

  root.textContent = ''

  const panel = document.createElement('div')
  panel.id = PANEL_ID
  panel.setAttribute(
    'style',
    [
      'max-width:44em',
      'margin:12vh auto 0',
      'padding:0 20px',
      'font:14px/1.8 system-ui,-apple-system,"Segoe UI",sans-serif',
      'color:#0f172a',
      'text-align:left',
    ].join(';'),
  )

  const title = document.createElement('div')
  title.setAttribute('style', 'font-size:20px;font-weight:600;margin-bottom:12px')
  title.textContent = '启动失败 · Failed to start'
  panel.appendChild(title)

  const hint = document.createElement('div')
  hint.setAttribute('style', 'color:#475569;margin-bottom:16px')
  hint.textContent =
    '应用在启动时就出错了，所以界面没能画出来。' +
    '下面这段内容就是原因 —— 把它发给开发者即可定位。' +
    '（你的数据没有丢，它在浏览器的本地数据库里。）'
  panel.appendChild(hint)

  const hintEn = document.createElement('div')
  hintEn.setAttribute('style', 'color:#94a3b8;margin-bottom:16px')
  hintEn.textContent =
    'The app failed while starting, so nothing could be drawn. The text below is the reason — send it along. Your data is safe in the browser database.'
  panel.appendChild(hintEn)

  const pre = document.createElement('pre')
  pre.setAttribute(
    'style',
    [
      'white-space:pre-wrap',
      'word-break:break-word',
      'background:#f8fafc',
      'border:1px solid #cbd5e1',
      'border-radius:8px',
      'padding:12px',
      'font:12px/1.7 ui-monospace,SFMono-Regular,Menlo,monospace',
      'color:#334155',
      'margin:0 0 20px',
    ].join(';'),
  )
  pre.textContent = detail
  panel.appendChild(pre)

  const button = document.createElement('button')
  button.type = 'button'
  button.textContent = '重新加载 · Reload'
  button.setAttribute(
    'style',
    [
      'padding:8px 18px',
      'border:1px solid #0f172a',
      'border-radius:8px',
      'background:#0f172a',
      'color:#fff',
      'font-size:14px',
      'cursor:pointer',
    ].join(';'),
  )
  button.onclick = () => window.location.reload()
  panel.appendChild(button)

  root.appendChild(panel)
}

/**
 * 装全局兜底。
 *
 * ⚠️ 由本模块**在求值时就自己调用**（见文件末尾），不要改成让调用方去调。
 * 理由见那里的注释 —— 那是个很容易写错的 ES 模块求值顺序问题。
 */
export function installBootGuard(): void {
  if (typeof window === 'undefined') return

  window.addEventListener('error', (event) => {
    if (booted) return
    /*
     * 资源加载失败（图片 404 之类）也会走到这个事件，但那种情况
     * `event.error` 是空的、`message` 也是空的 —— 它不影响应用能不能跑，
     * 不该把整个界面换成一张错误面板。
     */
    if (event.error == null && (event.message ?? '') === '') return
    showBootError(describe(event.error ?? event.message))
  })

  window.addEventListener('unhandledrejection', (event) => {
    if (booted) return
    showBootError(describe(event.reason))
  })
}

/*
 * ── 为什么在模块求值时就装上，而不是等调用方来调 ──────────────────
 *
 * ES 模块的求值顺序是：**先把所有 import 求值完，再跑本模块的正文**。
 *
 * 所以如果只在 main.tsx 的正文里写一句 installBootGuard()，
 * 那么当 `./App` 那条依赖链在**求值期间**就抛错时（某个顶层常量算错了、
 * 某个模块 import 了不存在的东西），main.tsx 的正文根本轮不到执行 ——
 * 兜底没装上，用户看到的还是白屏。
 *
 * 而白屏最常见的原因，恰恰就是这种「模块加载期就抛」。
 * 所以这一句必须在这里、在求值时就跑掉。
 *
 * main.tsx 里把它作为**第一条 import**，就能保证它比应用代码先就位。
 */
installBootGuard()
