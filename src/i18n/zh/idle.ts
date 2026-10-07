/** 闲置页：清单、批量处理、以及那几个「已处理」的提示。 */

export const idle = {
  /* 页头 */
  subtitleEmpty: '标记为闲置的物品会汇总到这里',
  /* 分组之后「越久越靠前」是**组内**的规矩，所以这句要说清「同一类里」 */
  subtitle: '按分类分组；同一类里闲置越久的排越前面 —— 最该被处理的自动浮到顶上',

  /* 一件闲置都没有 */
  emptyTitle: '闲置已清空',
  emptyHintFirst: '没有一件东西处在「闲置」状态 —— 很干净。',
  emptyHintSecond:
    '以后发现有东西一直没动，就在物品列表里点一下「闲置」，它就会出现在这里。',
  emptyAction: '去物品列表',

  /* 汇总条 */
  highlightLabel: '件闲置',
  share: '占全部物品的 {percent}%。',
  shareOldest: '占全部物品的 {percent}%，最久的已经闲置了 {days}。',
  hint: '看一遍，能扔的就点「已处理」。',

  /* 选择与批量操作 */
  selectAll: '全选这 {count} 件',
  selectedCount: '已选 {count} 件',
  markActive: '改回在用',
  discard: '已处理（舍弃）',
  discardTitle: '已处理（移入已舍弃）',

  /* 提示 */
  markedActiveToast: '已把 {count} 件改回「在用」',
  discardedToast: '已移入「已舍弃」，可在设置里找回',
  handledToast: '已处理 {count} 件，闲置清单又短了一点',
  /* 勾选列表标题旁边那句 —— 说明候选范围就是这一页的闲置 */
  discardPickerHint_one: '（候选：这一页的 {count} 件闲置）',
  discardPickerHint_other: '（候选：这一页的 {count} 件闲置）',

  /* 确认框 */
  confirmTitle: '确认已处理？',
  confirmLabel: '已处理',
  confirmBodyFirst: '将把选中的 {count} 件物品标记为「已舍弃」。',
  confirmBodySecond: '记录不会消失，可以在「设置 → 已舍弃回收站」里找回。',
}
