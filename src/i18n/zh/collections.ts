/** 活动合集：旅行、学习、搬家这类「为了做一件事要凑齐哪些东西」 */

export const collections = {
  /* 页面 */
  subtitle: '把为了同一件事要用的东西凑成一份清单',
  emptyTitle: '还没有任何活动',
  emptyHint: '旅行要带什么、学习要准备什么、搬家先搬哪些 —— 都可以做成一个活动。',
  emptyHintSecond: '建一个之后，去物品列表里勾选东西，点「加入活动」就能放进来。',
  createFirst: '建第一个活动',

  /* 新建 / 改名 */
  newPlaceholder: '比如：旅行、学习、搬家',
  create: '新建活动',
  createTitle: '新建活动',
  renameTitle: '重命名活动',
  namePlaceholder: '活动名字',
  noteLabel: '备注',
  notePlaceholder: '比如：三天两夜，去爬山',

  /* 列表 */
  count_one: '{count} 件',
  count_other: '{count} 件',
  emptyBadge: '空的',
  open: '查看',

  /* 详情 */
  detailSubtitle: '这个活动里要用的东西',
  detailEmptyTitle: '这个活动里还没有东西',
  detailEmptyHint: '去物品列表里勾选几件，然后点「加入活动」。',
  pickItems: '去挑东西',
  removeSelected: '移出选中的 {count} 件',
  removeOne: '移出',
  removeTitle: '确认移出？',
  removeBody: '只是从这个活动里移出，物品本身还在原处，不会被删掉。',
  backToList: '全部活动',

  /* 删除活动 */
  deleteTitle: '删除这个活动？',
  deleteBodyLead: '删掉',
  deleteBodyStrong: '这个活动本身',
  deleteBodyTail: '—— 里面的物品一个都不会删，只是不再属于这个活动而已。',
  deleteToast: '已删除「{name}」，{count} 件物品留在原处',

  /* 从物品列表加进来 */
  addTitle: '加入活动',
  addHint: '选一个已有活动，或者直接输入一个新名字。一件东西可以同时属于多个活动。',
  addPickExisting: '已有活动',
  addOrNew: '或者新建一个',
  addExisting: '加入这个',
  createAndAdd: '新建并加入',
  willAdd_one: '选中的 {count} 件会加进去',
  willAdd_other: '选中的 {count} 件会加进去',
  addedToast: '已把 {count} 件加入「{name}」',
  alreadyAll: '这 {count} 件已经都在「{name}」里了',
  addPartial: '{added} 件加入「{name}」，另外 {skipped} 件本来就在里面',

  /* 提示 */
  toastCreated: '已新建活动「{name}」',
  toastRenamed: '已改名',
  toastNoteSaved: '备注已保存',
  toastDuplicate: '已经有一个叫「{name}」的活动了',
  belongToOne: '属于「{name}」',

  /* 从活动生成清单 */
  makeChecklist: '生成清单',
  makeChecklistHint: '把这里勾选的东西做一份清单，边办边打钩。清单是临时的，活动本身不受影响。',
  makeChecklistName: '{name} 的清单',
  makeChecklistAll: '全选这里的东西',
}
