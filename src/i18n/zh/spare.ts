/**
 * 备用页：囤着等用的东西。
 *
 * 这一页的文案要一直守住一件事：**别把备用说成闲置**。
 * 闲置页是在提醒你「这些东西该处理了」，而备用是你特意留的 ——
 * 同一句话放在两页上会有一页是错的。
 */

export const spare = {
  /* 页头 */
  subtitle: '囤着等用的东西，用完了就来这儿取',
  subtitleEmpty: '买多了、留着备用的东西放这里',

  /* 顶部那两个数字 */
  highlightKinds: '种备用',
  highlightUnits: '共 {count} 件',
  hint:
    '备用的东西不算闲置 —— 它是特意留的，放多久都正常。所以它既不进闲置占比，也不会被催着处理。',

  /* 空状态 */
  emptyTitle: '备用区是空的',
  emptyHintFirst: '在「物品」页选中一件东西，点「标记备用」就能整条搬进来；',
  emptyHintSecond:
    '数量超过 1 的，用「拆出备用」可以把多买的那几件分出来 —— 原来那条留在原处，分出来的进这里。',
  emptyAction: '去物品页',

  /* 单条操作 */
  takeOne: '取用一件',
  takeOneTitle: '取一件出来用：还有存货就只是少一件，最后一件就让整条变成「在用」',
  discardTitle: '把这条备用舍弃（进回收站，可恢复）',
  spareCount_one: '备用 {count} 件',
  spareCount_other: '备用 {count} 件',

  /* 取用的结果提示 —— 两条分支各自说清楚发生了什么 */
  tookOneToast_one: '取用 1 件，这条还剩 {count} 件在备用区',
  tookOneToast_other: '取用 1 件，这条还剩 {count} 件在备用区',
  tookLastToast: '这是最后一件，这条已经改成「在用」',
  tookNoneToast: '这条不是备用，取不了',

  /* 批量 */
  selectAll: '全选（{count} 种）',
  selectedCount: '已选 {count} 种',
  takeAll: '全部改为在用',
  takeAllTitle: '把选中的整条搬出备用区，改成「在用」',
  takeAllToast_one: '{count} 条已改为「在用」',
  takeAllToast_other: '{count} 条已改为「在用」',
  discardSelected: '舍弃',
  discardConfirmTitle: '舍弃这些备用？',
  discardConfirmBody: '选中的 {count} 条会进「已舍弃回收站」，随时可以恢复。',
  /* 勾选列表标题旁边那句 —— 说明候选范围就是这一页的备用 */
  discardPickerHint_one: '（候选：这一页的 {count} 种备用）',
  discardPickerHint_other: '（候选：这一页的 {count} 种备用）',
  discardDoneToast_one: '{count} 条已舍弃，可在回收站恢复',
  discardDoneToast_other: '{count} 条已舍弃，可在回收站恢复',

  /* 分组 */

  /* 拆出备用 */
  splitTitle: '拆出备用',
  /* 中间那句要加粗，所以拆成三段在 JSX 里包 <strong> —— t() 不认 markdown */
  splitDescBefore: '把多买的那几件分出来，单独建一条备用记录放进备用区。原来那条',
  splitDescStrong: '留在原处',
  splitDescAfter: '，只是数量变少。',
  splitHowMany: '拆出几件',
  splitAvailable: '这条一共有 {count} 件，最多能拆 {max} 件（原处至少要留 1 件）。',
  splitKeepAtLeast: '原处要留下至少 1 件',
  splitWhere: '备用放在哪',
  splitWhereHint: '会记住这次的选择，下次拆的时候自动填上 —— 备用一般是收在同一个盒子里的。',
  splitConfirm: '拆出 {count} 件',
  splitToast_one: '已拆出 {count} 件备用，放进「{where}」',
  splitToast_other: '已拆出 {count} 件备用，放进「{where}」',
  splitToastNoWhere_one: '已拆出 {count} 件备用（未归位）',
  splitToastNoWhere_other: '已拆出 {count} 件备用（未归位）',

  /* 失败原因 */
  splitNotFound: '找不到这件物品，可能已经被删掉了',
  splitDiscarded: '这件已经舍弃了，先恢复它再拆',
  splitTooFew:
    '这条只有 1 件，没有「多出来的」可以拆。想整条变成备用，请用「标记备用」。',
  splitNoSpareToMake: '选中的东西数量都是 1，没有可以拆出来的',
}
