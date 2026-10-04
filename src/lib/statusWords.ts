/**
 * 状态词的对照表。
 *
 * ── 为什么要单独一个模块 ────────────────────────────────────────
 * 有两处需要「把一句话里的状态词认出来」：
 *   1. `ai/parse.ts` —— 模型返回的 status 字段
 *   2. `data/csvImport.ts` —— CSV 里那一列（导出时写的是**界面上的词**）
 *
 * 各写一份的话，两边迟早会漂：比如给中文加了「囤货」这个说法，
 * 只改了一处，另一处就静默认不出来 —— 而「认不出来」的表现是
 * **状态悄悄没了**，不是报错。所以放在中立的地方，两边共用。
 *
 * 返回 `ItemStatus | null`：
 *   · `null` = 认不出来 / 没提（调用方自己决定怎么解释）
 *   · `'discarded'` 是一个正常返回值 —— AI 那边会把它转成一次删除请求，
 *     CSV 那边就是一个状态值
 */

import type { ItemStatus } from '../types'

/**
 * 别名表。
 *
 * 认这么多写法是因为来源有两类：模型有时给代码值、有时给界面上的中文、
 * 切到英文界面又给英文词；而 CSV 是**导出时按当时的界面语言写死**的，
 * 所以中英都得认。
 */
const STATUS_WORDS: Record<string, ItemStatus> = {
  active: 'active',
  在用: 'active',
  使用中: 'active',
  正常: 'active',
  'in use': 'active',
  'in-use': 'active',
  inuse: 'active',
  using: 'active',

  idle: 'idle',
  闲置: 'idle',
  闲置中: 'idle',

  spare: 'spare',
  备用: 'spare',
  备份: 'spare',
  囤货: 'spare',

  discarded: 'discarded',
  已舍弃: 'discarded',
  舍弃: 'discarded',
  丢弃: 'discarded',
  扔掉: 'discarded',
  扔了: 'discarded',
  discard: 'discarded',
  deleted: 'discarded',
  removed: 'discarded',
}

/**
 * 把一个状态词认成状态码。认不出来返回 null。
 *
 * 归一化：去首尾空白、转小写、把连续空白压成一个空格 ——
 * 模型和表格软件都可能给出「 In  Use 」这种写法。
 */
export function statusFromWords(value: unknown): ItemStatus | null {
  if (typeof value !== 'string') return null
  const text = value.trim().toLowerCase().replace(/\s+/g, ' ')
  if (text === '') return null
  return STATUS_WORDS[text] ?? null
}
