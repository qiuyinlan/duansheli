/**
 * Settings page: backup & restore, storage status, automatic snapshots,
 * the recycle bin, the danger zone, and the import preview / result /
 * failure dialogs plus every confirmation on that page.
 *
 * Most of this copy is about safety, so **do not soften the warnings**:
 * where the Chinese says 「强烈建议先导出」 the English has to be an equally
 * direct recommendation, not a "you might also want to consider".
 *
 * A few sentences are split across sibling keys because a <strong> sits in
 * the middle of them (`This format is lossy: ` + bold + `.`). The JSX puts a
 * `{' '}` back where the original line break rendered as a space, so the
 * Chinese output is unchanged, character for character.
 */
export const settings = {
  /* Sub-heading under the page title (the title itself is nav.titleSettings) */
  subtitle: 'Keeping your data safe is the most important thing in this app — export a backup regularly',

  /* ---------------- Backup and restore ---------------- */
  backupTitle: 'Backup and restore',
  backupDesc1: 'Your data lives only in this browser on this device. It is never uploaded to any server.',
  backupDesc2:
    'Changing devices or browsers, or clearing browsing data, will make it disappear — so use the exported JSON file to carry your data over and as a fallback.',

  exportJsonTitle: 'Export a full backup (JSON)',
  exportJsonDesc1:
    'Contains every item, place, category, field and tag. This is the only format that can fully restore your data,',
  exportJsonDesc2: 'so keep a copy on a cloud drive or on your computer every week.',
  lastExportLabel: 'Last export:',
  lastExportValue: '{time} ({relative})',
  lastExportNever: 'never',
  exportJsonAction: 'Export JSON',

  exportCsvTitle: 'Export an item list (CSV)',
  exportCsvDesc1: 'Open it in Excel or another spreadsheet app to read it through or print it for a stocktake.',
  exportCsvDesc2: 'This format is lossy: ',
  exportCsvDesc2Strong: 'you cannot restore your data from it',
  exportCsvDesc2Tail: '.',
  exportCsvAction: 'Export CSV',

  importTitle: 'Import a backup (JSON)',
  importDescLead: 'Two ways to do it: ',
  overwriteStrong: 'Replace',
  importDescReplaceRest:
    'swaps this backup in place of your current data (pick this one to restore after changing devices);',
  mergeStrong: 'Merge',
  importDescMergeRest:
    'combines this backup with your current data (pick this one when a phone and a computer each hold half of it).',
  importDescSnapshotNote:
    'Either way, a snapshot of your current data is saved automatically before the import.',
  chooseFile: 'Choose file',

  /* Toasts after an export / import finishes */
  exportedToast: 'Exported {filename}',
  exportedCsvToast: 'Exported {filename} (the CSV is for reading only — you cannot restore data from it)',
  importReplaceDone_one: 'Replaced your data with the backup: {count} item',
  importReplaceDone_other: 'Replaced your data with the backup: {count} items',
  importFailedToast: 'Import failed',

  /* ---------------- Display preferences ---------------- */
  displayTitle: 'Display preferences',
  displayDesc: 'Changes how things are shown, never the data itself.',
  hideIdleTitle: 'Hide idle items from the item list by default',
  hideIdleDesc:
    'A lot of "idle" is really "spare" — replacements kept on purpose. Switch this on and they step out of the everyday list, visible on the Idle page. Affects the item list only; the overview and place pages still count them.',

  /* ---------------- Storage status ---------------- */
  storageTitle: 'Storage status',
  storageDesc: 'Your data sits in IndexedDB, which the browser provides. The database name is always duansheli.',
  storageEngineLabel: 'Storage engine',
  storageAvailable: 'Available',
  storageUsedLabel: 'Space used',
  storageQuotaLabel: 'Browser quota',
  storageItemsLabel: 'Total items',
  storageSnapshotsLabel: 'Snapshots',
  storageUpdatedLabel: 'Data last updated',
  storageOriginLabel: 'Current address',
  storageOriginHint:
    'Data is isolated per **address**: localhost, a LAN IP and GitHub Pages are three separate stores. So "I opened it at another address and my data is gone" is expected — migrate with export / import.',
  storageOriginHintStrong: 'address',

  /* The banner shown while no backup has ever been exported */
  backupOverdueNotice:
    'You have not exported a backup yet. Once the browser data is cleared it cannot be recovered — export one now.',

  /* ---------------- Automatic snapshots ---------------- */
  snapshotsTitle: 'Automatic snapshots',
  snapshotsDescThrottle: 'One is saved before every change (only one per minute), and at most 30 are kept;',
  snapshotsDescReserved:
    'snapshots taken before an import, or before deleting a place, category or field, are kept on top of that as a safety net.',
  snapshotsDescUndoable:
    'A snapshot of the current state is saved before a rollback too — so a rollback can itself be rolled back.',
  snapshotsTotal_one: '{count} snapshot saved',
  snapshotsTotal_other: '{count} snapshots saved',
  backupNowAction: 'Save one now',
  refreshAction: 'Refresh',
  snapshotsEmpty: 'No snapshots yet.',
  snapshotItems_one: '{count} item',
  snapshotItems_other: '{count} items',

  restoreAction: 'Roll back',
  deleteSnapshotTitle: 'Delete this snapshot',

  /* ---------------- Recycle bin (discarded items) ---------------- */
  recycleTitle: 'Recycle bin (discarded items)',
  recycleDesc:
    'Items you mark as discarded stay here, so you can look back at what you threw away and restore any of them at any time.',
  recycleEmpty: 'The recycle bin is empty.',
  recycleTotal_one: '{count} item in total',
  recycleTotal_other: '{count} items in total',
  purgeAllAction: 'Delete all permanently',
  discardedAt: 'Discarded {time}',
  restoredToast: 'Restored to “In use”',
  restoreItemAction: 'Restore',
  purgeAction: 'Delete permanently',

  /* ---------------- Danger zone ---------------- */
  dangerTitle: 'Dangerous actions',
  resetSeedTitle: 'Reset to the original categories, places and fields',
  resetSeedDesc1:
    'This clears every item and resets your categories, places and fields to how they looked right after you installed the app.',
  resetSeedDesc2: 'A snapshot is saved first, so you can roll it back afterwards.',
  resetSeedAction: 'Reset to defaults',

  clearAllTitle: 'Erase all data',
  clearAllDesc1: 'Deletes every item, place, category, field and tag, leaving you with a completely empty app.',
  clearAllDesc2: 'A snapshot is saved first here too — but snapshots live in this browser as well, so ',
  clearAllDesc2Strong: 'exporting a JSON backup first is strongly recommended',
  clearAllDesc2Tail: '.',
  clearAllAction: 'Erase everything',

  /* The footer line (the brand name stays as it is) */
  footerNote:
    '断舍离 · Local-only build · Your data never goes through any server · To change devices, use the exported JSON file',

  /* ---------------- Import preview ---------------- */
  importPreviewTitle: 'Confirm import',
  importing: 'Importing…',
  startImport: 'Start import',
  previewFileLabel: 'File',
  previewExportedAtLabel: 'Exported',
  previewContentsLabel: 'Contents',
  previewItems_one: '{count} item',
  previewItems_other: '{count} items',
  previewLocations_one: '{count} place',
  previewLocations_other: '{count} places',
  previewCategories_one: '{count} category',
  previewCategories_other: '{count} categories',
  previewAttributes_one: '{count} field',
  previewAttributes_other: '{count} fields',
  importStrategyLabel: 'How to import',
  strategyReplaceDesc1:
    'Wipes your current data and puts this backup in its place entirely. Pick this to restore your data after changing devices.',
  strategyReplaceDesc2: '(your current data is saved as a snapshot before the import)',
  strategyMergeDesc1:
    'Combines this backup with your current data. Pick this when two devices each hold part of it.',
  strategyMergeDesc2: 'Places are matched by name, and any that are missing are created automatically.',
  previewWarningsLabel: 'Problems found while parsing',

  /* ---------------- Import result ---------------- */
  reportTitle: 'Merge complete',
  gotIt: 'Got it',
  reportAdded: 'Added {count}',
  reportUpdated: 'Updated {count}',
  reportUnchanged: 'Unchanged {count}',
  reportExisting: 'Already present {count}',
  reportWarningsLabel_one: 'Things to watch out for ({count} note)',
  reportWarningsLabel_other: 'Things to watch out for ({count} notes)',
  noWarnings: 'No problems found.',
  mergeHint1:
    'Note: merging de-duplicates by id. If two devices each recorded the same thing you will end up with two entries,',
  mergeHint2: 'and you will have to delete one of them by hand.',

  /* ---------------- Import failure ---------------- */
  importErrorTitle: 'This file cannot be imported',
  importErrorHint:
    'Your current data was not changed at all. Please make sure you picked a .json backup file exported by {brand}.',

  /* ---------------- Confirmations ---------------- */
  confirmRestoreTitle: 'Roll back to this snapshot?',
  confirmRestoreBody: 'This puts your data back to how it was on {time}',
  confirmRestoreCount_one: '({count} item).',
  confirmRestoreCount_other: '({count} items).',
  confirmRestoreNote:
    'The current state is saved as a snapshot of its own first, so this rollback can itself be rolled back.',

  confirmPurgeTitle: 'Permanently delete this item?',
  confirmPurgeBody: 'Once deleted it cannot be recovered, and it will not stay in the recycle bin either.',

  confirmPurgeAllTitle_one: 'Permanently delete the {count} item in the recycle bin?',
  confirmPurgeAllTitle_other: 'Permanently delete all {count} items in the recycle bin?',
  confirmPurgeAllLabel: 'Delete all',
  confirmPurgeAllBody:
    'Once deleted it cannot be recovered. If you want a record of what you threw away, export a JSON backup first.',
  recycleClearedToast: 'Recycle bin cleared',

  confirmResetSeedTitle: 'Reset to the initial state?',
  confirmResetSeedLabel: 'Yes, reset',
  confirmResetSeedBody_one:
    'This clears the {count} item you have now, and resets your categories, places and fields to the original set. A snapshot is saved first.',
  confirmResetSeedBody_other:
    'This clears the {count} items you have now, and resets your categories, places and fields to the original set. A snapshot is saved first.',

  confirmClearAllTitle: 'Erase all data?',
  confirmClearAllLabel: 'Yes, erase everything',
  confirmClearAllBody_one: 'This deletes the {count} item you have, along with every place, category, field and tag.',
  confirmClearAllBody_other: 'This deletes all {count} items, along with every place, category, field and tag.',
  confirmClearAllNote1: 'A snapshot is saved first, but that snapshot lives in this browser as well.',
  confirmClearAllNoteStrong: 'It is strongly recommended that you export a JSON backup before doing this.',
}
