/**
 * 「置顶」（星星）这件事的纯逻辑。
 *
 * ── 为什么单独一个文件 ──────────────────────────────────────────
 * 置顶要在**四处**生效：AI 输入框的候选、位置选择弹窗、分类选择弹窗，
 * 以及将来别的地方。四处各自写一遍「点一下加进去 / 再点一下拿出来」，
 * 迟早会有一处写成「加两次」或者「排序时忘了它」——
 * 而那种错不会报错，只会让人觉得「我置顶了，怎么没上去」。
 *
 * 存的是一个 **id 列表，顺序就是置顶的顺序**（用户先点的那颗星排前面）。
 * 列表放在界面偏好里（localStorage），跟着这台设备走：
 * 「我常选哪个抽屉」是使用习惯，不是数据，所以既不进备份文件，
 * 也不会跟着导出 / 导入跑到别的设备上去。
 *
 * 删掉的位置 / 分类留下的 id 只是永远匹配不上，无害 ——
 * 和 `ui.expandedLocations` 同一个处理方式，不必专门清理。
 */

/** 点亮 / 取消一颗星。返回新的列表（不改传进来的那个） */
export function togglePinned(list: readonly string[], id: string): string[] {
  if (id === '') return [...list]
  return list.includes(id) ? list.filter((each) => each !== id) : [...list, id]
}

/** 置顶排在第几位（越小越靠前）；没置顶返回 -1 */
export function pinRank(list: readonly string[], id: string | null): number {
  if (id === null || id === '') return -1
  return list.indexOf(id)
}

export function isPinned(list: readonly string[], id: string | null): boolean {
  return pinRank(list, id) >= 0
}

/**
 * 按置顶顺序取出对应的节点 —— 给「置顶区」那一块用。
 *
 * 取不到的那些（位置已经被删了）直接跳过：清单上留一条点不动的死条目
 * 比什么都不显示更让人困惑。
 */
export function pinnedNodes<T extends { id: string }>(
  list: readonly string[],
  nodes: readonly T[],
): T[] {
  if (list.length === 0) return []
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const out: T[] = []
  for (const id of list) {
    const node = byId.get(id)
    if (node) out.push(node)
  }
  return out
}
