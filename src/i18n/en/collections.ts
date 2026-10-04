/**
 * Collections: "what do I need to gather in order to do this thing" —
 * travel, study, moving house.
 *
 * English naming note: 活动合集 is rendered as "collection" rather than
 * "activity". "Activity" reads as something you *do* (a calendar event);
 * what this feature holds is a set of things, so "collection" is the word
 * that matches what the user actually sees on the page.
 */

export const collections = {
  /* Page */
  subtitle: 'Gather the things you need for one particular occasion',
  emptyTitle: 'No collections yet',
  emptyHint:
    'What to pack for a trip, what to prepare for a course, what to move first — each can be a collection.',
  emptyHintSecond:
    'Create one, then tick items in the item list and choose "Add to collection".',
  createFirst: 'Create your first one',

  /* Create / rename */
  newPlaceholder: 'e.g. Trip, Course, Moving',
  create: 'New collection',
  createTitle: 'New collection',
  renameTitle: 'Rename collection',
  namePlaceholder: 'Collection name',
  noteLabel: 'Note',
  notePlaceholder: 'e.g. Three days, hiking',

  /* List */
  count_one: '{count} item',
  count_other: '{count} items',
  emptyBadge: 'empty',
  open: 'Open',

  /* Detail */
  detailSubtitle: 'The things this collection gathers',
  detailEmptyTitle: 'Nothing in this collection yet',
  detailEmptyHint:
    'Tick a few items in the item list and choose "Add to collection".',
  pickItems: 'Pick items',
  removeSelected: 'Remove {count}',
  removeOne: 'Remove',
  removeTitle: 'Remove from this collection?',
  removeBody:
    'This only takes them out of this collection. The items themselves stay right where they are.',
  backToList: 'All collections',

  /* Deleting a collection */
  deleteTitle: 'Delete this collection?',
  deleteBodyLead: 'This deletes',
  deleteBodyStrong: 'the collection itself',
  deleteBodyTail:
    '— not a single item in it. They simply stop belonging to this collection.',
  deleteToast: 'Deleted "{name}"; {count} items stayed where they were',

  /* Adding from the item list */
  addTitle: 'Add to collection',
  addHint:
    'Pick an existing collection, or type a new name. One item can belong to several collections at once.',
  addPickExisting: 'Existing collections',
  addOrNew: 'Or create a new one',
  addExisting: 'Add to this one',
  createAndAdd: 'Create and add',
  willAdd_one: 'The {count} you selected goes in',
  willAdd_other: 'The {count} you selected go in',
  addedToast: 'Added {count} to "{name}"',
  alreadyAll: 'All {count} are already in "{name}"',
  addPartial: 'Added {added} to "{name}"; {skipped} were already in it',

  /* Toasts */
  toastCreated: 'Created "{name}"',
  toastRenamed: 'Renamed',
  toastNoteSaved: 'Note saved',
  toastDuplicate: 'There is already a collection called "{name}"',
  belongToOne: 'In "{name}"',
}
