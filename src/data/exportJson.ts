import type { AppData, ExportFile } from '../types'
import { APP_ID, SCHEMA_VERSION } from '../types'
import { downloadText } from '../lib/download'
import { formatForFilename } from '../lib/format'

export function buildExportFile(data: AppData): ExportFile {
  return {
    format: APP_ID,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    generator: `断舍离 v${SCHEMA_VERSION}`,
    summary: {
      items: data.items.length,
      categories: data.categories.length,
      locations: data.locations.length,
      attributeDefs: data.attributeDefs.length,
      tags: data.tags.length,
    },
    data: {
      items: data.items,
      categories: data.categories,
      locations: data.locations,
      attributeDefs: data.attributeDefs,
      tags: data.tags,
    },
  }
}

export function exportJsonFilename(date = new Date()): string {
  return `断舍离-备份-${formatForFilename(date)}.json`
}

/** 导出完整备份并触发下载。带回退：极少数情况下 createObjectURL 被拦，改为提示用户。 */
export function exportJson(data: AppData): string {
  const file = buildExportFile(data)
  const filename = exportJsonFilename()
  const text = JSON.stringify(file, null, 2)
  downloadText(filename, text, 'application/json')
  return filename
}
