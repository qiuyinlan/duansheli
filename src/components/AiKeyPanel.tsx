import { useState } from 'react'
import { IconAlert, IconCheck, IconClose } from './ui/icons'
import { Button } from './ui/primitives'
import { useAppStore } from '../store/useAppStore'

function mask(key: string): string {
  if (key.length <= 10) return '••••••'
  return `${key.slice(0, 6)}••••${key.slice(-4)}`
}

/**
 * API Key 输入。
 *
 * 刻意**不做任何持久化**：Key 只活在当前页面的内存里，刷新即清空。
 * 原因写在 README 的「AI 功能」一节 —— 纯前端存 Key 有两个固有风险，
 * 其中一个（GitHub Pages 全部仓库共享同一个域名）很多人不会意识到。
 */
export function AiKeyPanel() {
  const apiKey = useAppStore((s) => s.aiApiKey)
  const setAiApiKey = useAppStore((s) => s.setAiApiKey)
  const notify = useAppStore((s) => s.notify)

  const [draft, setDraft] = useState('')

  if (apiKey !== '') {
    return (
      <div className="notice" style={{ marginBottom: 'var(--gap-5)' }}>
        <span className="notice__icon" style={{ color: 'var(--text)' }}>
          <IconCheck />
        </span>
        <span className="notice__body">
          API Key 已填入（<span className="numeric">{mask(apiKey)}</span>）。
          它只存在当前页面的内存里 —— <strong>刷新页面就会清空</strong>，也不会写入任何存储。
        </span>
        <span className="notice__action">
          <Button size="sm" onClick={() => setAiApiKey('')}>
            <IconClose size={12} />
            清除
          </Button>
        </span>
      </div>
    )
  }

  const submit = () => {
    const key = draft.trim()
    if (key === '') return
    setAiApiKey(key)
    setDraft('')
    notify('Key 已填入，仅本次会话有效', 'success')
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
            使用
          </Button>
        </div>
      </div>

      <div className="ai-privacy">
        <span className="ai-privacy__icon">
          <IconAlert size={14} />
        </span>
        <div>
          <strong>Key 只保存在内存里</strong>，不写入 localStorage / IndexedDB，
          也不进导出的备份文件 —— 刷新页面就没了，下次用时再粘贴一次。
          <br />
          请求由你的浏览器<strong>直连 api.deepseek.com</strong>，不经过任何第三方服务器
          （这一点已用真实请求验证过，见项目里的 <code>scripts/probe-deepseek-cors.mjs</code>）。
          <br />
          还没有 Key？到{' '}
          <a href="https://platform.deepseek.com/api_keys" target="_blank" rel="noreferrer">
            platform.deepseek.com
          </a>{' '}
          创建一个。建议单独建一个只用于这里的 Key，方便随时吊销。
        </div>
      </div>
    </div>
  )
}
