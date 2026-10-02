/**
 * AI 助手：Key 面板、对话框、草稿预览、采纳那一条链路。
 *
 * 这是全站文案最密集的一块 —— 尤其是 Key 的存储风险说明，
 * 拆成多段是为了保留原文里的 <strong> 强调：那些强调是**刻意的**，
 * 不是排版装饰，翻译时不要抹平，也不要为了「好看」把话说轻。
 *
 * 对话框里那三条 starter 是**示例句子**，不是界面文案本身 ——
 * 英文版要读起来像英语使用者真会打进去的话，不要逐字翻。
 */
export const ai = {
  /* ---- API Key 面板 ---- */
  keyLabel: 'DeepSeek API Key',
  keyPlaceholder: 'sk-…',
  keyFilledBefore: 'API Key 已填入（',
  keyFilledAfter: '），',
  keyStoredBold: '已保存在这台设备的浏览器里',
  keyFilledTail: '，刷新和关掉重开都还在。',
  keyStoredScope: '它不会进导出的备份文件，也不会进本地数据库。想彻底删掉就点右边的清除。',
  keyClearTitle: '从这台设备的浏览器里删掉这个 Key',
  keyClearConfirmTitle: '清除这台设备上保存的 Key？',
  keyClearConfirmBody: 'Key 会从这台设备的浏览器里删掉。',
  keyClearConfirmNote:
    '不影响你已经录入的数据，也不影响 DeepSeek 那边的账单 —— 只是下次想用 AI 功能时要重新粘贴一次。',
  keyClearedToast: '已从这台设备清除 API Key',
  keySavedToast: 'Key 已保存到这台设备',

  keyStorageLead: 'Key 会',
  keyStoredInBold: '保存在这台设备的浏览器里',
  keyStorageTail: '，刷新和关掉重开都不会丢，页面上随时可以一键清除。它',
  keyNeverBold: '不会',
  keyStorageEnd: '进导出的备份文件，也不会进本地数据库。',

  directLead: '请求由你的浏览器',
  directBold: '直连 api.deepseek.com',
  directTail: '，不经过任何第三方服务器（这一点已用真实请求验证过，见项目里的 ',
  probeScript: 'scripts/probe-deepseek-cors.mjs',
  directEnd: '）。',

  costBold: '但存下来就有代价，请知情：',
  riskCode: '① 任何能在你浏览器上执行 JS 的代码（恶意插件、其他页面的 XSS）理论上都能读到它。',
  riskDomainLead: '② ',
  riskDomainCode: '用户名.github.io',
  riskDomainMid: ' 是',
  riskDomainBold: '所有仓库共享同一个域名',
  riskDomainTail: '的 —— 如果你在同一账号下部署了别的项目，那个项目的页面也能读到它。',
  keyAdviceLead: '所以建议到',
  keyAdviceTail: '单独建一个只用于这里的 Key，方便随时吊销。',

  /* ---- 对话框 ---- */
  panelTitle: '和 AI 商量',
  usageTitle: '上一轮消耗 / 本次对话累计',
  usageLine: '上轮 {last} · 共 {total}',
  newChat: '新对话',
  newChatTitle: '清空对话和草稿，重新开始',

  emptyNewBold: '要录新的',
  emptyNewTail: '：把东西写在这里，它拆成一条条物品。',
  emptyEditBold: '要改现有的',
  emptyEditTail: '：直接说 —— 比如「把药品改成 药品/补剂」，它会自己把你现有的物品找出来放到右边。',

  /** 点一下就把整段填进输入框。第一行显示在按钮上，所以要是能独立成句的 */
  starter1:
    '先把这段录进去：\n\n衣柜里有一件灰色羊毛衫，两条牛仔裤，床头柜上有个旧手机。',
  starter2: '把没分类的那些都归一下类，该新建分类就新建',
  starter3: '把我所有的物品按分类和位置检查一遍，明显不合适的纠正过来',

  thinking: '正在想…',
  placeholderEmpty: '写下要录的东西，或者说要改什么…',
  placeholderWithDraft: '继续说（右边草稿 {count} 条）。Enter 发送，Shift+Enter 换行',
  send: '发送',

  resetTitle: '重新开一个对话？',
  resetConfirm: '开始新对话',
  resetCancel: '继续当前对话',
  resetHasDraftsLead: '当前草稿里的 ',
  resetHasDraftsMid: ' 条会全部丢掉 —— 它们',
  resetNotSavedBold: '还没有写进数据库',
  resetHasDraftsTail: '，所以是真的没了。',
  resetKeepHint: '想保留就先点「采纳选中的」，再开新对话。',
  resetBenefit: '重新开一轮的好处：历史清空，每轮要重发的内容更少，也更省 tokens。',
  resetEmptyBody: '会清空当前的对话记录，重新开始。',

  /* ---- 草稿预览 ---- */
  foundLead: '识别出 ',
  foundMid: ' 条，已选 ',
  foundTail: ' 条',
  adoptAllNewCategories: '采纳全部新分类',
  adoptAllNewLocations: '采纳全部新位置',
  suggestCategoriesLead: 'AI 建议新建 ',
  suggestCategoriesMid: ' 个分类：',
  suggestNotCheckedLead: '默认',
  suggestNotCheckedBold: '没有勾选',
  suggestCategoriesTail:
    ' —— 你点了才会创建。不想建的话，用到它们的物品会落到「未分类」里，之后可以自己再归。',
  adoptAll: '全部采纳',
  listSeparator: '、',

  rowIncludeAria: '是否录入「{name}」',
  existingBadge: '已有',
  existingBadgeTitle: '这条来自数据库，采纳时会更新它',
  fieldNameAria: '物品名称',
  fieldQuantityAria: '数量',
  fieldLocation: '位置',
  newLocationToggleTitle: '点击切换：是否创建这个位置',
  willCreate: '将创建',
  newPlace: '新位置',
  labelColon: '：',
  fieldCategories: '分类',
  newCategoryToggleTitle: '这是 AI 建议的新分类。点击切换：是否创建',
  fieldNote: '备注',
  droppedAttrsLead: 'AI 还提到 ',
  droppedAttrsTail:
    '，但你的属性库里没有这些属性，已忽略。（想记录的话，去「属性」页面先定义它们）',

  /* ---- 页面本体 ---- */
  subtitle: '写要录的东西，或者说要改什么 —— 它会自己去找相关的物品，改完给你过目',
  needKey: '请先填入 DeepSeek API Key',
  noReplyNote: '（这一轮没有说明）',
  needToSeeItems: '需要先看一下你现有的物品',
  loadedIntoDrafts_one: '已把 {count} 条现有物品拉进草稿（采纳时是更新，不会新建）',
  loadedIntoDrafts_other: '已把 {count} 条现有物品拉进草稿（采纳时是更新，不会新建）',
  noMatchingItems: '没有找到符合条件的物品',
  continueAfterLoad: '（上面那些物品已经拉进来了，请继续完成我刚才的指令）',
  noDraftChangesMeta: '这条没有改动草稿',

  metaAdded: '新增 {count}',
  metaUpdated: '修改 {count}',
  metaDiscarded: '移入回收站 {count}',
  metaNoChanges: '没有改动',
  metaUnchanged: '其余 {count} 条未动',
  metaUnknownIds: '忽略 {count} 个不存在的 id',

  nothingToApply: '没有需要写入的改动',
  resultUpdated: '更新 {count} 条',
  resultAdded: '新增 {count} 条',
  resultDiscarded: '移入回收站 {count} 条',
  resultNewCategories: '新建 {count} 个分类',
  resultNewLocations: '新建 {count} 个位置',
  appliedPrefix: '已',
  noChangesToast: '没有变化',

  draftEmptyTitle: '这里会显示要改的东西',
  draftEmptyLead: '在左边告诉 AI 你想做什么。两种都行：',
  draftEmptyNewBold: '录新的',
  draftEmptyNewTail: '：把一段文字写在聊天框里，它拆成一条条物品',
  draftEmptyEditBold: '改现有的',
  draftEmptyEditTail:
    '：直接说「把药品改成 药品/补剂」，它会自己把你现有的物品找出来、拉到这里',
  draftEmptyFoot: '不管哪种，都要你点「采纳」才会写进数据库。',

  summaryLead: '草稿共 ',
  summaryMid: ' 条',
  summaryExistingLead: '（其中 ',
  summaryExistingMid: ' 条是已有物品，采纳时',
  summaryExistingBold: '更新',
  summaryExistingTail: '而不是新建）',
  summaryJoinExisting: '，',
  summaryJoinFresh: '（',
  summaryNewTail: ' 条是新录入的，采纳时创建',
  summaryCloseParen: '）',
  summaryChangedHint: '· 加粗的是这一轮改过的',
  clearHighlight: '取消高亮',

  accept: '采纳',
  acceptUpdating: ' · 更新 {count}',
  acceptCreating: ' · 新建 {count}',
  acceptDiscarding: ' · 删除 {count}',
  acceptNothing: '（没有改动）',
  discardAll: '全部放弃',

  footerSelectedLead: '已勾选 ',
  footerSelectedTail: ' 条。',
  footerUntouchedLead: '另有 ',
  footerUntouchedTail: ' 条没被你改动过，采纳时会跳过 —— 不会白刷它们的修改时间。',
  footerSubmitLead: '只有点了「采纳」才会写进数据库。删掉的已有物品是进',
  footerTrashBold: '回收站',
  footerSubmitTail: '，可以恢复。',
}
