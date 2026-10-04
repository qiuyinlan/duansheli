/** Item statuses, plus the three "no value" pseudo-groups. */

export const status = {
  active: 'In use',
  idle: 'Idle',
  /*
   * Spare.
   *
   * Deliberately NOT "idle": the Idle page is framed as "the longer it sits,
   * the less it belongs here", while a spare is kept on purpose and is fine
   * sitting there for two years. The two mean opposite things.
   */
  spare: 'Spare',
  discarded: 'Discarded',

  /* Pseudo-groups: not real categories/places, they mean "this has no value" */
  unassigned: 'No place',
  uncategorized: 'Uncategorized',
  untagged: 'Untagged',
  all: 'All',
}
