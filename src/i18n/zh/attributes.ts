/**
 * 属性库页面：定义「可以填哪些属性」。
 *
 * 属性类型的名字（文本 / 数字 / …）直接借 `itemEdit` 的那一套 ——
 * 录入时的属性勾选器用的是同一批词，分开写两遍迟早会不一致。
 *
 * 属性名、选项值都是**用户自己的数据**，一律不翻译，所以这里看不到它们。
 */
export const attributes = {
  /* 页面标题借 nav.titleAttributes */
  subtitle: '这里定义「可以用哪些属性」，录入时再按需勾选 —— 用不上就不会出现在表单里。',
  newField: '新建属性',
  titleEdit: '编辑属性',

  /* 空状态 */
  emptyTitle: '属性库还是空的',
  emptyHint1: '想记什么就定义什么，常见的有：品牌、购入日期、价格、颜色、尺寸、型号。',
  emptyHint2: '定义好之后，录入物品时勾一下就能填。',
  emptyAction: '新建第一个属性',

  /* 列表里的元信息 */
  optionCount_one: '{count} 个选项',
  optionCount_other: '{count} 个选项',
  showByDefaultShort: '默认勾选',
  usage_one: '{count} 处使用',
  usage_other: '{count} 处使用',

  /* 表单 */
  fieldName: '属性名称',
  namePlaceholder: '例如：品牌',
  fieldType: '类型',
  typeOptText: '文本 —— 随便写',
  typeOptNumber: '数字 —— 可以比较大小',
  typeOptDate: '日期',
  typeOptSelect: '单选 —— 只能从固定选项里挑',
  typeOptBool: '是 / 否',
  fieldOptions: '选项',
  optionsCommaHint: '用逗号分隔',
  optionsPlaceholder: '黑，白，灰，木色',
  fieldUnit: '单位',
  unitPlaceholder: '例如：元、cm、kg',
  showByDefault: '录入物品时默认勾选这个属性',
  formHint: '提示：录入时勾选过一次之后，程序会记住「这个分类常用哪些属性」，下次自动带上。',

  /* 提示 */
  needOption: '单选类型至少需要一个选项',
  duplicate: '已经有一个叫「{name}」的属性了',
  addedToast: '已添加属性',
  savedToast: '已保存（已有物品上的值不会丢失）',
  deletedToast: '已删除属性',

  /* 删除确认。数字夹在句子中间，所以拆成前后两半，各自带单复数 */
  deleteTitle: '删除属性「{name}」？',
  deleteInUseLead: '有 ',
  deleteInUseTail_one: ' 处已经填了这个属性的值。',
  deleteInUseTail_other: ' 处已经填了这个属性的值。',
  deleteInUseNote:
    '删除后这些值将不再显示（物品本身和其他信息都不受影响）。删除前会自动存一份快照，之后也可以回退。',
  deleteUnused: '还没有任何物品填过这个属性，可以放心删除。',
}
