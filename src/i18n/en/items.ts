/**
 * The items page (list, toolbar, groups, bulk actions, filter panel).
 *
 * Two things here look odd on purpose:
 *
 * 1. **A few strings are split into fragments** (headerTotal / headerBetween /
 *    headerAfter, confirmDiscardLine1 / Line2). The Chinese original wraps a
 *    count in `<span className="numeric">` and puts a `<br />` between two
 *    sentences — one key per sentence would mean dropping that markup.
 *
 * 2. Status words, expiry states and the "no value" pseudo-names
 *    (No place / Uncategorized / Untagged) reuse the existing status and
 *    expiry keys instead of being duplicated here.
 *
 * Kept short: the toolbar labels, the segmented group control and the filter
 * panel are tight, and English is roughly twice as wide as Chinese.
 */
export const items = {
  /* Page header and its actions */
  headerTotal: 'Total',
  headerBetween: 'items ·',
  headerAfter: 'shown',
  addItem: 'New item',
  aiEntry: 'Add with AI',

  /* Guiding the user when there is nothing at all */
  emptyTitle: 'No items yet',
  emptyHint: 'Start with the drawer you most want to sort out, one item at a time.',

  /* Toolbar */
  searchPlaceholder: 'Search names, notes, tags, field values…',
  searchAria: 'Search items',
  groupLabel: 'Group',
  groupCategory: 'Category',
  groupLocation: 'Place',
  groupTag: 'Tag',
  groupStatus: 'Status',
  groupNone: 'No group',
  sortLabel: 'Sort',
  sortAria: 'Sort by',
  sortUpdated: 'Updated',
  sortCreated: 'Added',
  sortName: 'Name',
  sortQuantity: 'Quantity',
  sortLocation: 'Place',
  sortAsc: 'Asc ↑',
  sortDesc: 'Desc ↓',
  sortAscTitle: 'Sorted ascending',
  sortDescTitle: 'Sorted descending',
  filter: 'Filter',
  filterWithCount: 'Filter ({count})',
  removeCondition: 'Remove this filter',
  clearAll: 'Clear all',

  /* Bulk action bar */
  selectedCount: '{count} selected',
  markIdleBatch: 'Mark idle',
  backToActive: 'Back to in use',
  moveLocation: 'Move',
  addTags: 'Add tags',
  discard: 'Discard',
  selectAllShown: 'Select all {count} shown',
  batchStatus_one: 'Marked {count} item as “{status}”',
  batchStatus_other: 'Marked {count} items as “{status}”',

  /* Actions on a single row */
  markIdle: 'Mark idle',
  discardTitle: 'Discard (you can get it back in Settings)',
  discardedToast: 'Moved to “Discarded” — you can get it back in Settings',

  /* Toasts for moving and tagging */
  movedToast_one: 'Moved {count} item to a new place',
  movedToast_other: 'Moved {count} items to a new place',
  addTagsTitle_one: 'Add tags to {count} item',
  addTagsTitle_other: 'Add tags to {count} items',
  taggedToast_one: 'Added {count} tag',
  taggedToast_other: 'Added {count} tags',

  /* Filtering left nothing */
  noMatch: 'No matching items',
  noMatchHint: 'Try loosening the filters, or search for something else.',
  clearFilters: 'Clear filters',

  /* Discard confirmation. Two lines because the original has a <br /> in between */
  confirmDiscardTitle: 'Discard these items?',
  confirmDiscardLine1: 'The {count} selected items will be marked as “Discarded”.',
  confirmDiscardLine2:
    'They are not really gone — find them again under “Settings → Discarded items”, or delete them for good.',

  /* Filter panel */
  notFiltered: 'Not filtered',
  resetAll: 'Reset all',
  apply: 'Apply',
  applyWithCount_one: 'Apply ({count} filter)',
  applyWithCount_other: 'Apply ({count} filters)',
  includeDescendants: 'Show items in sub-places too when a place is selected',
  clearLocationFilter: 'Clear place filter ({count})',
  noAttributes: 'No fields defined yet.',
  selectPlaceholder: 'Choose…',
  opNoValueHint: 'No value needed',
  attrOpAria: '{name} comparison',
  attrValueAria: '{name} value',

  /* Attribute operators */
  opContains: 'contains',
  opEquals: 'equals',
  opGreater: 'greater',
  opLess: 'less',
  opIsTrue: 'yes',
  opIsFalse: 'no',
  opHasValue: 'has value',
  opNoValue: 'no value',
}
