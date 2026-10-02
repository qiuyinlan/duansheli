/**
 * 标签管理页：列表、重命名、删除。
 *
 * 标签名是**用户自己的数据**，一律不翻译；这里只有界面上的字。
 * 列表里那个「3 件」借 `format.countItems`，全站一致。
 */
export const tags = {
  /* 页面标题借 nav.titleTags */
  subtitle: '标签管的是「什么情境」，例如「想送人」「舍不得扔」「待维修」。',
  addPlaceholder: '添加一个标签',
  addHint: '录入物品时也可以随手新建标签，不必先来这里。',

  /* 空状态 */
  emptyTitle: '还没有标签',
  emptyHint: '标签是可选的，不用也可以。',

  view: '查看',
  renameTitle: '重命名标签',

  /* 提示 */
  addToast: '已添加标签',
  renamedToast: '已重命名',
  deletedToast: '已删除标签',

  /* 删除确认。数字夹在句子中间，所以拆成前后两半，各自带单复数 */
  deleteTitle: '删除标签「{name}」？',
  deleteInUseLead: '有 ',
  deleteInUseTail_one: ' 件物品带着这个标签。',
  deleteInUseTail_other: ' 件物品带着这个标签。',
  deleteInUseNote: '删除后标签会被移除，物品本身不会消失。',
  deleteUnused: '这个标签还没有被任何物品使用。',
}
