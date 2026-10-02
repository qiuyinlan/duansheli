/**
 * 发给 AI 的提示词：**结构定义**。
 *
 * 两份提示词（中文 / 英文）必须形状一致，所以先在这里把「有哪些段文字」
 * 定义清楚，zh.ts 和 en.ts 各自去填。少填一段、拼错一个键，编译就报错 ——
 * 和界面词典是同一套思路。
 *
 * 为什么不把两份提示词合成一份「中英混排」的：
 * 实测下来混排会让模型偶尔跟着另一种语言输出（尤其在要它「只返回 JSON」时），
 * 而提示词是 AI 质量的地基，不值得为省事冒这个风险。
 *
 * ⚠️ 改中文版时**务必同步英文版**。中文版是调优过的基准，英文版是它的直译加
 * 少量措辞调整（英文的技术说明习惯更直白）。改完跑 tests/ai.ts 里的双语一致性用例。
 */

export interface PromptText {
  /* ---------------- 一、从自由文字抽取物品 ---------------- */

  /** 抽取任务的角色与全部规则 */
  extractionSystem: string
  /** 分批时的开头说明。{index} / {total} 由调用方替换 */
  extractChunkHeader: string
  /** 用户原文的标签行 */
  extractInputLabel: string

  /* ---------------- 上下文块（用户现有的体系） ---------------- */

  ctxCategoriesHead: string
  ctxNoteIntro: string
  ctxNote1: string
  ctxNote2a: string
  ctxNote2b: string
  ctxNote2c: string
  ctxCategoriesEmpty: string
  ctxLocationsHead: string
  ctxLocationsNote: string
  ctxLocationsEmpty: string
  ctxAttributesHead: string
  ctxAttributesEmpty: string
  ctxTagsHead: string
  ctxTagsEmpty: string
  ctxTruncated: string
  /** 列表分隔符。中文用顿号，英文用逗号 */
  ctxListSeparator: string

  /* ---------------- 现有物品目录（对话模式用） ---------------- */

  digestEmpty: string
  digestTitle: string
  digestByCategory: string
  digestNoCategories: string
  digestUncategorized: string
  digestByLocation: string
  digestNoLocations: string
  digestUnassigned: string
  digestIdle: string
  digestFootnote1: string
  digestFootnote2: string
  /** 目录里一条的写法：{path}（{count}） */
  digestEntry: string

  /* ---------------- 二、对话 ---------------- */

  /** 对话助手的人物设定与全部规则 */
  chatSystem: string
  /** 用户消息里那两块的小标题 */
  chatDraftLabel: string
  chatEmptyDraft: string
  chatInstructionLabel: string
}

/** {name} 形式的插值。提示词里用得到，但不需要界面词典那套复数规则。 */
export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = vars[name]
    return value === undefined ? whole : String(value)
  })
}
