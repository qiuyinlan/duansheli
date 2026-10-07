/**
 * The spare page: things you stocked up on and are holding for later.
 *
 * One rule for all of this copy: **never call a spare "idle".**
 * The Idle page is telling you "these should be dealt with"; a spare is
 * something you kept on purpose. The same sentence would be wrong on one of them.
 */

export const spare = {
  /* Page header */
  subtitle: 'Things you stocked up on — come here when you run out',
  subtitleEmpty: 'Spares you bought extra and set aside live here',

  /* The two numbers at the top */
  highlightKinds: 'kinds spare',
  highlightUnits: '{count} in total',
  hint:
    'Spares are not counted as idle — you kept them on purpose, so sitting there is fine. They stay out of the idle share, and nothing ever nags you about them.',

  /* Empty state */
  emptyTitle: 'Your spare area is empty',
  emptyHintFirst:
    'On the Items page, select something and hit "Mark as spare" to move the whole entry here;',
  emptyHintSecond:
    'for anything with a quantity above 1, "Split off spares" takes the extras out — the original stays where it was and the split-off part lands here.',
  emptyAction: 'Go to Items',

  /* Per row */
  takeOne: 'Take one',
  takeOneTitle:
    'Take one out to use: if there is stock left it just drops by one, and the last one turns the whole entry into "In use"',
  discardTitle: 'Discard this spare (goes to the recycle bin, recoverable)',
  spareCount_one: '{count} spare',
  spareCount_other: '{count} spares',

  /* Results of taking one — each branch says exactly what happened */
  tookOneToast_one: 'Took 1 — {count} left in the spare area',
  tookOneToast_other: 'Took 1 — {count} left in the spare area',
  tookLastToast: 'That was the last one, so this entry is now "In use"',
  tookNoneToast: 'This one is not a spare, so there is nothing to take',

  /* Batch */
  selectAll: 'Select all ({count} kinds)',
  selectedCount: '{count} kinds selected',
  takeAll: 'Move all to "In use"',
  takeAllTitle: 'Move the selected entries out of the spare area into "In use"',
  takeAllToast_one: '{count} entry moved to "In use"',
  takeAllToast_other: '{count} entries moved to "In use"',
  discardSelected: 'Discard',
  discardConfirmTitle: 'Discard these spares?',
  discardConfirmBody:
    'The {count} selected entries go to the recycle bin and can be restored at any time.',
  /* The line next to the picker title, saying what is on offer */
  discardPickerHint_one: '(candidates: the {count} spare on this page)',
  discardPickerHint_other: '(candidates: the {count} spares on this page)',
  discardDoneToast_one: '{count} discarded — restorable from the recycle bin',
  discardDoneToast_other: '{count} discarded — restorable from the recycle bin',

  /* Grouping */

  /* Splitting off spares */
  splitTitle: 'Split off spares',
  /* The middle clause is bolded, so it is split in three and wrapped in
     <strong> at the call site — t() knows nothing about markdown */
  splitDescBefore:
    'Take the extras out into their own spare entry in the spare area. The original',
  splitDescStrong: 'stays where it is',
  splitDescAfter: ', it just drops in quantity.',
  splitHowMany: 'How many to split off',
  splitAvailable: 'This entry has {count} in total, so at most {max} can be split off (at least 1 has to stay).',
  splitKeepAtLeast: 'At least 1 has to stay where it is',
  splitWhere: 'Where do the spares go',
  splitWhereHint:
    'Your choice is remembered and filled in next time — spares usually live in the same box.',
  splitConfirm: 'Split off {count}',
  splitToast_one: 'Split off {count} spare into "{where}"',
  splitToast_other: 'Split off {count} spares into "{where}"',
  splitToastNoWhere_one: 'Split off {count} spare (no place set)',
  splitToastNoWhere_other: 'Split off {count} spares (no place set)',

  /* Failure reasons */
  splitNotFound: 'That item could not be found — it may have been deleted',
  splitDiscarded: 'That one is discarded; restore it before splitting',
  splitTooFew:
    'This entry has only 1, so there are no extras to split off. To make the whole entry a spare, use "Mark as spare".',
  splitNoSpareToMake: 'Everything selected has a quantity of 1, so there is nothing to split off',
}
