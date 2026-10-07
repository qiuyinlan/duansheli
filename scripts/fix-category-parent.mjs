#!/usr/bin/env node
/**
 * 拿一份导出的 JSON 备份，把一组分类挪到一个上级分类下面，写出新的一份备份。
 *
 * 这是 fix-categories.html 的「离线版」：那个页面要和应用开在同一个网址下才行，
 * 如果你的数据在别的地址上（比如 GitHub Pages），就走这条路 ——
 * 导出 JSON → 在这里改 → 回到应用里导入（覆盖）。
 *
 * 用法：
 *   node scripts/fix-category-parent.mjs <备份.json>                  # 先看它打算怎么改
 *   node scripts/fix-category-parent.mjs <备份.json> --write          # 真的写出新文件
 *   node scripts/fix-category-parent.mjs <备份.json> --list           # 只列出顶层分类
 *   node scripts/fix-category-parent.mjs <备份.json> --parent 衣服 --children 上衣,裤子,鞋子 --write
 *
 * 「怎么算」不在这里 —— 在 scripts/category-parent-fix.ts 里，那份逻辑有用例守着
 * （tests/categoryFix.ts）。这个脚本只负责读写文件和打印报告。
 *
 * 默认**不写文件**，只打印将要发生的改动。这是故意的：这个脚本动的是分类的层级，
 * 手一抖就可能把用户一层层攒起来的分类结构弄乱，所以必须显式加 --write。
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')

/** 衣物类的默认名单（名字对不上的会被跳过并如实报出来） */
const DEFAULT_CHILDREN = ['上衣', '裤子', '外套', '鞋子', '背心运动服', '秋', '睡衣', '其他穿戴']

/* ------------------------------------------------------------------ */
/* 参数                                                                */
/* ------------------------------------------------------------------ */

function parseArgs(argv) {
  const out = { file: null, parent: '衣服', children: DEFAULT_CHILDREN, write: false, list: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--write') out.write = true
    else if (arg === '--list') out.list = true
    else if (arg === '--parent') out.parent = argv[++i] ?? ''
    else if (arg === '--children') {
      out.children = (argv[++i] ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    } else if (arg.startsWith('--')) {
      fail(`不认识的参数：${arg}`)
    } else if (out.file === null) {
      out.file = arg
    } else {
      fail(`多余的参数：${arg}`)
    }
  }
  if (out.file === null) {
    fail(
      '用法：node scripts/fix-category-parent.mjs <备份.json> [--parent 衣服] ' +
        '[--children 上衣,裤子,鞋子] [--write] [--list]',
    )
  }
  return out
}

function fail(message) {
  console.error(`\n✗ ${message}\n`)
  process.exit(1)
}

/* ------------------------------------------------------------------ */
/* 把 TS 的那份逻辑打进来用（和 tests / audit-i18n 用同一招）           */
/* ------------------------------------------------------------------ */

async function loadPlanner() {
  const { build } = await import('esbuild')
  const { mkdirSync } = await import('node:fs')
  const outfile = join(root, '.audit-build', 'category-parent-fix.mjs')
  mkdirSync(join(root, '.audit-build'), { recursive: true })

  await build({
    stdin: {
      contents: `export { planCategoryParent } from './scripts/category-parent-fix'`,
      resolveDir: root,
      loader: 'ts',
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    packages: 'external',
    outfile,
    logLevel: 'error',
  })

  const mod = await import(pathToFileURL(outfile).href)
  return mod.planCategoryParent
}

/* ------------------------------------------------------------------ */
/* 主流程                                                              */
/* ------------------------------------------------------------------ */

const args = parseArgs(process.argv.slice(2))
const inputPath = resolve(process.cwd(), args.file)

let raw
try {
  raw = readFileSync(inputPath, 'utf8')
} catch (err) {
  fail(`读不了这个文件：${err instanceof Error ? err.message : String(err)}`)
}

let envelope
try {
  envelope = JSON.parse(raw)
} catch (err) {
  fail(`这不是合法的 JSON：${err instanceof Error ? err.message : String(err)}`)
}

if (envelope?.format !== 'duansheli') {
  fail('这不是「断舍离」导出的备份文件（缺少 format: "duansheli" 标记）。')
}
const data = envelope.data
if (!data || !Array.isArray(data.categories) || !Array.isArray(data.items)) {
  fail('备份文件里没有 categories / items，结构不对。')
}

const categories = data.categories

/* ---------------- --list：先把现状摆出来 ---------------- */

const tops = categories
  .filter((c) => c.parentId === null)
  .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'zh-CN'))

console.log(`\n文件：${basename(inputPath)}`)
console.log(`共 ${data.items.length} 件物品 / ${categories.length} 个分类（顶层 ${tops.length} 个）\n`)

console.log('顶层分类：')
for (const c of tops) console.log(`  · ${c.name}`)

const nested = categories.filter((c) => c.parentId !== null)
if (nested.length > 0) {
  console.log(`\n子分类（${nested.length} 个）：`)
  console.log(`  ${nested.map((c) => c.name).join('、')}`)
}

if (args.list) {
  console.log('\n（--list：只看不改）\n')
  process.exit(0)
}

/* ---------------- 名字 → id ---------------- */

// 只认**顶层**的同名分类：子分类同名是另一回事，不能顺手挪走
const childIds = []
const notFound = []
for (const name of args.children) {
  const found = tops.find((c) => c.name === name)
  if (found) childIds.push(found.id)
  else notFound.push(name)
}

if (notFound.length > 0) {
  console.log(`\n⚠️ 这些名字在顶层没找到，会跳过：${notFound.join('、')}`)
  console.log('   （如果它们确实存在，看看上面那张表里实际叫什么，用 --children 指定准确的名字）')
}

if (childIds.length === 0) {
  fail('一个要挪的分类都没匹配上。先用 --list 看看顶层都有什么，再用 --children 指定。')
}

/* ---------------- 算 ---------------- */

const planCategoryParent = await loadPlanner()

let seq = 0
const result = planCategoryParent({
  categories,
  items: data.items,
  parentName: args.parent,
  childIds,
  // 固定成可复现的：新分类 id 用时间戳拼序号，别用随机数
  makeId: () => `fix-${Date.now().toString(36)}-${++seq}`,
  now: new Date().toISOString(),
})

if (!result.ok) fail(`不能这么改：${result.reason}`)

const plan = result.plan
const newTops = plan.categories
  .filter((c) => c.parentId === null)
  .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'zh-CN'))
const kids = plan.categories
  .filter((c) => c.parentId === plan.parentId)
  .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'zh-CN'))

console.log(`\n${plan.parentCreated ? '新建' : '复用'}上级分类「${plan.parentName}」`)
console.log(`要挪进去：${plan.moved.map((c) => c.name).join(' → ')}`)
if (plan.alreadyUnder.length > 0) {
  console.log(`本来就在下面：${plan.alreadyUnder.map((c) => c.name).join('、')}`)
}
console.log(`「${plan.parentName}」这棵树下挂着 ${plan.itemsAffected} 件物品（物品本身一件不动）`)
console.log(`\n改完之后的顶层：${newTops.map((c) => c.name).join(' / ')}`)
console.log(`「${plan.parentName}」下面：${kids.map((c) => c.name).join(' / ')}`)

if (!args.write) {
  console.log('\n（预演。真的要改就再加一个 --write）\n')
  process.exit(0)
}

/* ---------------- 写 ---------------- */

const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
const outPath = resolve(
  dirname(inputPath),
  `断舍离-已整理分类-${stamp}.json`,
)
if (outPath === inputPath) fail('输出路径和输入是同一个文件，拒绝覆盖。')

const nextEnvelope = {
  ...envelope,
  exportedAt: new Date().toISOString(),
  summary: { ...envelope.summary, categories: plan.categories.length },
  data: { ...data, categories: plan.categories },
}

writeFileSync(outPath, JSON.stringify(nextEnvelope, null, 2), 'utf8')

console.log(`\n✓ 写好了：${basename(outPath)}`)
console.log('  接下来：应用里「设置 → 导入备份 → 选择文件 → 覆盖」，选这个文件。')
console.log('  导入前应用会自动再存一份快照，所以这一步也是可回退的。\n')
