import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  IconAlert,
  IconDownload,
  IconTrash,
  IconUndo,
  IconUpload,
} from '../components/ui/icons'
import { Button, ConfirmDialog, Modal } from '../components/ui/primitives'
import { exportCsv } from '../data/exportCsv'
import { exportJson } from '../data/exportJson'
import { parseExportFile } from '../data/validate'
import { formatBytes, readFileAsText } from '../lib/download'
import { formatDateTime, formatRelative } from '../lib/format'
import { estimateUsage } from '../storage/idb'
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

export function Settings() {
  const navigate = useNavigate()

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
  const [usage, setUsage] = useState<{ usage: number; quota: number } | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

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
    } catch {
      // 快照列表读不出来不影响主功能，静默处理
    }
  }, [])

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
    notify(`已导出 ${filename}`, 'success')
  }

  const handleExportCsv = () => {
    const filename = exportCsv(data, derived)
    notify(`已导出 ${filename}（CSV 仅供查看，不能用来恢复数据）`, 'success')
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
        notify(
          `已覆盖导入：${importPreview.data.items.length} 件物品`,
          'success',
        )
      } else {
        const report = await mergeAll(importPreview.data)
        setImportReport(report)
        notify('合并完成', 'success')
      }
      setImportPreview(null)
      setRefreshKey((k) => k + 1)
    } catch (err) {
      notify(err instanceof Error ? err.message : '导入失败', 'error')
    } finally {
      setImporting(false)
    }
  }

  const backupOverdue = data.items.length > 0 && ui.lastExportAt === null

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-header__title">设置</div>
          <div className="page-header__sub">
            数据安全是这个软件最重要的事 —— 请定期导出备份
          </div>
        </div>
      </div>

      {/* ================= 备份与恢复 ================= */}
      <section className="section">
        <div className="settings-block">
          <div className="settings-block__head">
            <div className="settings-block__title">备份与恢复</div>
            <div className="settings-block__desc">
              数据只存在这台设备的浏览器里，不会上传到任何服务器。
              换设备、换浏览器、清理浏览器数据都会看不到它 —— 所以请用导出的 JSON 文件来搬运和保底。
            </div>
          </div>
          <div className="settings-block__body">
            <div className="action-row">
              <div className="action-row__text">
                <div className="action-row__title">导出完整备份（JSON）</div>
                <div className="action-row__desc">
                  包含全部物品、位置、分类、属性、标签。这是唯一能完整恢复数据的格式，
                  建议每周存一份到网盘或电脑里。
                  <br />
                  上次导出：
                  {ui.lastExportAt ? ` ${formatDateTime(ui.lastExportAt)}（${formatRelative(ui.lastExportAt)}）` : ' 从未'}
                </div>
              </div>
              <div className="action-row__buttons">
                <Button variant="primary" onClick={handleExportJson}>
                  <IconDownload size={14} />
                  导出 JSON
                </Button>
              </div>
            </div>

            <div className="action-row">
              <div className="action-row__text">
                <div className="action-row__title">导出物品清单（CSV）</div>
                <div className="action-row__desc">
                  用 Excel / 表格软件打开查看，方便打印清点。
                  这是有损格式，<strong>不能用来恢复数据</strong>。
                </div>
              </div>
              <div className="action-row__buttons">
                <Button onClick={handleExportCsv} disabled={data.items.length === 0}>
                  导出 CSV
                </Button>
              </div>
            </div>

            <div className="action-row">
              <div className="action-row__text">
                <div className="action-row__title">导入备份（JSON）</div>
                <div className="action-row__desc">
                  支持两种方式：<strong>覆盖</strong> 用备份完全替换当前数据（换设备后恢复用这个）；
                  <strong>合并</strong> 把备份和当前数据合起来（手机和电脑各录了一半时用这个）。
                  <br />
                  无论选哪种，导入前都会自动为当前数据存一份快照。
                </div>
              </div>
              <div className="action-row__buttons">
                <Button onClick={() => fileInputRef.current?.click()}>
                  <IconUpload size={14} />
                  选择文件
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
            <div className="settings-block__title">存储状态</div>
            <div className="settings-block__desc">
              数据存在浏览器提供的 IndexedDB 里，数据库名固定为 duansheli。
            </div>
          </div>
          <div className="settings-block__body">
            <div className="storage-grid">
              <div className="storage-item">
                <span className="storage-item__label">存储引擎</span>
                <span className="storage-item__value">
                  IndexedDB
                  <span className="badge" style={{ marginLeft: 6 }}>
                    可用
                  </span>
                </span>
              </div>
              <div className="storage-item">
                <span className="storage-item__label">已用空间</span>
                <span className="storage-item__value">
                  {usage ? formatBytes(usage.usage) : '未知'}
                </span>
              </div>
              <div className="storage-item">
                <span className="storage-item__label">浏览器配额</span>
                <span className="storage-item__value">
                  {usage && usage.quota > 0 ? formatBytes(usage.quota) : '未知'}
                </span>
              </div>
              <div className="storage-item">
                <span className="storage-item__label">物品总数</span>
                <span className="storage-item__value">{data.items.length}</span>
              </div>
              <div className="storage-item">
                <span className="storage-item__label">快照份数</span>
                <span className="storage-item__value">{snapshots.length}</span>
              </div>
              <div className="storage-item">
                <span className="storage-item__label">数据最后更新</span>
                <span className="storage-item__value">{formatRelative(data.updatedAt)}</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ================= 备份提醒 ================= */}
      {backupOverdue ? (
        <div className="notice notice--alert" style={{ marginBottom: 'var(--gap-6)' }}>
          <span className="notice__icon">
            <IconAlert />
          </span>
          <span className="notice__body">
            你还没有导出过备份。浏览器数据一旦被清理就无法找回，建议现在导出一次。
          </span>
        </div>
      ) : null}

      {/* ================= 自动快照 ================= */}
      <section className="section">
        <div className="settings-block">
          <div className="settings-block__head">
            <div className="settings-block__title">自动快照</div>
            <div className="settings-block__desc">
              每次修改前都会自动存一份（同一分钟内只留一份），最多保留 30 份；
              导入前和删除位置 / 分类 / 属性前的快照会额外保底保留。
              回退之前也会先为当前状态存一份 —— 所以回退本身也可以回退。
            </div>
          </div>

          <div className="settings-block__body" style={{ paddingBottom: 0 }}>
            <div className="row-between wrap">
              <span className="tiny dim">共 {snapshots.length} 份</span>
              <div className="row">
                <Button
                  size="sm"
                  onClick={() => {
                    void backupNow().then(() => setRefreshKey((k) => k + 1))
                  }}
                >
                  立即备份一份
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setRefreshKey((k) => k + 1)}>
                  刷新
                </Button>
              </div>
            </div>
          </div>

          {snapshots.length === 0 ? (
            <div className="settings-block__body">
              <span className="dim small">还没有任何快照。</span>
            </div>
          ) : (
            <div style={{ maxHeight: 340, overflowY: 'auto' }}>
              {snapshots.map((snap) => (
                <div key={snap.id} className="snapshot-row">
                  <div className="snapshot-row__main">
                    <div className="snapshot-row__time">{formatDateTime(snap.at)}</div>
                    <div className="snapshot-row__meta">
                      <span className="badge">{SNAPSHOT_REASON_LABEL[snap.reason]}</span>
                      <span>{snap.itemCount} 件物品</span>
                      <span className="dim">{formatRelative(snap.at)}</span>
                    </div>
                  </div>
                  <div className="row">
                    <Button size="sm" onClick={() => setRestoreTarget(snap)}>
                      <IconUndo size={12} />
                      回退
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      title="删除这份快照"
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
            <div className="settings-block__title">已舍弃回收站</div>
            <div className="settings-block__desc">
              标记为「已舍弃」的物品会留在这里，可以回顾自己扔了些什么，也可以随时恢复。
            </div>
          </div>

          {discarded.length === 0 ? (
            <div className="settings-block__body">
              <span className="dim small">回收站是空的。</span>
            </div>
          ) : (
            <>
              <div className="settings-block__body" style={{ paddingBottom: 0 }}>
                <div className="row-between wrap">
                  <span className="tiny dim">共 {discarded.length} 件</span>
                  <Button size="sm" variant="danger" onClick={() => setConfirmPurgeAll(true)}>
                    全部彻底删除
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
                            : '未归位'}
                        </span>
                        {item.discardedAt ? (
                          <span className="dim">舍弃于 {formatDateTime(item.discardedAt)}</span>
                        ) : null}
                      </div>
                    </div>
                    <div className="row">
                      <Button
                        size="sm"
                        onClick={() => {
                          restoreItem(item.id)
                          notify('已恢复为「在用」', 'success')
                        }}
                      >
                        恢复
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        title="彻底删除"
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
          <div className="danger-zone__title">危险操作</div>

          <div className="danger-item">
            <div className="danger-item__text">
              <div className="danger-item__title">恢复为初始的分类、位置与属性库</div>
              <div className="danger-item__desc">
                会清空所有物品，并把分类、位置、属性库重置成刚安装时的样子。
                执行前会自动存一份快照，之后可以回退。
              </div>
            </div>
            <Button variant="danger" onClick={() => setConfirmResetSeed(true)}>
              恢复初始
            </Button>
          </div>

          <div className="danger-item">
            <div className="danger-item__text">
              <div className="danger-item__title">清空所有数据</div>
              <div className="danger-item__desc">
                删除全部物品、位置、分类、属性和标签，回到完全空白的状态。
                <br />
                同样会先存一份快照 —— 但快照也在这个浏览器里，<strong>强烈建议先导出一份 JSON</strong>。
              </div>
            </div>
            <Button variant="danger" onClick={() => setConfirmClearAll(true)}>
              清空所有
            </Button>
          </div>
        </div>
      </section>

      <div className="row" style={{ marginTop: 'var(--gap-5)' }}>
        <span className="tiny dim">
          断舍离 · 本地版 · 数据不经过任何服务器 · 想换设备请用导出的 JSON 文件
        </span>
      </div>

      {/* ================= 导入预览 ================= */}
      <Modal
        open={importPreview !== null}
        title="确认导入"
        onClose={() => setImportPreview(null)}
        maxWidth={520}
        footer={
          <>
            <Button onClick={() => setImportPreview(null)} disabled={importing}>
              取消
            </Button>
            <Button variant="primary" onClick={() => void doImport()} disabled={importing}>
              {importing ? '导入中…' : '开始导入'}
            </Button>
          </>
        }
      >
        {importPreview ? (
          <div className="stack">
            <div className="report">
              <div className="report__row">
                <span>文件</span>
                <span className="truncate">{importPreview.fileName}</span>
              </div>
              <div className="report__row">
                <span>导出时间</span>
                <span>{importPreview.exportedAt ? formatDateTime(importPreview.exportedAt) : '未知'}</span>
              </div>
              <div className="report__row">
                <span>包含内容</span>
                <span>
                  {importPreview.data.items.length} 件物品 ·{' '}
                  {importPreview.data.locations.length} 个位置 ·{' '}
                  {importPreview.data.categories.length} 个分类 ·{' '}
                  {importPreview.data.attributeDefs.length} 个属性
                </span>
              </div>
            </div>

            <div className="field">
              <span className="field__label">导入方式</span>
              <label className="checkbox" style={{ alignItems: 'flex-start' }}>
                <input
                  type="radio"
                  name="import-strategy"
                  checked={importStrategy === 'replace'}
                  onChange={() => setImportStrategy('replace')}
                  style={{ marginTop: 3 }}
                />
                <span>
                  <strong>覆盖</strong>
                  <span className="small muted" style={{ display: 'block' }}>
                    清空当前数据，完全用这份备份替换。换设备后恢复数据请选这个。
                    （当前数据会在导入前自动存成快照）
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
                  <strong>合并</strong>
                  <span className="small muted" style={{ display: 'block' }}>
                    把这份备份和当前数据合起来。两台设备各录了一部分时选这个。
                    位置会按名称自动对齐，缺失的会自动补建。
                  </span>
                </span>
              </label>
            </div>

            {importPreview.warnings.length > 0 ? (
              <div className="field">
                <span className="field__label">解析时发现的问题</span>
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
        title="合并完成"
        onClose={() => setImportReport(null)}
        maxWidth={520}
        footer={
          <Button variant="primary" onClick={() => setImportReport(null)}>
            知道了
          </Button>
        }
      >
        {importReport ? (
          <div className="stack">
            <div className="report">
              <div className="report__row">
                <span>物品</span>
                <span>
                  新增 {importReport.items.added} · 更新 {importReport.items.updated} · 未变{' '}
                  {importReport.items.unchanged}
                </span>
              </div>
              <div className="report__row">
                <span>位置</span>
                <span>
                  新增 {importReport.locations.added} · 已存在 {importReport.locations.updated}
                </span>
              </div>
              <div className="report__row">
                <span>分类</span>
                <span>
                  新增 {importReport.categories.added} · 已存在 {importReport.categories.updated}
                </span>
              </div>
              <div className="report__row">
                <span>属性</span>
                <span>
                  新增 {importReport.attributeDefs.added} · 已存在{' '}
                  {importReport.attributeDefs.updated}
                </span>
              </div>
              <div className="report__row">
                <span>标签</span>
                <span>新增 {importReport.tags.added}</span>
              </div>
            </div>

            {importReport.warnings.length > 0 ? (
              <div className="field">
                <span className="field__label">
                  需要留意的地方（共 {importReport.warnings.length} 条）
                </span>
                <ul className="report__warnings">
                  {importReport.warnings.slice(0, 60).map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="dim small">没有发现问题。</div>
            )}

            <div className="dim small">
              提示：合并是按 id 去重的。如果两台设备分别录了同一件东西，会出现两条记录，
              需要你手动删掉其中一条。
            </div>
          </div>
        ) : null}
      </Modal>

      {/* ================= 导入失败 ================= */}
      <Modal
        open={importError !== null}
        title="这个文件无法导入"
        onClose={() => setImportError(null)}
        maxWidth={440}
        footer={
          <Button variant="primary" onClick={() => setImportError(null)}>
            知道了
          </Button>
        }
      >
        <div className="stack-sm">
          <div className="small" style={{ color: 'var(--danger)' }}>
            {importError}
          </div>
          <div className="dim small">
            当前数据完全没有被改动。请确认选择的是「断舍离」导出的 .json 备份文件。
          </div>
        </div>
      </Modal>

      {/* ================= 各类确认 ================= */}
      <ConfirmDialog
        open={restoreTarget !== null}
        title="回退到这份快照？"
        confirmLabel="回退"
        message={
          <>
            将把数据恢复到 {restoreTarget ? formatDateTime(restoreTarget.at) : ''} 的状态
            （{restoreTarget?.itemCount ?? 0} 件物品）。
            <br />
            <br />
            当前状态会先被单独存成一份快照，所以这次回退本身也可以再回退。
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
        title="彻底删除这件物品？"
        danger
        confirmLabel="彻底删除"
        message="删除后无法恢复，也不会留在回收站里。"
        onConfirm={() => {
          if (purgeTarget) purgeItem(purgeTarget)
          setPurgeTarget(null)
        }}
        onCancel={() => setPurgeTarget(null)}
      />

      <ConfirmDialog
        open={confirmPurgeAll}
        title={`彻底删除回收站里的 ${discarded.length} 件物品？`}
        danger
        confirmLabel="全部删除"
        message="删除后无法恢复。如果你想留个记录「我都扔了什么」，建议先导出 JSON 备份。"
        onConfirm={() => {
          purgeAllDiscarded()
          notify('回收站已清空', 'success')
          setConfirmPurgeAll(false)
        }}
        onCancel={() => setConfirmPurgeAll(false)}
      />

      <ConfirmDialog
        open={confirmResetSeed}
        title="恢复为初始状态？"
        danger
        confirmLabel="确认恢复"
        message={`将清空当前 ${data.items.length} 件物品，并把分类、位置、属性库重置为初始内容。执行前会自动存一份快照。`}
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
        title="清空所有数据？"
        danger
        confirmLabel="确认清空"
        message={
          <>
            这会删除全部 {data.items.length} 件物品以及所有位置、分类、属性、标签。
            <br />
            <br />
            执行前会自动存一份快照，但快照也存在这个浏览器里。
            <strong>强烈建议先导出 JSON 备份再操作。</strong>
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
