#!/usr/bin/env node
/**
 * 双语审计。
 *
 * 做两件事：
 *   1. **找漏翻的中文** —— 界面文件里不该有写死的中文（注释不算，注释本来就该是中文）。
 *   2. **查词典是否对齐** —— zh 和 en 的 key 集合、插值占位符必须完全一致。
 *
 * 为什么要单独一个脚本：`tsc` 能挡住「en 少了某个 key」，
 * 但挡不住「JSX 里直接写了一句中文」—— 那种漏翻编译得过、测试也照过
 * （测试环境锁中文），只有切到英文才看得出来。这个脚本专门抓它。
 *
 * 用法：
 *   node scripts/audit-i18n.mjs          报告 + 有漏翻就以非 0 退出
 *   node scripts/audit-i18n.mjs --all    连「允许保留中文」的地方也列出来
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const ROOT = process.cwd()
const SHOW_ALLOWED = process.argv.includes('--all')

/* ------------------------------------------------------------------ */
/* 允许保留中文的地方 —— 每一条都要有理由，不能图省事往里加              */
/* ------------------------------------------------------------------ */

const ALLOWED = [
  {
    // 词典本身、以及 AI 提示词的中文那份
    match: (p) => p.includes(`${sep}i18n${sep}`) || p.includes(`${sep}promptText${sep}`),
    why: '词典与中文提示词，本来就是中文的存放处',
  },
  {
    // 容错用的中文键名别名：「模型可能把 note 写成 备注」，这是协议容忍，不是文案
    file: 'src/ai/parse.ts',
    why: 'AI 回复的中文键名别名（raw.备注 之类）与中文数字表，是解析容错，不面向用户',
  },
  {
    // 认中文日期写法的正则：解析 2026年3月15日
    file: 'src/lib/expiry.ts',
    why: '把「2026年3月15日」这类中文写法归一成日期的正则',
  },
]

function isAllowed(relPath) {
  for (const rule of ALLOWED) {
    if (rule.match && rule.match(relPath)) return rule.why
    if (rule.file && relPath.split(sep).join('/') === rule.file) return rule.why
  }
  return null
}

/* ------------------------------------------------------------------ */
/* 扫描                                                                */
/* ------------------------------------------------------------------ */

const CJK = /[\u4e00-\u9fff]/

/** 去掉注释后再看 —— 注释里的中文是正常的，项目注释一直是中文 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(?<![:'"])\/\/[^\n]*/g, '')
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.')) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(full)
  }
  return out
}

const files = walk(join(ROOT, 'src'))
const problems = []
const allowedHits = []

for (const full of files) {
  const rel = relative(ROOT, full)
  const stripped = stripComments(readFileSync(full, 'utf8'))
  const lines = stripped.split('\n')
  const hits = []
  lines.forEach((line, i) => {
    if (CJK.test(line)) hits.push({ line: i + 1, text: line.trim() })
  })
  if (hits.length === 0) continue

  const why = isAllowed(rel)
  if (why) allowedHits.push({ rel, hits, why })
  else problems.push({ rel, hits })
}

/* ------------------------------------------------------------------ */
/* 词典对齐                                                            */
/* ------------------------------------------------------------------ */

function flatten(obj, prefix = '', out = {}) {
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix === '' ? key : `${prefix}.${key}`
    if (typeof value === 'string') out[path] = value
    else flatten(value, path, out)
  }
  return out
}

/** 抽出 {name} 形式的占位符，用来比较两边是不是「同一句话」 */
function placeholders(text) {
  return [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
}

async function auditDict() {
  // 词典是 TS，先用 esbuild 打成一个临时 ESM 再 import —— 和 tests 用的是同一招。
  const outfile = join(ROOT, '.audit-build', 'dict.mjs')
  const { build } = await import('esbuild')
  const { mkdirSync } = await import('node:fs')
  const { pathToFileURL } = await import('node:url')
  mkdirSync(join(ROOT, '.audit-build'), { recursive: true })

  await build({
    stdin: {
      contents: `
        export { zh } from './src/i18n/zh/index'
        export { en } from './src/i18n/en/index'
      `,
      resolveDir: ROOT,
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

  const { zh, en } = await import(pathToFileURL(outfile).href)

  const flatZh = flatten(zh)
  const flatEn = flatten(en)
  const zhKeys = new Set(Object.keys(flatZh))
  const enKeys = new Set(Object.keys(flatEn))

  const missing = [...zhKeys].filter((k) => !enKeys.has(k))
  const extra = [...enKeys].filter((k) => !zhKeys.has(k))
  const mismatch = []
  for (const key of zhKeys) {
    if (!enKeys.has(key)) continue
    const a = placeholders(flatZh[key]).join(',')
    const b = placeholders(flatEn[key]).join(',')
    if (a !== b) mismatch.push({ key, zh: a, en: b })
  }

  /*
   * 词典值里不该出现 markdown 加粗。
   *
   * t() 只做 {变量} 插值，不认任何 markdown —— 写进去的星号会**原样显示**
   * 在界面上，变成「数据按**网址**隔离」这种东西。
   * 这类错误最阴的地方是：中英两边写一样的星号时，key 对得齐、占位符也对得齐，
   * 前面几项检查全部通过。所以必须单独查一条。
   */
  const markdown = []
  for (const [key, text] of Object.entries(flatZh)) {
    if (text.includes('**')) markdown.push({ key, lang: 'zh', text })
  }
  for (const [key, text] of Object.entries(flatEn)) {
    if (text.includes('**')) markdown.push({ key, lang: 'en', text })
  }

  return { zhCount: zhKeys.size, enCount: enKeys.size, missing, extra, mismatch, markdown }
}

/* ------------------------------------------------------------------ */
/* 报告                                                                */
/* ------------------------------------------------------------------ */

console.log('双语审计\n' + '─'.repeat(56))

if (SHOW_ALLOWED && allowedHits.length > 0) {
  console.log('\n允许保留中文的地方：')
  for (const { rel, hits, why } of allowedHits) {
    console.log(`  · ${rel}（${hits.length} 行）—— ${why}`)
  }
}

if (problems.length > 0) {
  console.log(`\n✗ 有 ${problems.length} 个界面文件里还留着写死的中文：\n`)
  for (const { rel, hits } of problems) {
    console.log(`  ${rel}`)
    for (const hit of hits.slice(0, 8)) console.log(`    ${hit.line}: ${hit.text}`)
    if (hits.length > 8) console.log(`    …另有 ${hits.length - 8} 行`)
  }
  console.log('\n  这些文字在英文界面下不会变。要么走 t()，要么加进 ALLOWED 并说明理由。')
} else {
  console.log('\n✓ 界面文件里没有写死的中文')
}

const dict = await auditDict()
if (dict) {
  console.log(`\n词典：zh ${dict.zhCount} 条 / en ${dict.enCount} 条`)
  if (dict.missing.length > 0) console.log(`  ✗ en 缺少：${dict.missing.slice(0, 10).join(', ')}`)
  if (dict.extra.length > 0) console.log(`  ✗ en 多出：${dict.extra.slice(0, 10).join(', ')}`)
  if (dict.mismatch.length > 0) {
    console.log(`  ✗ 占位符不一致（${dict.mismatch.length} 条）：`)
    for (const m of dict.mismatch.slice(0, 10)) {
      console.log(`    ${m.key}  zh={${m.zh}}  en={${m.en}}`)
    }
  }
  if (dict.markdown.length > 0) {
    console.log(`  ✗ 文案里有 markdown 星号（${dict.markdown.length} 条）—— 会原样显示：`)
    for (const m of dict.markdown.slice(0, 10)) {
      console.log(`    [${m.lang}] ${m.key}: ${m.text.slice(0, 60)}`)
    }
    console.log('    要加粗请拆成 xxxBefore / xxxStrong / xxxAfter 三段，在 JSX 里包 <strong>。')
  }
  if (
    dict.missing.length === 0 &&
    dict.extra.length === 0 &&
    dict.mismatch.length === 0 &&
    dict.markdown.length === 0
  ) {
    console.log('  ✓ key、占位符、加粗写法全部对齐')
  }
}

console.log('')
const dictBad =
  dict !== null &&
  (dict.missing.length > 0 ||
    dict.extra.length > 0 ||
    dict.mismatch.length > 0 ||
    dict.markdown.length > 0)
process.exit(problems.length > 0 || dictBad ? 1 : 0)
