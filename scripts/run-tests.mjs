/**
 * 把测试用 esbuild 打成一个 ESM 包再跑。
 * 这样测试里可以直接 import 源码的 .ts 文件（含无扩展名的相对导入），
 * 不需要额外的编译配置。
 */
import { build } from 'esbuild'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const outDir = resolve(root, '.test-build')
mkdirSync(outDir, { recursive: true })
const outfile = resolve(outDir, 'smoke.mjs')

await build({
  entryPoints: [resolve(root, 'tests', 'index.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  // 只打包我们自己的源码，node_modules 交给 Node 原生解析。
  // 否则 react-dom/server 内部的 CJS require('stream') 会被打成动态 require 而失败。
  packages: 'external',
  outfile,
  logLevel: 'warning',
})

try {
  await import(pathToFileURL(outfile).href)
} catch (err) {
  // 测试失败时 harness 会抛错；这里只需要保证进程以非 0 退出
  console.error(err instanceof Error ? err.message : String(err))
  process.exitCode = 1
}
