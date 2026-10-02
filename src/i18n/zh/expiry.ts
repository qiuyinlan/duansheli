/** 有效期：状态词、独立页面、录入表单里的那一段 */

export const expiry = {
  /* 四种状态。用在哪都一致 —— 物品行徽章、分组标题、筛选、统计 */
  stateExpired: '已过期',
  stateSoon: '{days} 天内',
  stateOk: '还早',
  stateNone: '未设置',

  /* 剩余 / 超期天数 */
  dueToday: '今天到期',
  dueTomorrow: '明天到期',
  dueIn_one: '{count} 天后到期',
  dueIn_other: '{count} 天后到期',
  overdueBy_one: '已过期 {count} 天',
  overdueBy_other: '已过期 {count} 天',

  /* 页面 */
  subtitle: '按到期时间排 —— 最该先处理的在最上面',
  countExpired_one: '{count} 件已过期',
  countExpired_other: '{count} 件已过期',
  countSoon_one: '{count} 件在 {days} 天内到期',
  countSoon_other: '{count} 件在 {days} 天内到期',
  countNone: '还有 {count} 件没填有效期',
  allClear: '没有要到期的东西',
  allClearHint: '给药品、化妆品、食品这类东西填上有效期，它们就会出现在这里。',
  nothingSet: '你还没给任何东西填有效期',
  nothingSetHint: '在物品的编辑页里可以填「有效期至」。填过的东西会在这里按到期顺序排好。',

  /* 分组标题 */
  groupExpired: '已过期',
  groupSoon: '即将过期',
  groupLater: '还早',
  groupNone: '没填有效期',

  /* 阈值设置 */
  thresholdLabel: '「即将过期」算多少天以内',
  thresholdHint: '不同的东西差很多：鲜奶是 3 天，化妆品是半年。按你最常看的那类调。',
  thresholdDays: '{count} 天',
  showLaterLabel: '把还早的和没填的也列出来',

  /* 批量操作 */
  handleSelected: '已处理选中的 {count} 件',
  handledToast: '已处理 {count} 件，有效期清单又短了一点',
  discardSelected: '舍弃选中的 {count} 件',
  discardedToast: '已把 {count} 件移进回收站，还捞得回来',

  /* 表单那一段 */
  fieldLabel: '有效期至',
  fieldHint: '只填日期就行。到期只是个提醒，不会自动改动你的数据。',
  fieldClear: '清除有效期',
  fieldPastWarning: '这个日期已经过去了 —— 确定了就照填，只是先提醒一下。',
  fieldQuickYear: '一年后',
  fieldQuickHalfYear: '半年后',
  fieldQuickMonth: '一个月后',
  fieldQuickWeek: '一周后',

  /* 概览页的卡片 */
  cardTitle: '即将过期',
  cardExpired_one: '{count} 件已经过期',
  cardExpired_other: '{count} 件已经过期',
  cardSoon_one: '{count} 件快到期了',
  cardSoon_other: '{count} 件快到期了',
  cardEmpty: '最近没有要到期的东西',
  cardAction: '去看看',

  /* 提示 */
  needExpiryHint: '想知道哪些东西快过期？给它们填上有效期就行。',
  sortLabel: '按有效期',
  filterLabel: '有效期',
}
