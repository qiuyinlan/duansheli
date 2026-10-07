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
  noMatchingItems:
    'No items matched. If it really is in your database, rephrase (its name works best) and let it look again — do not create it directly.',
  continueAfterLoad:
    '(Those items are in the drafts now — please carry on with my instruction. Note: they are existing drafts, so update them instead of creating new ones.)',
  noDraftChangesMeta: 'This one changed nothing in the drafts',
  sourceMissing_one:
    '{count} draft pointed at an item that no longer exists (deleted, or already accepted) — it has been turned back into a new item, so check that it is what you want.',
  sourceMissing_other:
    '{count} drafts pointed at items that no longer exist (deleted, or already accepted) — they have been turned back into new items, so check that they are what you want.',

  /* ---- Choosing what to discard ---- */
  discardPicker: {
    title: 'Choose what goes to the trash',
    lead: 'Tick the items to move to the trash — with nothing ticked, nothing is deleted.',
    selectAll: 'Select all {count}',
    confirm_one: 'Move to trash ({count})',
    confirm_other: 'Move to trash ({count})',
    nonePicked: 'Tick something first',
    empty: 'There is nothing to discard.',
    trashNote_one: '{count} item will move to the trash — the record itself stays.',
    trashNote_other: '{count} items will move to the trash — the records themselves stay.',
    whereToRestore: 'You can restore them later under Settings → Discarded recycle bin.',
    doneToast_one: 'Moved {count} item to the trash — restorable in Settings',
    doneToast_other: 'Moved {count} items to the trash — restorable in Settings',
  },

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
  /*
   * Deletions requested for items that are no longer in the database.
   * The last line of defence against "it said it did it, it did not, and it never said so":
   * these used to be skipped silently while the toast still claimed "13 moved to trash".
   */
  resultMissingDiscards_one:
    '{count} item marked for deletion is no longer in your database (already deleted?) — nothing was done twice',
  resultMissingDiscards_other:
    '{count} items marked for deletion are no longer in your database (already deleted?) — nothing was done twice',
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

  /*
   * Showing only what changed.
   *
   * The user's case: they had the AI pull in 189 existing items to check them and it
   * changed 3 — the untouched 186 buried the three that matter.
   */
  showUnchanged: 'Show the {count} unchanged',
  showOnlyChanged: 'Only changed',
  noChangesInDraftsTitle: 'Nothing changed this round',
  noChangesInDraftsHint_one: 'All {count} pulled-in item stayed as it was — so there is no list here.',
  noChangesInDraftsHint_other:
    'All {count} pulled-in items stayed as they were — so there is no list here.',

  /*
   * Name collisions with items already in the database.
   *
   * The program deliberately has no default here: guessing "create" is the reported bug
   * ("I already own it and it made a second one"), and guessing "update" is worse —
   * it changes something the user never asked to change.
   */
  dedupeLead: '',
  dedupeTail:
    ' draft names match something you already own. Confirm what each one means first:',
  dedupeExisting: 'you already have this (at {location})',
  dedupeUpdate: 'That is it — update it',
  dedupeCreate: 'Not it — create a new one',
  acceptWaitingDedupe: ' · {count} awaiting your call',
  needDedupeChoice: '{count} name matches are still unconfirmed — pick one above before accepting',

  /*
   * What is about to be deleted, listed on its own.
   * Those entries have already left the draft list, so without this the user cannot
   * see what they are about to lose before clicking Accept.
   */
  willDiscardLead_one: 'This {count} item will move to the trash:',
  willDiscardLead_other: 'These {count} items will move to the trash:',
  willDiscardTail:
    '(they do not really disappear — restore them under Settings → Discarded recycle bin)',

  /* Items from the previous accepted batch — prepended to the next instruction */
  appliedContext: '(The previous batch has been accepted and saved: {names}. They are existing items now.)\n',

  /* ---- The AI organising categories ---- */
  catLead: 'The AI wants to make ',
  catLeadTail: ' change(s) to your categories (untick any you do not want):',
  catProblemsLead: 'Of these, ',
  catProblemsBold: 'cannot be done',  catProblemsTail:
    ' — those entries will NOT be applied, and they will not be silently dropped either. Consider asking it to rephrase. For example, a category cannot be moved inside itself or one of its own subcategories: that would make the whole subtree disappear from the interface.',

  catIncludeAria: 'Apply the “{name}” entry',

  catKindCreate: 'New',
  /* A new category has no "from" — the logic layer only reports isNew; wording lives here */
  catFromNew: '(new category)',
  catKindRename: 'Rename',
  catKindMove: 'Move',
  catKindDelete: 'Delete',

  catNoteNoop: 'already like this — nothing to change',
  catNoteMissing: 'no such category (wrong name, or it has been changed already)',
  catNoteDuplicate: 'a category of that name already exists at the same level',
  catNoteCycle: 'cannot move a category inside itself or its own subcategory',

  catDeleteChildren_one: '{count} subcategory will move up one level',
  catDeleteChildren_other: '{count} subcategories will move up one level',
  catDeleteItems_one: '{count} item will lose this category',
  catDeleteItems_other: '{count} items will lose this category',
  /* The user's biggest fear is "will deleting this delete my things too" — so say it outright */
  catDeleteNothingLost: ' (not a single item is deleted)',

  catWillApply_one: '{count} category change will be applied',
  catWillApply_other: '{count} category changes will be applied',
  catNothingApply: 'No applicable category changes',

  /*
   * The AI said it would change categories, but none of its entries could be read.
   * This line exists purely so that never happens silently — before, the AI claimed
   * "renamed X to Y" while the interface said "no changes", and the two just
   * mistrusted each other.
   */
  categoryChangesUnread:
    'The AI said it would change categories this round ({count} of them), but I could not read its format, so nothing was applied. Rephrasing usually fixes it.',

  catAccept: 'Accept category changes',
  catDone: 'Done: ',
  catResultCreated_one: '{count} category created',
  catResultCreated_other: '{count} categories created',
  catResultRenamed_one: '{count} renamed',
  catResultRenamed_other: '{count} renamed',
  catResultMoved_one: '{count} moved',
  catResultMoved_other: '{count} moved',
  catResultDeleted_one: '{count} deleted',
  catResultDeleted_other: '{count} deleted',
  catResultNothing: 'No category changes were applied',

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
