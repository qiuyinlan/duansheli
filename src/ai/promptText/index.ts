/**
 * 按当前界面语言取提示词。
 *
 * 为什么在这里读语言、而不是让调用方传进来：
 * 提示词是在**发请求的那一刻**构建的，读当前语言正好是想要的行为
 * （用户切了语言，下一个问题就用新语言问）。
 * 如果改成传参，`buildExtractionMessages` 那一串签名都得跟着改，
 * 收益为零。
 */

import { getLang } from '../../i18n'
import { promptTextEn } from './en'
import { promptTextZh } from './zh'
import type { PromptText } from './types'

export { fill } from './types'
export type { PromptText }

export function promptText(): PromptText {
  return getLang() === 'en' ? promptTextEn : promptTextZh
}
