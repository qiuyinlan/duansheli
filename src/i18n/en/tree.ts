/**
 * Strings owned by the tree view itself.
 *
 * The place tree, the category tree, the filter panel and both pickers share
 * this one component, so its words live in their own namespace — putting them
 * in `attributes` / `tags` would be wrong, those are page areas.
 *
 * Node names and virtual-node labels (no place / uncategorised) arrive as
 * props and are the caller's business; only what the component grows itself
 * belongs here.
 */
export const tree = {
  /** The toggle only carries an aria-label, but it is still a button */
  expand: 'Expand',
  collapse: 'Collapse',
  /** Fallback for when the caller passes no emptyText */
  empty: 'Nothing here yet',
}
