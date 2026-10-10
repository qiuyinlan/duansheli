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
import './categoryFix'
import './expiry'
import './collections'
import './spare'
import './csv'
import './aiVocab'
// AI 输入框旁边那套（快捷指令 / 补全 / 预检）的规则 —— 纯逻辑，jsdom 没法打字
import './aiCommands'
// AI 整理分类（新建/改名/移动/删除）—— 纯逻辑，算和写分开
import './categoryEdit'
// AI 新建位置（用户报的「需要可以新建位置」）—— 同一套分工
import './locationEdit'
import './storage'
// 数据丢失：init 不能把还没落盘的新东西冲掉（issue 10）
import './dataLoss'
// 两份数据的差异、快照件数、合并只做加法（issue 14/15/16）
import './diff'
// 云端同步：信封 / 删除墓碑 / 两台设备收敛（纯逻辑，不连网）
import './cloud'
import './ai'
import './i18n'
import './render'
// 状态一致性：列表说什么、点进去就得是什么（issue 13）
import './statusConsistency'
// 体检会清空真实的 IndexedDB，放最后 —— 免得把前面用例依赖的数据擦掉
import './diagnose'
// 同上：会话用例也会写 IndexedDB 与 store 状态，放在最后
import './aiSession'
// 云端同步引擎（接假云端）：首次绑定不许替用户决定、冲突要先合并。
// 它同样会写 store 与 IndexedDB，所以排在最后 —— 而且自己负责恢复现场
import './cloudEngine'

import { finish } from './harness'

finish()
