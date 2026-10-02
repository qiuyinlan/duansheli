import type { BarDatum } from '../../store/selectors'

/** 按排名决定灰度 —— 越靠上越深，跟设计文档里「灰度条形图」的约定一致 */
function toneClass(index: number): string {
  if (index === 0) return 'bar-tone-0'
  if (index <= 2) return 'bar-tone-1'
  if (index <= 5) return 'bar-tone-2'
  return 'bar-tone-3'
}

interface BarChartProps {
  data: BarDatum[]
  /** 传入后条形可点击，用于跳到带筛选的列表 */
  onSelect?: (datum: BarDatum) => void
  emptyText?: string
  /** 最多显示多少条，超出部分合并为「其他」 */
  limit?: number
}

export function BarChart({ data, onSelect, emptyText = '暂无数据', limit }: BarChartProps) {
  let rows = data

  if (limit && data.length > limit) {
    const head = data.slice(0, limit)
    const restValue = data.slice(limit).reduce((sum, d) => sum + d.value, 0)
    rows = [...head]
    if (restValue > 0) {
      rows.push({ key: '__others__', label: `其他 ${data.length - limit} 项`, value: restValue })
    }
  }

  if (rows.length === 0) {
    return <div className="dim small">{emptyText}</div>
  }

  const max = Math.max(...rows.map((d) => d.value), 1)

  return (
    <div className="bar-chart">
      {rows.map((datum, index) => {
        const width = Math.max(1.5, (datum.value / max) * 100)
        const clickable = Boolean(onSelect && datum.target)

        const inner = (
          <>
            <span className="bar-row__label truncate" title={datum.label}>
              {datum.label}
            </span>
            <span className="bar-row__track">
              <span
                className={`bar-row__fill ${toneClass(index)}`}
                style={{ width: `${width}%` }}
              />
            </span>
            <span className="bar-row__value">{datum.value}</span>
          </>
        )

        return clickable ? (
          <button
            key={datum.key}
            type="button"
            className="bar-row bar-row--clickable"
            onClick={() => onSelect?.(datum)}
            title={`查看「${datum.label}」`}
          >
            {inner}
          </button>
        ) : (
          <div key={datum.key} className="bar-row">
            {inner}
          </div>
        )
      })}
    </div>
  )
}
