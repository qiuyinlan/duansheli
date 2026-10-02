/**
 * 分类页：不限层级的树 + 选中分类下的物品。
 *
 * 结构跟「位置」页对称（新建子级 / 重命名 / 移动 / 删除），
 * 所以 key 的名字也刻意对齐，改一边时好对照另一边。
 * 「未分类」用的是 status.uncategorized，不在这里重复定义。
 */
export const categories = {
  /* 页头 */
  subtitle:
    '分类管的是「这是什么」。可以分很多级，比如 化妆品 › 眼妆；一件物品可以同时属于多个分类。',
  newTop: '新建分类',

  /* 空状态 */
  empty: '还没有分类',
  emptyHint: '先建几个常用的顶层分类就好，比如：衣物、电子、日用品。',
  emptyHintSecond: '之后随时可以在任意分类下面继续加子分类。',
  createFirst: '创建第一个分类',

  /* 树节点上的操作按钮（title 也是无障碍名） */
  addChild: '新建子分类',
  moveUnder: '移动到其他分类下',

  /* 右侧：这个分类下的物品 */
  countHere_one: '共 {count} 件',
  countHere_other: '共 {count} 件',
  directHere_one: '（其中 {count} 件直接挂在这里）',
  directHere_other: '（其中 {count} 件直接挂在这里）',
  includeDescendants: '含子分类',
  filter: '筛选',
  scopedEmpty: '这个分类下还没有物品',
  scopedEmptyHint: '空分类没问题 —— 先建好结构，东西可以慢慢归。',
  allAssignedEmpty: '所有物品都已经分类了',
  allAssignedEmptyHint: '每一件东西都找到了自己的位置。',

  /* 新建 / 重命名对话框 */
  addTopTitle: '新建顶层分类',
  addChildTitle: '在「{name}」下新建子分类',
  renameTitle: '重命名分类',
  namePlaceholder: '例如：眼妆',

  /* 移动 */
  moveTitle: '移动分类',
  moveToTop: '移到顶层',
  moveHint: '选一个新的上级分类。选「{moveToTop}」就把它提为顶层分类。',
  moveHintSecond: '（它自己的子分类会跟着一起走）',
  moveDone: '已移动分类',
  moveFailed: '移动失败',

  /* 新建 / 重命名的结果 */
  addDone: '已创建分类',
  addDuplicate: '同一级下已经有同名的分类了',
  renameDone: '已重命名',

  /* 删除 */
  deleteDone: '已删除分类「{name}」',
  deleteFailed: '删除失败',
  deleteTitle: '删除分类「{name}」？',
  deleteConfirm: '移到未分类并删除',
  deleteBodyLead: '这个分类下还有 {list}。',
  deleteJoin: '、',
  deleteChildCount_one: '{count} 个子分类',
  deleteChildCount_other: '{count} 个子分类',
  deleteItemCount_one: '{count} 件物品',
  deleteItemCount_other: '{count} 件物品',
  /* 中间那句在界面上是加粗的，所以拆成前后两段夹着 <strong> */
  deleteBodyBefore: '继续的话，',
  deleteBodyStrong: '子分类会挂到顶层',
  deleteBodyAfter:
    '、直接挂在这里的物品会变成「{uncategorized}」—— 东西本身都不会丢，子分类里的物品也不受影响。删除前会自动存一份快照。',
  deleteMovedDone: '已删除分类，内容已妥善安置',
}
