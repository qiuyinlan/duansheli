/**
 * 首次使用的起步脚手架。
 *
 * 这些名字会**真的写进数据库**，成为用户自己的数据，所以它们**按首次启动时的
 * 界面语言生成一次**，之后切换语言不会去改动已有数据 ——
 * 不然你辛苦改过的分类名会被悄悄翻译掉，那是很糟的体验。
 *
 * 属性定义里的单位（元）也一样进数据，所以也得跟着语言走。
 */
export const seed = {
  /* 位置树：从顶层往下，父节点总在子节点之前 */
  home: '家',
  bedroom: '卧室',
  livingRoom: '客厅',
  kitchen: '厨房',
  study: '书房',
  bathroom: '卫生间',
  balcony: '阳台',
  storage: '储物间',
  wardrobe: '衣柜',
  nightstand: '床头柜',
  underBed: '床下收纳',
  tvStand: '电视柜',
  sideboard: '储物柜',
  shoeCabinet: '鞋柜',
  desk: '书桌',
  bookshelf: '书架',
  cupboard: '橱柜',
  fridge: '冰箱',
  storageBox: '收纳箱',
  shelf: '货架',

  /* 顶层分类 */
  catClothing: '衣物',
  catElectronics: '电子',
  catBooks: '书籍',
  catKitchen: '厨房',
  catDaily: '日用品',
  catMedicine: '药品',
  catStationery: '文具',
  catTools: '工具',
  catKeepsake: '纪念品',
  catOther: '其他',

  /* 属性库 */
  attrBrand: '品牌',
  attrPurchaseDate: '购入日期',
  attrPrice: '价格',
  attrPriceUnit: '元',
  attrColor: '颜色',
  attrSize: '尺寸',
  colorBlack: '黑',
  colorWhite: '白',
  colorGrey: '灰',
  colorWood: '木色',
  colorColorful: '彩色',

  /* 标签 */
  tagGiveAway: '想送人',
  tagReluctant: '舍不得扔',
  tagToRepair: '待维修',
}
