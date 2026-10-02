import type { BarDatum } from '../../store/selectors'
import { t, useT } from '../../i18n'
import { colorForKey } from '../../lib/palette'

interface BarChartProps {
  data: BarDatum[]
  /** 传入后条形可点击，用于跳到带筛选的列表 */
  onSelect?: (datum: BarDatum) => void
  emptyText?: string
  /** 最多显示多少条，超出部分合并为「其他」 */
  limit?: number
}

/**
 * 条形图。
 *
 * 每条用**自己那个分类 / 位置的颜色**，跟下面分组列表的颜色对得上 ——
 * 图表里看到「化妆品」是蓝的，列表里那一组也是蓝的，一眼能连起来。
 * 颜色由 key 哈希决定，所以是稳定的，不会每刷新一次就换个色。
 */
export function BarChart({ data, onSelect, emptyText, limit }: BarChartProps) {
  // 订阅语言：图里的字（「其他 N 项」、可点击条形的提示）要跟着切
  useT()

  let rows = data

  if (limit && data.length > limit) {
    const head = data.slice(0, limit)
    const restValue = data.slice(limit).reduce((sum, d) => sum + d.value, 0)
    rows = [...head]
    if (restValue > 0) {
      rows.push({
        key: '__others__',
        label: t('chart.others', { count: data.length - limit }),
        value: restValue,
      })
    }
  }

  if (rows.length === 0) {
    // 调用方给了 emptyText 就用它的（那是调用方的文案），没给才用兜底
    return <div className="dim small">{emptyText ?? t('chart.empty')}</div>
  }

  const max = Math.max(...rows.map((d) => d.value), 1)

  return (
    <div className="bar-chart">
      {rows.map((datum) => {
        const width = Math.max(1.5, (datum.value / max) * 100)
        const clickable = Boolean(onSelect && datum.target)
        const color = colorForKey(datum.key)

        const inner = (
          <>
            <span className="bar-row__label truncate" title={datum.label}>
              {datum.label}
            </span>
            <span className="bar-row__track">
              <span
                className="bar-row__fill"
                style={{ width: `${width}%`, background: color.bar }}
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
            title={t('chart.view', { label: datum.label })}
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
