/**
 * 拿一份真实的 CSV 物品清单过一遍导入解析器，把结果打出来看。
 *
 * 为什么留着这个脚本：CSV 导入最容易出问题的地方是**真实文件的形状** ——
 * BOM、引号里的逗号、CRLF、空单元格、中文表头、带单位的属性列、
 * 缺名称的行。单元测试用的是我造的例子，而这个脚本跑的是用户手里那份。
 *
 * 用法：
 *   node scripts/verify-csv-import.mjs "断舍离-物品清单-2026-10-04-1707.csv"
 *
 * 它只读不写（除了一个用完就删的临时目录），不会碰任何用户数据。
 */
import { build } from 'esbuild'
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = process.cwd()
const TMP = join(ROOT, '.tmp-csv')

try {
  mkdirSync(TMP, { recursive: true })
  writeFileSync(
    join(TMP, 'entry.ts'),
    `export { parseCsvToAppData, parseCsv, looksLikeCsv } from '../src/data/csvImport'`,
  )

  await build({
    entryPoints: [join(TMP, 'entry.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    packages: 'external',
    outfile: join(TMP, 'out.mjs'),
    logLevel: 'error',
  })

  const mod = await import(pathToFileURL(join(TMP, 'out.mjs')).href)
  const file = process.argv[2]
  if (!file) {
    console.error('用法：node scripts/verify-csv-import.mjs <文件.csv>')
    process.exit(1)
  }

  const text = readFileSync(file, 'utf8')

  console.log('像不像 CSV：', mod.looksLikeCsv(text))

  const rows = mod.parseCsv(text)
  console.log('解析出的行数（含表头）：', rows.length)
  console.log('表头：', (rows[0] ?? []).join(' | '))

  const result = mod.parseCsvToAppData(text)
  if (!result.ok) {
    console.log('\n✗ 解析失败：', result.error)
  } else {
    const d = result.data
    console.log('\n✓ 解析成功')
    console.log('物品：', result.stats.items, ' 跳过：', result.stats.skipped)
    console.log('分类：', result.stats.categories, ' 位置：', result.stats.locations)
    console.log('属性：', result.stats.attributes, ' 标签：', result.stats.tags)
    console.log('导出时间点：', result.exportedAt)

    const count = (s) => d.items.filter((i) => i.status === s).length
    console.log(
      '\n状态分布：在用', count('active'),
      '闲置', count('idle'),
      '备用', count('spare'),
      '已舍弃', count('discarded'),
    )

    if (d.locations.length > 0) {
      console.log('\n位置树：')
      for (const l of d.locations) {
        const parent =
          l.parentId === null ? '(顶层)' : (d.locations.find((x) => x.id === l.parentId)?.name ?? '?')
        console.log('  ', parent, '>', l.name)
      }
    } else {
      console.log('\n位置树：（空 —— 这份清单里没有任何位置）')
    }

    console.log('\n分类：', d.categories.map((c) => c.name).join('、'))
    console.log(
      '属性：',
      d.attributeDefs.map((a) => (a.unit ? `${a.name}(${a.unit})` : a.name)).join('、'),
    )

    console.log('\n前 3 件：')
    for (const item of d.items.slice(0, 3)) {
      console.log(
        '  ',
        JSON.stringify({
          name: item.name,
          数量: item.quantity,
          状态: item.status,
          有效期: item.expiresAt,
          分类: item.categoryIds.map((id) => d.categories.find((c) => c.id === id)?.name),
          标签: item.tags,
          属性值: Object.entries(item.attrs).map(
            ([k, v]) => `${d.attributeDefs.find((a) => a.id === k)?.name}=${v}`,
          ),
          备注: item.note,
          创建: item.createdAt,
          修改: item.updatedAt,
        }),
      )
    }

    console.log('\n提示（会显示给用户）：')
    for (const w of result.warnings) console.log('  ·', w)
  }
} finally {
  rmSync(TMP, { recursive: true, force: true })
}

