/**
 * 云端同步（Supabase）。
 *
 * ── 这一区的文案有一条额外义务 ──────────────────────────────────
 * 同步是这个项目里第一个**会把数据送到别处**的功能。用户要在这块界面上决定
 * 「登不登录、用哪边的数据覆盖哪边」，而这两个决定都可能让数据变少。
 * 所以这里的文案不能只写「同步成功」这种话，得把三件事说清楚：
 *   1. 数据存到哪去了（存到**他自己的** Supabase 项目里，不是我们的服务器）
 *   2. 本地那份还在（云端是副本，不是主副本）
 *   3. 覆盖类操作会丢什么（并且默认选中「合并」）
 */
export const cloud = {
  /* ---------------- 面板标题 ---------------- */
  title: '云端同步',
  desc:
    '让电脑和手机看到同一份数据。数据仍然存在这台设备上，云端是它的副本 —— ' +
    '断网、退出登录都照常能用。',

  /* ---------------- 还没配置 ---------------- */
  notConfiguredTitle: '还没配置云端',
  notConfiguredBody:
    '这个版本里没有 Supabase 的地址和 anon key，所以同步功能整体是关掉的。' +
    '本地功能和以前一模一样，不受影响。想开的话照下面四步走一遍：',
  /*
   * 这条是专门回答「我怎么没看到登录的地方」的。
   *
   * 登录表单**故意**只在配好之后才出现 —— 没配的时候显示一个填了也连不上的
   * 登录框，比不显示更糟（用户会以为是自己账号的问题）。
   * 但这份好意必须写出来，否则用户只看到「没有登录入口」，找不到原因。
   */
  notConfiguredWhere:
    '配好那两个变量、把开发服务器重启一次之后，登录表单就会出现在这块地方。',
  notConfiguredStep1: '在 supabase.com 建一个项目（免费档就够用）',
  notConfiguredStep2: '在项目的 SQL Editor 里跑一遍仓库里的 supabase/schema.sql（建表 + 访问规则）',
  notConfiguredStep3:
    '在 Authentication 里打开 Email 登录方式，并按文档决定要不要开「Confirm email」',
  notConfiguredStep4:
    '把 Project URL 和 anon key 写进 .env.local（本地开发）或仓库的 Secrets（线上部署），重新构建',
  notConfiguredDocsLead: '完整步骤（含每一步该点哪里）见 ',
  notConfiguredDocsFile: 'docs/supabase-接入步骤.md',
  notConfiguredShort: '还没配置云端（缺 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY）。',

  /*
   * 配置本身有问题时，要说清是哪一种。
   *
   * 尤其是 Secret key 那条：它不是「还没配好」，而是一个**必须马上处理的事故**——
   * 那把钥匙能绕过数据库的访问规则读到所有人的数据，
   * 而前端代码是人人可见的（它会被打进网页 JS）。这里必须把人拦住、说清补救动作。
   */
  problemPlaceholder:
    '看起来还是 .env.example 里的示例值。把 xxxx 换成你自己的 Project URL 和 key，再重启开发服务器。',
  problemSecretTitle: '危险：你填的是 Secret key，不能放进前端',
  problemSecretBodyA: '这把钥匙能',
  problemSecretBodyBold: '绕过数据库的访问规则',
  problemSecretBodyC:
    '（RLS），读到所有人的数据。而前端代码会原样打进网页 JS，谁都能看到。' +
    '如果你已经把它部署出去过，请去 Supabase 控制台的 API Keys 里撤销它并重新生成一把 —— 那种情况下撤销是唯一能补救的动作。' +
    '正确的那把叫 Publishable key（老界面叫 anon / public），它们指的是同一种角色。' +
    '云端功能已经因为这个原因关掉了，本地功能不受影响。',

  /* ---------------- 登录 ---------------- */
  signInTitle: '登录同一个账号',
  signInDesc: '电脑和手机各登录一次同一个邮箱，两边就会互相同步。第一次用先注册。',
  emailLabel: '邮箱',
  emailPlaceholder: 'you@example.com',
  passwordLabel: '密码',
  passwordPlaceholder: '至少 6 位',
  passwordHint: '邮箱和密码只发给 Supabase，不会存到别的地方，也不会进导出的备份文件。',
  signIn: '登录',
  signUp: '注册',
  signingIn: '正在登录…',
  signingUp: '正在注册…',
  signInOk: '登录成功，正在同步…',
  signUpOk: '注册成功，已登录。',
  signUpNeedConfirm:
    '注册成功。请到邮箱里点一下确认链接，再回来登录 —— 你的项目开着「确认邮箱」，' +
    '没确认之前 Supabase 不会给你会话。',
  signOut: '退出登录',
  loggedOutToast: '已退出登录。本地数据一件都没删。',
  signedInAs: '已登录：',

  /* ---------------- 状态 ---------------- */
  statusLabel: '状态',
  statusOff: '未登录',
  statusIdle: '已同步',
  statusSyncing: '同步中…',
  statusError: '同步失败',
  statusOutdated: '需要更新程序',
  statusPending: '有改动待同步',
  lastSyncLabel: '上次同步',
  neverSynced: '还没同步过',
  syncNow: '立即同步',
  deviceLabel: '这台设备',
  deviceHint:
    '每台设备一个编号。两台设备编号不同是正常的 —— 它只用来判断「这份数据是不是我自己刚推上去的」，' +
    '免得同一份东西来回推。',

  /* ---------------- 出错时的说法 ---------------- */
  errorBadCredentials: '邮箱或密码不对。',
  errorEmailNotConfirmed: '这个邮箱还没确认。请到邮箱里点确认链接，再回来登录。',
  errorAlreadyRegistered:
    '这个邮箱已经注册过了。直接登录就行；忘了密码就在 Supabase 控制台的 Authentication 里重置。',
  errorWeakPassword: '密码太短了，至少 6 位。',
  errorRateLimited: '请求太频繁，被 Supabase 临时挡住了。等几分钟再试。',
  errorSignupDisabled: '这个项目关闭了注册。请用已有的账号登录。',
  errorBadEmail: '邮箱格式不对。',
  errorNetwork:
    '连不上云端。本地数据不受影响，联网后会自动再同步。' +
    '如果一直失败，多半是网络到不了 {host} 这个域名（它和控制台那个域名不是一回事，' +
    '很容易和代理设置冲突）—— 在浏览器里直接打开 {host}/rest/v1/ 试一下，' +
    '或者跑 npm run check:supabase 看详细原因。',
  errorNoTable: '云端还没建表。请到 Supabase 的 SQL Editor 里跑一遍 supabase/schema.sql。',
  errorGeneric: '同步失败：{message}',
  outdated:
    '云端那份数据来自更新的程序版本。请先更新这个应用（或者在写出它的那台设备上升级），' +
    '再同步 —— 现在硬同步会把新版本才认识的字段丢掉。',
  detailLabel: '技术细节',
  detailShow: '展开',
  detailHide: '收起',

  /* ---------------- 别人删了东西 ---------------- */
  /*
   * 这条必须弹。别的设备删掉一样东西，这台设备上它会**当场消失** ——
   * 不说一声的话，用户看到的就是「我的东西怎么少了」，
   * 而这是这个项目最不能接受的一类意外。
   */
  removedByOtherDevice_one: '另一台设备删掉了 {count} 项，这台设备上刚刚同步掉了。',
  removedByOtherDevice_other: '另一台设备删掉了 {count} 项，这台设备上刚刚同步掉了。',

  /* ---------------- 首次绑定：用哪一边 ---------------- */
  choiceTitle: '云端已经有数据了',
  choiceDesc:
    '云端那份不是空的，而这台设备上也有数据。两边都有东西时该怎么合，只有你自己清楚 —— ' +
    '选一个（不确定就选合并）：',
  choiceLocalLabel: '这台设备',
  choiceRemoteLabel: '云端（{at} 写入）',
  choiceItems_one: '{count} 件物品',
  choiceItems_other: '{count} 件物品',
  choiceMerge: '合并（推荐）',
  choiceMergeDesc:
    '两边求并集：谁那儿都没有的会留下，同一个 id 取改动时间较新的那一份。' +
    '代价是分类和位置可能各留一份（两台设备各自建的 id 不同，名字一样也不会自动认成同一个）。',
  choicePush: '用这台设备的覆盖云端',
  choicePushDesc:
    '云端那份会被整份替换。如果云端是另一台设备上正经录入的，这一步就把它盖掉了。',
  choicePull: '用云端的覆盖这台设备',
  choicePullDesc: '这台设备上的数据会被整份替换。当前这份还能在本次同步前导出一份备份。',
  choiceConfirm: '就用这个',
  firstSyncMerged: '已经和云端合并过了。',
  firstSyncPushed: '已用这台设备的数据覆盖云端。',
  firstSyncPulled: '已用云端的数据覆盖了这台设备。',

  /* ---------------- 连接自检（面板上那个「测试连接」） ---------------- */
  /*
   * 这几条的措辞有个共同要求：**说清是哪一类问题**。
   * 「同步失败」四个字底下藏着网络阻断、浏览器扩展拦截、钥匙错、没建表、
   * 没开邮箱登录至少五种原因，而它们的界面表现几乎一样。
   */
  probeTitle: '测试连接',
  probeRunning: '正在测试…',
  probeHint:
    '发三个只读请求：能不能连上、表建了没、邮箱登录开了没。不写任何数据，也不用登录。',
  probeReachOk: '连上了，而且这把钥匙被接受',
  probeReachDenied: '连上了，但钥匙被拒绝（多半是复制时少了字符，或者这把钥匙已经撤销了）',
  probeBlocked: '请求没能发出去：{message}',
  /*
   * 这一条和下面那条的分工：不带钥匙的请求**通没通**。
   * 通 → 域名没问题，卡在「带自定义头的跨域请求要先过预检（OPTIONS）」这一环，
   *       常见原因是代理规则、安全软件、或扩展在动带自定义头的请求。
   * 不通 → 根本没连上，换网络 / 关扩展。
   * 这个区分很值：它把「换网络」和「关软件」两件完全不同的事分开了。
   */
  probeBlockedWithKey:
    '这个域名是通的（不带钥匙的请求过去了），但带上钥匙的那个请求发不出去：{message}',
  probeBlockedWithKeyHint:
    '这种组合说明域名和网络都没问题，卡在「带自定义请求头的跨域请求要先过一个预检（OPTIONS）」这一环。' +
    '常见原因：代理软件 / 安全软件 / 浏览器扩展在改动或拦截带自定义头的请求。' +
    '先试无痕窗口（无痕默认不加载扩展）；还不行就临时关掉代理或安全软件再点一次，看是不是它们。',
  probeBlockedHint:
    '最常见的原因是代理没生效：你的项目域名（<项目>.supabase.co）在不少网络下会被重置' +
    '（TCP 连得上、TLS 握手却被 RST），而 supabase.com（控制台那个域名）却是通的 —— ' +
    '于是「我明明能打开控制台」会把人带偏。先确认平时用的代理是开着的，' +
    '并且把它切成全局模式再试一次。' +
    '如果代理确定没问题，那就是浏览器扩展拦的：手打地址能打开、页面发出的请求却被掐掉，' +
    '正是广告拦截 / 隐私保护类扩展的典型行为 —— 用无痕窗口再试一次（无痕默认不加载扩展）。',
  probeTableLocked: '表建好了，而且未登录的人读不到它 —— 这正是我们要的状态',
  probeTableMissing: '表还没建。去 Supabase 的 SQL Editor 里跑一遍 supabase/schema.sql',
  probeTableOpen: '警告：未登录竟然能读到数据',
  probeTableOpenNote:
    '说明行级安全没生效，或者给 anon 角色开了读权限。请重跑 supabase/schema.sql —— ' +
    '这不是「配置不全」，是别人可能读到你全部数据的安全问题。',
  probeAuthOff: '邮箱登录没开。去 Authentication → Providers → Email 打开',
  probeAuthAuto: '邮箱登录已开启；注册之后可以直接登录（不需要点邮件确认）',
  probeAuthConfirm: '邮箱登录已开启；注册之后要去邮箱点一下确认链接才能登录',
  probeSignupOpen:
    '注册目前是开着的。注册完自己的账号后建议关掉（Authentication → Allow new users to sign up）—— ' +
    '这个网址是公开的，别人能自己注册来占用你的项目配额（读不到你的数据，但会白占资源）。',
  probeSignupClosed: '注册已关闭。如果你还没注册过账号，先临时打开一次，注册完再关掉。',
  probeOdd: '返回了意料之外的结果（见下面的技术细节）',
  probeStatus: 'HTTP {status}',

  /* ---------------- 退出登录 ---------------- */
  logoutConfirmTitle: '退出登录？',
  logoutConfirmBody: '退出只是断开这台设备的同步，本地数据一件都不会删，随时可以再登录。',
  logoutConfirmNote:
    '之后再换别的账号登录时，会重新问一次「用哪边的数据」，所以不用担心串号。',

  /* ---------------- 数据放在哪 ---------------- */
  privacyLead: '登录之后，数据会保存到',
  privacyBold: '你自己的 Supabase 项目',
  privacyTail:
    '里，一个账号一行。数据库那边的行级安全策略保证只有你自己读得到它 —— ' +
    'anon key 是公开的（它会被打进网页里），所以那条策略必须在建表时一起跑上，' +
    'supabase/schema.sql 里已经有了。本地 IndexedDB 仍然是主副本：断网照常录入，' +
    '联网之后自动补同步。',
}
