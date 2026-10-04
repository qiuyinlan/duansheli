/**
 * 测试入口。
 *
 * 注意顺序：
 *   1. fake-indexeddb 必须最先求值，它会给 globalThis 装上 IndexedDB，
 *      之后的持久化链路才是真的在跑。
 *   2. ESM 的 import 会在本模块正文之前全部求值完，所以两个测试文件里的
 *      顶层 await 都会跑完，finish() 最后才汇总。
 */

import 'fake-indexeddb/auto'
import './dom'

import './smoke'
import './expiry'
import './collections'
import './spare'
import './csv'
import './aiVocab'
import './storage'
import './ai'
import './i18n'
import './render'
// 体检会清空真实的 IndexedDB，放最后 —— 免得把前面用例依赖的数据擦掉
import './diagnose'
// 同上：会话用例也会写 IndexedDB 与 store 状态，放在最后
import './aiSession'

import { finish } from './harness'

finish()
