/**
 * 相对时间与天数。
 *
 * `_one` / `_other` 成对出现的地方，中文两句写一样 —— 中文本来就没有单复数，
 * 留着是为了让两份字典形状一致（见 zh/index.ts 的说明）。
 */
export const format = {
  today: '今天',
  yesterday: '昨天',

  daysAgo_one: '{count} 天前',
  daysAgo_other: '{count} 天前',
  monthsAgo_one: '{count} 个月前',
  monthsAgo_other: '{count} 个月前',
  yearsAgo_one: '{count} 年前',
  yearsAgo_other: '{count} 年前',

  /** 「已闲置 47 天」里那个数字 */
  lessThanOneDay: '不到 1 天',
  days_one: '{count} 天',
  days_other: '{count} 天',
  overYears_one: '{count} 年多',
  overYears_other: '{count} 年多',

  /** 列表里的「3 件」这类 */
  countItems_one: '{count} 件',
  countItems_other: '{count} 件',
  countKinds_one: '{count} 种',
  countKinds_other: '{count} 种',
}
