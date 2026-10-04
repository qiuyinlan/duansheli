import { useEffect } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { Button } from './components/ui/primitives'
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

export function App() {
  const status = useAppStore((s) => s.status)
  const error = useAppStore((s) => s.error)
  const init = useAppStore((s) => s.init)
  const { t } = useT()

  useEffect(() => {
    void init()
  }, [init])

  if (status === 'loading') {
    return (
      <div className="center-screen">
        <div className="spinner" />
        <div className="dim small">{t('common.openingData')}</div>
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
