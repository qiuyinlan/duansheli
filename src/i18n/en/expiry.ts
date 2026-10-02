/** Expiry: status words, the dedicated page, and the form section. */

export const expiry = {
  /* Four states. Used identically in badges, group headers, filters, stats */
  stateExpired: 'Expired',
  stateSoon: 'Within {days} days',
  stateOk: 'Not soon',
  stateNone: 'No expiry',

  /* Days left / overdue */
  dueToday: 'Expires today',
  dueTomorrow: 'Expires tomorrow',
  dueIn_one: 'Expires in {count} day',
  dueIn_other: 'Expires in {count} days',
  overdueBy_one: '{count} day overdue',
  overdueBy_other: '{count} days overdue',

  /* Page */
  subtitle: 'Sorted by expiry — the most urgent is on top',
  countExpired_one: '{count} item has expired',
  countExpired_other: '{count} items have expired',
  countSoon_one: '{count} item expires within {days} days',
  countSoon_other: '{count} items expire within {days} days',
  countNone: '{count} more have no expiry date',
  allClear: 'Nothing is expiring',
  allClearHint:
    'Add an expiry date to medicine, cosmetics, food and the like — they will show up here.',
  nothingSet: 'You have not set an expiry date on anything yet',
  nothingSetHint:
    'You can fill in "Expires" when editing an item. Everything that has one is listed here in order.',

  /* Group headings */
  groupExpired: 'Expired',
  groupSoon: 'Expiring soon',
  groupLater: 'Not soon',
  groupNone: 'No expiry date',

  /* Threshold setting */
  thresholdLabel: 'Count as "expiring soon" within',
  thresholdHint:
    'It varies a lot: milk is 3 days, cosmetics are six months. Set it for whatever you check most.',
  thresholdDays: '{count} days',
  showLaterLabel: 'Also list the ones that are not soon and have no date',

  /* Bulk actions */
  handleSelected: 'Marked {count} as handled',
  handledToast: '{count} handled — the expiry list is a little shorter',
  discardSelected: 'Discard {count}',
  discardedToast: 'Moved {count} to the recycle bin — you can still get them back',

  /* Form section */
  fieldLabel: 'Expires',
  fieldHint: 'Just the date. Expiring is only a reminder — it never changes your data by itself.',
  fieldClear: 'Clear expiry date',
  fieldPastWarning: 'That date is already in the past — fine if you mean it, just flagging it.',
  fieldQuickYear: 'In a year',
  fieldQuickHalfYear: 'In six months',
  fieldQuickMonth: 'In a month',
  fieldQuickWeek: 'In a week',

  /* Overview card */
  cardTitle: 'Expiring',
  cardExpired_one: '{count} item has expired',
  cardExpired_other: '{count} items have expired',
  cardSoon_one: '{count} item is expiring soon',
  cardSoon_other: '{count} items are expiring soon',
  cardEmpty: 'Nothing is expiring any time soon',
  cardAction: 'Take a look',

  /* Hints */
  needExpiryHint: 'Want to know what is about to expire? Give those items an expiry date.',
  sortLabel: 'By expiry',
  filterLabel: 'Expiry',
}