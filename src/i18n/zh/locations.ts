/**
 * 位置页：不限层级的树 + 选中位置下的物品。
 *
 * 「未归位」不在这里 —— 它是个虚拟分组名，用的是 status.unassigned，
 * 跟物品行、筛选、图表里的叫法保持一致。
 */
export const locations = {
  /* 页头 */
  subtitle_one: '共 {count} 个位置，层级不限，想加多深都行',
  subtitle_other: '共 {count} 个位置，层级不限，想加多深都行',
  newTop: '新建位置',

  /* 空状态 */
  empty: '还没有创建任何位置',
  emptyHint: '位置可以一层层往下分，比如：',
  emptyHintExample: '家 › 卧室 › 衣柜 › 第二层抽屉',
  createFirst: '创建第一个位置',

  /* 树节点上的操作按钮（title 也是无障碍名） */
  addChild: '新建子位置',
  moveUnder: '移动到其他位置下',

  /* 右侧：这个位置下的物品 */
  countHere_one: '共 {count} 件',
  countHere_other: '共 {count} 件',
  directHere_one: '（其中 {count} 件直接放在这里）',
  directHere_other: '（其中 {count} 件直接放在这里）',
  includeDescendants: '含子位置',
  markIdle: '闲置',
  markActive: '改回在用',
  scopedEmpty: '这个位置是空的',
  scopedEmptyHint: '空位置很好 —— 说明这里没有堆积。',
  unassignedEmpty: '没有未归位的物品',
  unassignedEmptyHint: '每件物品都已经有了明确的位置。',

  /*
   * 拖拽改归位。
   *
   * 列表上那句和把手上的那句说的是一件事，只是出现的地方不同：
   * 一句在列表标题下面（一直在），一句在行首那个小点上（悬停才看得到）。
   */
  dragHint: '把物品那一行拖到左边的位置上，就能改它的归位。',
  dragHandleTitle: '按住拖到左侧的位置上',
  dropDone: '已把「{name}」移到「{location}」',
  /* 拖回了原地：什么也没改，但也得出声，否则看起来像拖拽失灵 */
  dropSame: '「{name}」本来就在「{location}」',
  /* 触屏和键盘走这条：HTML5 拖放在手机上根本不触发 */
  moveItem: '移到…',

  /*
   * 这一页的**就地**增删改查（issue 7）。
   *
   * 用户的原话：「在位置那一个页面里也可以进行物品的增删改查，现在只能点击
   * 那个物品进去才能编辑它，我想要像分类那个地方一样，可以直接在那个界面删除。」
   * 位置页本来就是站在柜子前面清点的地方，每改一件都跳出去再跳回来，
   * 清点根本做不下去。
   */
  renameItemTitle: '就地改名',
  renameItemAria: '重命名「{name}」',
  itemRenamed: '已改名',
  deleteItemTitle: '移入回收站（可在设置里找回）',
  discardPickerHint_one: '（候选：这一页的 {count} 件物品）',
  discardPickerHint_other: '（候选：这一页的 {count} 件物品）',

  /* 新建 / 重命名对话框 */
  addTopTitle: '新建顶层位置',
  addChildTitle: '在「{name}」下新建位置',
  renameTitle: '重命名位置',
  namePlaceholder: '例如：第二层抽屉',

  /* 移动 */
  moveDone: '已移动位置',
  moveFailed: '移动失败',

  /* 新建 / 重命名的结果 */
  addDone: '已创建位置',
  addFailed: '创建失败，请检查名称',
  renameDone: '已重命名',

  /* 删除 */
  deleteDone: '已删除位置「{name}」',
  deleteFailed: '删除失败',
  deleteTitle: '删除位置「{name}」？',
  deleteConfirm: '移动内容并删除',
  deleteBodyLead: '这个位置下还有 {list}。',
  deleteJoin: '、',
  deleteChildCount_one: '{count} 个子位置',
  deleteChildCount_other: '{count} 个子位置',
  deleteItemCount_one: '{count} 件物品',
  deleteItemCount_other: '{count} 件物品',
  deleteBodyHint:
    '继续的话，它们会被移动到「{unassigned}」，物品本身不会丢失；之后可以再各自指定新位置。',
  deleteMovedDone: '已删除位置，内容已移到「{unassigned}」',
}
