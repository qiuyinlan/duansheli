/**
 * 「把一组分类挪到一个上级分类下面」—— 纯函数，一行数据库代码都没有。
 *
 * ── 为什么要单独抽出来 ────────────────────────────────────────────
 * 这个动作要**改真实的数据**（分类的 parentId 和 order），而它恰恰是最没法用
 * 眼睛验的那类改动：改完只是树的样子变了，看不出对错，等你发现不对时，
 * 原本的层级已经没了。
 *
 * 所以把「怎么算」和「往哪儿写」分开：这里是纯函数，输入旧的 categories/items，
 * 输出新的 categories 加一份「改了什么」的报告；写库那两个入口各自只负责搬数据。
 * 于是每种情况都能用测试钉死（见 tests/categoryFix.ts），包括：
 * 上级分类已经存在 / 不存在、选中的名字一个都没有、重复执行第二次、
 * 排序怎么变、悬挂的 id、
 * 以及最要紧的一条 —— **物品的 categoryIds 一根毫毛都不动**。
 *
 * ── 谁在用 ────────────────────────────────────────────────────────
 *   · fix-categories.html          本地开发服务器上的小工具页（直接改当前网址下的数据）
 *   · scripts/fix-category-parent.mjs   拿一份导出的 JSON 备份，改出一份新的备份
 */

export interface FixCategory {
  id: string
  name: string
  parentId: string | null
  order: number
  createdAt: string
}

/** 这里只关心分类引用 —— 别的字段一概不看、也不动 */
export interface FixItem {
  categoryIds: string[]
}

export interface ParentFixInput {
  categories: readonly FixCategory[]
  items: readonly FixItem[]
  /** 上级分类的名字，例如「衣服」 */
  parentName: string
  /** 要挪进去的分类 id */
  childIds: readonly string[]
  /** 新分类的 id 从哪儿来（测试里给个确定的，好断言） */
  makeId: () => string
  /** 新建分类时的创建时间 */
  now: string
}

export interface ParentFixPlan {
  /** 新的分类数组：没被碰到的分类原样保留 */
  categories: FixCategory[]
  parentId: string
  parentName: string
  /** 上级分类是这次新建的，还是本来就有、直接复用的 */
  parentCreated: boolean
  /** 挪进去的分类，按最终的先后顺序 */
  moved: FixCategory[]
  /** 选中的里面**本来就已经挂在它下面**的（重复执行时会出现） */
  alreadyUnder: FixCategory[]
  /** 选中的 id 在数据里根本找不到（数据可能已经变了） */
  missingIds: string[]
  /** 这棵分类树下现在挂着多少件物品 */
  itemsAffected: number
}

export type ParentFixResult = { ok: true; plan: ParentFixPlan } | { ok: false; reason: string }

/** 同层排序用的比较函数 —— 和 lib/tree.ts 里那条保持一致：先 order，再名字 */
const byOrderThenName = (a: FixCategory, b: FixCategory): number =>
  a.order - b.order || a.name.localeCompare(b.name, 'zh-CN')

/** 一棵分类树（含全部子孙）的 id 集合 */
function subtreeOf(categories: readonly FixCategory[], rootId: string): Set<string> {
  const ids = new Set<string>([rootId])
  // 上限就是分类总数：万一数据里有环，转一圈也就停了，不会死循环
  for (let pass = 0; pass < categories.length + 1; pass++) {
    let grew = false
    for (const category of categories) {
      if (category.parentId && ids.has(category.parentId) && !ids.has(category.id)) {
        ids.add(category.id)
        grew = true
      }
    }
    if (!grew) break
  }
  return ids
}

export function planCategoryParent(input: ParentFixInput): ParentFixResult {
  const { categories, items, childIds, makeId, now } = input
  const parentName = input.parentName.trim()

  if (parentName === '') return { ok: false, reason: '上级分类的名字是空的' }
  if (childIds.length === 0) return { ok: false, reason: '没有选中任何要挪的分类' }

  const byId = new Map(categories.map((category) => [category.id, category]))

  /*
   * 上级分类：顶层已经有一个同名的就直接用（**绝不重复建**），
   * 一个都没有才新建。
   *
   * 同名但**不在顶层**的情况刻意拦住不办：那说明用户已经在别处用过这个名字了，
   * 这时候要么复用、要么另起一个，两种选择都会让树变得不是他想要的样子 ——
   * 与其猜，不如让他自己决定（提示里说清了怎么办）。
   */
  const sameName = categories.filter((category) => category.name === parentName)
  const existingTop = sameName.find((category) => category.parentId === null)
  if (!existingTop && sameName.length > 0) {
    return {
      ok: false,
      reason: `已经有一个叫「${parentName}」的分类，但它不在顶层 —— 先把它挪到顶层，或者换一个名字`,
    }
  }

  const parent: FixCategory = existingTop ?? {
    id: makeId(),
    name: parentName,
    parentId: null,
    // 真正的排序值下面统一算，这里只是占位
    order: 0,
    createdAt: now,
  }

  const moved: FixCategory[] = []
  const alreadyUnder: FixCategory[] = []
  const missingIds: string[] = []

  for (const id of [...new Set(childIds)].sort()) {
    if (id === parent.id) continue // 别把自己挪到自己下面
    const category = byId.get(id)
    if (!category) {
      missingIds.push(id)
      continue
    }
    if (category.parentId === parent.id) {
      alreadyUnder.push(category)
      continue
    }
    moved.push(category)
  }

  if (moved.length === 0 && alreadyUnder.length === 0) {
    return { ok: false, reason: '选中的分类一个都没找到（数据可能已经变了，刷新页面重来一次）' }
  }

  /*
   * 挪进去的那些：按它们**原来的先后**排好，再重排成 0、1、2……
   * 重排是必要的 —— 它们的 order 原来是「顶层里的第几名」，直接带进新家
   * 会留下一个千疮百孔的空档（比如 2、5、9），以后手动插一个分类就很容易插错位置。
   */
  const sortedMoved = [...moved].sort(byOrderThenName)
  const childOrder = new Map(sortedMoved.map((category, index) => [category.id, index]))

  const reparented = categories.map((category) => {
    const order = childOrder.get(category.id)
    return order === undefined ? category : { ...category, parentId: parent.id, order }
  })

  /*
   * 上级分类插在「原来那一堆衣物分类所在的位置」上，而不是甩到最后面。
   *
   * 用户看的是「衣服这一块」，它们原来在哪就该在哪 —— 冒到列表末尾（或者挤到开头）
   * 都会让人以为分类被挪乱了。位置取原来最靠前的那个衣物分类的顺序号。
   */
  const formerTopMovers = sortedMoved.filter((category) => category.parentId === null)
  const tops = reparented
    .filter((category) => category.parentId === null && category.id !== parent.id)
    .sort(byOrderThenName)

  /*
   * 插入位置取「原来那一堆衣物分类所在的位置」；一个顶层分类都没挪的时候，
   * 就沿着上级分类**自己现在的顺序号**定位 —— 这条是给重复执行准备的：
   * 第二次跑的时候没有东西可挪，要是顺手把它甩到末尾，顶层的先后就变了，
   * 「跑两次和跑一次结果一样」也就不成立了。
   */
  const anchorOrder =
    formerTopMovers.length > 0
      ? Math.min(...formerTopMovers.map((category) => category.order))
      : (existingTop?.order ?? null)

  let anchorIndex = tops.length
  if (anchorOrder !== null) {
    const found = tops.findIndex((category) => category.order >= anchorOrder)
    anchorIndex = found === -1 ? tops.length : found
  }

  const orderedTops = [...tops]
  orderedTops.splice(anchorIndex, 0, parent)

  // 顶层重排成连续的 0、1、2……（相对顺序不变，只是把空档填掉）
  //
  // ⚠️ 新建的上级分类要真的**进数组**：上面只把它排进了顺序表，
  // 数组里还没有它 —— 漏了这一句，被挪的分类会挂在一个不存在的父级上
  // （表现是它们从界面上消失，因为树里找不到父节点）。用例守着这一条。
  const withParent = reparented.some((category) => category.id === parent.id)
    ? reparented
    : [...reparented, parent]

  const topOrder = new Map(orderedTops.map((category, index) => [category.id, index]))
  const nextCategories = withParent.map((category) => {
    const order = topOrder.get(category.id)
    return order === undefined ? category : { ...category, order }
  })

  const subtree = subtreeOf(nextCategories, parent.id)
  const itemsAffected = items.filter((item) =>
    item.categoryIds.some((id) => subtree.has(id)),
  ).length

  return {
    ok: true,
    plan: {
      categories: nextCategories,
      parentId: parent.id,
      parentName,
      parentCreated: existingTop === undefined,
      moved: nextCategories.filter((category) => childOrder.has(category.id)).sort(byOrderThenName),
      alreadyUnder,
      missingIds,
      itemsAffected,
    },
  }
}
