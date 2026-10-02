import { useState } from 'react'
import { IconAlert, IconCheck, IconClose } from './ui/icons'
import { Button, ConfirmDialog } from './ui/primitives'
import { useAppStore } from '../store/useAppStore'

function mask(key: string): string {
  if (key.length <= 10) return '••••••'
  return `${key.slice(0, 6)}••••${key.slice(-4)}`
}

/**
 * API Key 输入。
 *
 * Key 会**保存在这台设备的浏览器里**（localStorage），所以刷新不会丢。
 * 这是用户明确要求的行为 —— 代价是「刷新即清空」这层保护没了，
 * 所以这里必须把风险讲清楚，并把「清除」按钮做得显眼。
 *
 * Key 始终不会进导出的备份文件，也不会进 IndexedDB。
 */
export function AiKeyPanel() {
  const apiKey = useAppStore((s) => s.aiApiKey)
  const setAiApiKey = useAppStore((s) => s.setAiApiKey)
  const notify = useAppStore((s) => s.notify)

  const [draft, setDraft] = useState('')
  const [confirmClear, setConfirmClear] = useState(false)

  if (apiKey !== '') {
    return (
      <>
        <div className="notice" style={{ marginBottom: 'var(--gap-5)' }}>
          <span className="notice__icon" style={{ color: 'var(--text)' }}>
            <IconCheck />
          </span>
          <span className="notice__body">
            API Key 已填入（<span className="numeric">{mask(apiKey)}</span>），
            <strong>已保存在这台设备的浏览器里</strong>，刷新和关掉重开都还在。
            <br />
            <span className="tiny dim">
              它不会进导出的备份文件，也不会进本地数据库。想彻底删掉就点右边的清除。
            </span>
          </span>
          <span className="notice__action">
            <Button
              size="sm"
              variant="danger"
              onClick={() => setConfirmClear(true)}
              title="从这台设备的浏览器里删掉这个 Key"
            >
              <IconClose size={12} />
              清除
            </Button>
          </span>
        </div>

        <ConfirmDialog
          open={confirmClear}
          title="清除这台设备上保存的 Key？"
          danger
          confirmLabel="清除"
          message={
            <>
              Key 会从这台设备的浏览器里删掉。
              <br />
              <br />
              不影响你已经录入的数据，也不影响 DeepSeek 那边的账单 ——
              只是下次想用 AI 功能时要重新粘贴一次。
            </>
          }
          onConfirm={() => {
            setAiApiKey('')
            setConfirmClear(false)
            notify('已从这台设备清除 API Key', 'success')
          }}
          onCancel={() => setConfirmClear(false)}
        />
      </>
    )
  }

  const submit = () => {
    const key = draft.trim()
    if (key === '') return
    setAiApiKey(key)
    setDraft('')
    notify('Key 已保存到这台设备', 'success')
  }

  return (
    <div className="card" style={{ marginBottom: 'var(--gap-5)' }}>
      <div className="field">
        <label className="field__label" htmlFor="ai-key">
          DeepSeek API Key
        </label>
        <div className="row">
          <input
            id="ai-key"
            className="input grow"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="sk-…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                submit()
              }
            }}
          />
          <Button variant="primary" onClick={submit} disabled={draft.trim() === ''}>
            保存
          </Button>
        </div>
      </div>

      <div className="ai-privacy">
        <span className="ai-privacy__icon">
          <IconAlert size={14} />
        </span>
        <div>
          Key 会<strong>保存在这台设备的浏览器里</strong>，刷新和关掉重开都不会丢，
          页面上随时可以一键清除。它<strong>不会</strong>进导出的备份文件，也不会进本地数据库。
          <br />
          请求由你的浏览器<strong>直连 api.deepseek.com</strong>，不经过任何第三方服务器
          （这一点已用真实请求验证过，见项目里的 <code>scripts/probe-deepseek-cors.mjs</code>）。
          <br />
          <br />
          <strong>但存下来就有代价，请知情：</strong>
          <br />① 任何能在你浏览器上执行 JS 的代码（恶意插件、其他页面的 XSS）理论上都能读到它。
          <br />② <code>用户名.github.io</code> 是<strong>所有仓库共享同一个域名</strong>的 ——
          如果你在同一账号下部署了别的项目，那个项目的页面也能读到它。
          <br />
          所以建议到{' '}
          <a href="https://platform.deepseek.com/api_keys" target="_blank" rel="noreferrer">
            platform.deepseek.com
          </a>{' '}
          单独建一个只用于这里的 Key，方便随时吊销。
        </div>
      </div>
    </div>
  )
}
