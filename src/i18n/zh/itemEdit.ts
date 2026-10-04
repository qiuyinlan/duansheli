/**
 * 录入 / 编辑物品的表单，以及表单里用的那三个选择器
 * （位置、分类、属性勾选、标签输入）。
 *
 * 只放这个界面区域自己的文案。通用的按钮直接借 `common`（保存 / 关闭 / 新建 / 必填…），
 * 表单里的「有效期至」那一段借 `expiry` —— 那边物品行、独立页面用的是同一套词，
 * 分开写两遍迟早会不一致。
 *
 * 注意：分类名、位置名、标签、属性名都是**用户自己的数据**，一律不翻译，
 * 所以这里看不到它们。
 */
export const itemEdit = {
  /* 页面标题与副标题 */
  titleEdit: '编辑物品',
  subtitleEdit: '改完记得保存',
  subtitleNew: '只有名称是必填的，其余都可以以后慢慢补',
  discard: '舍弃',
  discardedToast: '已移入「{status}」，可在设置里找回',

  /* 找不到这件物品 */
  notFoundTitle: '找不到这件物品',
  notFoundHint: '它可能已经被彻底删除了。',
  backToItems: '回到物品列表',

  /* 名称（唯一的必填项） */
  fieldName: '名称',
  namePlaceholder: '写得具体一点，例如「灰色羊毛衫」而不是「毛衣」',
  nameRequired: '先给这件物品起个名字吧',

  /* 位置 */
  fieldLocation: '位置',
  locationPick: '未归位（点击选择）',
  locationClear: '清空位置',

  /* 分类 */
  fieldCategories: '分类',
  categoriesChoose: '选择分类',
  categoriesChange: '修改分类',
  categoriesHint: '一件物品可以同时属于多个分类。',
  removeCategoryAria: '移除分类 {name}',

  /* 数量、状态 */
  fieldQuantity: '数量',
  fieldStatus: '状态',
  idleOn: '标记为闲置 —— 会出现在「闲置」页面里，等着被处理',
  idleOff: '在用（打开开关可以标记为闲置）',

  /* 更多（标签、备注） */
  moreToggle: '更多（标签、活动、备注）',
  fieldTags: '标签',
  tagsHint: '标签适合记「情境」而不是「是什么」，例如「想送人」「舍不得扔」。',
  fieldCollections: '属于哪些活动',
  collectionsHint: '旅行、学习这类。一件东西可以同时属于多个活动，点一下就切换。',
  collectionPlaceholder: '输一个新活动名字，回车新建',
  noCollectionsYet: '还没有任何活动 —— 在下面输一个名字就能建。',
  fieldNote: '备注',
  notePlaceholder: '任何想记下来的事，比如「妈妈送的」「有点漏水」',

  /* 属性 */
  fieldAttributes: '属性',
  attributesHint: '只加这次需要的。不勾的属性不会出现在表单里。',
  addAttributes: '添加属性',
  attributesEmptyLibrary: '属性库还是空的，可以在「属性」页面里定义。',
  attributesEmptySelected: '还没有选择任何属性。',
  removeAttrTitle: '不再填写「{name}」',
  /** 属性名后面的单位，中文用全角括号 */
  attrUnitParen: '（{unit}）',
  attrNotSet: '未填写',

  /* 底部按钮与快捷键 */
  saveAndContinue: '保存并继续录入',
  saveAndBack: '保存并返回',
  ctrlEnterHint: '按 Ctrl / ⌘ + Enter 也是「保存并继续」',
  savedContinue: '已保存，继续录入下一件',

  /* 位置选择器 */
  pickLocationTitle: '选择位置',
  pickLocationCurrent: '当前：{path}',
  locationsEmpty: '还没有位置，可以在「位置」页面里创建。',

  /* 分类选择器 */
  pickCategoryTitle: '选择分类',
  pickCategoryHint: '点分类名切换选中，可以选多个。分类是多级的，物品挂在哪一级都可以。',
  categoriesEmpty: '还没有分类，在下面新建一个。',
  newTopCategory: '新建顶层分类',
  newCategoryPlaceholder: '例如：化妆品',
  duplicateCategory: '顶层已经有一个叫「{name}」的分类了',
  subCategoryHint: '想建子分类（比如「化妆品 › 眼妆」）请到「分类」页面，那里可以建任意层级。',
  /** 两个选择器底部那个带计数的确认按钮 */
  pickConfirm: '确定（已选 {count}）',

  /* 标签输入 */
  removeTagAria: '移除标签 {name}',
  tagPlaceholder: '输入标签后按回车，例如：想送人',

  /* 属性勾选器 */
  pickAttrTitle: '选择要填的属性',
  attrPickerEmpty:
    '属性库还是空的。去「属性」页面定义几个（比如品牌、购入日期、价格），之后就能在录入时按需勾选。',
  attrPickerHint: '只勾选这次真正需要的。不勾的属性不会出现在表单里，也不会占地方。',
  attrTypeSelect: '单选',
  attrTypeBool: '是/否',
  attrTypeDate: '日期',
  attrTypeNumber: '数字',
  attrTypeNumberUnit: '数字（{unit}）',
  attrTypeText: '文本',
}
