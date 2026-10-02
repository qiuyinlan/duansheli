/**
 * The bar chart (category / place / status breakdown on the overview page).
 *
 * It is a shared component, so its words get their own namespace rather than
 * being buried in one page's area. Each bar's label (a category or place name)
 * is the caller's data and is never translated.
 */
export const chart = {
  /** Fallback for when the caller passes no emptyText */
  empty: 'No data yet',
  /** The row that merged everything past `limit` */
  others: 'Others ({count})',
  /** Tooltip on a clickable bar; {label} is the caller's data */
  view: 'View “{label}”',
}
