import type { AppData, AttributeDef, Item } from '../types'
import type { DerivedContext } from '../store/selectors'
import { formatAttrValue, statusLabel } from '../store/selectors'
import { downloadText } from '../lib/download'
import { formatDateTime, formatForFilename } from '../lib/format'

/** RFC 4180 转义：含逗号、引号、换行的值要包引号，内部引号翻倍 */
function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value)
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

export function exportCsvFilename(date = new Date()): string {
  return `断舍离-物品清单-${formatForFilename(date)}.csv`
}

/**
 * 导出物品清单为 CSV，供 Excel / 表格软件查看。
 *
 * ⚠️ CSV 是**有损**格式：属性定义、分类顺序等结构信息不会保留，
 * 因此它只能看、不能用来恢复数据。备份请用 JSON。
 */
export function buildCsv(data: AppData, ctx: DerivedContext): string {
  const attrDefs: AttributeDef[] = [...data.attributeDefs].sort((a, b) => a.order - b.order)

  const header = [
    '名称',
    '数量',
    '状态',
    '有效期至',
    '分类',
    '位置',
    '标签',
    '备注',
    '创建时间',
    '最后修改',
    ...attrDefs.map((d) => (d.unit ? `${d.name}(${d.unit})` : d.name)),
  ]

  const rows = data.items.map((item: Item) => {
    const categoryNames = item.categoryIds
      .map((id) => ctx.categoryById.get(id)?.name)
      .filter((n): n is string => Boolean(n))

    const attrCells = attrDefs.map((def) => formatAttrValue(def, item.attrs[def.id]))

    return [
      item.name,
      item.quantity,
      statusLabel(item.status),
      // 没设置就是空单元格，不要写「—」：表格软件里空着才好排序和筛选
      item.expiresAt ?? '',
      categoryNames.join(' / '),
      item.locationId ? ctx.index.pathString(item.locationId, ' / ') : '未归位',
      item.tags.join(' / '),
      item.note,
      formatDateTime(item.createdAt),
      formatDateTime(item.updatedAt),
      ...attrCells,
    ]
  })

  const lines = [header, ...rows].map((row) => row.map(csvCell).join(','))
  // \ufeff 是 BOM —— 没有它 Excel 打开中文会乱码
  return `\ufeff${lines.join('\r\n')}\r\n`
}

export function exportCsv(data: AppData, ctx: DerivedContext): string {
  const filename = exportCsvFilename()
  downloadText(filename, buildCsv(data, ctx), 'text/csv')
  return filename
}
