import { useState, useSyncExternalStore } from 'react'
import { Button, ConfirmDialog, Modal } from './ui/primitives'
import { IconAlert, IconCheck, IconCloud } from './ui/icons'
import { cloudConfig, cloudConfigProblem } from '../cloud/client'
import { probeCloud, type ProbeCheck } from '../cloud/diagnose'
import { useAppStore } from '../store/useAppStore'
import { useT } from '../i18n'
import { formatDateTime } from '../lib/format'
import {
  cloudFailureDetail,
  currentDeviceId,
  getCloudState,
  resolveFirstSync,
  signInCloud,
  signOutCloud,
  signUpCloud,
  subscribeCloud,
  syncNow,
  type FirstSyncStrategy,
} from '../cloud/sync'

/**
 * 「测试连接」—— 三个只读请求，结果直接列在下面。
 *
 * ── 为什么这个按钮值得占一块地方 ──────────────────────────────────
 * 「同步失败」这四个字底下至少藏着五种原因（网络阻断、浏览器扩展拦截、
 * 钥匙错、没建表、没开邮箱登录），而它们的界面表现几乎一样。
 * 别的手段各有盲区：
 *   · 命令行脚本走的是**另一条网络路径**，看不见浏览器扩展
 *   · DevTools 的 Network 面板准确，但要会看
 * 而这个按钮是在**应用自己的上下文里**发请求的，所以它能看到全部五种，
 * 并且用中文说清「哪一步不对、该去点哪里」。
 */
function CloudProbe() {
  const { t } = useT()
  const [checks, setChecks] = useState<ProbeCheck[] | null>(null)
  const [running, setRunning] = useState(false)
  const [openDetail, setOpenDetail] = useState<string | null>(null)

  const run = async () => {
    setRunning(true)
    setOpenDetail(null)
    try {
      setChecks(
        await probeCloud(
          cloudConfig,
          (input, init) => fetch(input, init),
          /*
           * 不带钥匙、也不要求 CORS 的一次请求。
           * mode: 'no-cors' 时浏览器**不触发预检**，所以它成功只说明
           * 「这个域名连得上」；再和带钥匙那次的结果一比，
           * 就能分清是「网络不通」还是「预检被拦」—— 这两件事的解决办法完全不同。
           */
          async (baseUrl) => {
            await fetch(`${baseUrl}/auth/v1/settings`, { mode: 'no-cors', cache: 'no-store' })
            return true
          },
        ),
      )
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="cloud-probe">
      <div className="row">
        <Button size="sm" onClick={() => void run()} disabled={running}>
          {running ? t('cloud.probeRunning') : t('cloud.probeTitle')}
        </Button>
        <span className="tiny dim">{t('cloud.probeHint')}</span>
      </div>

      {checks !== null ? (
        <ul className="cloud-probe__list">
          {checks.map((check) => (
            <li key={check.id} className={`cloud-probe__row cloud-probe__row--${check.outcome}`}>
              <span className="cloud-probe__icon">
                {check.outcome === 'ok' ? (
                  <IconCheck />
                ) : check.outcome === 'fail' ? (
                  <IconAlert />
                ) : (
                  <IconCloud />
                )}
              </span>
              <span className="cloud-probe__body">
                {/*
                  把 detail 当 message 变量传进去。
                  有几条文案里带 {message} 占位符（比如「请求没能发出去：{message}」），
                  不传的话界面上会原样显示 "{message}" —— 这种半成品文案
                  比什么都不说更让人困惑。多余的变量会被忽略，所以统一传。
                */}
                <span className="small">{t(check.messageKey, { message: check.detail })}</span>
                {check.status !== null ? (
                  <span className="tiny dim"> {t('cloud.probeStatus', { status: check.status })}</span>
                ) : null}
                {check.noteKey !== undefined ? (
                  <>
                    <br />
                    <span className="tiny dim" style={{ lineHeight: 1.7 }}>
                      {t(check.noteKey)}
                    </span>
                  </>
                ) : null}
                {check.detail !== '' ? (
                  <>
                    <br />
                    <button
                      type="button"
                      className="linklike tiny"
                      onClick={() => setOpenDetail((v) => (v === check.id ? null : check.id))}
                    >
                      {openDetail === check.id ? t('cloud.detailHide') : t('cloud.detailShow')}
                      {t('cloud.detailLabel')}
                    </button>
                    {openDetail === check.id ? (
                      <>
                        <br />
                        <code className="tiny">{check.detail}</code>
                      </>
                    ) : null}
                  </>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

/**
 * 设置页的「云端同步」面板。
 *
 * ── 三种状态，三种界面 ────────────────────────────────────────────
 *   1. 没配环境变量  → 告诉他要配哪两个、怎么配（不是错误，是没开）
 *   2. 配了但没登录  → 登录 / 注册表单
 *   3. 登录了        → 同步状态、上次同步时间、立即同步、退出
 *
 * 另外还有一个只在特定时刻出现的弹窗：**首次绑定、两边都有数据**时问用哪边。
 * 那个弹窗比什么都重要 —— 它出现的时机正是「一不小心就会覆盖掉一边」的时刻，
 * 所以三个选项都写清了代价，默认选中「合并」。
 */
export function CloudSyncPanel() {
  // 订阅引擎的状态；getCloudState 返回的引用只在真的变了时才换（见 sync.ts 里的说明）
  const state = useSyncExternalStore(subscribeCloud, getCloudState, getCloudState)
  const notify = useAppStore((s) => s.notify)
  const { t, tc } = useT()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [confirmSignOut, setConfirmSignOut] = useState(false)
  const [showDetail, setShowDetail] = useState(false)

  // 配置层面出的问题（少配了 / 还是模板 / 拿错钥匙）—— 和「没配」走同一块界面
  const configProblem = cloudConfigProblem

  const submit = async (mode: 'in' | 'up') => {
    if (busy) return
    setBusy(true)
    setFormError(null)
    try {
      const outcome =
        mode === 'in' ? await signInCloud(email, password) : await signUpCloud(email, password)
      if (!outcome.ok) {
        setFormError(outcome.error ?? t('cloud.notConfiguredShort'))
        return
      }
      setPassword('')
      if (outcome.needsEmailConfirm) {
        notify(t('cloud.signUpNeedConfirm'), 'info')
      } else {
        notify(mode === 'in' ? t('cloud.signInOk') : t('cloud.signUpOk'), 'success')
      }
    } finally {
      setBusy(false)
    }
  }

  /* ---------------- 1. 没配置（或配置有问题） ---------------- */
  if (!state.configured) {
    return (
      <div className="settings-block" style={{ marginBottom: 'var(--gap-6)' }}>
        <div className="settings-block__head">
          <div className="settings-block__title">{t('cloud.title')}</div>
          <div className="settings-block__desc">{t('cloud.desc')}</div>
        </div>
        <div className="settings-block__body">
          {/*
            拿错钥匙这件事必须单独吼一声。
            「还没配置云端」这种说法会让人继续去翻别的地方，
            而真正该做的是：把那把能绕过安全规则的钥匙撤掉。
          */}
          {configProblem === 'secretKey' ? (
            <div className="notice notice--alert" style={{ marginBottom: 'var(--gap-4)' }}>
              <span className="notice__icon">
                <IconAlert />
              </span>
              <span className="notice__body">
                <strong>{t('cloud.problemSecretTitle')}</strong>
                <br />
                {t('cloud.problemSecretBodyA')}
                <strong>{t('cloud.problemSecretBodyBold')}</strong>
                {t('cloud.problemSecretBodyC')}
              </span>
            </div>
          ) : null}

          {configProblem === 'placeholder' ? (
            <div className="notice" style={{ marginBottom: 'var(--gap-4)' }}>
              <span className="notice__icon" style={{ color: 'var(--text)' }}>
                <IconCloud />
              </span>
              <span className="notice__body">{t('cloud.problemPlaceholder')}</span>
            </div>
          ) : null}

          <div className="notice">
            <span className="notice__icon" style={{ color: 'var(--text)' }}>
              <IconCloud />
            </span>
            <span className="notice__body">
              <strong>{t('cloud.notConfiguredTitle')}</strong>
              <br />
              {t('cloud.notConfiguredBody')}
            </span>
          </div>

          <ol className="cloud-steps">
            <li>{t('cloud.notConfiguredStep1')}</li>
            <li>{t('cloud.notConfiguredStep2')}</li>
            <li>{t('cloud.notConfiguredStep3')}</li>
            <li>{t('cloud.notConfiguredStep4')}</li>
          </ol>

          {/*
            明确说一句「配好之后登录表单就在这儿」。
            没有这一句，用户看到的是一个「没有登录入口」的设置页，
            第一反应是「功能没做出来 / 我找错地方了」。
          */}
          <div className="tiny" style={{ marginTop: 'var(--gap-4)', lineHeight: 1.7 }}>
            {t('cloud.notConfiguredWhere')}
          </div>

          <div className="tiny dim" style={{ marginTop: 'var(--gap-2)' }}>
            {t('cloud.notConfiguredDocsLead')}
            <code>{t('cloud.notConfiguredDocsFile')}</code>
          </div>
        </div>
      </div>
    )
  }

  /* ---------------- 2. 没登录 ---------------- */
  if (!state.signedIn) {
    return (
      <div className="settings-block" style={{ marginBottom: 'var(--gap-6)' }}>
        <div className="settings-block__head">
          <div className="settings-block__title">{t('cloud.signInTitle')}</div>
          <div className="settings-block__desc">{t('cloud.signInDesc')}</div>
        </div>
        <div className="settings-block__body">
          <div className="field">
            <label className="field__label" htmlFor="cloud-email">
              {t('cloud.emailLabel')}
            </label>
            <input
              id="cloud-email"
              className="input"
              type="email"
              autoComplete="email"
              spellCheck={false}
              placeholder={t('cloud.emailPlaceholder')}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="field">
            <label className="field__label" htmlFor="cloud-password">
              {t('cloud.passwordLabel')}
            </label>
            <input
              id="cloud-password"
              className="input"
              type="password"
              autoComplete="current-password"
              placeholder={t('cloud.passwordPlaceholder')}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void submit('in')
                }
              }}
            />
          </div>

          {formError !== null ? (
            <div className="notice notice--alert" style={{ marginBottom: 'var(--gap-4)' }}>
              <span className="notice__icon">
                <IconAlert />
              </span>
              <span className="notice__body">{formError}</span>
            </div>
          ) : null}

          <div className="row">
            <Button
              variant="primary"
              onClick={() => void submit('in')}
              disabled={busy || email.trim() === '' || password === ''}
            >
              {busy ? t('cloud.signingIn') : t('cloud.signIn')}
            </Button>
            <Button
              onClick={() => void submit('up')}
              disabled={busy || email.trim() === '' || password === ''}
            >
              {busy ? t('cloud.signingUp') : t('cloud.signUp')}
            </Button>
          </div>

          <div className="tiny dim" style={{ marginTop: 'var(--gap-3)', lineHeight: 1.7 }}>
            {t('cloud.passwordHint')}
          </div>
          <div className="tiny dim" style={{ marginTop: 'var(--gap-2)', lineHeight: 1.7 }}>
            {t('cloud.privacyLead')}
            <strong>{t('cloud.privacyBold')}</strong>
            {t('cloud.privacyTail')}
          </div>

          {/*
            登录进不去的时候，这里就是第一现场。
            放在表单下面：用户点完「登录」失败之后，视线正好落在这儿。
          */}
          <CloudProbe />
        </div>
      </div>
    )
  }

  /* ---------------- 3. 登录了 ---------------- */
  const detail = cloudFailureDetail()

  return (
    <div className="settings-block" style={{ marginBottom: 'var(--gap-6)' }}>
      <div className="settings-block__head">
        <div className="settings-block__title">{t('cloud.title')}</div>
        <div className="settings-block__desc">{t('cloud.desc')}</div>
      </div>
      <div className="settings-block__body">
        <div className="storage-grid">
          <div className="storage-item">
            <span className="storage-item__label">{t('cloud.signedInAs')}</span>
            <span className="storage-item__value">{state.email ?? '—'}</span>
          </div>
          <div className="storage-item">
            <span className="storage-item__label">{t('cloud.statusLabel')}</span>
            <span className="storage-item__value">
              {phaseLabel(state, t)}
              {state.pending ? (
                <span className="badge" style={{ marginLeft: 6 }}>
                  {t('cloud.statusPending')}
                </span>
              ) : null}
            </span>
          </div>
          <div className="storage-item">
            <span className="storage-item__label">{t('cloud.lastSyncLabel')}</span>
            <span className="storage-item__value">
              {state.lastSyncAt ? formatDateTime(state.lastSyncAt) : t('cloud.neverSynced')}
            </span>
          </div>
          <div className="storage-item">
            <span className="storage-item__label">{t('cloud.deviceLabel')}</span>
            <span className="storage-item__value">
              <code className="storage-item__code">{currentDeviceId().slice(0, 8)}</code>
            </span>
          </div>
        </div>

        {state.lastError !== null ? (
          <div className="notice notice--alert" style={{ margin: 'var(--gap-4) 0' }}>
            <span className="notice__icon">
              <IconAlert />
            </span>
            <span className="notice__body">
              {state.lastError}
              {detail !== null ? (
                <>
                  <br />
                  <button
                    type="button"
                    className="linklike tiny"
                    onClick={() => setShowDetail((v) => !v)}
                  >
                    {showDetail ? t('cloud.detailHide') : t('cloud.detailShow')}
                    {t('cloud.detailLabel')}
                  </button>
                  {showDetail ? (
                    <>
                      <br />
                      <code className="tiny">{detail}</code>
                    </>
                  ) : null}
                </>
              ) : null}
            </span>
          </div>
        ) : null}

        <div className="action-row">
          <div>
            <div className="action-row__title">{t('cloud.syncNow')}</div>
            <div className="muted small">{t('cloud.deviceHint')}</div>
          </div>
          <Button
            onClick={() => void syncNow('manual')}
            disabled={state.phase === 'syncing' || state.choice !== null}
          >
            {state.phase === 'syncing' ? t('cloud.statusSyncing') : t('cloud.syncNow')}
          </Button>
        </div>

        <div className="action-row">
          <div>
            <div className="action-row__title">{t('cloud.signOut')}</div>
            <div className="muted small">{t('cloud.logoutConfirmBody')}</div>
          </div>
          <Button variant="danger" onClick={() => setConfirmSignOut(true)}>
            {t('cloud.signOut')}
          </Button>
        </div>

        <CloudProbe />
      </div>

      <ConfirmDialog
        open={confirmSignOut}
        title={t('cloud.logoutConfirmTitle')}
        message={
          <>
            {t('cloud.logoutConfirmBody')}
            <br />
            <br />
            {t('cloud.logoutConfirmNote')}
          </>
        }
        confirmLabel={t('cloud.signOut')}
        onConfirm={() => {
          setConfirmSignOut(false)
          void signOutCloud().then(() => notify(t('cloud.loggedOutToast'), 'success'))
        }}
        onCancel={() => setConfirmSignOut(false)}
      />

      {state.choice !== null ? (
        <FirstSyncDialog
          choice={state.choice}
          onPick={(strategy) => {
            void resolveFirstSync(strategy)
          }}
          tc={tc}
          t={t}
        />
      ) : null}
    </div>
  )
}

function phaseLabel(
  state: ReturnType<typeof getCloudState>,
  t: ReturnType<typeof useT>['t'],
): string {
  switch (state.phase) {
    case 'syncing':
      return t('cloud.statusSyncing')
    case 'error':
      return t('cloud.statusError')
    case 'outdated':
      return t('cloud.statusOutdated')
    case 'idle':
      return t('cloud.statusIdle')
    default:
      return t('cloud.statusOff')
  }
}

/**
 * 首次绑定：云端和本机都有数据，用哪边？
 *
 * 这个弹窗**故意不能随便关掉**（没有右上角关闭、没有点遮罩关闭）：
 * 关掉之后同步就停在那里，而用户会以为「已经同步好了」。
 * 三个选项里「合并」排在第一个并被推荐 —— 它是唯一一个不会直接丢数据的。
 */
function FirstSyncDialog({
  choice,
  onPick,
  t,
  tc,
}: {
  choice: { localItems: number; remoteItems: number; remoteAt: string }
  onPick: (strategy: FirstSyncStrategy) => void
  t: ReturnType<typeof useT>['t']
  tc: ReturnType<typeof useT>['tc']
}) {
  const [selected, setSelected] = useState<FirstSyncStrategy>('merge')

  const options: Array<{ key: FirstSyncStrategy; label: string; desc: string }> = [
    { key: 'merge', label: t('cloud.choiceMerge'), desc: t('cloud.choiceMergeDesc') },
    { key: 'push', label: t('cloud.choicePush'), desc: t('cloud.choicePushDesc') },
    { key: 'pull', label: t('cloud.choicePull'), desc: t('cloud.choicePullDesc') },
  ]

  return (
    <Modal
      open
      title={t('cloud.choiceTitle')}
      onClose={() => {
        /* 必须选一个才关得掉 —— 见上面那段说明 */
      }}
      footer={
        <Button variant="primary" onClick={() => onPick(selected)}>
          {t('cloud.choiceConfirm')}
        </Button>
      }
    >
      <div style={{ lineHeight: 1.8 }}>{t('cloud.choiceDesc')}</div>

      <div className="storage-grid" style={{ margin: 'var(--gap-4) 0' }}>
        <div className="storage-item">
          <span className="storage-item__label">{t('cloud.choiceLocalLabel')}</span>
          <span className="storage-item__value">{tc(choice.localItems, 'cloud.choiceItems')}</span>
        </div>
        <div className="storage-item">
          <span className="storage-item__label">
            {t('cloud.choiceRemoteLabel', { at: formatDateTime(choice.remoteAt) })}
          </span>
          <span className="storage-item__value">{tc(choice.remoteItems, 'cloud.choiceItems')}</span>
        </div>
      </div>

      <div className="stack">
        {options.map((option) => (
          <label key={option.key} className="cloud-choice">
            <input
              type="radio"
              name="cloud-first-sync"
              checked={selected === option.key}
              onChange={() => setSelected(option.key)}
            />
            <span>
              <strong>{option.label}</strong>
              <br />
              <span className="muted small">{option.desc}</span>
            </span>
          </label>
        ))}
      </div>
    </Modal>
  )
}

/**
 * 顶栏下面那条同步提示。
 *
 * ── 为什么平时它什么都不显示 ────────────────────────────────────
 * 「已同步」是个**正常状态**，不是消息。每次都挂一条绿色横幅的话，
 * 它就变成了背景噪音，等真的出错时用户已经不看那儿了。
 * 所以这里只在三种情况下出现：同步失败（含账号/建表这类配置问题）、
 * 需要升级程序、还有改动没推上去。
 *
 * 和落盘失败那条横幅分工不同：
 *   · 落盘失败 = 这台设备上的数据**可能会丢**，最严重
 *   · 同步失败 = 本地好好的，只是和另一台设备对不上
 * 所以两者都用横幅，但同步失败的措辞必须让人知道「本地没事」。
 */
export function CloudStatusNotice() {
  const state = useSyncExternalStore(subscribeCloud, getCloudState, getCloudState)
  const { t } = useT()

  if (!state.signedIn) return null
  const alert = state.phase === 'error' || state.phase === 'outdated'
  const noteworthy = alert || state.pending || state.phase === 'syncing'
  if (!noteworthy) return null

  const message =
    state.phase === 'error'
      ? (state.lastError ?? t('cloud.statusError'))
      : state.phase === 'outdated'
        ? t('cloud.outdated')
        : state.phase === 'syncing'
          ? t('cloud.statusSyncing')
          : t('cloud.statusPending')

  return (
    <div className={`notice${alert ? ' notice--alert' : ''} save-banner`}>
      <span className="notice__icon" style={alert ? undefined : { color: 'var(--text-2)' }}>
        {alert ? <IconAlert /> : <IconCloud />}
      </span>
      <span className="notice__body small">{message}</span>
      {alert ? (
        <span className="notice__action row">
          <Button size="sm" onClick={() => void syncNow('manual')}>
            {t('cloud.syncNow')}
          </Button>
        </span>
      ) : null}
    </div>
  )
}
