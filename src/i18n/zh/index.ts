/**
 * 中文词典 —— **唯一真源**。
 *
 * `en.ts` 的类型被约束成 `typeof zh`，所以：
 *   · 这里加了 key 而英文没加 → 编译不过
 *   · 英文多写了中文没有的 key → 编译不过（对象字面量的多余属性检查）
 * 双语因此不可能悄悄漂移，这比靠人记得同步可靠得多。
 *
 * ── 写法约定 ────────────────────────────────────────────────────
 * · 需要插值的地方用 `{name}`：`'共 {count} 件'`
 * · 有单复数的地方写成 `xxx_one` / `xxx_other` 一对，用 `tc(count, 'xxx')` 取。
 *   中文没有单复数，所以两条写一样的话 —— 这点冗余换来的是两份字典**形状一致**，
 *   而形状一致正是上面那套类型约束能成立的前提。
 * · 按界面区域分命名空间，一个命名空间一个文件
 */

import { ai } from './ai'
import { attributes } from './attributes'
import { categories } from './categories'
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
import { status } from './status'
import { tags } from './tags'

export const zh = {
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
  idle,
  expiry,
  settings,
  more,
  ai,
  data,
}

export type Dict = typeof zh

/** 词典里所有叶子节点的点号路径，例如 'nav.items' | 'common.save' | ... */
export type DictKey = Paths<Dict>

type Paths<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${Paths<T[K]>}`
}[keyof T & string]

/**
 * 能用在 tc() 上的词干 —— 也就是所有「有 _one 变体」的 key 去掉后缀。
 * 这样 tc(3, 'items.found') 里拼错的词干会直接编译不过。
 */
export type PluralStem = DictKey extends infer K
  ? K extends `${infer Stem}_one`
    ? Stem
    : never
  : never
