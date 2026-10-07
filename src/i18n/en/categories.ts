/**
 * Categories page: the unbounded tree plus the items in the selected category.
 *
 * Deliberately symmetric with the places page (add child / rename / move /
 * delete), so the key names line up and the two pages stay easy to compare.
 * "Uncategorized" comes from status.uncategorized, not from here.
 */
export const categories = {
  /* Page header */
  subtitle:
    'Categories answer “what is this”. They nest as deep as you like — e.g. Cosmetics › Eye makeup — and one item can belong to several of them at once.',
  newTop: 'New category',

  /* Search — same wording as the category picker in the item editor */
  searchPlaceholder: 'Search categories, e.g. “makeup” or “medicine”',
  searchAria: 'Search categories',
  searchFound_one:
    '{count} matching category (the faded ones are its upper levels — you can pick those too)',
  searchFound_other:
    '{count} matching categories (the faded ones are their upper levels — you can pick those too)',
  searchNone: 'No matching categories. Clear the search to see all.',

  /* Empty state */
  empty: 'No categories yet',
  emptyHint: 'A few top-level categories you actually use are enough, e.g. Clothes, Electronics, Household.',
  emptyHintSecond: 'You can add sub-categories under any of them later.',
  createFirst: 'Create the first category',

  /* Actions on a tree node (the title doubles as the accessible name) */
  addChild: 'New sub-category',
  moveUnder: 'Move under another category',

  /* Right pane: the items in this category */
  countHere_one: '{count} item in total',
  countHere_other: '{count} items in total',
  /** NOTE: leading space — this is appended straight after the total above */
  directHere_one: ' ({count} of them attached right here)',
  directHere_other: ' ({count} of them attached right here)',
  includeDescendants: 'Include sub-categories',
  filter: 'Filter',
  scopedEmpty: 'Nothing in this category yet',
  scopedEmptyHint: 'An empty category is fine — build the structure first, fill it in later.',
  allAssignedEmpty: 'Everything is categorized',
  allAssignedEmptyHint: 'Every single thing has found its place.',

  /* New / rename dialog */
  addTopTitle: 'New top-level category',
  addChildTitle: 'New sub-category under “{name}”',
  renameTitle: 'Rename category',
  namePlaceholder: 'For example: Eye makeup',

  /* Moving */
  moveTitle: 'Move category',
  moveToTop: 'Move to top level',
  moveHint: 'Pick a new parent category. Choose “{moveToTop}” to promote it to the top level.',
  moveHintSecond: '(Its own sub-categories come along.)',
  moveDone: 'Category moved',
  moveFailed: 'Could not move it',

  /* Result of creating / renaming */
  addDone: 'Category created',
  addDuplicate: 'A category with that name already exists at this level',
  renameDone: 'Renamed',

  /* Deleting */
  deleteDone: 'Deleted the category “{name}”',
  deleteFailed: 'Could not delete it',
  deleteTitle: 'Delete the category “{name}”?',
  deleteConfirm: 'Move to Uncategorized and delete',
  deleteBodyLead: 'This category still holds {list}.',
  deleteJoin: ' and ',
  deleteChildCount_one: '{count} sub-category',
  deleteChildCount_other: '{count} sub-categories',
  deleteItemCount_one: '{count} item',
  deleteItemCount_other: '{count} items',
  /* The middle sentence is bold in the UI, so it is split around <strong> */
  deleteBodyBefore: 'If you continue, ',
  deleteBodyStrong: 'sub-categories move to the top level',
  deleteBodyAfter:
    ', and the items attached directly here become “{uncategorized}” — nothing is lost, and items inside sub-categories are untouched. A snapshot is saved before the delete.',
  deleteMovedDone: 'Category deleted — everything has been rehomed',
}
