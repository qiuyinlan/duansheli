/**
 * 数据层：导入校验、合并报告、本地存储、快照，以及 AI 客户端的错误映射。
 *
 * 这些文案全都产生在 React 之外 —— 校验和合并的报告、IndexedDB 抛出的错误、
 * 导出的文件名与 CSV 表头、API 客户端映射出来的「该怎么办」。
 * 它们改不了界面状态，所以调用方只能靠这段文字告诉用户发生了什么。
 *
 * 因此**取词一律在构造消息的那一刻**（`t()` 写在函数里）：
 * 这些模块顶层没有语言概念，写成常量会在模块加载时把当时那门语言冻住。
 */
export const data = {
  /* 拼进句子里的名词。校验和合并报告都要用，放一处免得两种说法 */
  kind: {
    item: '物品',
    location: '位置',
    category: '分类',
    attribute: '属性',
    collection: '活动',
    checklist: '清单',
  },

  /* ---------------- 导入文件的校验 ---------------- */
  validate: {
    /* 逐条归一化时的提示：能救则救，救不了就说清是哪一条、为什么 */
    itemNotObject: '第 {index} 条物品不是有效对象，已跳过',
    itemNoName: '第 {index} 条物品没有名称，已跳过',
    itemNoId: '物品「{name}」缺少 id，已跳过',
    locationNoIdOrName: '发现一条缺少 id 或名称的位置，已跳过',
    categoryNoIdOrName: '发现一条缺少 id 或名称的分类，已跳过',
    attributeNoIdOrName: '发现一条缺少 id 或名称的属性，已跳过',
    collectionNotObject: '发现一条不是有效对象的活动，已跳过',
    collectionNoName: '发现一条没有名称的活动，已跳过',
    collectionNoId: '活动「{name}」缺少 id，已跳过',
    checklistNotObject: '发现一条不是有效对象的清单，已跳过',
    checklistNoIdOrName: '发现一条缺少 id 或名称的清单，已跳过',
    checklistEntrySkipped: '清单「{name}」第 {index} 条没有名字，已跳过',

    duplicateId: '发现重复的{kind} id，已忽略后出现的那条',
    danglingLocation_one: '{count} 件物品指向了不存在的位置，已改为「未归位」',
    danglingLocation_other: '{count} 件物品指向了不存在的位置，已改为「未归位」',
    danglingCategory_one: '{count} 处分类引用已失效，已移除',
    danglingCategory_other: '{count} 处分类引用已失效，已移除',
    danglingCollection_one: '{count} 处活动引用已失效，已移除',
    danglingCollection_other: '{count} 处活动引用已失效，已移除',
    locationParentMissing: '位置「{name}」的上级位置不存在，已提升为顶层',
    categoryParentMissing: '分类「{name}」的上级分类不存在，已提升为顶层',

    /* 整份文件读不进来：说清是文件的问题，并给出下一步 */
    fileEmpty: '文件是空的。',
    fileNotJson: '文件内容不是合法的 JSON，可能已损坏或不是导出文件。',
    fileNotObject: '文件结构不正确：顶层应该是一个对象。',
    fileNotOurs: '这不是「断舍离」的备份文件（缺少 format: "{appId}" 标记）。',
    fileNoSchemaVersion: '备份文件缺少有效的 schemaVersion 字段。',
    fileNewerSchema:
      '这份备份来自更新版本（数据结构 v{version}），' +
      '当前程序只支持到 v{supported}。请先升级程序再导入。',
    fileNoData: '备份文件里没有 data 字段，或 data 不是对象。',
    fileNoCollections: '备份文件里找不到 items / locations / categories 数据。',
  },

  /* ---------------- 合并导入的报告 ---------------- */
  importReport: {
    /* 名称路径原样带出来，用户才知道被补建的是哪个节点 */
    autoCreated: '自动补建{kind}：{path}',
    lostLocation_one: '{count} 件物品的位置引用无法解析，已改为「未归位」',
    lostLocation_other: '{count} 件物品的位置引用无法解析，已改为「未归位」',
  },

  /* ---------------- 本地存储 ---------------- */
  storage: {
    noIndexedDb:
      '当前浏览器不支持 IndexedDB，无法保存数据。' +
      '请改用 Chrome / Edge / Safari / Firefox 的普通模式（不要用无痕模式）。',
    openFailed: '无法打开本地数据库',
    openError: '打开本地数据库失败',
    blocked: '本地数据库被其他标签页占用，请关闭本站的其他标签页后刷新',
    transactionAborted: '数据库事务被中止',
    cloudNotReady: '云端存储将在后续版本提供，当前版本请使用本地存储。',
    saveFailed: '保存到本地失败：{message}',
    /*
     * 落盘失败时**一直挂着**的横幅。
     *
     * 和上面那条提示的分工：提示会消失，横幅不会 ——
     * 「这次改动没存进去」不能让用户三秒之后就忘了，
     * 因为他看到的内容在内存里是好的，看起来一切正常。
     */
    saveFailedBanner:
      '这次改动没能存进本地：{message}。原因多半是浏览器把数据库连接关掉了（另一个标签页、清了站点数据、或存储被回收）。你现在看到的内容还在内存里，但一刷新就会丢 —— 请点「重试保存」。',
    saveFailedRetry: '重试保存',
    saveFailedExport: '先导出备份',
    saveRetryOk: '存进去了',
    fileReadFailed: '读取文件失败',
  },

  /* ---------------- 树的移动与删除 ---------------- */
  /*
   * 这些结果会被界面直接弹成提示，所以要说清「为什么不行」。
   * `{kind}` 由调用方填：同一个判断位置和分类都要用，
   * 该说「位置」还是「分类」只有调用方知道（lib/tree.ts 只返回代号）。
   */
  tree: {
    moveBlockedSelf: '不能把它移动到它自己下面',
    moveBlockedMissing: '目标{kind}不存在',
    moveBlockedDescendant: '不能把它移动到它自己的子级下面',
    moveFailed: '移动失败',
    deleteMissing: '{kind}不存在',
    deleteFailed: '删除失败',
    deleteBlockedDescendant: '不能把内容移动到正在删除的这个{kind}下面',
    deleteHasChildrenAndItems: '该{kind}下有 {children} 个子{kind}和 {items} 件物品',
    deleteHasChildren: '该{kind}下有 {children} 个子{kind}',
    deleteHasItems: '该{kind}下有 {items} 件物品',
  },

  /* ---------------- store 里弹出的提示 ---------------- */
  store: {
    scaffoldRestored: '已恢复为初始的分类、位置与属性库（物品已清空）',
    allCleared: '所有数据已清空（可在快照中回退）',
    manualSnapshotCreated: '已生成一份手动备份快照',
    snapshotNotFound: '找不到这份快照',
    /*
     * 醒来发现盘上的东西比快照还少时，自动救回来之后说的话。
     *
     * 这条提示的意义在于：用户本来会看到「我的东西没了」，
     * 现在他看到的是「我们发现它少了，已经放回去了」——
     * 同一件事，两种完全不同的感受。
     */
    restoredFromSnapshot:
      '打开时发现本地数据比上一份快照少了 {missing} 件（很可能是上次没存完就关掉了页面）。已自动从那份快照恢复，现在有 {count} 件物品，请核对一下。',
    snapshotRestored: '已回退到所选快照（{count} 件物品）',
    /*
     * 回退会**改变物品数量**，所以要如实报出前后差别（issue 16）。
     * 少了的时候尤其要说清楚 —— 那正是用户会慌的那一刻。
     */
    snapshotRestoredMore:
      '已回退：物品从 {before} 件变成 {after} 件（多了 {delta} 件）',
    snapshotRestoredFewer:
      '已回退：物品从 {before} 件变成 {after} 件（少了 {delta} 件）。少掉的还在上一份快照里，可以再回退回来。',
  },

  /* ---------------- 快照 ---------------- */
  snapshot: {
    reasonAuto: '自动',
    reasonImport: '导入前',
    reasonManual: '手动备份',
    reasonDestructive: '删除前',
  },

  /* ---------------- 导出 ---------------- */
  export: {
    /* 文件名里带时间戳，同一天导出多次不会互相覆盖 */
    csvFilename: '断舍离-物品清单-{stamp}.csv',
    jsonFilename: '断舍离-备份-{stamp}.json',
    generator: '断舍离 v{version}',

    /* CSV 表头是给人看的，表格软件里一眼要能懂 */
    csvName: '名称',
    csvQuantity: '数量',
    csvStatus: '状态',
    csvExpiry: '有效期至',
    csvCategories: '分类',
    csvLocation: '位置',
    csvTags: '标签',
    csvNote: '备注',
    csvCreatedAt: '创建时间',
    csvUpdatedAt: '最后修改',
  },

  /* ---------------- 从 CSV 物品清单恢复 ---------------- */
  /*
   * CSV 本来是「只能看、不能拿来恢复」的格式。补上这条路之后，
   * 这些文案有一个额外义务：**必须让人知道它补不回什么**。
   * 看起来像一次完整恢复，比老实说「只能救回一部分」危险得多。
   */
  csv: {
    empty: '这个文件里没有任何行。',
    noNameColumn: '认不出「名称」这一列 —— 这看起来不是本程序导出的物品清单。',
    noItems: '没有解析出任何物品（每一行都缺名称）。',

    warnNotABackup:
      '这是从 CSV 清单恢复的，不是原始备份。能救回来的都在这里了，但下面几样找不回来。',
    warnCollections: '活动归属（旅行 / 学习 这类）找不回来 —— CSV 里没有这一列。',
    warnLists: '清单找不回来 —— CSV 里没有这一列。',
    warnCategoryTree:
      '分类的层级找不回来：CSV 只写了分类名字，父子关系在导出时就丢了。所以现在全都是顶层分类，需要的话去「分类」页重新归拢。',
    warnAttrTypes:
      '属性的类型找不回来：一律按「文本」建，单位从表头的括号里取。需要的话去「属性」页改。',
    warnSkipped_one: '有 {count} 行没有名称，已跳过。',
    warnSkipped_other: '有 {count} 行没有名称，已跳过。',
  },

  /* ---------------- AI 客户端的错误映射 ---------------- */
  ai: {
    noKey: '还没有填写 DeepSeek API Key。',
    auth: 'API Key 无效。请检查是否复制完整（通常以 sk- 开头），以及是否已经过期。',
    balance: '账户余额不足。请到 DeepSeek 开放平台充值后再试。',
    badRequest: '请求格式不对，DeepSeek 拒绝了这次调用。',
    badParams: '请求参数不被接受。',
    rateLimit: '请求太频繁或已达到速率上限，等一会儿再试。',
    server: 'DeepSeek 服务端暂时出问题了，稍后再试。',
    unexpectedStatus: 'DeepSeek 返回了意外的状态码 {status}。',
    notJson: 'DeepSeek 返回的内容不是合法 JSON，可能被网络拦了。',
    emptyContent: 'DeepSeek 这次没有返回内容（偶发情况）。直接再点一次通常就好了。',
    aborted: '已取消。',
    network: '连不上 DeepSeek。请检查网络；如果你在用广告拦截插件，它可能拦了这个请求。',

    /* 回复能拿到、但结构不对 —— 这些是解析层的判断，所以都带上「原文开头」 */
    emptyResponse: 'DeepSeek 返回了空内容。',
    noJsonFound: '没能从 AI 的回复里找到 JSON。原始回复开头是：{snippet}',
    noItemList: 'AI 的回复里没有找到物品列表。可能是这段文字里没有可识别的物品。',
    badShape: 'AI 的回复不是预期的结构。',
    noReplyOrItems: 'AI 的回复里既没有说明也没有物品列表。',
  },
}
