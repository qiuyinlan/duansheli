import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  IconAlert,
  IconDownload,
  IconTrash,
  IconUndo,
  IconUpload,
} from '../components/ui/icons'
import { Button, ConfirmDialog, Modal, Switch } from '../components/ui/primitives'
import { exportCsv } from '../data/exportCsv'
import { exportJson } from '../data/exportJson'
import { parseExportFile } from '../data/validate'
import { useT } from '../i18n'
import { formatBytes, readFileAsText } from '../lib/download'
import { formatDateTime, formatRelative } from '../lib/format'
import { estimateUsage } from '../storage/idb'
import { diagnoseLocalData, type LocalDiagnosis } from '../storage/diagnose'
import {
  SNAPSHOT_REASON_LABEL,
  deleteSnapshot,
  listSnapshots,
} from '../storage/snapshots'
import { useAppStore } from '../store/useAppStore'
import type { AppData, ImportReport, ImportStrategy, SnapshotMeta } from '../types'

interface ImportPreview {
  fileName: string
  data: AppData
  warnings: string[]
  exportedAt: string | null
}

/* ------------------------------------------------------------------ */
/* 数据体检                                                            */
/* ------------------------------------------------------------------ */

/**
 * 「我的数据去哪儿了」自助诊断。
 *
 * 为什么要有这个：三种完全不同的真相在界面上长得**一模一样**（都是空列表）——
 *   1. 数据在，只是你现在站在**另一个网址**下（数据按网址隔离）
 *   2. 主记录真没了，但**快照还在** —— 一键就能找回来
 *   3. 这个网址下本来就没存过东西
 * 只摆事实，让用户一眼分清自己在哪一种里，而不是让他猜。
 *
 * 只读：打开这个面板不会产生快照、不会写任何东西。
 */
function DiagnosisPanel({
  diagnosis,
  diagnosing,
  onRerun,
  onRestoreBest,
}: {
  diagnosis: LocalDiagnosis | null
  diagnosing: boolean
  onRerun: () => void
  onRestoreBest: (snapshotId: string) => void
}) {
  const { t, tc } = useT()

  const d = diagnosis

  let verdictText = ''
  let alert = false

  if (d) {
    if (d.verdict === 'unreadable') {
      alert = true
      verdictText = t('settings.diagnoseVerdictUnreadable', {
        message: d.app.readError ?? d.snapshots.readError ?? '',
      })
    } else if (d.verdict === 'restorable') {
      alert = true
      verdictText = tc(d.snapshots.maxItems, 'settings.diagnoseVerdictRestorable', {
        current: d.app.itemCount,
      })
    } else if (d.verdict === 'empty') {
      alert = true
      /*
       * 「没有快照」和「快照都是空的」是两种情况，但结论都是 empty。
       * 这里必须分开说 —— 上面那一格正列着「共 2 份」，这行却写「也没有快照」，
       * 用户会立刻不知道该信哪一句。自相矛盾的界面比不说话的界面更糟。
       */
      verdictText =
        d.snapshots.count === 0
          ? t('settings.diagnoseVerdictEmpty')
          : t('settings.diagnoseVerdictEmptyOnlyEmptySnapshots')
    } else if (d.app.itemCount === 0) {
      verdictText = t('settings.diagnoseVerdictEmptyFresh')
    } else {
      verdictText = tc(d.app.itemCount, 'settings.diagnoseVerdictOk', {
        time: d.app.updatedAt ? formatRelative(d.app.updatedAt) : '—',
      })
    }
  }

  const dbText = !d
    ? '—'
    : d.dbExists === null
      ? t('settings.diagnoseDbUnknown')
      : d.dbExists
        ? t('settings.diagnoseDbExists')
        : t('settings.diagnoseDbMissing')

  const appText = !d
    ? '—'
    : d.app.readError
      ? t('settings.diagnoseAppReadFailed', { message: d.app.readError })
      : !d.app.exists
        ? t('settings.diagnoseAppMissing')
        : [
            d.app.updatedAt
              ? t('settings.diagnoseAppUpdated', { time: formatRelative(d.app.updatedAt) })
              : null,
            d.app.schemaVersion === null
              ? null
              : t('settings.diagnoseAppSchema', { version: d.app.schemaVersion }),
          ]
            .filter(Boolean)
            .join(' · ')

  const snapshotText = !d
    ? '—'
    : d.snapshots.readError
      ? t('settings.diagnoseSnapshotsReadFailed', { message: d.snapshots.readError })
      : d.snapshots.count === 0
        ? t('settings.diagnoseSnapshotsNone')
        : t('settings.diagnoseSnapshotsRange', {
            count: d.snapshots.count,
            oldest: d.snapshots.oldestAt ? formatDateTime(d.snapshots.oldestAt) : '—',
            newest: d.snapshots.newestAt ? formatDateTime(d.snapshots.newestAt) : '—',
          })

  /*
   * 只列 localStorage 的**键名**。
   * 值里面有一个是 API Key —— 体检没有理由去读它，更不能显示出来。
   */
  const localText = !d
    ? '—'
    : d.localKeys.length === 0
      ? t('settings.diagnoseLocalNone')
      : t('settings.diagnoseLocalValue', {
          count: d.localKeys.length,
          keys: d.localKeys.join(', '),
        })

  const best = d && d.verdict === 'restorable' ? d.snapshots.best : null

  return (
    <section className="section">
      <div className="settings-block">
        <div className="settings-block__head">
          <div className="settings-block__title">{t('settings.diagnoseTitle')}</div>
          <div className="settings-block__desc">{t('settings.diagnoseDesc')}</div>
        </div>

        <div className="settings-block__body">
          <div className="storage-grid">
            <div className="storage-item">
              <span className="storage-item__label">{t('settings.diagnoseDbLabel')}</span>
              <span className="storage-item__value">{dbText}</span>
            </div>
            <div className="storage-item">
              <span className="storage-item__label">{t('settings.diagnoseAppLabel')}</span>
              <span className="storage-item__value">{appText}</span>
            </div>
            <div className="storage-item">
              <span className="storage-item__label">{t('settings.diagnoseSnapshotsLabel')}</span>
              <span className="storage-item__value">{snapshotText}</span>
            </div>
            <div className="storage-item">
              <span className="storage-item__label">{t('settings.diagnoseLocalLabel')}</span>
              <span className="storage-item__value">{localText}</span>
            </div>
          </div>
        </div>

        <div className="settings-block__body" style={{ paddingTop: 0 }}>
          <div className={alert ? 'notice notice--alert' : 'notice'}>
            {alert ? (
              <span className="notice__icon">
                <IconAlert />
              </span>
            ) : null}
            <span className="notice__body">{verdictText}</span>
          </div>

          {best ? (
            <div className="row-between wrap" style={{ marginTop: 'var(--gap-3)' }}>
              <span className="tiny dim">
                {tc(best.itemCount, 'settings.diagnoseSnapshotsBest', {
                  time: formatDateTime(best.at),
                })}
              </span>
              <Button size="sm" onClick={() => onRestoreBest(best.id)}>
                <IconUndo size={12} />
                {t('settings.diagnoseRestoreBestAction')}
              </Button>
            </div>
          ) : null}

          {/*
            「这个网址下什么都没有」是最需要解释的一种结论 ——
            不说清楚，用户只会得出「数据没了」这一个结论，而正确的结论往往是
            「数据在另一个网址下，去那儿打开」。
          */}
          {d && d.verdict === 'empty' ? (
            <div className="tiny dim" style={{ marginTop: 'var(--gap-3)', lineHeight: 1.7 }}>
              {t('settings.diagnoseEmptyHint')}
            </div>
          ) : null}

          <div className="row" style={{ marginTop: 'var(--gap-3)' }}>
            <Button size="sm" variant="ghost" disabled={diagnosing} onClick={onRerun}>
              {t('settings.diagnoseRerunAction')}
            </Button>
          </div>
        </div>
      </div>
    </section>
  )
}

export function Settings() {
  const navigate = useNavigate()

  // useT() 一方面是拿 t/tc，另一方面是**订阅语言**：
  // 语言一换这个组件就会重新渲染，页面上所有文字才会跟着变。
  const { t, tc } = useT()

  const data = useAppStore((s) => s.data)
  const derived = useAppStore((s) => s.derived)
  const ui = useAppStore((s) => s.ui)
  const setUi = useAppStore((s) => s.setUi)
  const replaceAll = useAppStore((s) => s.replaceAll)
  const mergeAll = useAppStore((s) => s.mergeAll)
  const resetToSeed = useAppStore((s) => s.resetToSeed)
  const clearEverything = useAppStore((s) => s.clearEverything)
  const backupNow = useAppStore((s) => s.backupNow)
  const restoreFromSnapshot = useAppStore((s) => s.restoreFromSnapshot)
  const restoreItem = useAppStore((s) => s.restoreItem)
  const purgeItem = useAppStore((s) => s.purgeItem)
  const purgeAllDiscarded = useAppStore((s) => s.purgeAllDiscarded)
  const notify = useAppStore((s) => s.notify)

  const [snapshots, setSnapshots] = useState<SnapshotMeta[]>([])
  const [snapshotsError, setSnapshotsError] = useState<string | null>(null)
  const [usage, setUsage] = useState<{ usage: number; quota: number } | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const [diagnosis, setDiagnosis] = useState<LocalDiagnosis | null>(null)
  const [diagnosing, setDiagnosing] = useState(false)

  /**
   * 当前地址。
   *
   * 浏览器把数据按**网址**隔离，而这个项目你会有好几个常用地址
   * （localhost / 局域网 IP / GitHub Pages）—— 它们是互不相通的数据仓库。
   * 把地址摆出来，「我的数据怎么不见了」这类问题才好判断。
   * 只在浏览器里取，服务端渲染 / 测试环境下取不到就是空字符串。
   */
  const origin = typeof window === 'undefined' ? '' : window.location.origin

  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null)
  const [importStrategy, setImportStrategy] = useState<ImportStrategy>('replace')
  const [importReport, setImportReport] = useState<ImportReport | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)

  const [restoreTarget, setRestoreTarget] = useState<SnapshotMeta | null>(null)
  const [confirmResetSeed, setConfirmResetSeed] = useState(false)
  const [confirmClearAll, setConfirmClearAll] = useState(false)
  const [confirmPurgeAll, setConfirmPurgeAll] = useState(false)
  const [purgeTarget, setPurgeTarget] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)

  const refresh = useCallback(async () => {
    try {
      const [list, estimate] = await Promise.all([listSnapshots(), estimateUsage()])
      setSnapshots(list)
      setUsage(estimate)
      setSnapshotsError(null)
    } catch (err) {
      /*
       * 读失败**不能**静默吞掉。
       * 列表空着看起来就是「一份备份都没有」—— 那会让人在真的丢了数据时
       * 以为自己已经无路可退，然后放弃。这里必须把失败本身说出来。
       */
      setSnapshotsError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  /**
   * 数据体检。只读，所以进页面就跑一次 ——
   * 会点进来找数据的人，往往已经慌了，不该再指望他自己发现要点哪个按钮。
   */
  const runDiagnosis = useCallback(async () => {
    setDiagnosing(true)
    try {
      setDiagnosis(await diagnoseLocalData())
    } finally {
      setDiagnosing(false)
    }
  }, [])

  useEffect(() => {
    void runDiagnosis()
  }, [runDiagnosis])

  useEffect(() => {
    void refresh()
  }, [refresh, refreshKey])

  const discarded = useMemo(
    () => data.items.filter((i) => i.status === 'discarded'),
    [data.items],
  )

  const handleExportJson = () => {
    const filename = exportJson(data)
    setUi({ lastExportAt: new Date().toISOString() })
    setRefreshKey((k) => k + 1)
    notify(t('settings.exportedToast', { filename }), 'success')
  }

  const handleExportCsv = () => {
    const filename = exportCsv(data, derived)
    notify(t('settings.exportedCsvToast', { filename }), 'success')
  }

  const handleFile = async (file: File) => {
    try {
      const text = await readFileAsText(file)
      const result = parseExportFile(text)
      if (!result.ok) {
        setImportError(result.error)
        return
      }
      setImportStrategy('replace')
      setImportPreview({
        fileName: file.name,
        data: result.data,
        warnings: result.warnings,
        exportedAt: result.exportedAt,
      })
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err))
    }
  }

  const doImport = async () => {
    if (!importPreview) return
    setImporting(true)
    try {
      if (importStrategy === 'replace') {
        await replaceAll(importPreview.data, 'import')
        notify(tc(importPreview.data.items.length, 'settings.importReplaceDone'), 'success')
      } else {
        const report = await mergeAll(importPreview.data)
        setImportReport(report)
        notify(t('settings.reportTitle'), 'success')
      }
      setImportPreview(null)
      setRefreshKey((k) => k + 1)
    } catch (err) {
      notify(err instanceof Error ? err.message : t('settings.importFailedToast'), 'error')
    } finally {
      setImporting(false)
    }
  }

  const backupOverdue = data.items.length > 0 && ui.lastExportAt === null

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-header__title">{t('nav.titleSettings')}</div>
          <div className="page-header__sub">{t('settings.subtitle')}</div>
        </div>
      </div>

      {/* ================= 备份与恢复 ================= */}
      <section className="section">
        <div className="settings-block">
          <div className="settings-block__head">
            <div className="settings-block__title">{t('settings.backupTitle')}</div>
            <div className="settings-block__desc">
              {t('settings.backupDesc1')} {t('settings.backupDesc2')}
            </div>
          </div>
          <div className="settings-block__body">
            <div className="action-row">
              <div className="action-row__text">
                <div className="action-row__title">{t('settings.exportJsonTitle')}</div>
                <div className="action-row__desc">
                  {t('settings.exportJsonDesc1')} {t('settings.exportJsonDesc2')}
                  <br />
                  {t('settings.lastExportLabel')}{' '}
                  {ui.lastExportAt
                    ? t('settings.lastExportValue', {
                        time: formatDateTime(ui.lastExportAt),
                        relative: formatRelative(ui.lastExportAt),
                      })
                    : t('settings.lastExportNever')}
                </div>
              </div>
              <div className="action-row__buttons">
                <Button variant="primary" onClick={handleExportJson}>
                  <IconDownload size={14} />
                  {t('settings.exportJsonAction')}
                </Button>
              </div>
            </div>

            <div className="action-row">
              <div className="action-row__text">
                <div className="action-row__title">{t('settings.exportCsvTitle')}</div>
                <div className="action-row__desc">
                  {t('settings.exportCsvDesc1')} {t('settings.exportCsvDesc2')}
                  <strong>{t('settings.exportCsvDesc2Strong')}</strong>
                  {t('settings.exportCsvDesc2Tail')}
                </div>
              </div>
              <div className="action-row__buttons">
                <Button onClick={handleExportCsv} disabled={data.items.length === 0}>
                  {t('settings.exportCsvAction')}
                </Button>
              </div>
            </div>

            <div className="action-row">
              <div className="action-row__text">
                <div className="action-row__title">{t('settings.importTitle')}</div>
                <div className="action-row__desc">
                  {t('settings.importDescLead')}
                  <strong>{t('settings.overwriteStrong')}</strong>{' '}
                  {t('settings.importDescReplaceRest')}{' '}
                  <strong>{t('settings.mergeStrong')}</strong>{' '}
                  {t('settings.importDescMergeRest')}
                  <br />
                  {t('settings.importDescSnapshotNote')}
                </div>
              </div>
              <div className="action-row__buttons">
                <Button onClick={() => fileInputRef.current?.click()}>
                  <IconUpload size={14} />
                  {t('settings.chooseFile')}
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json,application/json"
                  className="sr-only"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    // 清空 value，这样连续选择同一个文件也能再次触发
                    e.target.value = ''
                    if (file) void handleFile(file)
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ================= 存储状态 ================= */}
      <section className="section">
        <div className="settings-block">
          <div className="settings-block__head">
            <div className="settings-block__title">{t('settings.displayTitle')}</div>
            <div className="settings-block__desc">{t('settings.displayDesc')}</div>
          </div>
          <div className="settings-block__body">
            <div className="action-row">
              <div>
                <div className="action-row__title">{t('settings.hideIdleTitle')}</div>
                <div className="muted small">{t('settings.hideIdleDesc')}</div>
              </div>
              <Switch
                checked={ui.hideIdle}
                onChange={(checked) => setUi({ hideIdle: checked })}
                label={ui.hideIdle ? t('common.on') : t('common.off')}
              />
            </div>

            {/*
              备用单独一个开关，不和闲置合并 ——
              「闲置别碍事」和「备用别碍事」是两种不同的判断，
              合并成一个的话，想只关其中一个就做不到了。
            */}
            <div className="action-row">
              <div>
                <div className="action-row__title">{t('settings.hideSpareTitle')}</div>
                <div className="muted small">{t('settings.hideSpareDesc')}</div>
              </div>
              <Switch
                checked={ui.hideSpare}
                onChange={(checked) => setUi({ hideSpare: checked })}
                label={ui.hideSpare ? t('common.on') : t('common.off')}
              />
            </div>
          </div>
        </div>

        <div className="settings-block">
          <div className="settings-block__head">
            <div className="settings-block__title">{t('settings.storageTitle')}</div>
            <div className="settings-block__desc">{t('settings.storageDesc')}</div>
          </div>
          <div className="settings-block__body">
            <div className="storage-grid">
              <div className="storage-item">
                <span className="storage-item__label">{t('settings.storageEngineLabel')}</span>
                <span className="storage-item__value">
                  IndexedDB
                  <span className="badge" style={{ marginLeft: 6 }}>
                    {t('settings.storageAvailable')}
                  </span>
                </span>
              </div>
              <div className="storage-item">
                <span className="storage-item__label">{t('settings.storageUsedLabel')}</span>
                <span className="storage-item__value">
                  {usage ? formatBytes(usage.usage) : t('common.unknown')}
                </span>
              </div>
              <div className="storage-item">
                <span className="storage-item__label">{t('settings.storageQuotaLabel')}</span>
                <span className="storage-item__value">
                  {usage && usage.quota > 0 ? formatBytes(usage.quota) : t('common.unknown')}
                </span>
              </div>
              <div className="storage-item">
                <span className="storage-item__label">{t('settings.storageItemsLabel')}</span>
                <span className="storage-item__value">{data.items.length}</span>
              </div>
              <div className="storage-item">
                <span className="storage-item__label">{t('settings.storageSnapshotsLabel')}</span>
                <span className="storage-item__value">{snapshots.length}</span>
              </div>
              <div className="storage-item">
                <span className="storage-item__label">{t('settings.storageUpdatedLabel')}</span>
                <span className="storage-item__value">{formatRelative(data.updatedAt)}</span>
              </div>
              {/*
                这一行是给「我的数据怎么不见了」准备的。
                浏览器的数据按**网址**隔离，而这个项目你会有好几个常用地址
                （localhost / 局域网 IP / GitHub Pages），它们是互不相通的数据仓库。
                把当前地址摆出来，才能一眼看出「原来我现在在另一个仓库里」。
              */}
              <div className="storage-item">
                <span className="storage-item__label">{t('settings.storageOriginLabel')}</span>
                <span className="storage-item__value">
                  <code className="storage-item__code">{origin}</code>
                </span>
              </div>
            </div>

            {/*
              把「数据按网址隔离」这件事写在界面上。
              这条不写，用户换个地址打开就会以为数据丢了 —— 真发生过。

              拆成三段拼，是因为 t() 不做 markdown：写成一条带 **星号** 的文案
              会把星号原样显示出来。要加粗只能在 JSX 里包 <strong>。
            */}
            <div className="tiny dim" style={{ marginTop: 'var(--gap-3)', lineHeight: 1.7 }}>
              {t('settings.storageOriginHintBefore')}
              <strong>{t('settings.storageOriginHintStrong')}</strong>
              {t('settings.storageOriginHintAfter')}
            </div>
          </div>
        </div>
      </section>

      {/* ================= 数据体检 ================= */}
      <DiagnosisPanel
        diagnosis={diagnosis}
        diagnosing={diagnosing}
        onRerun={() => {
          void runDiagnosis()
        }}
        onRestoreBest={(snapshotId) => {
          void restoreFromSnapshot(snapshotId).then(() => {
            setRefreshKey((k) => k + 1)
            void runDiagnosis()
          })
        }}
      />

      {/* ================= 备份提醒 ================= */}
      {backupOverdue ? (
        <div className="notice notice--alert" style={{ marginBottom: 'var(--gap-6)' }}>
          <span className="notice__icon">
            <IconAlert />
          </span>
          <span className="notice__body">{t('settings.backupOverdueNotice')}</span>
        </div>
      ) : null}

      {/* ================= 自动快照 ================= */}
      <section className="section">
        <div className="settings-block">
          <div className="settings-block__head">
            <div className="settings-block__title">{t('settings.snapshotsTitle')}</div>
            <div className="settings-block__desc">
              {t('settings.snapshotsDescThrottle')} {t('settings.snapshotsDescReserved')}{' '}
              {t('settings.snapshotsDescUndoable')}
            </div>
          </div>

          <div className="settings-block__body" style={{ paddingBottom: 0 }}>
            <div className="row-between wrap">
              <span className="tiny dim">{tc(snapshots.length, 'settings.snapshotsTotal')}</span>
              <div className="row">
                <Button
                  size="sm"
                  onClick={() => {
                    void backupNow().then(() => setRefreshKey((k) => k + 1))
                  }}
                >
                  {t('settings.backupNowAction')}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setRefreshKey((k) => k + 1)}>
                  {t('settings.refreshAction')}
                </Button>
              </div>
            </div>
          </div>

          {snapshotsError !== null ? (
            /*
             * 读失败要单独说，不能退化成「还没有任何快照」——
             * 那两种情况看起来一样，但一个是「没备份」，另一个只是「没读到」，
             * 而这个区别恰好出现在用户最需要知道真相的时候。
             */
            <div className="settings-block__body">
              <span className="small">{t('settings.snapshotsReadFailed', { message: snapshotsError })}</span>
            </div>
          ) : snapshots.length === 0 ? (
            <div className="settings-block__body">
              <span className="dim small">{t('settings.snapshotsEmpty')}</span>
            </div>
          ) : (
            <div style={{ maxHeight: 340, overflowY: 'auto' }}>
              {snapshots.map((snap) => (
                <div key={snap.id} className="snapshot-row">
                  <div className="snapshot-row__main">
                    <div className="snapshot-row__time">{formatDateTime(snap.at)}</div>
                    <div className="snapshot-row__meta">
                      <span className="badge">{SNAPSHOT_REASON_LABEL[snap.reason]}</span>
                      <span>{tc(snap.itemCount, 'settings.snapshotItems')}</span>
                      <span className="dim">{formatRelative(snap.at)}</span>
                    </div>
                  </div>
                  <div className="row">
                    <Button size="sm" onClick={() => setRestoreTarget(snap)}>
                      <IconUndo size={12} />
                      {t('settings.restoreAction')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      title={t('settings.deleteSnapshotTitle')}
                      onClick={() => {
                        void deleteSnapshot(snap.id).then(() => setRefreshKey((k) => k + 1))
                      }}
                    >
                      <IconTrash size={13} />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ================= 已舍弃回收站 ================= */}
      <section className="section">
        <div className="settings-block">
          <div className="settings-block__head">
            <div className="settings-block__title">{t('settings.recycleTitle')}</div>
            <div className="settings-block__desc">{t('settings.recycleDesc')}</div>
          </div>

          {discarded.length === 0 ? (
            <div className="settings-block__body">
              <span className="dim small">{t('settings.recycleEmpty')}</span>
            </div>
          ) : (
            <>
              <div className="settings-block__body" style={{ paddingBottom: 0 }}>
                <div className="row-between wrap">
                  <span className="tiny dim">
                    {tc(discarded.length, 'settings.recycleTotal')}
                  </span>
                  <Button size="sm" variant="danger" onClick={() => setConfirmPurgeAll(true)}>
                    {t('settings.purgeAllAction')}
                  </Button>
                </div>
              </div>
              <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                {discarded.map((item) => (
                  <div key={item.id} className="snapshot-row">
                    <div className="snapshot-row__main">
                      <div className="snapshot-row__time">{item.name}</div>
                      <div className="snapshot-row__meta">
                        <span>
                          {item.locationId
                            ? derived.index.pathString(item.locationId, ' / ')
                            : t('status.unassigned')}
                        </span>
                        {item.discardedAt ? (
                          <span className="dim">
                            {t('settings.discardedAt', {
                              time: formatDateTime(item.discardedAt),
                            })}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <div className="row">
                      <Button
                        size="sm"
                        onClick={() => {
                          restoreItem(item.id)
                          notify(t('settings.restoredToast'), 'success')
                        }}
                      >
                        {t('settings.restoreItemAction')}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        title={t('settings.purgeAction')}
                        onClick={() => setPurgeTarget(item.id)}
                      >
                        <IconTrash size={13} />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </section>

      {/* ================= 危险区 ================= */}
      <section className="section">
        <div className="danger-zone">
          <div className="danger-zone__title">{t('settings.dangerTitle')}</div>

          <div className="danger-item">
            <div className="danger-item__text">
              <div className="danger-item__title">{t('settings.resetSeedTitle')}</div>
              <div className="danger-item__desc">
                {t('settings.resetSeedDesc1')} {t('settings.resetSeedDesc2')}
              </div>
            </div>
            <Button variant="danger" onClick={() => setConfirmResetSeed(true)}>
              {t('settings.resetSeedAction')}
            </Button>
          </div>

          <div className="danger-item">
            <div className="danger-item__text">
              <div className="danger-item__title">{t('settings.clearAllTitle')}</div>
              <div className="danger-item__desc">
                {t('settings.clearAllDesc1')}
                <br />
                {t('settings.clearAllDesc2')}
                <strong>{t('settings.clearAllDesc2Strong')}</strong>
                {t('settings.clearAllDesc2Tail')}
              </div>
            </div>
            <Button variant="danger" onClick={() => setConfirmClearAll(true)}>
              {t('settings.clearAllAction')}
            </Button>
          </div>
        </div>
      </section>

      <div className="row" style={{ marginTop: 'var(--gap-5)' }}>
        <span className="tiny dim">{t('settings.footerNote')}</span>
      </div>

      {/* ================= 导入预览 ================= */}
      <Modal
        open={importPreview !== null}
        title={t('settings.importPreviewTitle')}
        onClose={() => setImportPreview(null)}
        maxWidth={520}
        footer={
          <>
            <Button onClick={() => setImportPreview(null)} disabled={importing}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" onClick={() => void doImport()} disabled={importing}>
              {importing ? t('settings.importing') : t('settings.startImport')}
            </Button>
          </>
        }
      >
        {importPreview ? (
          <div className="stack">
            <div className="report">
              <div className="report__row">
                <span>{t('settings.previewFileLabel')}</span>
                <span className="truncate">{importPreview.fileName}</span>
              </div>
              <div className="report__row">
                <span>{t('settings.previewExportedAtLabel')}</span>
                <span>
                  {importPreview.exportedAt
                    ? formatDateTime(importPreview.exportedAt)
                    : t('common.unknown')}
                </span>
              </div>
              <div className="report__row">
                <span>{t('settings.previewContentsLabel')}</span>
                <span>
                  {tc(importPreview.data.items.length, 'settings.previewItems')} ·{' '}
                  {tc(importPreview.data.locations.length, 'settings.previewLocations')} ·{' '}
                  {tc(importPreview.data.categories.length, 'settings.previewCategories')} ·{' '}
                  {tc(importPreview.data.attributeDefs.length, 'settings.previewAttributes')}
                </span>
              </div>
            </div>

            <div className="field">
              <span className="field__label">{t('settings.importStrategyLabel')}</span>
              <label className="checkbox" style={{ alignItems: 'flex-start' }}>
                <input
                  type="radio"
                  name="import-strategy"
                  checked={importStrategy === 'replace'}
                  onChange={() => setImportStrategy('replace')}
                  style={{ marginTop: 3 }}
                />
                <span>
                  <strong>{t('settings.overwriteStrong')}</strong>
                  <span className="small muted" style={{ display: 'block' }}>
                    {t('settings.strategyReplaceDesc1')} {t('settings.strategyReplaceDesc2')}
                  </span>
                </span>
              </label>
              <label className="checkbox" style={{ alignItems: 'flex-start' }}>
                <input
                  type="radio"
                  name="import-strategy"
                  checked={importStrategy === 'merge'}
                  onChange={() => setImportStrategy('merge')}
                  style={{ marginTop: 3 }}
                />
                <span>
                  <strong>{t('settings.mergeStrong')}</strong>
                  <span className="small muted" style={{ display: 'block' }}>
                    {t('settings.strategyMergeDesc1')} {t('settings.strategyMergeDesc2')}
                  </span>
                </span>
              </label>
            </div>

            {importPreview.warnings.length > 0 ? (
              <div className="field">
                <span className="field__label">{t('settings.previewWarningsLabel')}</span>
                <ul className="report__warnings">
                  {importPreview.warnings.slice(0, 40).map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>

      {/* ================= 导入结果 ================= */}
      <Modal
        open={importReport !== null}
        title={t('settings.reportTitle')}
        onClose={() => setImportReport(null)}
        maxWidth={520}
        footer={
          <Button variant="primary" onClick={() => setImportReport(null)}>
            {t('settings.gotIt')}
          </Button>
        }
      >
        {importReport ? (
          <div className="stack">
            <div className="report">
              <div className="report__row">
                <span>{t('nav.items')}</span>
                <span>
                  {t('settings.reportAdded', { count: importReport.items.added })} ·{' '}
                  {t('settings.reportUpdated', { count: importReport.items.updated })} ·{' '}
                  {t('settings.reportUnchanged', { count: importReport.items.unchanged })}
                </span>
              </div>
              <div className="report__row">
                <span>{t('nav.locations')}</span>
                <span>
                  {t('settings.reportAdded', { count: importReport.locations.added })} ·{' '}
                  {t('settings.reportExisting', { count: importReport.locations.updated })}
                </span>
              </div>
              <div className="report__row">
                <span>{t('nav.categories')}</span>
                <span>
                  {t('settings.reportAdded', { count: importReport.categories.added })} ·{' '}
                  {t('settings.reportExisting', { count: importReport.categories.updated })}
                </span>
              </div>
              <div className="report__row">
                <span>{t('nav.attributes')}</span>
                <span>
                  {t('settings.reportAdded', { count: importReport.attributeDefs.added })} ·{' '}
                  {t('settings.reportExisting', { count: importReport.attributeDefs.updated })}
                </span>
              </div>
              <div className="report__row">
                <span>{t('nav.tags')}</span>
                <span>{t('settings.reportAdded', { count: importReport.tags.added })}</span>
              </div>
            </div>

            {importReport.warnings.length > 0 ? (
              <div className="field">
                <span className="field__label">
                  {tc(importReport.warnings.length, 'settings.reportWarningsLabel')}
                </span>
                <ul className="report__warnings">
                  {importReport.warnings.slice(0, 60).map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="dim small">{t('settings.noWarnings')}</div>
            )}

            <div className="dim small">
              {t('settings.mergeHint1')} {t('settings.mergeHint2')}
            </div>
          </div>
        ) : null}
      </Modal>

      {/* ================= 导入失败 ================= */}
      <Modal
        open={importError !== null}
        title={t('settings.importErrorTitle')}
        onClose={() => setImportError(null)}
        maxWidth={440}
        footer={
          <Button variant="primary" onClick={() => setImportError(null)}>
            {t('settings.gotIt')}
          </Button>
        }
      >
        <div className="stack-sm">
          <div className="small" style={{ color: 'var(--danger)' }}>
            {importError}
          </div>
          <div className="dim small">
            {t('settings.importErrorHint', { brand: t('nav.brand') })}
          </div>
        </div>
      </Modal>

      {/* ================= 各类确认 ================= */}
      <ConfirmDialog
        open={restoreTarget !== null}
        title={t('settings.confirmRestoreTitle')}
        confirmLabel={t('settings.restoreAction')}
        message={
          <>
            {t('settings.confirmRestoreBody', {
              time: restoreTarget ? formatDateTime(restoreTarget.at) : '',
            })}{' '}
            {tc(restoreTarget?.itemCount ?? 0, 'settings.confirmRestoreCount')}
            <br />
            <br />
            {t('settings.confirmRestoreNote')}
          </>
        }
        onConfirm={() => {
          if (!restoreTarget) return
          void restoreFromSnapshot(restoreTarget.id).then(() => {
            setRestoreTarget(null)
            setRefreshKey((k) => k + 1)
          })
        }}
        onCancel={() => setRestoreTarget(null)}
      />

      <ConfirmDialog
        open={purgeTarget !== null}
        title={t('settings.confirmPurgeTitle')}
        danger
        confirmLabel={t('settings.purgeAction')}
        message={t('settings.confirmPurgeBody')}
        onConfirm={() => {
          if (purgeTarget) purgeItem(purgeTarget)
          setPurgeTarget(null)
        }}
        onCancel={() => setPurgeTarget(null)}
      />

      <ConfirmDialog
        open={confirmPurgeAll}
        title={tc(discarded.length, 'settings.confirmPurgeAllTitle')}
        danger
        confirmLabel={t('settings.confirmPurgeAllLabel')}
        message={t('settings.confirmPurgeAllBody')}
        onConfirm={() => {
          purgeAllDiscarded()
          notify(t('settings.recycleClearedToast'), 'success')
          setConfirmPurgeAll(false)
        }}
        onCancel={() => setConfirmPurgeAll(false)}
      />

      <ConfirmDialog
        open={confirmResetSeed}
        title={t('settings.confirmResetSeedTitle')}
        danger
        confirmLabel={t('settings.confirmResetSeedLabel')}
        message={tc(data.items.length, 'settings.confirmResetSeedBody')}
        onConfirm={() => {
          void resetToSeed().then(() => {
            setConfirmResetSeed(false)
            setRefreshKey((k) => k + 1)
          })
        }}
        onCancel={() => setConfirmResetSeed(false)}
      />

      <ConfirmDialog
        open={confirmClearAll}
        title={t('settings.confirmClearAllTitle')}
        danger
        confirmLabel={t('settings.confirmClearAllLabel')}
        message={
          <>
            {tc(data.items.length, 'settings.confirmClearAllBody')}
            <br />
            <br />
            {t('settings.confirmClearAllNote1')}{' '}
            <strong>{t('settings.confirmClearAllNoteStrong')}</strong>
          </>
        }
        onConfirm={() => {
          void clearEverything().then(() => {
            setConfirmClearAll(false)
            setRefreshKey((k) => k + 1)
            navigate('/')
          })
        }}
        onCancel={() => setConfirmClearAll(false)}
      />
    </>
  )
}
