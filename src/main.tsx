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
import { syncDocumentLang, t } from './i18n'

import './styles/global.css'
import './styles/layout.css'
import './styles/components.css'
import './styles/pages.css'

// 先把 <html lang> 定下来，再挂 React —— 字体回退、连字符断行、
// 读屏软件发音都看这个属性，晚一步设置会先闪一下错误的语言。
syncDocumentLang()

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
