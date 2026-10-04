/**
 * Lists: the throwaway, tick-off kind.
 *
 * Division of labour with collections: a collection is the **template** you build
 * up over time; a list is **this occasion's instance** — you tick it off and
 * delete it. So the wording here keeps saying "temporary" and "fine to delete",
 * whereas the collections copy says "gather".
 */

export const checklists = {
  /* Page */
  subtitle: 'A throwaway to-do list — tick it off, then bin it',
  emptyTitle: 'No lists yet',
  emptyHint:
    'A list is temporary: gather what this occasion needs, tick things off as you go, delete it when done.',
  emptyHintSecond:
    'Two ways to make one: tick items in the item list, or pick a few inside a collection.',
  createFromItems: 'New list',
  createTitle: 'New list',
  namePlaceholder: 'e.g. Saturday camping, this week’s shopping',
  defaultName: 'New list',

  /* List */
  count_one: '{count} item',
  count_other: '{count} items',
  progress: '{done} of {total} ticked',
  allDone: 'All ticked',
  fromCollection: 'From "{name}"',
  open: 'Open',

  /* Detail */
  detailSubtitle: 'Tick things off as you go',
  emptyEntriesTitle: 'This list is empty',
  emptyEntriesHint: 'Add one below, or go tick a few items and make a list from them.',
  backToList: 'All lists',

  /* Ticking and editing */
  checkAria: 'Tick "{name}"',
  addEntry: 'Add one',
  addEntryPlaceholder: 'e.g. pick up a bottle of water',
  addEntryHint:
    'An entry does not have to be something in your library — things to buy or borrow can just be written in.',
  entryNamePlaceholder: 'Name',
  quantityAria: 'Quantity',
  removeEntry: 'Remove this entry',
  clearChecked: 'Clear the {count} ticked',
  clearCheckedToast: 'Cleared {count}',
  checkedSummary_one: '{count} ticked',
  checkedSummary_other: '{count} ticked',
  uncheckAll: 'Untick all',

  /* Name and deletion */
  renameTitle: 'Rename list',
  deleteTitle: 'Delete this list?',
  deleteBodyLead: 'A list is',
  deleteBodyStrong: 'temporary',
  deleteBodyTail:
    '— once deleted it is gone. Neither your collections nor your items are affected.',
  deleteToast: 'Deleted the list "{name}"',

  /* Toasts */
  createdToast: 'Made the list "{name}" with {count} entries',
  renamedToast: 'Renamed',
  entryAddedToast: 'Added',
  entryRemovedToast: 'Removed',

  /* What an item row says about the link back */
  itemGone: 'No longer in your library',
  goToItem: 'Open this item',
}
