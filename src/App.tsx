import { useEffect, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { Button } from './components/ui/primitives'
import { markBooted } from './lib/bootGuard'
import { Attributes } from './pages/Attributes'
import { Ai } from './pages/Ai'
import { Categories } from './pages/Categories'
import { Checklists } from './pages/Checklists'
import { Collections } from './pages/Collections'
import { Expiry } from './pages/Expiry'
import { Idle } from './pages/Idle'
import { ItemEdit } from './pages/ItemEdit'
import { Items } from './pages/Items'
import { Locations } from './pages/Locations'
import { More } from './pages/More'
import { Overview } from './pages/Overview'
import { Settings } from './pages/Settings'
import { Spare } from './pages/Spare'
import { Tags } from './pages/Tags'
import { useAppStore } from './store/useAppStore'
import { useT } from './i18n'

/**
 * 路由表单独抽出来，方便测试里直接渲染各页面
 * （不用经过 App 的「加载中 / 出错」分支，那条分支会触发 init() 覆盖数据）。
 */
export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Overview />} />
        <Route path="items" element={<Items />} />
        <Route path="items/new" element={<ItemEdit />} />
        <Route path="items/:id" element={<ItemEdit />} />
        <Route path="locations" element={<Locations />} />
        <Route path="idle" element={<Idle />} />
        <Route path="spare" element={<Spare />} />
        <Route path="expiry" element={<Expiry />} />
        <Route path="collections" element={<Collections />} />
        <Route path="collections/:id" element={<Collections />} />
        <Route path="checklists" element={<Checklists />} />
        <Route path="checklists/:id" element={<Checklists />} />
        <Route path="ai" element={<Ai />} />
        <Route path="more" element={<More />} />
        <Route path="categories" element={<Categories />} />
        <Route path="attributes" element={<Attributes />} />
        <Route path="tags" element={<Tags />} />
        <Route path="settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}

/**
 * 「打开本地数据」超过这个时间就认为卡住了，给用户一条出路。
 *
 * 正常情况下这一步是**瞬间**的（读一条 IndexedDB 记录）。所以 10 秒
 * 还没好，基本可以断定是卡住了 —— 而以前这里是一个**永远转下去的圈**：
 * 没有超时、没有说明、没有重试，用户只能干看着。
 */
export const INIT_SLOW_MS = 10_000

export function App({ initSlowMs = INIT_SLOW_MS }: { initSlowMs?: number } = {}) {
  const status = useAppStore((s) => s.status)
  const error = useAppStore((s) => s.error)
  const init = useAppStore((s) => s.init)
  const { t } = useT()
  const [slow, setSlow] = useState(false)

  useEffect(() => {
    void init()
  }, [init])

  // 记一笔「已经挂载过」—— 启动兜底从此不再插手，交给 ErrorBoundary
  useEffect(() => {
    markBooted()
  }, [])

  /*
   * 卡住检测。
   *
   * 定时器在 status 变化时会被清掉：一旦读完了（ready 或 error），
   * 这个计时就没意义了。
   */
  useEffect(() => {
    if (status !== 'loading') return
    const timer = setTimeout(() => setSlow(true), initSlowMs)
    return () => clearTimeout(timer)
  }, [status, initSlowMs])

  if (status === 'loading') {
    return (
      <div className="center-screen">
        <div className="spinner" />
        <div className="dim small">{t('common.openingData')}</div>
        {/*
          卡住的时候必须给一条出路。以前这里什么都没有 ——
          一直转下去，用户既不知道是不是坏了，也没法重试。
        */}
        {slow ? (
          <div className="stack" style={{ maxWidth: '34em', marginTop: 'var(--gap-5)' }}>
            <div style={{ fontWeight: 600 }}>{t('common.initSlowTitle')}</div>
            <div className="muted small" style={{ lineHeight: 1.8, textAlign: 'left' }}>
              {t('common.initSlowHint')}
            </div>
            <div className="row" style={{ justifyContent: 'center' }}>
              <Button variant="primary" onClick={() => void init()}>
                {t('common.retry')}
              </Button>
              <Button onClick={() => window.location.reload()}>{t('common.reload')}</Button>
            </div>
          </div>
        ) : null}
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="center-screen">
        <div style={{ fontSize: 'var(--fs-h2)', fontWeight: 600 }}>
          {t('common.openDataFailed')}
        </div>
        <div
          className="muted small"
          style={{ maxWidth: '38em', lineHeight: 1.8, textAlign: 'left' }}
        >
          {error}
          <br />
          <br />
          {t('common.openDataReason1')}
          {t('common.openDataReason2')}
        </div>
        <Button variant="primary" onClick={() => void init()}>
          {t('common.retry')}
        </Button>
      </div>
    )
  }

  return <AppRoutes />
}
