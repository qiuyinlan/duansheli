/*
 * ⚠️ 这必须是最前面的一条 import。
 *
 * 它自己会在模块求值时装上全局兜底，而 ES 模块是**按 import 顺序求值**的 ——
 * 排在它后面的 `./App` 那条链如果加载期就抛错，兜底也已经就位了。
 * 放到后面（或者改成在正文里调用）都会漏掉那种情况。
 */
import './lib/bootGuard'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { App } from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { initCloud } from './cloud/sync'
import { syncDocumentLang, t } from './i18n'

import './styles/global.css'
import './styles/layout.css'
import './styles/components.css'
import './styles/pages.css'

// 先把 <html lang> 定下来，再挂 React —— 字体回退、连字符断行、
// 读屏软件发音都看这个属性，晚一步设置会先闪一下错误的语言。
syncDocumentLang()

/*
 * 云端同步在这里点火。
 *
 * 为什么在挂 React 之前：`initCloud` 要订阅 store（本地数据一读出来就同步一次），
 * 而那件事越早挂上越好 —— 挂在 App 的 effect 里的话，StrictMode 会把 effect
 * 跑两遍（`initCloud` 是幂等的，两遍也不会挂两套监听，但没必要让它跑两遍）。
 *
 * 没配 Supabase 的时候它什么都不做，只把「未配置」记在状态里给设置页显示。
 */
initCloud()

const container = document.getElementById('root')
if (!container) throw new Error(t('common.mountPointMissing'))

createRoot(container).render(
  <StrictMode>
    {/*
      ErrorBoundary 放在最外层：App 自己出错时也要有人兜住。
      它用的是 t()，所以必须在 i18n 之后 —— i18n 挂掉的情况由 bootGuard 负责。
    */}
    <ErrorBoundary>
      <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <App />
      </HashRouter>
    </ErrorBoundary>
  </StrictMode>,
)
