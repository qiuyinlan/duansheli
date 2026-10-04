/** Shared buttons, units, confirmations, toasts. */

export const common = {
  /* Buttons */
  save: 'Save',
  cancel: 'Cancel',
  confirm: 'Confirm',
  delete: 'Delete',
  edit: 'Edit',
  close: 'Close',
  back: 'Back',
  add: 'Add',
  remove: 'Remove',
  search: 'Search',
  clear: 'Clear',
  reset: 'Reset',
  retry: 'Retry',
  copy: 'Copy',
  rename: 'Rename',
  move: 'Move',
  create: 'New',
  done: 'Done',
  selectAll: 'Select all',
  selectNone: 'Select none',
  expand: 'Expand',
  collapse: 'Collapse',

  /* States */
  loading: 'Loading…',
  saving: 'Saving…',
  empty: 'Nothing here',
  unspecified: 'Not set',
  optional: 'Optional',
  required: 'Required',
  yes: 'Yes',
  no: 'No',
  on: 'On',
  off: 'Off',
  none: 'None',
  all: 'All',
  unknown: 'Unknown',

  /* Units — English has no measure word, so these are bare nouns */
  itemUnit: 'items',
  dayUnit: 'days',
  yearUnit: 'years',

  /* Toasts */
  saved: 'Saved',
  deleted: 'Deleted',
  copied: 'Copied',
  nothingToDo: 'Nothing to handle',

  /* Confirmation dialog */
  confirmDeleteTitle: 'Delete this?',
  confirmDeleteBody: 'Once deleted, it is gone for good.',
  cannotUndo: 'This cannot be undone.',

  /* Accessibility */
  selectItemAria: 'Select “{name}”',

  /* Language switcher */
  language: 'Language',
  languageSwitchTo: 'Switch to {lang}',
  languageHint: 'Only the interface changes — your own entries are never translated.',

  /* Accessible labels (invisible on screen, read out by screen readers) */
  clearSearchAria: 'Clear search',
  closeAria: 'Close',
  closeAlertAria: 'Dismiss message',

  /* Startup: the full-screen notice shown when local data will not open */
  openingData: 'Opening your local data…',
  openDataFailed: 'Could not open your local data',
  openDataReason1:
    'Common causes: the browser is in private or incognito mode, or site data storage is turned off. Try a normal window;',
  openDataReason2:
    'On iPhone, check Settings → Safari → Advanced → Website Data to make sure it is not disabled.',
  /*
   * A way out when it hangs.
   *
   * This used to be a spinner that span forever: no timeout, no explanation,
   * no retry — you could not tell whether it was broken and you could not get
   * yourself out of it.
   */
  initSlowTitle: 'Opening your local data is stuck',
  initSlowHint:
    'This step is instant normally. Common causes: this site is still open in another tab, site data storage is turned off, or the local database is held by something else. Try "Retry" first; if that fails, reload the page. Your data is not lost by doing this.',
  reload: 'Reload',

  /* The fallback screen shown when rendering fails (ErrorBoundary) */
  crashTitle: 'This page hit an error',
  crashHint:
    'The page could not be drawn, but your data is not lost — it stays in the browser database and a refresh usually brings it back. The line below is the exact reason; copy it to the developer.',
  crashGoHome: 'Back to overview',

  /* Small marker after a name, e.g. "Garage / Shelf (new)" */
  newSuffix: ' (new)',

  /* Fatal errors that should only be reachable during development */
  mountPointMissing: 'Mount point #root not found',
}
