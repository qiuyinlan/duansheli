/**
 * 设置页：备份与恢复、存储状态、自动快照、回收站、危险区，
 * 以及导入导出的预览 / 结果 / 失败三种对话框和各类确认框。
 *
 * 这一页的文案大半和安全有关，翻译时**不要削弱警告的语气**：
 * 中文说「强烈建议先导出」，英文就得是同样明确的建议，
 * 不能软化成「你也可以考虑先导出」。
 *
 * 一处细节：页面里有些句子在一行 JSX 里被换行拆成了两条 key
 * （例如 `这是有损格式，` + 加粗的 `不能用来恢复数据` + `。`），
 * 那是因为中间夹着 <strong>，不能把两段合成一条 —— 合成会丢掉加粗。
 * 渲染时用 `{' '}` 把原来 JSX 换行产生的那个空格补回来，
 * 所以中文的显示结果和改写之前一字不差。
 */
export const settings = {
  /* 页面标题下方的说明（标题本身用 nav.titleSettings） */
  subtitle: '数据安全是这个软件最重要的事 —— 请定期导出备份',

  /* ---------------- 备份与恢复 ---------------- */
  backupTitle: '备份与恢复',
  backupDesc1: '数据只存在这台设备的浏览器里，不会上传到任何服务器。',
  backupDesc2:
    '换设备、换浏览器、清理浏览器数据都会看不到它 —— 所以请用导出的 JSON 文件来搬运和保底。',

  exportJsonTitle: '导出完整备份（JSON）',
  exportJsonDesc1: '包含全部物品、位置、分类、属性、标签。这是唯一能完整恢复数据的格式，',
  exportJsonDesc2: '建议每周存一份到网盘或电脑里。',
  lastExportLabel: '上次导出：',
  lastExportValue: '{time}（{relative}）',
  lastExportNever: '从未',
  exportJsonAction: '导出 JSON',

  exportCsvTitle: '导出物品清单（CSV）',
  exportCsvDesc1: '用 Excel / 表格软件打开查看，方便打印清点。',
  exportCsvDesc2: '这是有损格式，',
  exportCsvDesc2Strong: '不能用来恢复数据',
  exportCsvDesc2Tail: '。',
  exportCsvAction: '导出 CSV',

  importTitle: '导入备份（JSON）',
  importDescLead: '支持两种方式：',
  overwriteStrong: '覆盖',
  importDescReplaceRest: '用备份完全替换当前数据（换设备后恢复用这个）；',
  mergeStrong: '合并',
  importDescMergeRest: '把备份和当前数据合起来（手机和电脑各录了一半时用这个）。',
  importDescSnapshotNote: '无论选哪种，导入前都会自动为当前数据存一份快照。',
  chooseFile: '选择文件',

  /* 导出 / 导入完成后的小提示 */
  exportedToast: '已导出 {filename}',
  exportedCsvToast: '已导出 {filename}（CSV 仅供查看，不能用来恢复数据）',
  importReplaceDone_one: '已覆盖导入：{count} 件物品',
  importReplaceDone_other: '已覆盖导入：{count} 件物品',
  importFailedToast: '导入失败',
  /* 选了 .csv 但内容读不出来时，比 JSON 那句通用报错更对症 */
  importCsvFailed:
    '这个 CSV 认不出来。需要至少有一列「名称」（或 Name），并且是逗号分隔 —— 本程序导出的物品清单就长这样。',

  /* ---------------- 显示偏好 ---------------- */
  displayTitle: '显示偏好',
  displayDesc: '只改变「怎么看」，不动任何数据。',
  hideIdleTitle: '物品列表里默认不显示闲置的东西',
  hideIdleDesc:
    '很多闲置其实是「备用」—— 特意留着的替换品。打开后它们从日常清单里收起来，只在「闲置」页看得到。只影响物品列表，概览和位置页照常统计。',

  /* 备用的隐藏开关：和闲置分开，因为「闲置别碍事」和「备用别碍事」是两种判断 */
  hideSpareTitle: '物品列表里默认不显示备用的东西',
  hideSpareDesc:
    '备用是特意囤着等用的，平时不想在日常清单里看到它们。打开后它们从物品列表里收起来，只在「备用」页看得到。只影响物品列表，概览和位置页照常统计。',

  /* ---------------- 存储状态 ---------------- */
  storageTitle: '存储状态',
  storageDesc: '数据存在浏览器提供的 IndexedDB 里，数据库名固定为 duansheli。',
  storageEngineLabel: '存储引擎',
  storageAvailable: '可用',
  storageUsedLabel: '已用空间',
  storageQuotaLabel: '浏览器配额',
  storageItemsLabel: '物品总数',
  storageSnapshotsLabel: '快照份数',
  storageUpdatedLabel: '数据最后更新',
  storageOriginLabel: '当前网址',
  /*
   * ⚠️ 别在文案里写 **星号加粗**。
   * t() 只做 {变量} 插值，不认任何 markdown —— 星号会原样显示在界面上。
   * 要加粗就把那句话拆成两段，用 xxxStrong 那条在 JSX 里包 <strong>。
   */
  storageOriginHintBefore: '数据按',
  storageOriginHintStrong: '网址',
  storageOriginHintAfter:
    '隔离：localhost、局域网 IP、GitHub Pages 是三个互不相通的数据仓库。所以「换个地址打开就看不到数据」是正常的，要用导出 / 导入迁移。',

  /* 还没导出过备份时的提醒条 */
  backupOverdueNotice: '你还没有导出过备份。浏览器数据一旦被清理就无法找回，建议现在导出一次。',

  /* ---------------- 自动快照 ---------------- */
  snapshotsTitle: '自动快照',
  snapshotsDescThrottle: '每次修改前都会自动存一份（同一分钟内只留一份），最多保留 30 份；',
  snapshotsDescReserved: '导入前和删除位置 / 分类 / 属性前的快照会额外保底保留。',
  snapshotsDescUndoable: '回退之前也会先为当前状态存一份 —— 所以回退本身也可以回退。',
  snapshotsTotal_one: '共 {count} 份',
  snapshotsTotal_other: '共 {count} 份',
  backupNowAction: '立即备份一份',
  refreshAction: '刷新',
  snapshotsEmpty: '还没有任何快照。',
  snapshotItems_one: '{count} 件物品',
  snapshotItems_other: '{count} 件物品',

  restoreAction: '回退',
  deleteSnapshotTitle: '删除这份快照',
  /* 读快照列表失败时**必须**说出来 —— 显示「还没有快照」是在骗人 */
  snapshotsReadFailed: '快照列表读不出来：{message}',

  /* ---------------- 数据体检 ---------------- */
  diagnoseTitle: '数据体检',
  diagnoseDesc:
    '数据看着不见了、或者想确认备份还在不在，看这里就知道。只读，不会改动任何东西。',
  diagnoseRerunAction: '重新体检',
  diagnoseDbLabel: 'duansheli 数据库',
  diagnoseDbExists: '存在',
  diagnoseDbMissing: '不存在',
  diagnoseDbUnknown: '这个浏览器查不了',
  diagnoseAppLabel: '主数据记录',
  diagnoseAppMissing: '没有',
  diagnoseAppUpdated: '最后更新 {time}',
  diagnoseAppSchema: '数据版本 {version}',
  diagnoseAppReadFailed: '读不出来：{message}',
  diagnoseSnapshotsLabel: '快照',
  diagnoseSnapshotsNone: '一份都没有',
  diagnoseSnapshotsRange: '共 {count} 份 · 最早 {oldest} · 最新 {newest}',
  diagnoseSnapshotsBest_one: '物品最多的一份有 {count} 件（{time}）',
  diagnoseSnapshotsBest_other: '物品最多的一份有 {count} 件（{time}）',
  diagnoseSnapshotsReadFailed: '读不出来：{message}',
  diagnoseLocalLabel: '本地偏好',
  diagnoseLocalNone: '无',
  diagnoseLocalValue: '{count} 项：{keys}',
  diagnoseRestoreBestAction: '回退到物品最多的那一份',
  diagnoseVerdictOk_one: '数据在：{count} 件物品，最后更新 {time}。',
  diagnoseVerdictOk_other: '数据在：{count} 件物品，最后更新 {time}。',
  diagnoseVerdictEmptyFresh:
    '这个网址下是空的：0 件物品，也没有快照 —— 说明你从来没在这个地址上存过东西。',
  diagnoseVerdictRestorable_one:
    '当前只有 {current} 件物品，但快照里最多有 {count} 件 —— 很可能能找回来。',
  diagnoseVerdictRestorable_other:
    '当前只有 {current} 件物品，但快照里最多有 {count} 件 —— 很可能能找回来。',
  diagnoseVerdictEmpty: '这个网址下没找到数据，也没有快照。',
  /* 有快照、但每份都是空的 —— 说「也没有快照」就与上面的列表自相矛盾了 */
  diagnoseVerdictEmptyOnlyEmptySnapshots: '这个网址下没有数据；现有的那些快照里也是空的。',
  diagnoseVerdictUnreadable: '读取的时候出错了：{message}',
  diagnoseEmptyHint:
    '数据是按网址分开存的。如果你在别的地址录过东西，把那些地址也挨个打开跑一次体检：localhost、127.0.0.1、局域网 IP、GitHub Pages。找到以后用导出 / 导入搬过来。',

  /* ---------------- 已舍弃回收站 ---------------- */
  recycleTitle: '已舍弃回收站',
  recycleDesc: '标记为「已舍弃」的物品会留在这里，可以回顾自己扔了些什么，也可以随时恢复。',
  recycleEmpty: '回收站是空的。',
  recycleTotal_one: '共 {count} 件',
  recycleTotal_other: '共 {count} 件',
  purgeAllAction: '全部彻底删除',
  discardedAt: '舍弃于 {time}',
  restoredToast: '已恢复为「在用」',
  restoreItemAction: '恢复',
  purgeAction: '彻底删除',

  /* ---------------- 危险区 ---------------- */
  dangerTitle: '危险操作',
  resetSeedTitle: '恢复为初始的分类、位置与属性库',
  resetSeedDesc1: '会清空所有物品，并把分类、位置、属性库重置成刚安装时的样子。',
  resetSeedDesc2: '执行前会自动存一份快照，之后可以回退。',
  resetSeedAction: '恢复初始',

  clearAllTitle: '清空所有数据',
  clearAllDesc1: '删除全部物品、位置、分类、属性和标签，回到完全空白的状态。',
  clearAllDesc2: '同样会先存一份快照 —— 但快照也在这个浏览器里，',
  clearAllDesc2Strong: '强烈建议先导出一份 JSON',
  clearAllDesc2Tail: '。',
  clearAllAction: '清空所有',

  /* 页脚那一行（品牌名保持原样） */
  footerNote: '断舍离 · 本地版 · 数据不经过任何服务器 · 想换设备请用导出的 JSON 文件',

  /* ---------------- 导入预览 ---------------- */
  importPreviewTitle: '确认导入',
  importing: '导入中…',
  startImport: '开始导入',
  previewFileLabel: '文件',
  previewExportedAtLabel: '导出时间',
  previewContentsLabel: '包含内容',
  previewItems_one: '{count} 件物品',
  previewItems_other: '{count} 件物品',
  previewLocations_one: '{count} 个位置',
  previewLocations_other: '{count} 个位置',
  previewCategories_one: '{count} 个分类',
  previewCategories_other: '{count} 个分类',
  previewAttributes_one: '{count} 个属性',
  previewAttributes_other: '{count} 个属性',
  importStrategyLabel: '导入方式',
  strategyReplaceDesc1: '清空当前数据，完全用这份备份替换。换设备后恢复数据请选这个。',
  strategyReplaceDesc2: '（当前数据会在导入前自动存成快照）',
  strategyMergeDesc1: '把这份备份和当前数据合起来。两台设备各录了一部分时选这个。',
  strategyMergeDesc2: '位置会按名称自动对齐，缺失的会自动补建。',
  previewWarningsLabel: '解析时发现的问题',

  /* ---------------- 导入结果 ---------------- */
  reportTitle: '合并完成',
  gotIt: '知道了',
  reportAdded: '新增 {count}',
  reportUpdated: '更新 {count}',
  reportUnchanged: '未变 {count}',
  reportExisting: '已存在 {count}',
  reportWarningsLabel_one: '需要留意的地方（共 {count} 条）',
  reportWarningsLabel_other: '需要留意的地方（共 {count} 条）',
  noWarnings: '没有发现问题。',
  mergeHint1: '提示：合并是按 id 去重的。如果两台设备分别录了同一件东西，会出现两条记录，',
  mergeHint2: '需要你手动删掉其中一条。',

  /* ---------------- 导入失败 ---------------- */
  importErrorTitle: '这个文件无法导入',
  importErrorHint: '当前数据完全没有被改动。请确认选择的是「{brand}」导出的 .json 备份文件。',

  /* ---------------- 各类确认框 ---------------- */
  confirmRestoreTitle: '回退到这份快照？',
  confirmRestoreBody: '将把数据恢复到 {time} 的状态',
  confirmRestoreCount_one: '（{count} 件物品）。',
  confirmRestoreCount_other: '（{count} 件物品）。',
  confirmRestoreNote: '当前状态会先被单独存成一份快照，所以这次回退本身也可以再回退。',

  confirmPurgeTitle: '彻底删除这件物品？',
  confirmPurgeBody: '删除后无法恢复，也不会留在回收站里。',

  confirmPurgeAllTitle_one: '彻底删除回收站里的 {count} 件物品？',
  confirmPurgeAllTitle_other: '彻底删除回收站里的 {count} 件物品？',
  confirmPurgeAllLabel: '全部删除',
  confirmPurgeAllBody: '删除后无法恢复。如果你想留个记录「我都扔了什么」，建议先导出 JSON 备份。',
  recycleClearedToast: '回收站已清空',

  confirmResetSeedTitle: '恢复为初始状态？',
  confirmResetSeedLabel: '确认恢复',
  confirmResetSeedBody_one:
    '将清空当前 {count} 件物品，并把分类、位置、属性库重置为初始内容。执行前会自动存一份快照。',
  confirmResetSeedBody_other:
    '将清空当前 {count} 件物品，并把分类、位置、属性库重置为初始内容。执行前会自动存一份快照。',

  confirmClearAllTitle: '清空所有数据？',
  confirmClearAllLabel: '确认清空',
  confirmClearAllBody_one: '这会删除全部 {count} 件物品以及所有位置、分类、属性、标签。',
  confirmClearAllBody_other: '这会删除全部 {count} 件物品以及所有位置、分类、属性、标签。',
  confirmClearAllNote1: '执行前会自动存一份快照，但快照也存在这个浏览器里。',
  confirmClearAllNoteStrong: '强烈建议先导出 JSON 备份再操作。',
}
