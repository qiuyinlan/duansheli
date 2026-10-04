import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from './ui/primitives'
import { t } from '../i18n'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/**
 * 渲染错误的兜底。
 *
 * ── 为什么非要有这个 ────────────────────────────────────────────
 * React 18 里，渲染期未捕获的异常会让 React **卸载整棵树** ——
 * 用户看到的是一片空白，而且屏幕上没有任何线索。
 * 「白屏 + 无信息」是最难查的失败形态，所以必须把它变成一段能读的话。
 *
 * 它和 `lib/bootGuard.ts` 的分工：
 *   · bootGuard 管**挂载之前**的失败（模块加载就抛，React 还没开始跑）
 *   · 这个边界管**挂载之后**渲染期的失败（这时候 React 是好的，
 *     能画出一个像样的界面，也就能把用户引导回去）
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    /*
     * 留在控制台里 —— 前面那段组件栈是排查时最有用的东西。
     *
     * 这句**故意用英文**：它是给开发者看的，不是界面文案。
     * （而且 audit:i18n 会把 src 里的中文都当成「漏翻」，
     *  这不是漏翻，所以别把它「翻译」回中文。）
     */
    console.error('Render error:', error, info.componentStack)
  }

  private reload = () => {
    window.location.reload()
  }

  private goHome = () => {
    window.location.hash = '#/'
    this.setState({ error: null })
  }

  render(): ReactNode {
    const { error } = this.state
    if (error === null) return this.props.children

    return (
      <div className="center-screen">
        <div style={{ fontSize: 'var(--fs-h2)', fontWeight: 600 }}>
          {t('common.crashTitle')}
        </div>
        <div
          className="muted small"
          style={{ maxWidth: '40em', lineHeight: 1.8, textAlign: 'left' }}
        >
          {t('common.crashHint')}
        </div>
        {/*
          把原始错误原样贴出来。难看，但这是用户唯一能复制给我、
          而我唯一能据以定位的东西 —— 藏起来只会让下一次更难查。
        */}
        <pre className="crash-detail">{`${error.name}: ${error.message}`}</pre>
        <div className="row">
          <Button variant="primary" onClick={this.goHome}>
            {t('common.crashGoHome')}
          </Button>
          <Button onClick={this.reload}>{t('common.reload')}</Button>
        </div>
      </div>
    )
  }
}
