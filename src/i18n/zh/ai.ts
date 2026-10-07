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

  /*
   * 数据被整体替换（清空 / 导入覆盖 / 回退快照）时，未采纳的草稿必须作废 ——
   * 草稿里的物品、分类、位置都是照着**原来那份数据**记的，现在对不上号了，
   * 再采纳会悄悄少做几条。作废了就要说一声，不能悄悄清掉。
   */
  sessionClearedByDataReset:
    '数据被整体替换了，刚才那段对话和没采纳的草稿已经作废 —— 草稿里的物品、分类、位置都是照着原来那份数据记的，现在对不上号了。',

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
  fieldStatus: '状态',
  fieldCollections: '活动',
  droppedAttrsLead: 'AI 还提到 ',
  droppedAttrsTail:
    '，但你的属性库里没有这些属性，已忽略。（想记录的话，去「属性」页面先定义它们）',
  droppedCollectionsLead: 'AI 还提到活动 ',
  droppedCollectionsTail:
    '，但你没有这个活动，已忽略。（活动只能你自己建，去「活动」页面建一个再试）',

  /* ---- 页面本体 ---- */
  subtitle: '写要录的东西，或者说要改什么 —— 它会自己去找相关的物品，改完给你过目',
  needKey: '请先填入 DeepSeek API Key',
  noReplyNote: '（这一轮没有说明）',
  needToSeeItems: '需要先看一下你现有的物品',
  loadedIntoDrafts_one: '已把 {count} 条现有物品拉进草稿（采纳时是更新，不会新建）',
  loadedIntoDrafts_other: '已把 {count} 条现有物品拉进草稿（采纳时是更新，不会新建）',
  noMatchingItems:
    '没有找到符合条件的物品。如果它确实在你库里，换个说法（比如直接说名字）让它再找一次，别直接新建。',
  continueAfterLoad:
    '（上面那些物品已经拉进来了，请继续完成我刚才的指令。注意：它们现在就在草稿里，改它们用 update、不要新建。）',
  noDraftChangesMeta: '这条没有改动草稿',
  sourceMissing_one:
    '有 {count} 条草稿对应的物品已经不在了（可能被删掉、或已经被采纳过）—— 已把它们改成新建，请确认这几条是不是你要的。',
  sourceMissing_other:
    '有 {count} 条草稿对应的物品已经不在了（可能被删掉、或已经被采纳过）—— 已把它们改成新建，请确认这几条是不是你要的。',

  /* ---- 删除物品前的勾选（issue 3）---- */
  discardPicker: {
    title: '选择要移入回收站的东西',
    lead: '勾选要移入回收站的物品 —— 一个都没勾时不会删任何东西。',
    selectAll: '全选这 {count} 件',
    confirm_one: '移入回收站（{count} 件）',
    confirm_other: '移入回收站（{count} 件）',
    nonePicked: '先勾选要删的',
    empty: '没有可删除的物品。',
    trashNote_one: '将把 {count} 件移入回收站，物品本身不会消失。',
    trashNote_other: '将把 {count} 件移入回收站，物品本身不会消失。',
    whereToRestore: '之后可以在「设置 → 已舍弃回收站」里逐条恢复。',
    doneToast_one: '已把 {count} 件移入回收站，可在设置里恢复',
    doneToast_other: '已把 {count} 件移入回收站，可在设置里恢复',
  },

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
  /*
   * 要求删、但数据库里已经找不到的那些。
   *
   * 这一条是防「说做了、没做、还不说」的最后一道：以前它们被静默跳过，
   * 提示照样说「移入回收站 13」，其实一件都没动。
   */
  resultMissingDiscards_one: '有 {count} 条要删的已经不在库里了（可能已被删过），没有重复处理',
  resultMissingDiscards_other: '有 {count} 条要删的已经不在库里了（可能已被删过），没有重复处理',
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

  /*
   * 只显示改动过的（issue 6）。
   *
   * 用户的场景：让 AI 把 189 条现有物品拉进来核对，它只改了 3 条 ——
   * 那 186 条没动的铺在预览底下，把真正要看的东西淹掉了。
   */
  showUnchanged: '显示没改动的 {count} 条',
  showOnlyChanged: '只看改动过的',
  noChangesInDraftsTitle: '这一轮没有改动',
  noChangesInDraftsHint_one: '拉进来的 {count} 条都保持原样 —— 所以这里不铺列表。',
  noChangesInDraftsHint_other: '拉进来的 {count} 条都保持原样 —— 所以这里不铺列表。',

  /*
   * 名字撞上库里已有物品时的确认（issue 2）。
   *
   * 这里**必须**让用户点，程序不给默认值：猜「新建」就是他报的那个 bug
   * （「我明明有，它又建了一个」），猜「更新」更糟（动了他没让动的东西）。
   */
  dedupeLead: '有 ',
  dedupeTail: ' 条的名字和你库里已有的东西一样。请先确认每一条是哪种情况：',
  dedupeExisting: '库里已有这一条（位置：{location}）',
  dedupeUpdate: '就是它，改这一条',
  dedupeCreate: '不是它，另建一条新的',
  acceptWaitingDedupe: ' · 待确认 {count}',
  needDedupeChoice: '还有 {count} 条重名没确认，先在上面选一下再采纳',

  /*
   * 会被删掉的那些（单独列一块）。
   *
   * 它们已经从草稿里被移走了，所以不会出现在改动列表里 ——
   * 不单独列的话，用户在点「采纳」之前看不到自己将要失去哪几件。
   * 用户原话：「只需要给我看更改的，还有删除的即可。」
   */
  willDiscardLead_one: '这 {count} 件会被移进回收站：',
  willDiscardLead_other: '这 {count} 件会被移进回收站：',
  willDiscardTail: '（它们不会真的消失，可以在「设置 → 已舍弃回收站」里恢复）',

  /* 上一批已生效的条目 —— 拼在下一轮指令前面，AI 才知道那批不用再新建 */
  appliedContext: '（上一批已经采纳落库了：{names}。它们现在是已有物品。）\n',

  /*
   * ---- AI 整理分类 ----
   *
   * 用户要的能力：「我希望 ai 可以编辑分类，我可以让它帮我整理已有的分类。」
   *
   * 分类是**结构**，改错了没法用眼睛验（你只知道树变了样子），
   * 所以预览这一块的重点是「把将要发生什么一行一行说清楚」，
   * 而且每种状态都要说清「这条到底会不会被执行」。
   */
  catLead: 'AI 想对分类做 ',
  catLeadTail: ' 处改动（取消勾选就不做）：',
  catProblemsLead: '其中有 ',
  catProblemsBold: '做不了',
  catProblemsTail: ' 的条目 —— 它们不会被执行，也不会悄悄丢掉。看看要不要让它换个说法重试。',  catIncludeAria: '是否执行「{name}」这一条',

  catKindCreate: '新建',
  /* 新建的那一条没有「原来的分类」——逻辑层只给出 isNew 这个事实，措辞在这一层 */
  catFromNew: '（新分类）',  catKindRename: '改名',
  catKindMove: '移动',
  catKindDelete: '删除',

  catNoteNoop: '本来就是这样，不用改',
  catNoteMissing: '找不到这个分类（可能名字不对，或者它已经被改过了）',
  catNoteDuplicate: '同级已经有同名的分类了，不能撞成两个',
  catNoteCycle: '不能把分类挪到它自己（或它的下级）里面 —— 那样整棵子树会从界面上消失',

  catDeleteChildren_one: '{count} 个子分类会挂到上一级',
  catDeleteChildren_other: '{count} 个子分类会挂到上一级',
  catDeleteItems_one: '{count} 件物品会失去这个分类归属',
  catDeleteItems_other: '{count} 件物品会失去这个分类归属',
  /* 用户最怕的就是「删了它会不会把东西也删了」，所以必须明说 */
  catDeleteNothingLost: '（物品本身一件都不会少）',

  catWillApply_one: '将改动 {count} 处分类',
  catWillApply_other: '将改动 {count} 处分类',
  catNothingApply: '没有可执行的分类改动',

  /*
   * AI 说了要改分类，但我一条都没看懂它的格式。
   *
   * 这条提示存在的意义就是**不让它静默消失**：以前的表现是 AI 说
   * 「已把 X 改名成 Y」、界面上却是「没有改动」，用户和 AI 互相怀疑。
   * 现在至少有一句话说清「它说了、我没读懂」，用户知道该换个说法重试。
   */
  categoryChangesUnread:
    'AI 这一轮说了要改分类（{count} 处），但我没读懂它给的格式，所以一处都没执行。换个说法再说一次通常就好了。',

  catAccept: '采纳分类改动',
  catDone: '已',
  catResultCreated_one: '新建 {count} 个分类',
  catResultCreated_other: '新建 {count} 个分类',
  catResultRenamed_one: '改名 {count} 个',
  catResultRenamed_other: '改名 {count} 个',
  catResultMoved_one: '移动 {count} 个',
  catResultMoved_other: '移动 {count} 个',
  catResultDeleted_one: '删除 {count} 个',
  catResultDeleted_other: '删除 {count} 个',
  catResultNothing: '分类没有任何改动',

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
