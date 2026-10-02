/**
 * Places page: the unbounded tree plus the items in the selected place.
 *
 * "No place" is not here — that pseudo-group uses status.unassigned, so the
 * wording stays identical to item rows, filters and charts.
 */
export const locations = {
  /* Page header */
  subtitle_one: '{count} place — nest it as deep as you like',
  subtitle_other: '{count} places — nest them as deep as you like',
  newTop: 'New place',

  /* Empty state */
  empty: 'No places yet',
  emptyHint: 'A place can nest one level after another, for example:',
  emptyHintExample: 'Home › Bedroom › Wardrobe › Second drawer',
  createFirst: 'Create the first place',

  /* Actions on a tree node (the title doubles as the accessible name) */
  addChild: 'New sub-place',
  moveUnder: 'Move under another place',

  /* Right pane: the items in this place */
  countHere_one: '{count} item in total',
  countHere_other: '{count} items in total',
  /** NOTE: leading space — this is appended straight after the total above */
  directHere_one: ' ({count} of them right here)',
  directHere_other: ' ({count} of them right here)',
  includeDescendants: 'Include sub-places',
  markIdle: 'Mark idle',
  markActive: 'Mark in use',
  scopedEmpty: 'This place is empty',
  scopedEmptyHint: 'An empty place is a good sign — nothing has piled up here.',
  unassignedEmpty: 'No items without a place',
  unassignedEmptyHint: 'Every item already has a place of its own.',

  /* New / rename dialog */
  addTopTitle: 'New top-level place',
  addChildTitle: 'New place under “{name}”',
  renameTitle: 'Rename place',
  namePlaceholder: 'For example: Second drawer',

  /* Moving */
  moveDone: 'Place moved',
  moveFailed: 'Could not move it',

  /* Result of creating / renaming */
  addDone: 'Place created',
  addFailed: 'Could not create it — check the name',
  renameDone: 'Renamed',

  /* Deleting */
  deleteDone: 'Deleted the place “{name}”',
  deleteFailed: 'Could not delete it',
  deleteTitle: 'Delete the place “{name}”?',
  deleteConfirm: 'Move contents and delete',
  deleteBodyLead: 'This place still holds {list}.',
  deleteJoin: ' and ',
  deleteChildCount_one: '{count} sub-place',
  deleteChildCount_other: '{count} sub-places',
  deleteItemCount_one: '{count} item',
  deleteItemCount_other: '{count} items',
  deleteBodyHint:
    'If you continue they move to “{unassigned}” — nothing is lost, and you can give each of them a new place afterwards.',
  deleteMovedDone: 'Place deleted — its contents moved to “{unassigned}”',
}
