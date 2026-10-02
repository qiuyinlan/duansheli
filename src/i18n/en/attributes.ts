/**
 * The field library page — where you define which fields can be filled in.
 *
 * The type names come from `itemEdit` (the same words appear in the field
 * chooser on the item form, so they live in one place).
 *
 * Field names and option values are the user's own data and are never
 * translated, which is why none of them appear here.
 */
export const attributes = {
  /* The page title comes from nav.titleAttributes */
  subtitle:
    'Define which fields exist here, then tick the ones you need while entering an item — the rest stay out of the form.',
  newField: 'New field',
  titleEdit: 'Edit field',

  /* Empty state */
  emptyTitle: 'The field library is still empty',
  emptyHint1:
    'Define whatever you want to keep track of — brand, purchase date, price, colour, size and model are the usual ones.',
  emptyHint2: 'Once defined, tick it while entering an item and you can fill it in.',
  emptyAction: 'Create the first field',

  /* Meta line in the list */
  optionCount_one: '{count} option',
  optionCount_other: '{count} options',
  showByDefaultShort: 'ticked by default',
  usage_one: 'used on {count} item',
  usage_other: 'used on {count} items',

  /* Form */
  fieldName: 'Field name',
  namePlaceholder: 'e.g. Brand',
  fieldType: 'Type',
  typeOptText: 'Text — write anything',
  typeOptNumber: 'Number — can be compared',
  typeOptDate: 'Date',
  typeOptSelect: 'Select — pick from a fixed list',
  typeOptBool: 'Yes / no',
  fieldOptions: 'Options',
  optionsCommaHint: 'separate with commas',
  optionsPlaceholder: 'Black, white, grey, wood',
  fieldUnit: 'Unit',
  unitPlaceholder: 'e.g. USD, cm, kg',
  showByDefault: 'Tick this field by default when entering an item',
  formHint:
    'Tip: once you have ticked it for an item, the app remembers which fields that category usually uses and pre-selects them next time.',

  /* Messages */
  needOption: 'A select field needs at least one option',
  duplicate: 'There is already a field called “{name}”',
  addedToast: 'Field added',
  savedToast: 'Saved — values already on your items are kept',
  deletedToast: 'Field deleted',

  /* Delete confirmation. The number sits mid-sentence, so the sentence is
     split around it and each half carries its own plural form. */
  deleteTitle: 'Delete the field “{name}”?',
  deleteInUseLead: 'Used on ',
  deleteInUseTail_one: ' item.',
  deleteInUseTail_other: ' items.',
  deleteInUseNote:
    'Those values stop showing (the items themselves and everything else are untouched). A snapshot is saved first, so you can roll back later.',
  deleteUnused: 'No item has filled in this field yet, so it is safe to delete.',
}
