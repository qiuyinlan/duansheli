import { useState } from 'react'
import { IconAlert, IconCheck, IconClose } from './ui/icons'
import { Button, ConfirmDialog } from './ui/primitives'
import { useAppStore } from '../store/useAppStore'
import { useT } from '../i18n'

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

  // 除了拿 t，这一句还让面板订阅语言变化
  const { t } = useT()

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
            {t('ai.keyFilledBefore')}
            <span className="numeric">{mask(apiKey)}</span>
            {t('ai.keyFilledAfter')}
            <strong>{t('ai.keyStoredBold')}</strong>
            {t('ai.keyFilledTail')}
            <br />
            <span className="tiny dim">{t('ai.keyStoredScope')}</span>
          </span>
          <span className="notice__action">
            <Button
              size="sm"
              variant="danger"
              onClick={() => setConfirmClear(true)}
              title={t('ai.keyClearTitle')}
            >
              <IconClose size={12} />
              {t('common.clear')}
            </Button>
          </span>
        </div>

        <ConfirmDialog
          open={confirmClear}
          title={t('ai.keyClearConfirmTitle')}
          danger
          confirmLabel={t('common.clear')}
          message={
            <>
              {t('ai.keyClearConfirmBody')}
              <br />
              <br />
              {t('ai.keyClearConfirmNote')}
            </>
          }
          onConfirm={() => {
            setAiApiKey('')
            setConfirmClear(false)
            notify(t('ai.keyClearedToast'), 'success')
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
    notify(t('ai.keySavedToast'), 'success')
  }

  return (
    <div className="card" style={{ marginBottom: 'var(--gap-5)' }}>
      <div className="field">
        <label className="field__label" htmlFor="ai-key">
          {t('ai.keyLabel')}
        </label>
        <div className="row">
          <input
            id="ai-key"
            className="input grow"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder={t('ai.keyPlaceholder')}
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
            {t('common.save')}
          </Button>
        </div>
      </div>

      <div className="ai-privacy">
        <span className="ai-privacy__icon">
          <IconAlert size={14} />
        </span>
        <div>
          {t('ai.keyStorageLead')}
          <strong>{t('ai.keyStoredInBold')}</strong>
          {t('ai.keyStorageTail')}
          <strong>{t('ai.keyNeverBold')}</strong>
          {t('ai.keyStorageEnd')}
          <br />
          {t('ai.directLead')}
          <strong>{t('ai.directBold')}</strong>
          {t('ai.directTail')}
          <code>{t('ai.probeScript')}</code>
          {t('ai.directEnd')}
          <br />
          <br />
          <strong>{t('ai.costBold')}</strong>
          <br />
          {t('ai.riskCode')}
          <br />
          {t('ai.riskDomainLead')}
          <code>{t('ai.riskDomainCode')}</code>
          {t('ai.riskDomainMid')}
          <strong>{t('ai.riskDomainBold')}</strong>
          {t('ai.riskDomainTail')}
          <br />
          {t('ai.keyAdviceLead')}{' '}
          <a href="https://platform.deepseek.com/api_keys" target="_blank" rel="noreferrer">
            platform.deepseek.com
          </a>{' '}
          {t('ai.keyAdviceTail')}
        </div>
      </div>
    </div>
  )
}
