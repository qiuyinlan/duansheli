import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { App } from './App'
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
    <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <App />
    </HashRouter>
  </StrictMode>,
)
