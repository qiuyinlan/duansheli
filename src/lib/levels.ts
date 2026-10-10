/**
 * 位置名字里的「几层」。
 *
 * ── 为什么单独一个文件 ──────────────────────────────────────────
 * 这件事有两个使用点，而且分属两层：
 *   · 补全（`src/ai/commands.ts`）：打一个新名字时，顺手给出它下面那几层
 *   · 位置页新建位置（`src/pages/Locations.tsx`）：一次把 1 层到 N 层建好
 * 两处必须**认同一套写法**（「白色四层收纳」= 4），否则会出现
 * 「补全给得出 4 层、新建却说认不出来」这种自相矛盾。
 *
 * ── 它只做识别，不替用户决定 ────────────────────────────────────
 * 这里的函数只回答「这个名字里写的是几层」。建不建、建几层，
 * 一律由用户点（补全里点其中一层，或者在位置页勾那个选项）——
 * 名字里认出个数字就自动建四个位置，那是替用户做主，这个项目不做。
 */

/** 中文数字。只认个位和十 —— 「二十层收纳架」这种东西不在真实用法里 */
const CN_DIGITS: Record<string, number> = {
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
}

/**
 * 名字里写的层数；认不出来返回 null。
 *
 *   「白色三层收纳」        → 3
 *   「独立白色四层收纳架」  → 4
 *   「drawer 4 tiers」      → 4
 *   「2层」                 → null  ← 它本身就是某一层，不该再给它造子层
 *   「四层收纳架」          → null  ← 名字以数字开头，看着像「某一层」而不是「几层的东西」
 *
 * 最后两条是刻意的：位置树里子层本来就叫「1层」「2层」，
 * 把这类名字也认成层数，会给出「2层 / 1层」这种荒唐的候选。
 * 所以要求**数字前面还有别的东西**。
 */
export function levelsFromName(name: string): number | null {
  const match = /^(.+?)\s*([一二两三四五六七八九十]|\d{1,2})\s*(?:层|tiers?|levels?|layers?)/.exec(
    name.trim(),
  )
  if (match === null) return null

  const raw = match[2]
  const count = /^\d+$/.test(raw) ? Number(raw) : CN_DIGITS[raw]
  if (count === undefined) return null
  /* 1 层的不叫「几层」，超过 12 层基本是名字里碰巧带了数字 */
  if (count < 2 || count > 12) return null
  return count
}

/**
 * 按层数生成子层名字：`1层` / `2层` …
 *
 * `label` 来自词汇表（`{n}层` / `"Level {n}"`），跟着界面语言走 ——
 * 中文界面下建出来的子层叫「1层」，和用户自己已有的那套命名一致。
 */
export function levelNames(count: number, label: string): string[] {
  const out: string[] = []
  for (let i = 1; i <= count; i++) out.push(label.replace('{n}', String(i)))
  return out
}
