/**
 * 生成人工验收测试用的示例数据备份文件。
 *
 * 目标文件：项目根目录下的《示例数据-导入用.json》
 * 用法：npm run sample
 */

import { build } from 'esbuild'
import { mkdirSync, writeFileSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const outDir = resolve(root, '.test-build')
mkdirSync(outDir, { recursive: true })

const outfile = resolve(outDir, 'sample-data.mjs')

await build({
  entryPoints: [resolve(root, 'scripts', 'sampleData.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  packages: 'external',
  outfile,
  logLevel: 'warning',
})

const mod = await import(pathToFileURL(outfile).href)
const result = mod.buildSampleBackup()

const target = resolve(root, '示例数据-导入用.json')
writeFileSync(target, result.json, 'utf8')

console.log(`已生成：${target}`)
console.log(`大小：${(statSync(target).size / 1024).toFixed(1)} KB`)
console.log(`物品：${result.itemCount} 件`)

if (result.warnings.length > 0) {
  console.log(`\n生成过程中的提示（${result.warnings.length} 条）：`)
  for (const warning of result.warnings) console.log(`  · ${warning}`)
} else {
  console.log('所有分类和位置都对应上了，没有提示。')
}
