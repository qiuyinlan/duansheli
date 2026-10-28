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
  /*
   * 搜索 + 展开控制。
   * 用户的原话：「这么多折叠层级，怎么看最清晰呢」——
   * 层级一深，最有效的一招是**直接跳到某个位置**，而不是让眼睛顺着一棵树爬。
   */
  searchAria: '搜索位置',
  searchPlaceholder: '搜索位置或物品…',
  searchItemsLabel: '匹配的物品',
  searchItemLocation: '位置：{path}',
  searchFound_one: '找到 {count} 个位置（浅色的是它在哪一层）',
  searchFound_other: '找到 {count} 个位置（浅色的是它在哪一层）',
  searchNone: '没有匹配的位置',
  expandHint: '默认只展开顶层 —— 想一次看全就点「全部展开」',
  expandAll: '全部展开',
  collapseAll: '全部折叠',
  /*
   * 「名字里写着几层」时才出现的那一项。
   *
   * 位置是结构：一口气多出四个位置，得是用户看得见、点得掉的一步 ——
   * 所以它是一个默认勾上、但摆在眼前的开关，而不是默默建出来的。
   */
  alsoLevels: '同时把 {count} 层都建好',
  alsoLevelsHint:
    '你起的名字里写着「{count} 层」。一起建好的话，之后往里放东西就不用再新建了；不想建就把这个勾去掉。',
  addWithLevelsDone: '已新建位置「{name}」和它下面的 {count} 层',

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

  /*
   * 删除 —— 只在「选择」界面里做。
   *
   * 用户的原话：「现在位置还是不能直接删除空位置及子位置。删了之后莫名其妙
   * 又恢复了。删除一个位置，跳出来，删除该位置，和删除该位置及所有子位置。
   * 以及位置编辑页面可以多选一键删除。不用直接显示删除键，
   * 进入选择界面能选择后再删除。」
   *
   * 于是两件事一起改了：①每一行不再挂垃圾桶；②删之前把「子位置留不留」
   * 摆成两个按钮问清楚 —— 以前是代码替他决定（子位置一律移到顶层），
   * 屏幕上看起来就是「删完又冒出来了」。
   */
  selectMode: '选择',
  selectDone: '完成',
  selectHint: '勾选要删除的位置，再点「删除所选」',
  /* 勾选只动位置：物品最多被移走，不会被删 —— 这句得一直摆在眼前 */
  selectHintItems: '勾选只针对位置；物品不会被删，最多被移到「{unassigned}」',
  selectClear: '取消全选',
  selectCount_one: '已选 {count} 个位置',
  selectCount_other: '已选 {count} 个位置',
  selectCheckAria: '勾选「{name}」',
  deleteSelected: '删除所选',
  deleteNothingPicked: '先勾选要删除的位置',

  /*
   * 删之前问的那句（有子位置时两个选项都会出现）。
   *
   * 单数和多选**各写一条**、不走 `_one/_other`：中文的那一对必须写成同一句话
   * （见 tests/i18n.ts），而「一个位置」和「所选的一批」本来就不是同一句话。
   */
  deleteAskTitle: '删除位置「{name}」？',
  deleteAskTitleMany: '删除所选的 {count} 个位置？',
  deleteAskLead: '「{name}」下面还有 {list}。',
  deleteAskLeadMany: '所选的 {count} 个位置下面还有 {list}。',
  deleteOnlyBtn: '删除该位置',
  deleteOnlyBtnMany: '只删这些位置',
  deleteCascadeBtn: '删除该位置及所有子位置',
  deleteCascadeBtnMany: '连同子位置一起删',
  deleteOnlyHint: '子位置保留（其中 {places} 个会移到上一层）；{items} 件物品移到「{unassigned}」。',
  deleteCascadeHint:
    '连同 {places} 个子位置一起删；里面的 {items} 件物品移到「{unassigned}」，物品本身不会丢。',
  deletePlainHint: '{items} 件物品会移到「{unassigned}」，物品本身不会丢。',

  /* 删除的结果 */
  deleteDone: '已删除位置「{name}」',
  deleteFailed: '删除失败',
  deleteManyDone_one: '已删除 {count} 个位置',
  deleteManyDone_other: '已删除 {count} 个位置',
  deleteJoin: '、',
  deleteChildCount_one: '{count} 个子位置',
  deleteChildCount_other: '{count} 个子位置',
  deleteItemCount_one: '{count} 件物品',
  deleteItemCount_other: '{count} 件物品',
}
