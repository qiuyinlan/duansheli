/**
 * 物品页（列表、工具条、分组、批量操作、筛选面板）。
 *
 * 两处特殊写法，先说清楚为什么：
 *
 * 1. **有的文案被拆成两三段**（headerTotal / headerBetween / headerAfter、
 *    confirmDiscardLine1 / Line2）。因为原文中间夹着 `<span className="numeric">`
 *    或者 `<br />` —— 数字要单独包一层做等宽显示，整句塞进一个 key 就
 *    得把标签一起丢掉。拆开虽然看着啰嗦，但保住了原来的结构。
 *
 * 2. 状态词、有效期状态词、分类/位置/标签这些「没有值」的虚拟名字，
 *    复用 status / expiry 命名空间里已有的 key，不在这里重复定义。
 */
export const items = {
  /* 页面标题与操作 */
  headerTotal: '共',
  headerBetween: '件，当前显示',
  headerAfter: '件',
  addItem: '录入物品',
  aiEntry: 'AI 录入',

  /* 一件都没有时的引导 */
  emptyTitle: '还没有任何物品',
  emptyHint: '从最想整理的那个抽屉开始，一件一件录进来。',

  /* 工具条 */
  searchPlaceholder: '搜索名称、备注、标签、属性值…',
  searchAria: '搜索物品',
  groupLabel: '分组',
  groupCategory: '分类',
  groupLocation: '位置',
  groupTag: '标签',
  groupStatus: '状态',
  groupNone: '不分组',
  sortLabel: '排序',
  sortAria: '排序方式',
  sortUpdated: '最近修改',
  sortCreated: '最近添加',
  sortName: '名称',
  sortQuantity: '数量',
  sortLocation: '位置',
  sortAsc: '升序 ↑',
  sortDesc: '降序 ↓',
  sortAscTitle: '当前升序',
  sortDescTitle: '当前降序',
  filter: '筛选',
  filterWithCount: '筛选（{count}）',
  removeCondition: '移除这个条件',
  clearAll: '全部清除',

  /* 批量操作条 */
  selectedCount: '已选 {count} 件',
  markIdleBatch: '标记闲置',
  markSpareBatch: '标记备用',
  splitToSpare: '拆出备用',
  backToActive: '改回在用',
  moveLocation: '移动位置',
  addTags: '加标签',
  addToCollection: '加入活动',
  makeChecklist: '新建清单',
  /* 默认隐藏闲置时的那条提示。只说「藏了几件」不够，要给出去哪看的入口 */
  idleHidden_one: '这里默认不显示闲置的东西 —— 有 {count} 件被收起来了（都在「闲置」页）',
  idleHidden_other: '这里默认不显示闲置的东西 —— 有 {count} 件被收起来了（都在「闲置」页）',
  idleHiddenGo: '去闲置页',
  idleHiddenShow: '就在这看',
  /* 备用同理，但入口指向备用页 */
  spareHidden_one: '这里默认不显示备用的东西 —— 有 {count} 件被收起来了（都在「备用」页）',
  spareHidden_other: '这里默认不显示备用的东西 —— 有 {count} 件被收起来了（都在「备用」页）',
  spareHiddenGo: '去备用页',
  spareHiddenShow: '就在这看',
  discard: '舍弃',
  selectAllShown: '全选当前 {count} 件',
  batchStatus_one: '已把 {count} 件物品标记为「{status}」',
  batchStatus_other: '已把 {count} 件物品标记为「{status}」',

  /* 物品行上的操作 */
  markIdle: '闲置',
  discardTitle: '舍弃（可在设置里找回）',
  discardedToast: '已移入「已舍弃」，可在设置里找回',

  /* 移位置、加标签的提示 */
  movedToast_one: '已把 {count} 件物品移动到新位置',
  movedToast_other: '已把 {count} 件物品移动到新位置',
  addTagsTitle_one: '给 {count} 件物品加标签',
  addTagsTitle_other: '给 {count} 件物品加标签',
  taggedToast_one: '已添加 {count} 个标签',
  taggedToast_other: '已添加 {count} 个标签',

  /* 筛完一件不剩 */
  noMatch: '没有匹配的物品',
  noMatchHint: '试试放宽筛选条件，或者换个搜索词。',
  clearFilters: '清除筛选条件',

  /* 舍弃确认框。两行分开是因为中间有个 <br /> */
  confirmDiscardTitle: '舍弃这些物品？',
  confirmDiscardLine1: '将把选中的 {count} 件物品标记为「已舍弃」。',
  confirmDiscardLine2:
    '它们不会真的消失，可以在「设置 → 已舍弃回收站」里找回或彻底删除。',

  /* 筛选面板 */
  notFiltered: '未筛选',
  resetAll: '全部重置',
  apply: '应用',
  applyWithCount_one: '应用（{count} 项条件）',
  applyWithCount_other: '应用（{count} 项条件）',
  includeDescendants: '选中位置时，连同子位置里的物品一起显示',
  clearLocationFilter: '清除位置筛选（{count}）',
  noAttributes: '还没有定义任何属性。',
  selectPlaceholder: '请选择…',
  opNoValueHint: '无需填值',
  attrOpAria: '{name} 的判断方式',
  attrValueAria: '{name} 的值',

  /* 属性运算符 */
  opContains: '包含',
  opEquals: '等于',
  opGreater: '大于',
  opLess: '小于',
  opIsTrue: '是',
  opIsFalse: '否',
  opHasValue: '已填写',
  opNoValue: '未填写',
}
