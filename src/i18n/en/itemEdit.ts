/**
 * The item form (new / edit) plus the pickers it opens: place, categories,
 * the field chooser and the tag input.
 *
 * Shared verbs come from `common` (Save / Close / New / Required…) and the
 * expiry section from `expiry`, so the same words stay consistent with the
 * item rows and the dedicated pages.
 *
 * Category names, place names, tags and field names are the user's own data —
 * never translated, which is why none of them appear here.
 */
export const itemEdit = {
  /* Page title and subtitle */
  titleEdit: 'Edit item',
  subtitleEdit: 'Remember to save when you are done',
  subtitleNew: 'Only the name is required — fill in the rest whenever you like',
  discard: 'Discard',
  discardedToast: 'Moved to “{status}” — you can get it back in Settings',

  /* Item not found */
  notFoundTitle: 'Item not found',
  notFoundHint: 'It may have been deleted for good.',
  backToItems: 'Back to items',

  /* Name (the only required field) */
  fieldName: 'Name',
  namePlaceholder: 'Be specific — “grey wool sweater” rather than “sweater”',
  nameRequired: 'Give this item a name first',

  /* Place */
  fieldLocation: 'Place',
  locationPick: 'No place (tap to choose)',
  locationClear: 'Clear place',

  /* Categories */
  fieldCategories: 'Categories',
  categoriesChoose: 'Choose categories',
  categoriesChange: 'Change categories',
  categoriesHint: 'An item can belong to more than one category.',
  removeCategoryAria: 'Remove category {name}',

  /* Quantity and status */
  fieldQuantity: 'Quantity',
  fieldStatus: 'Status',
  /*
   * Status went from a two-way switch to three options: a switch can only say
   * "yes / no", and a spare is a *third branch*, not a kind of idle.
   */
  statusActive: 'In use',
  statusIdle: 'Idle',
  statusSpare: 'Spare',
  statusActiveHint: 'In use — the one you actually use day to day',
  statusIdleHint: 'Idle — it shows up on the Idle page, waiting to be dealt with',
  statusSpareHint: 'Spare — kept on purpose, filed on the Spares page, never nagged about',
  statusDiscardedHint:
    'This one is currently "Discarded". Restore it from the recycle bin on the Settings page.',

  /* More (tags, notes) */
  moreToggle: 'More (tags, collections, notes)',
  fieldTags: 'Tags',
  tagsHint:
    'Tags are for the situation, not the thing — “gift idea”, “hard to let go of”.',
  fieldCollections: 'In which collections',
  collectionsHint:
    'Trips, courses and the like. One item can be in several collections — tap to toggle.',
  collectionPlaceholder: 'Type a new collection name and press Enter',
  noCollectionsYet: 'No collections yet — type a name below to create one.',
  fieldNote: 'Notes',
  notePlaceholder: 'Anything worth writing down, e.g. “a gift from mum”, “leaks a little”',

  /* Fields (属性) */
  fieldAttributes: 'Fields',
  attributesHint: 'Add only the ones you need this time. Unchecked fields stay out of the form.',
  addAttributes: 'Add fields',
  attributesEmptyLibrary: 'The field library is still empty — define some on the Fields page.',
  attributesEmptySelected: 'No fields chosen yet.',
  removeAttrTitle: 'Stop filling in “{name}”',
  /** Unit after a field name. The leading space is deliberate: English needs it. */
  attrUnitParen: ' ({unit})',
  attrNotSet: 'Not set',

  /* Bottom buttons and shortcut */
  saveAndContinue: 'Save and add another',
  saveAndBack: 'Save and go back',
  ctrlEnterHint: 'Ctrl / ⌘ + Enter also saves and keeps adding',
  savedContinue: 'Saved — ready for the next one',

  /* Place picker */
  pickLocationTitle: 'Choose a place',
  pickLocationCurrent: 'Current: {path}',
  locationsEmpty: 'No places yet — you can create them on the Places page.',
  locationSearchPlaceholder: 'Search places, e.g. “wardrobe” or “top drawer”',
  locationSearchAria: 'Search places',
  locationSearchFound_one:
    '{count} matching place (the faded ones are the levels it sits under)',
  locationSearchFound_other:
    '{count} matching places (the faded ones are the levels they sit under)',
  locationSearchNone: 'No matching places. Try another word, or clear the search to see all.',

  /* Category picker */
  pickCategoryTitle: 'Choose categories',
  pickCategoryHint:
    'Tap a category name to toggle it; you can pick several. Categories are nested, and an item can sit at any level.',
  categoriesEmpty: 'No categories yet — create one below.',
  categorySearchPlaceholder: 'Search categories, e.g. “makeup” or “medicine”',
  categorySearchAria: 'Search categories',
  categorySearchFound_one:
    '{count} matching category (the faded ones are its upper levels — you can pick those too)',
  categorySearchFound_other:
    '{count} matching categories (the faded ones are their upper levels — you can pick those too)',
  categorySearchNone:
    'No matching categories. Clear the search to see all, or create one below.',
  newTopCategory: 'New top-level category',
  newCategoryPlaceholder: 'e.g. Cosmetics',
  duplicateCategory: 'There is already a top-level category called “{name}”',
  subCategoryHint:
    'For a subcategory (like “Cosmetics › Eye make-up”), use the Categories page — it allows any depth.',
  /** The counted confirm button both pickers share */
  pickConfirm: 'Confirm ({count} selected)',

  /* Tag input */
  removeTagAria: 'Remove tag {name}',
  tagPlaceholder: 'Type a tag and press Enter, e.g. gift idea',

  /* Field chooser */
  pickAttrTitle: 'Choose fields to fill in',
  attrPickerEmpty:
    'The field library is still empty. Define a few on the Fields page (brand, purchase date, price) and you can tick them per item.',
  attrPickerHint:
    'Tick only the ones you actually need this time. Unchecked fields take up no space in the form.',
  attrTypeSelect: 'Select',
  attrTypeBool: 'Yes/no',
  attrTypeDate: 'Date',
  attrTypeNumber: 'Number',
  attrTypeNumberUnit: 'Number ({unit})',
  attrTypeText: 'Text',
}
