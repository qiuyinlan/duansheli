/**
 * 英文词典。
 *
 * 唯一强约束就在下面那行 `: Dict` —— 它是「英文必须和中文一一对应」的全部实现。
 * 加 key、删 key、改嵌套结构，只要两边不一致，`tsc` 立刻报错。
 *
 * 翻译口径（保持全站一致）：
 *   · 语气用平实的祈使句，不客套、不营销腔 —— 和中文版一个调子
 *   · 按钮用动词（Save / Delete），不用名词
 *   · 界面上的「件」译成 items，不译成 pieces（后者指零件）
 *   · 导航词尽量短，手机底部只有 5 格，长了会挤
 */

import type { Dict } from '../zh'
import { ai } from './ai'
import { attributes } from './attributes'
import { categories } from './categories'
import { chart } from './chart'
import { checklists } from './checklists'
import { collections } from './collections'
import { common } from './common'
import { data } from './data'
import { expiry } from './expiry'
import { format } from './format'
import { idle } from './idle'
import { itemEdit } from './itemEdit'
import { items } from './items'
import { locations } from './locations'
import { more } from './more'
import { nav } from './nav'
import { overview } from './overview'
import { seed } from './seed'
import { settings } from './settings'
import { spare } from './spare'
import { status } from './status'
import { tags } from './tags'
import { tree } from './tree'

export const en: Dict = {
  common,
  nav,
  status,
  format,
  seed,
  overview,
  items,
  itemEdit,
  locations,
  categories,
  attributes,
  tags,
  collections,
  checklists,
  tree,
  chart,
  idle,
  spare,
  expiry,
  settings,
  more,
  ai,
  data,
}
