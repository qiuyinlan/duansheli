/**
 * The tag management page: list, rename, delete.
 *
 * Tag names are the user's own data and are never translated. The "3 items"
 * counts on the list come from `format.countItems`, so they stay consistent
 * with the rest of the app.
 */
export const tags = {
  /* The page title comes from nav.titleTags */
  subtitle: 'Tags describe the situation, not the thing — “Give away”, “Hard to let go”, “Needs repair”.',
  addPlaceholder: 'Add a tag',
  addHint: 'You can also create a tag on the fly while entering an item — no need to come here first.',

  /* Empty state */
  emptyTitle: 'No tags yet',
  emptyHint: 'Tags are optional — you can do fine without them.',

  view: 'View',
  renameTitle: 'Rename tag',

  /* Messages */
  addToast: 'Tag added',
  renamedToast: 'Renamed',
  deletedToast: 'Tag deleted',

  /* Delete confirmation. The number sits mid-sentence, so the sentence is
     split around it and each half carries its own plural form. */
  deleteTitle: 'Delete the tag “{name}”?',
  deleteInUseLead: 'Used on ',
  deleteInUseTail_one: ' item.',
  deleteInUseTail_other: ' items.',
  deleteInUseNote: 'The tag is removed from them; the items themselves stay.',
  deleteUnused: 'No item uses this tag yet.',
}
