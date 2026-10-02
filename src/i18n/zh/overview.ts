/** 概览页：页头、空状态、几个大数字、三张饼/条形图的标题。 */

export const overview = {
  /* 页头 */
  subtitleEmpty: '你的家当会在这里变成一张图',
  updatedAt: '最近更新于 {time}',
  addItem: '录入物品',

  /* 一件都没有时的引导 */
  emptyTitle: '还没有录入任何物品',
  emptyHintFirst: '先录一件试试 —— 只要填个名称就能存下，其余都是可选的。',
  emptyHintSecond: '分类、位置、属性库已经替你准备好了一套常用的起步内容，随时可以改。',
  emptyAction: '录入第一件物品',

  /* 备份提示条 */
  backupNever: '数据只存在这台设备的浏览器里，还没有导出过备份。清一次浏览器数据就全没了。',
  backupStale: '上次导出备份是 {time}，建议重新导出一份。',
  backupAction: '去备份',

  /* 大数字与四张小卡 */
  heroLabel: '件物品（不含已舍弃）',
  statCategories: '个分类',
  statLocations: '个位置',
  statIdle: '件闲置',
  statUnassigned: '件未归位',
  statUnassignedTitle: '查看未归位的物品',

  /* 闲置占比 —— 断舍离的核心指标 */
  idleShare: '闲置占比',
  idleNone: '目前没有闲置物品 —— 每一件都在用，很干净。',
  idleSome: '有 {count} 件已经闲置。闲置越久越说明它不该留在这里。',
  idleAction: '去处理',

  /* 图表 */
  byCategory: '按分类',
  byCategoryNote: '只统计顶层分类；一件物品在同一顶层下只算一次',
  emptyCategories: '还没有设置分类',
  byLocation: '按位置',
  byLocationNote: '这里只显示第一层，点进去可以看每一层',
  emptyLocations: '还没有设置位置',
  byTag: '按标签',
  byStatus: '按状态',
  byStatusNote: '已舍弃的物品仍保留记录，可在设置里查看',
}
