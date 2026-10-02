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

    duplicateId: 'Duplicate {kind} id found; the later one was ignored',
    danglingLocation_one: '{count} item pointed to a place that does not exist; set to "No place"',
    danglingLocation_other:
      '{count} items pointed to a place that does not exist; set to "No place"',
    danglingCategory_one: '{count} stale category reference removed',
    danglingCategory_other: '{count} stale category references removed',
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
    snapshotRestored: 'Rolled back to the snapshot you picked',
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
