/**
 * The AI assistant: key panel, chat panel, draft preview, and the accept flow.
 *
 * This is the wordiest area of the app — the storage-risk disclosure in
 * particular. It is split into fragments because the <strong> emphasis in the
 * original is deliberate, not decoration: keep it, and do not soften what it
 * says in order to make the copy read more nicely.
 *
 * The three starters are **example sentences**, not interface labels: they
 * should read like something an English speaker would actually type into the
 * box. Losing a word-for-word match with the Chinese is fine; sounding like a
 * translation is not.
 */
export const ai = {
  /* ---- API key panel ---- */
  keyLabel: 'DeepSeek API Key',
  keyPlaceholder: 'sk-…',
  keyFilledBefore: 'API key is set (',
  keyFilledAfter: '). It is ',
  keyStoredBold: 'saved in this browser on this device',
  keyFilledTail: ', and it stays after a refresh or a restart.',
  keyStoredScope:
    'It is not part of exported backups and not in the local database. To get rid of it completely, click Clear on the right.',
  keyClearTitle: 'Delete this key from this browser',
  keyClearConfirmTitle: 'Clear the key saved on this device?',
  keyClearConfirmBody: 'The key is deleted from this browser.',
  keyClearConfirmNote:
    'Your entries are untouched, and it does not affect your DeepSeek billing — you will just have to paste it in again the next time you use the AI features.',
  keyClearedToast: 'API key cleared from this device',
  keySavedToast: 'Key saved on this device',

  keyStorageLead: 'The key is ',
  keyStoredInBold: 'saved in this browser on this device',
  keyStorageTail:
    ' — it survives a refresh or a restart, and you can clear it from this page at any time. It is ',
  keyNeverBold: 'not',
  keyStorageEnd: ' written into exported backups, and not into the local database.',

  directLead: 'Requests go from your browser ',
  directBold: 'straight to api.deepseek.com',
  directTail: ', through no third-party server (verified with real requests — see ',
  probeScript: 'scripts/probe-deepseek-cors.mjs',
  directEnd: ' in this repo).',

  costBold: 'But storing it does cost you, and you should know:',
  riskCode:
    '① Any code that can run JS in your browser (a malicious extension, XSS on another page) could in theory read it.',
  riskDomainLead: '② ',
  riskDomainCode: '<username>.github.io',
  riskDomainMid: ' is ',
  riskDomainBold: 'one shared domain for all your repositories',
  riskDomainTail:
    ' — if you deploy another project under the same account, that project’s pages can read it too.',
  keyAdviceLead: 'So create a key used only here at',
  keyAdviceTail: 'and you can revoke it whenever you want.',

  /* ---- Chat panel ---- */
  panelTitle: 'Talk it over with the AI',
  usageTitle: 'Last turn / this conversation',
  usageLine: 'Last {last} · total {total}',
  newChat: 'New chat',
  newChatTitle: 'Clear the chat and the drafts and start over',

  /*
   * Shown when the data is replaced wholesale (cleared / overwritten by an
   * import / rolled back): the unaccepted drafts must be voided, because every
   * draft references items, categories and places from the old data, so those
   * references no longer line up and accepting would silently apply only part
   * of the plan. Voiding silently is not an option either.
   */
  sessionClearedByDataReset:
    'Your data was replaced, so the previous conversation and its unaccepted drafts have been voided — the drafts referenced items, categories and places from the old data, and those no longer line up.',

  emptyNewBold: 'To add new things',
  emptyNewTail: ': write them here and it splits them into individual items.',
  emptyEditBold: 'To change existing ones',
  emptyEditTail:
    ': just say so — for example “move the medicine under Medicine / Supplements” — and it finds the items you already have and puts them on the right.',

  /** One click fills the whole thing into the box. The first line is what the button shows, so it has to stand on its own. */
  starter1:
    'Log this for me:\n\nA grey wool sweater and two pairs of jeans in the wardrobe, and an old phone on the bedside table.',
  starter2: 'File the uncategorised items into categories, making new ones where needed',
  starter3: 'Go through all my items and fix any categories or places that look wrong',

  thinking: 'Thinking…',
  placeholderEmpty: 'Write what you want to record, or what to change…',
  placeholderWithDraft:
    'Keep going ({count} drafts on the right). Enter sends, Shift+Enter makes a new line',
  send: 'Send',

  resetTitle: 'Start a new conversation?',
  resetConfirm: 'Start a new one',
  resetCancel: 'Keep this one',
  resetHasDraftsLead: 'All ',
  resetHasDraftsMid: ' drafts in the current list get thrown away — they have ',
  resetNotSavedBold: 'not been written to the database',
  resetHasDraftsTail: ' yet, so they really are gone.',
  resetKeepHint: 'To keep them, accept them first and then start a new chat.',
  resetBenefit:
    'Why start fresh: the history is cleared, so each round has less to re-send — and that costs fewer tokens.',
  resetEmptyBody: 'This clears the current conversation and starts over.',

  /* ---- Draft preview ---- */
  foundLead: 'Found ',
  foundMid: ' items, ',
  foundTail: ' selected',
  adoptAllNewCategories: 'Adopt all new categories',
  adoptAllNewLocations: 'Adopt all new places',
  suggestCategoriesLead: 'The AI suggests ',
  suggestCategoriesMid: ' new categories: ',
  suggestNotCheckedLead: 'None are ticked ',
  suggestNotCheckedBold: 'by default',
  suggestCategoriesTail:
    ' — they are only created if you tick them. Skip them and the items that use them land in “Uncategorized”; you can file them yourself later.',
  adoptAll: 'Adopt all',
  listSeparator: ', ',

  rowIncludeAria: 'Include “{name}”',
  existingBadge: 'Existing',
  existingBadgeTitle: 'This row comes from your database — accepting updates it',
  fieldNameAria: 'Item name',
  fieldQuantityAria: 'Quantity',
  fieldLocation: 'Place',
  newLocationToggleTitle: 'Click to toggle whether this place gets created',
  willCreate: 'Will create',
  newPlace: 'New place',
  labelColon: ': ',
  fieldCategories: 'Categories',
  newCategoryToggleTitle:
    'This is a new category suggested by the AI. Click to toggle whether it gets created',
  fieldNote: 'Notes',
  fieldStatus: 'Status',
  fieldCollections: 'Collections',
  droppedAttrsLead: 'The AI also mentioned ',
  droppedAttrsTail:
    ' — but your field library has no such fields, so they were ignored. (To record them, define them on the Fields page first.)',
  droppedCollectionsLead: 'The AI also mentioned the collection ',
  droppedCollectionsTail:
    ' — but you do not have it, so it was ignored. (Collections can only be made by you; create it on the Collections page and try again.)',

  /* ---- The page itself ---- */
  subtitle:
    'Write what you want to record, or say what to change — it finds the relevant items itself and shows you the result before anything is saved',
  needKey: 'Add your DeepSeek API key first',
  noReplyNote: '(no explanation this round)',
  needToSeeItems: 'I need to look at your existing items first',
  loadedIntoDrafts_one:
    'Pulled {count} existing item into the drafts — accepting updates it instead of creating it',
  loadedIntoDrafts_other:
    'Pulled {count} existing items into the drafts — accepting updates them instead of creating them',
  noMatchingItems: 'No items matched',
  continueAfterLoad: '(those items are in the drafts now — please carry on with my instruction)',
  noDraftChangesMeta: 'This one changed nothing in the drafts',

  metaAdded: '{count} added',
  metaUpdated: '{count} changed',
  metaDiscarded: '{count} moved to trash',
  metaNoChanges: 'no changes',
  metaUnchanged: '{count} others untouched',
  metaUnknownIds: '{count} unknown ids ignored',

  nothingToApply: 'Nothing to write',
  resultUpdated: '{count} updated',
  resultAdded: '{count} added',
  resultDiscarded: '{count} moved to trash',
  resultNewCategories: '{count} categories created',
  resultNewLocations: '{count} places created',
  appliedPrefix: 'Done: ',
  noChangesToast: 'No changes',

  draftEmptyTitle: 'Anything to be changed shows up here',
  draftEmptyLead: 'Tell the AI on the left what you want to do. Either works:',
  draftEmptyNewBold: 'Add new items',
  draftEmptyNewTail: ': paste a paragraph into the chat box and it splits it into individual items',
  draftEmptyEditBold: 'Change existing ones',
  draftEmptyEditTail:
    ': just say it — e.g. “move the medicine under Medicine / Supplements” — and it finds the items you already have and pulls them in here',
  draftEmptyFoot: 'Either way, nothing reaches the database until you click “Accept”.',

  summaryLead: '',
  summaryMid: ' drafts',
  summaryExistingLead: ' (',
  summaryExistingMid: ' from your database — accepting ',
  summaryExistingBold: 'updates',
  summaryExistingTail: ' them rather than creating new ones)',
  summaryJoinExisting: ', ',
  summaryJoinFresh: ' (',
  summaryNewTail: ' newly captured and created on accept',
  summaryCloseParen: ')',
  summaryChangedHint: '· Bold ones changed this round',
  clearHighlight: 'Clear highlight',

  accept: 'Accept',
  acceptUpdating: ' · update {count}',
  acceptCreating: ' · create {count}',
  acceptDiscarding: ' · delete {count}',
  acceptNothing: ' (no changes)',
  discardAll: 'Discard all',

  footerSelectedLead: '',
  footerSelectedTail: ' selected.',
  footerUntouchedLead: 'Another ',
  footerUntouchedTail:
    ' you did not change are skipped on accept — their modified time is not bumped.',
  footerSubmitLead:
    'Nothing is written to the database until you click “Accept”. Existing items you delete go to the ',
  footerTrashBold: 'trash',
  footerSubmitTail: ' and can be restored.',
}
