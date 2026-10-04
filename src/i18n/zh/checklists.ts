/**
 * 清单：一次性的待办。
 *
 * 和「活动合集」的分工：活动是**模板**（长期攒的），清单是**本次的实例**（打钩、用完就删）。
 * 所以这里的文案要一直强调「临时」「删了没关系」，而活动的文案是「攒」。
 */

export const checklists = {
  /* 页面 */
  subtitle: '临时的一份待办，打完钩就删掉',
  emptyTitle: '还没有清单',
  emptyHint: '清单是临时的：把这次要用的东西凑成一份，边办边打钩，办完删掉就行。',
  emptyHintSecond: '两种建法：在物品列表里勾选几件；或者从某个活动里挑几件。',
  createFromItems: '新建清单',
  createTitle: '新建清单',
  namePlaceholder: '比如：周六露营、这周采购',
  defaultName: '新清单',

  /* 列表 */
  count_one: '{count} 条',
  count_other: '{count} 条',
  progress: '已打钩 {done} / {total}',
  allDone: '全打钩了',
  fromCollection: '来自「{name}」',
  open: '打开',

  /* 详情 */
  detailSubtitle: '办好了就打个钩',
  emptyEntriesTitle: '这份清单是空的',
  emptyEntriesHint: '下面可以直接加一条，或者回物品列表勾选几件再建一份。',
  backToList: '全部清单',

  /* 打钩与编辑 */
  checkAria: '勾选「{name}」',
  addEntry: '加一条',
  addEntryPlaceholder: '比如：顺路买瓶水',
  addEntryHint: '清单里的条目不一定是库里的东西 —— 顺路要买、要借的都可以写进来。',
  entryNamePlaceholder: '名字',
  quantityAria: '数量',
  removeEntry: '删掉这条',
  clearChecked: '清掉打钩的 {count} 条',
  clearCheckedToast: '已清掉 {count} 条',
  checkedSummary_one: '已打钩 {count} 条',
  checkedSummary_other: '已打钩 {count} 条',
  uncheckAll: '全部取消打钩',

  /* 名与删除 */
  renameTitle: '重命名清单',
  deleteTitle: '删除这份清单？',
  deleteBodyLead: '清单是',
  deleteBodyStrong: '临时',
  deleteBodyTail: '的，删掉就没了 —— 但活动合集和物品都不会受影响。',
  deleteToast: '已删除清单「{name}」',

  /* 提示 */
  createdToast: '已建清单「{name}」，共 {count} 条',
  renamedToast: '已改名',
  entryAddedToast: '已加一条',
  entryRemovedToast: '已删掉这条',

  /* 物品行上的关联信息 */
  itemGone: '物品已不在库里',
  goToItem: '看这件物品',
}
