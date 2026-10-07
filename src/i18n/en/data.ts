/**
 * Data layer: import validation, merge report, local storage, snapshots,
 * and the AI client's error mapping.
 *
 * Translation notes (same rules as the rest of the dictionary):
 *   · These are the messages a user sees when something breaks, so the
 *     actionable hint always stays — say what to do next, never just "failed".
 *   · Plain and direct, no blame.
 *   · Same placeholder names as the Chinese side: the message is built at
 *     call time with `t(key, { ... })`.
 */
export const data = {
  /* Nouns spliced into sentences. Validation and the merge report share them */
  kind: {
    item: 'item',
    location: 'place',
    category: 'category',
    attribute: 'attribute',
    collection: 'collection',
    checklist: 'list',
  },

  /* ---------------- Import file validation ---------------- */
  validate: {
    /* Per-record notes: salvage what we can, and say which one failed and why */
    itemNotObject: 'Item #{index} is not a valid object; skipped',
    itemNoName: 'Item #{index} has no name; skipped',
    itemNoId: 'Item "{name}" is missing its id; skipped',
    locationNoIdOrName: 'A place is missing its id or name; skipped',
    categoryNoIdOrName: 'A category is missing its id or name; skipped',
    attributeNoIdOrName: 'An attribute is missing its id or name; skipped',
    collectionNotObject: 'A collection is not a valid object; skipped',
    collectionNoName: 'A collection has no name; skipped',
    collectionNoId: 'Collection "{name}" is missing its id; skipped',
    checklistNotObject: 'A list is not a valid object; skipped',
    checklistNoIdOrName: 'A list is missing its id or name; skipped',
    checklistEntrySkipped: 'Entry #{index} of list "{name}" has no name; skipped',

    duplicateId: 'Duplicate {kind} id found; the later one was ignored',
    danglingLocation_one: '{count} item pointed to a place that does not exist; set to "No place"',
    danglingLocation_other:
      '{count} items pointed to a place that does not exist; set to "No place"',
    danglingCategory_one: '{count} stale category reference removed',
    danglingCategory_other: '{count} stale category references removed',
    danglingCollection_one: '{count} stale collection reference removed',
    danglingCollection_other: '{count} stale collection references removed',
    locationParentMissing:
      '"{name}" had a parent place that does not exist; moved to the top level',
    categoryParentMissing:
      '"{name}" had a parent category that does not exist; moved to the top level',

    /* The whole file cannot be read: say what is wrong and what to do next */
    fileEmpty: 'The file is empty.',
    fileNotJson: 'This file is not valid JSON. It may be damaged, or not an export file at all.',
    fileNotObject: 'Unexpected file structure: the top level should be an object.',
    fileNotOurs: 'This is not a 断舍离 backup file (missing the format: "{appId}" marker).',
    fileNoSchemaVersion: 'The backup file has no valid schemaVersion field.',
    fileNewerSchema:
      'This backup comes from a newer version (data structure v{version}); ' +
      'this app only supports up to v{supported}. Update the app before importing.',
    fileNoData: 'The backup file has no data field, or data is not an object.',
    fileNoCollections: 'No items / locations / categories data found in the backup file.',
  },

  /* ---------------- Merge report ---------------- */
  importReport: {
    /* The name path is printed as-is so the user can tell which node was created */
    autoCreated: 'Created missing {kind}: {path}',
    lostLocation_one: 'Could not resolve the place for {count} item; set to "No place"',
    lostLocation_other: 'Could not resolve the place for {count} items; set to "No place"',
  },

  /* ---------------- Local storage ---------------- */
  storage: {
    noIndexedDb:
      'This browser does not support IndexedDB, so data cannot be saved. ' +
      'Please use normal (non-private) mode in Chrome / Edge / Safari / Firefox.',
    openFailed: 'Could not open the local database',
    openError: 'Failed to open the local database',
    blocked:
      'The local database is in use by another tab. Close the other tabs of this site and reload',
    transactionAborted: 'The database transaction was aborted',
    cloudNotReady: 'Cloud storage is coming in a later version; use local storage for now.',
    saveFailed: 'Could not save locally: {message}',
    /*
     * The banner that STAYS on screen after a failed write.
     *
     * How it differs from the toast above: the toast disappears, the banner
     * does not. "This change was not saved" must not be forgotten three
     * seconds later, because what you see on screen looks perfectly fine.
     */
    saveFailedBanner:
      'This change could not be saved locally: {message}. The usual cause is the browser closing the database connection (another tab, cleared site data, or storage being reclaimed). What you see is still in memory, but a refresh will lose it — hit "Try saving again".',
    saveFailedRetry: 'Try saving again',
    saveFailedExport: 'Export a backup first',
    saveRetryOk: 'Saved',
    fileReadFailed: 'Could not read the file',
  },

  /* ---------------- Moving and deleting tree nodes ---------------- */
  /*
   * These results get surfaced as toasts, so they have to say *why* it failed.
   * `{kind}` is supplied by the caller: the same check serves both places and
   * categories, and only the caller knows which word is right
   * (`lib/tree.ts` returns a bare code, not a sentence).
   */
  tree: {
    moveBlockedSelf: 'You cannot move it inside itself',
    moveBlockedMissing: 'That {kind} does not exist',
    moveBlockedDescendant: 'You cannot move it inside one of its own children',
    moveFailed: 'Could not move it',
    deleteMissing: 'That {kind} does not exist',
    deleteFailed: 'Could not delete it',
    deleteBlockedDescendant: 'You cannot move things into the {kind} being deleted',
    deleteHasChildrenAndItems:
      'That {kind} holds {children} sub-{kind} and {items} items',
    deleteHasChildren: 'That {kind} holds {children} sub-{kind}',
    deleteHasItems: 'That {kind} holds {items} items',
  },

  /* ---------------- Toasts raised from the store ---------------- */
  store: {
    scaffoldRestored: 'Restored the starting categories, places and fields (your items were cleared)',
    allCleared: 'All data cleared (you can roll back from a snapshot)',
    manualSnapshotCreated: 'Saved a manual backup snapshot',
    snapshotNotFound: 'That snapshot is not there',
    /*
     * Shown after silently restoring from a snapshot on startup.
     * The user used to see "my things are gone"; now they see "we noticed and put them back".
     */
    restoredFromSnapshot:
      'On opening, your local data had {missing} fewer items than the last snapshot (most likely the page was closed before a save finished). It has been restored from that snapshot — you now have {count} items; please check them over.',
    snapshotRestored: 'Rolled back to the snapshot you picked ({count} items)',
    /*
     * A rollback CHANGES the item count, so say so up front — the moment it drops
     * is exactly when people panic.
     */
    snapshotRestoredMore: 'Rolled back: items went from {before} to {after} — {delta} more',
    snapshotRestoredFewer:
      'Rolled back: items went from {before} to {after} — {delta} fewer. What disappeared is still in the previous snapshot, so you can roll back again.',
  },

  /* ---------------- Snapshots ---------------- */
  snapshot: {
    reasonAuto: 'Auto',
    reasonImport: 'Before import',
    reasonManual: 'Manual backup',
    reasonDestructive: 'Before delete',
  },

  /* ---------------- Export ---------------- */
  export: {
    /* ASCII file names: a Chinese name gets mangled once it travels through
       email attachments or zip archives, and the brand is the only thing lost */
    csvFilename: 'duansheli-items-{stamp}.csv',
    jsonFilename: 'duansheli-backup-{stamp}.json',
    generator: '断舍离 v{version}',

    /* The CSV header is read in a spreadsheet — keep each column to one obvious word */
    csvName: 'Name',
    csvQuantity: 'Quantity',
    csvStatus: 'Status',
    csvExpiry: 'Expires',
    csvCategories: 'Categories',
    csvLocation: 'Place',
    csvTags: 'Tags',
    csvNote: 'Note',
    csvCreatedAt: 'Created',
    csvUpdatedAt: 'Last updated',
  },

  /* ---------------- Recovering from a CSV item list ---------------- */
  /*
   * CSV was meant to be view-only. Now that it can be recovered from,
   * this copy has an extra duty: **it must say what cannot come back.**
   * Looking like a complete restore is far more dangerous than admitting
   * it is partial.
   */
  csv: {
    empty: 'This file has no rows at all.',
    noNameColumn: 'Could not find a "Name" column — this does not look like an item list exported from here.',
    noItems: 'No items could be read (every row was missing a name).',

    warnNotABackup:
      'This was recovered from a CSV list, not from a real backup. Everything that could be saved is here, but the items below cannot be recovered.',
    warnCollections:
      'Collection membership (Trip / Course / …) cannot be recovered — the CSV has no such column.',
    warnLists: 'Lists cannot be recovered — the CSV has no such column.',
    warnCategoryTree:
      'The category hierarchy cannot be recovered: the CSV only stored category names, so the parent/child structure was lost when it was exported. They are all top-level categories now; tidy them up on the Categories page if you want.',
    warnAttrTypes:
      'Field types cannot be recovered: everything is created as plain text, and units are taken from the parentheses in the header. Change them on the Fields page if needed.',
    warnSkipped_one: '{count} row had no name and was skipped.',
    warnSkipped_other: '{count} rows had no name and were skipped.',
  },

  /* ---------------- AI client error mapping ---------------- */
  ai: {
    noKey: 'No DeepSeek API Key yet.',
    auth: 'The API Key is not valid. Check that you copied it in full (it usually starts with sk-) and that it has not expired.',
    balance: 'Not enough account balance. Top up on the DeepSeek platform and try again.',
    badRequest: 'The request was malformed, so DeepSeek rejected this call.',
    badParams: 'The request parameters were not accepted.',
    rateLimit: 'Too many requests, or the rate limit was reached. Wait a moment and try again.',
    server: 'The DeepSeek server is having trouble right now. Try again later.',
    unexpectedStatus: 'DeepSeek returned an unexpected status code {status}.',
    notJson: 'What DeepSeek returned is not valid JSON. The network may have intercepted it.',
    emptyContent:
      'DeepSeek returned no content this time (a known occasional glitch). Tap it again — that usually fixes it.',
    aborted: 'Cancelled.',
    network:
      'Could not reach DeepSeek. Check your network; if you run an ad blocker, it may be blocking this request.',

    /* A reply arrived but its shape is wrong. These are the parser's verdicts,
       so each one carries the start of the raw text to make it diagnosable. */
    emptyResponse: 'DeepSeek returned an empty response.',
    noJsonFound: 'No JSON could be found in the AI reply. It started with: {snippet}',
    noItemList:
      'The AI reply contained no item list. It may be that this text has no recognisable items in it.',
    badShape: 'The AI reply is not in the expected shape.',
    noReplyOrItems: 'The AI reply contained neither an explanation nor an item list.',
  },
}
