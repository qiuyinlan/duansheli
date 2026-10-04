/** Overview page: header, empty state, the big numbers, chart headings. */

export const overview = {
  /* Header */
  subtitleEmpty: 'Your belongings turn into a picture here',
  updatedAt: 'Last updated {time}',
  addItem: 'Add item',

  /* Guidance when nothing has been entered yet */
  emptyTitle: 'No items yet',
  emptyHintFirst: 'Add one to try it — a name is all it takes, everything else is optional.',
  emptyHintSecond:
    'Categories, locations and attributes already come with a starter set you can change any time.',
  /* For "my data disappeared": browser data is isolated per address, and this
     project has several addresses in use. Without this line, opening another
     address looks like data loss. */
  emptyOriginNote:
    'There really is nothing at this address. If you entered things at another address (localhost, a LAN IP and GitHub Pages are three separate stores), they live there and do not follow you — migrate with Settings → Export / Import.',
  emptyAction: 'Add your first item',

  /* Backup notice */
  backupNever:
    'Your data lives only in this browser and has never been exported. Clearing browser data wipes all of it.',
  backupStale: 'Last export was {time} — worth making a fresh one.',
  backupAction: 'Back up now',

  /* The big number and the four stat cards */
  heroLabel: 'items (discarded not counted)',
  statCategories: 'categories',
  statLocations: 'locations',
  statIdle: 'idle',
  statUnassigned: 'unassigned',
  statUnassignedTitle: 'Show items with no location',

  /* Idle share — the number this whole app is about */
  idleShare: 'Idle share',
  idleNone: 'Nothing is idle right now — every single thing is in use. Clean.',
  idleSome: '{count} items have gone idle. The longer it sits idle, the less it belongs here.',
  idleAction: 'Deal with it',

  /* Charts */
  byCategory: 'By category',
  byCategoryNote: 'Top-level categories only; an item counts once per top-level category',
  emptyCategories: 'No categories set up yet',
  byLocation: 'By location',
  byLocationNote: 'Only the first level here — open one to walk down',
  emptyLocations: 'No locations set up yet',
  byTag: 'By tag',
  byStatus: 'By status',
  byStatusNote: 'Discarded items keep their record — see them in Settings',
}
