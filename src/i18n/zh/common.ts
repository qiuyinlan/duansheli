/**
 * 通用：到处都在用的按钮、单位、确认框、提示。
 *
 * 判断标准：**三个以上地方用**才放这里。只在一个页面出现的文案
 * 留在那个页面的命名空间里，免得 common 变成一个大杂烩。
 */
export const common = {
  /* 按钮 */
  save: '保存',
  cancel: '取消',
  confirm: '确定',
  delete: '删除',
  edit: '编辑',
  close: '关闭',
  back: '返回',
  add: '添加',
  remove: '移除',
  search: '搜索',
  clear: '清除',
  reset: '重置',
  retry: '重试',
  copy: '复制',
  rename: '重命名',
  move: '移动',
  create: '新建',
  done: '完成',
  selectAll: '全选',
  selectNone: '全不选',
  expand: '展开',
  collapse: '收起',

  /* 状态词 */
  loading: '加载中…',
  saving: '正在保存…',
  empty: '暂无内容',
  unspecified: '未指定',
  optional: '可选',
  required: '必填',
  yes: '是',
  no: '否',
  on: '开',
  off: '关',
  none: '无',
  all: '全部',
  unknown: '未知',

  /* 单位（跟数量拼在一起时用，所以自带量词） */
  itemUnit: '件',
  dayUnit: '天',
  yearUnit: '年',

  /* 提示 */
  saved: '已保存',
  deleted: '已删除',
  copied: '已复制',
  nothingToDo: '没有需要处理的东西',

  /* 确认框 */
  confirmDeleteTitle: '确认删除？',
  confirmDeleteBody: '删掉之后就找不回来了。',
  cannotUndo: '这个操作不能撤销。',

  /* 无障碍 */
  selectItemAria: '选择「{name}」',

  /* 语言开关 */
  language: '语言',
  languageSwitchTo: '切换到{lang}',
  languageHint: '只改变界面文字，你录入的内容不会被翻译。',

  /* 无障碍标签（屏幕上看不见，但读屏软件会念） */
  clearSearchAria: '清空搜索',
  closeAria: '关闭',
  closeAlertAria: '关闭提示',

  /* 启动阶段：本地数据打不开时的整屏提示 */
  openingData: '正在打开本地数据…',
  openDataFailed: '无法打开本地数据',
  openDataReason1:
    '常见原因：浏览器处于无痕 / 隐私模式，或禁用了网站数据存储。请改用普通窗口打开；',
  openDataReason2: '如果是 iPhone，请在「设置 → Safari → 高级 → 网站数据」中确认没有禁用。',
  /*
   * 卡住时的出路。
   *
   * 以前这里是一个**永远转下去的圈**：没超时、没说明、没重试，
   * 用户既不知道是不是坏了，也没法自救 —— 只能来问我「打不开了」。
   */
  initSlowTitle: '打开本地数据卡住了',
  initSlowHint:
    '正常情况下这一步是瞬间的。常见原因：本站还在另一个标签页里开着、浏览器禁用了网站数据存储、或者本地数据库被占用。可以先点「重试」；还不行就重新加载页面。你的数据不会因此丢失。',
  reload: '重新加载',

  /* 渲染出错时的兜底屏（ErrorBoundary） */
  crashTitle: '这一页出错了',
  crashHint:
    '页面没能画出来，但你的数据没有丢 —— 它一直在浏览器的本地数据库里，刷新一下通常就能恢复。下面这行是具体原因，可以复制给开发者。',
  crashGoHome: '回概览',
  crashWhere: '出错的位置（组件栈）：',

  /* 挂在某个名字后面的小标记，如「车库 / 货架（新）」 */
  newSuffix: '（新）',

  /* 只在开发期可能出现的致命错误 */
  mountPointMissing: '找不到 #root 挂载点',
}
