/** Idle page: the list, the bulk actions, and those "handled" toasts. */

export const idle = {
  /* Header */
  subtitleEmpty: 'Anything you mark as idle collects here',
  /* Now that the list is grouped, "longest first" is a rule *inside* each group */
  subtitle:
    'Grouped by category; inside each group the longest-idle items come first — whatever most needs dealing with floats to the top',

  /* Nothing idle at all */
  emptyTitle: 'Nothing is idle',
  emptyHintFirst: 'Nothing is sitting idle right now — clean.',
  emptyHintSecond:
    'When something goes untouched for a while, hit "Idle" in the item list and it shows up here.',
  emptyAction: 'Go to items',

  /* Highlight block */
  highlightLabel: 'idle',
  share: 'That is {percent}% of everything you own.',
  shareOldest: 'That is {percent}% of everything you own — the oldest has sat idle for {days}.',
  hint: 'Go through them and hit "Handled" on anything you can let go.',

  /* Selection and bulk actions */
  selectAll: 'Select all {count}',
  selectedCount: '{count} selected',
  markActive: 'Mark in use',
  discard: 'Handled (discard)',
  discardTitle: 'Handled — move to discarded',

  /* Toasts */
  markedActiveToast: 'Moved {count} back to "in use"',
  discardedToast: 'Moved to "discarded" — you can restore it in Settings',
  handledToast: '{count} handled — the idle list is a little shorter',
  /* The line next to the picker title, saying what is on offer */
  discardPickerHint_one: '(candidates: the {count} idle item on this page)',
  discardPickerHint_other: '(candidates: the {count} idle items on this page)',

  /* Confirmation dialog */
  confirmTitle: 'Mark as handled?',
  confirmLabel: 'Handled',
  confirmBodyFirst: 'This marks the selected {count} items as "discarded".',
  confirmBodySecond:
    'The records stay — you can restore them under Settings → Discarded recycle bin.',
}
