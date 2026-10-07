/**
 * 让 AI 整理**分类**（不只是物品）。
 *
 * ── 用户要的是什么 ──────────────────────────────────────────────
 * 「我希望 ai 可以编辑分类，我可以让它帮我整理已有的分类。」
 *
 * 这是个很自然的需求：分类是一层层攒出来的，攒久了就会出现
 * 「上衣 / 裤子 / 外套 / 鞋子 / 背心运动服 / 秋 / 睡衣 / 其他穿戴」这种
 * 平铺的八个顶层 —— 想收进一个「衣服」下面，手动拖八次。
 * （这也正是 `scripts/category-parent-fix.ts` 那个一次性工具在干的事，
 * 只是那时候只能靠改文件。）
 *
 * ── 为什么必须和物品走同一套流程 ────────────────────────────────
 *
 * 分类是**结构**，动它比动一件物品危险得多：
 *   · 改名会牵动所有挂在它下面的物品的显示
 *   · 移动会把一整棵子树搬走
 *   · 删除更狠 —— 子分类和物品都会变成孤儿
 *
 * 所以这一层**只负责算**：把 AI 的意图翻译成一份「打算做什么」的清单，
 * 一行都不碰数据。落库由用户在界面上点「采纳」之后才发生。
 * 这也是这个项目一贯的做法（见 docs/设计文档.md 第 31 章：
 * 「这个改动没法用眼睛验，所以算和写必须分开」）。
 *
 * ── 四个动作，刻意只有四个 ──────────────────────────────────────
 *
 * | 动作 | 效果 | 为什么要它 |
 * |---|---|---|
 * | `create` | 在某个父分类下新建一个 | 「帮我把这些收进一个『衣服』」 |
 * | `rename` | 改名 | 「把『其他穿戴』改成『穿戴』」 |
 * | `move` | 挪到别的父分类下（含挪到顶层） | 「把鞋子和睡衣都挪到衣服下面」 |
 * | `delete` | 删掉（子分类挂到父级） | 「『杂项』这个分类没用了，拆掉」 |
 *
 * **刻意不做「合并两个分类」** —— 那看着方便，实际上要决定
 * 「挂在两边上的物品怎么办」「子分类重名了跟谁走」，每一步都可能猜错。
 * 需要合并时，让 AI 用 rename + move + delete 三件事拼出来，
 * 而每一步都在预览里看得见、能取消。
 */

import type { AppData, Category } from '../types'
import { uid } from '../lib/id'

/* ------------------------------------------------------------------ */
/* 意图（AI 说人话，程序翻译成这个）                                     */
/* ------------------------------------------------------------------ */

/** AI 能请求的四种分类改动 */
export type CategoryChangeKind = 'create' | 'rename' | 'move' | 'delete'

export interface CategoryChange {
  kind: CategoryChangeKind
  /**
   * 目标分类的**名称路径**（从顶层到它自己）。
   *
   * 用路径而不是名字：分类是多级的，「眼妆」可能同时挂在「化妆品」和
   * 「护肤」下面。只给一个名字会选错那一个。
   * 和 AI 那边对物品分类的处理完全一致（`matchPath` 那套）。
   */
  path: string[]
  /**
   * 改完之后叫什么（只有 rename 有意义）。
   */
  newName?: string
  /**
   * 挪到哪个父分类下（只有 move 有意义）。
   *
   * 空数组 = **挪到顶层**。这个区分很要紧：`undefined` 是「没提」，
   * `[]` 是「我就是要它变成顶层」——把两者混起来，AI 想说「提到顶层」
   * 的那个请求会变成什么都不做。
   */
  newParentPath?: string[]
  /** 新建时挂哪个父分类下（只有 create 有意义）。空数组 = 顶层。 */
  parentPath?: string[]
}

/* ------------------------------------------------------------------ */
/* 解析后的计划（每条都指向具体的 id，并且说清能不能做）                 */
/* ------------------------------------------------------------------ */

export type CategoryPlanStatus =
  /** 能做（跟着会真的改） */
  | 'ok'
  /** 目标分类找不到（AI 说了个不存在的路径，或者路径拼错了） */
  | 'missing'
  /** 要做的事已经成立了（改名成同一个名字 / 本来就在那个父级下） */
  | 'noop'
  /** 同名分类已经存在（新建 / 改名会撞车） */
  | 'duplicate'
  /** 会成环（挪到自己的子孙下面）—— 树会长歪，绝对不能做 */
  | 'cycle'

export interface CategoryPlanEntry {
  /** 界面上用来做 key，也用来让用户单独取消某一条 */
  key: string
  kind: CategoryChangeKind
  status: CategoryPlanStatus
  /**
   * 这条改动**没有**「原来的分类」——只有新建才是这样。
   *
   * 为什么用布尔而不是让 `fromLabel` 变成「（新分类）」那种文字：
   * 这个模块是 `ai/` 下的纯逻辑，**不该知道界面语言**
   * （`scripts/audit-i18n.mjs` 那条「界面文件里不许有写死的中文」也会拦）。
   * 所以这里只给出事实，措辞交给界面。
   */
  isNew?: boolean
  /** 目标分类现在的路径文字（新建时是空字符串） */
  fromLabel: string
  /** 改完之后的路径文字，给界面显示 */
  toLabel: string
  /** 目标分类现在的 id（missing 时为 null） */
  targetId: string | null
  /** 挪到哪个父级（move / create 用） */
  newParentId?: string | null
  /** 改完之后的名字（rename / create 用） */
  newName?: string
  /** delete 时：会有几个子分类被挂到父级去 */
  childCount?: number
  /** delete 时：会有几件物品失去这个分类 */
  itemCount?: number
  /** 用户勾掉了就不做（默认都做） */
  include: boolean
  /** AI 原本的话，用来在界面上如实展示（不用它做判断） */
  raw: CategoryChange
}

export interface CategoryPlanResult {
  entries: CategoryPlanEntry[]
  /** 有问题的那些（missing / duplicate / cycle）—— 界面上必须单独提示 */
  problems: number
}

/* ------------------------------------------------------------------ */
/* 路径工具                                                            */
/* ------------------------------------------------------------------ */

const norm = (value: string) => value.trim()

/** 分类 id → 名称路径（从顶层到它自己） */
function pathOf(categories: Category[], id: string): string[] {
  const byId = new Map(categories.map((c) => [c.id, c]))
  const names: string[] = []
  const seen = new Set<string>()
  let current = byId.get(id)
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    names.unshift(current.name)
    current = current.parentId ? byId.get(current.parentId) : undefined
  }
  return names
}

/**
 * 名称路径 → 分类 id。
 *
 * 三级降级，和 AI 那边匹配位置/分类的规则**故意保持一致**
 * （见 `ai/convert.ts` 的 `matchPath`）：完整路径 → 后缀唯一 → 放弃。
 * 两处不一致的表现是「AI 说得出、程序对不上」，最难解释。
 */
function resolvePath(categories: Category[], path: string[]): string | null {
  const wanted = path.map(norm).filter((part) => part !== '')
  if (wanted.length === 0) return null

  const key = wanted.join('/')
  for (const category of categories) {
    if (pathOf(categories, category.id).map(norm).join('/') === key) return category.id
  }

  // 后缀唯一才敢用：「眼妆」能对上，但有两个「眼妆」时谁也不选
  const suffixMatches = categories.filter((category) => {
    const names = pathOf(categories, category.id).map(norm)
    if (names.length < wanted.length) return false
    return names.slice(names.length - wanted.length).every((name, i) => name === wanted[i])
  })
  return suffixMatches.length === 1 ? (suffixMatches[0] as Category).id : null
}

/** 某个分类下面直接挂着几个子分类 / 几件物品 */
function countsUnder(data: AppData, id: string): { children: number; items: number } {
  return {
    children: data.categories.filter((c) => c.parentId === id).length,
    items: data.items.filter((item) => item.categoryIds.includes(id)).length,
  }
}

/* ------------------------------------------------------------------ */
/* 算计划                                                              */
/* ------------------------------------------------------------------ */

/**
 * 把 AI 的意图翻译成一份可执行的计划。
 *
 * **这个函数一行都不改数据。** 它只回答两个问题：
 *   · 这条要求指的是哪个分类？
 *   · 这件事能不能做（不能做的原因是什么）？
 *
 * 为什么单独抽出来：分类是多级树，改错了很难复原，而「算」这一步
 * 完全可以被用例钉死（见 `tests/categoryEdit.ts`）。第 31 章那次
 * 一次性整理的教训就是「算和写分开，用例真的抓到了两个会静默毁数据的 bug」。
 */
export function planCategoryChanges(
  data: AppData,
  changes: readonly CategoryChange[],
): CategoryPlanResult {
  const entries: CategoryPlanEntry[] = []

  for (const change of changes) {
    const key = uid()
    const rawPath = change.path.map(norm).filter((part) => part !== '')
    if (rawPath.length === 0) continue

    const fromPathLabel = rawPath.join(' / ')

    /* ---------------- create ---------------- */
    if (change.kind === 'create') {
      const name = norm(change.newName ?? rawPath[rawPath.length - 1] ?? '')
      if (name === '') continue

      const parentPath = (change.parentPath ?? rawPath.slice(0, -1)).map(norm).filter(Boolean)
      const parentId = parentPath.length === 0 ? null : resolvePath(data.categories, parentPath)

      if (parentPath.length > 0 && parentId === null) {
        entries.push({
          key,
          kind: 'create',
          status: 'missing',
          isNew: true,
          fromLabel: '',
          toLabel: parentPath.join(' / ') + ' / ' + name,
          targetId: null,
          include: true,
          raw: change,
        })
        continue
      }

      const duplicate = data.categories.some(
        (c) => (c.parentId ?? null) === parentId && c.name === name,
      )
      const toLabel =
        (parentPath.length > 0 ? parentPath.join(' / ') + ' / ' : '') + name

      if (duplicate) {
        entries.push({
          key,
          kind: 'create',
          status: 'duplicate',
          isNew: true,
          fromLabel: '',
          toLabel,
          targetId: null,
          include: true,
          raw: change,
        })
        continue
      }

      entries.push({
        key,
        kind: 'create',
        status: 'ok',
        isNew: true,
        fromLabel: '',
        toLabel,
        targetId: null,
        newParentId: parentId,
        newName: name,
        include: true,
        raw: change,
      })
      continue
    }

    /* ---------------- rename / move / delete 都要先找到目标 ---------------- */
    const targetId = resolvePath(data.categories, rawPath)
    if (targetId === null) {
      entries.push({
        key,
        kind: change.kind,
        status: 'missing',
        fromLabel: fromPathLabel,
        toLabel: fromPathLabel,
        targetId: null,
        include: true,
        raw: change,
      })
      continue
    }

    const target = data.categories.find((c) => c.id === targetId) as Category
    const parentPath = pathOf(data.categories, targetId).slice(0, -1)

    if (change.kind === 'rename') {
      const newName = norm(change.newName ?? '')
      if (newName === '') continue
      if (newName === target.name) {
        entries.push({
          key,
          kind: 'rename',
          status: 'noop',
          fromLabel: fromPathLabel,
          toLabel: fromPathLabel,
          targetId,
          newName,
          include: true,
          raw: change,
        })
        continue
      }
      const duplicate = data.categories.some(
        (c) => c.id !== targetId && (c.parentId ?? null) === target.parentId && c.name === newName,
      )
      if (duplicate) {
        entries.push({
          key,
          kind: 'rename',
          status: 'duplicate',
          fromLabel: fromPathLabel,
          toLabel: [...parentPath, newName].join(' / '),
          targetId,
          newName,
          include: true,
          raw: change,
        })
        continue
      }
      entries.push({
        key,
        kind: 'rename',
        status: 'ok',
        fromLabel: fromPathLabel,
        toLabel: [...parentPath, newName].join(' / '),
        targetId,
        newName,
        include: true,
        raw: change,
      })
      continue
    }

    if (change.kind === 'move') {
      const wantedParentPath = (change.newParentPath ?? []).map(norm).filter(Boolean)

      /*
       * `newParentPath` 没给 = 没提这件事 → 不做。
       * 给成空数组 = 明确提出「挪到顶层」→ 要做。
       * 这两个必须分开，理由见 CategoryChange.newParentPath 的注释。
       */
      if (change.newParentPath === undefined) continue

      const newParentId =
        wantedParentPath.length === 0 ? null : resolvePath(data.categories, wantedParentPath)

      if (wantedParentPath.length > 0 && newParentId === null) {
        entries.push({
          key,
          kind: 'move',
          status: 'missing',
          fromLabel: fromPathLabel,
          toLabel: wantedParentPath.join(' / ') + ' / ' + target.name,
          targetId,
          include: true,
          raw: change,
        })
        continue
      }

      if ((target.parentId ?? null) === newParentId) {
        entries.push({
          key,
          kind: 'move',
          status: 'noop',
          fromLabel: fromPathLabel,
          toLabel: fromPathLabel,
          targetId,
          newParentId,
          include: true,
          raw: change,
        })
        continue
      }

      /*
       * 成环检查：不能挪到自己的子孙下面。
       *
       * 这一条是**必须**的，不是防御性编程：树一旦成环，那个子树
       * 会从界面上整个消失（`buildTree` 把它们当成不可达节点），
       * 用户看到的就是「我的分类凭空少了一半」。
       */
      if (newParentId !== null) {
        const descendants = new Set<string>()
        const stack = [targetId]
        while (stack.length > 0) {
          const current = stack.pop() as string
          if (descendants.has(current)) continue
          descendants.add(current)
          for (const child of data.categories) {
            if (child.parentId === current) stack.push(child.id)
          }
        }
        if (descendants.has(newParentId)) {
          entries.push({
            key,
            kind: 'move',
            status: 'cycle',
            fromLabel: fromPathLabel,
            toLabel: wantedParentPath.join(' / ') + ' / ' + target.name,
            targetId,
            include: true,
            raw: change,
          })
          continue
        }
      }

      const newParentLabel =
        newParentId === null
          ? ''
          : pathOf(data.categories, newParentId).join(' / ') + ' / '
      entries.push({
        key,
        kind: 'move',
        status: 'ok',
        fromLabel: fromPathLabel,
        toLabel: newParentLabel + target.name,
        targetId,
        newParentId,
        include: true,
        raw: change,
      })
      continue
    }

    if (change.kind === 'delete') {
      const { children, items } = countsUnder(data, targetId)
      entries.push({
        key,
        kind: 'delete',
        status: 'ok',
        fromLabel: fromPathLabel,
        toLabel: parentPath.join(' / '),
        targetId,
        childCount: children,
        itemCount: items,
        include: true,
        raw: change,
      })
    }
  }

  return {
    entries,
    problems: entries.filter((entry) =>
      entry.status === 'missing' || entry.status === 'duplicate' || entry.status === 'cycle',
    ).length,
  }
}

/**
 * 一份计划里，真正会被改动的条目数 —— 界面上那个「采纳」按钮上的数字。
 *
 * `noop` 不算（本来就那样），`missing` / `duplicate` / `cycle` 也不算
 * （做不了），被用户取消勾选的更不算。
 */
export function countEffectiveCategoryChanges(entries: readonly CategoryPlanEntry[]): number {
  return entries.filter((entry) => entry.include && entry.status === 'ok').length
}

/* ------------------------------------------------------------------ */
/* 落库（纯函数）                                                      */
/* ------------------------------------------------------------------ */

/** 名字被改过的分类：id → 新名字。界面上用来对一遍改了什么 */
export interface CategoryApplyResult {
  data: AppData
  created: number
  renamed: number
  moved: number
  deleted: number
  /** 被挂到父级去的子分类数（delete 的连带） */
  reparentedChildren: number
  /** 失去了这个分类归属的物品数（delete 的连带，物品本身一件不少） */
  affectedItems: number
}

/**
 * 把计划落到数据上。
 *
 * ── 为什么是个纯函数 ────────────────────────────────────────────
 * 分类是结构，动错了很难复原（用户看不到「本来应该是什么样」）。
 * 所以「算」全部收在这里，一行副作用都没有，可以被用例逐条钉死；
 * store 那边只负责拿结果去 commit。
 * 这和 `scripts/category-parent-fix.ts` 的分工是同一个道理。
 *
 * ── 两条硬规矩 ──────────────────────────────────────────────────
 *
 * 1. **绝不删物品。** 删分类只解除归属：直接挂在上面的物品会被
 *    摘掉这一个 categoryId（别的分类照旧），一件都不会少。
 * 2. **绝不留下孤儿。** 删掉的分类如果有子分类，子分类挂到
 *    「被删的那个的父级」去；如果它本来就是顶层，子分类就提升为顶层。
 *    留一堆 `parentId` 指向不存在节点的分类，界面上它们会
 *    **整个从树里消失**（`buildTree` 把它们当不可达）——
 *    用户会以为分类被删掉了，其实数据还在，那种状态最难解释。
 *
 * 顺序也讲究：**先建、再改名、再挪、最后删**。
 * 反过来（先删后建）的话，AI 说「把『杂项』拆掉、另建一个『其他』」
 * 会先制造一段「什么都不在」的中间态；而且删掉之后它占的名字空出来了，
 * 后面新建同名分类就不会被判成重复。
 */
export function applyCategoryPlan(
  data: AppData,
  entries: readonly CategoryPlanEntry[],
  now: string = new Date().toISOString(),
): CategoryApplyResult {
  const effective = entries.filter((entry) => entry.include && entry.status === 'ok')
  /** 分类当前的样子，边改边更新 */
  let categories: Category[] = data.categories.map((c) => ({ ...c }))
  let items = data.items.map((item) => ({ ...item }))

  let created = 0
  let renamed = 0
  let moved = 0
  let deleted = 0
  let reparentedChildren = 0
  let affectedItems = 0

  const nextOrder = (parentId: string | null): number => {
    let max = -1
    for (const category of categories) {
      if ((category.parentId ?? null) === parentId) max = Math.max(max, category.order)
    }
    return max + 1
  }

  /* ---------------- 1. 新建 ---------------- */
  for (const entry of effective.filter((e) => e.kind === 'create')) {
    const name = norm(entry.newName ?? '')
    if (name === '') continue
    const parentId = entry.newParentId ?? null
    if (parentId !== null && !categories.some((c) => c.id === parentId)) continue

    const category: Category = {
      id: uid(),
      name,
      parentId,
      order: nextOrder(parentId),
      createdAt: now,
    }
    categories.push(category)
    created++
  }

  /* ---------------- 2. 改名 ---------------- */
  for (const entry of effective.filter((e) => e.kind === 'rename')) {
    const targetId = entry.targetId
    const newName = norm(entry.newName ?? '')
    if (targetId === null || newName === '') continue
    const index = categories.findIndex((c) => c.id === targetId)
    if (index < 0) continue

    /*
     * 最后再挡一次同名冲突。
     *
     * 计划里已经查过了，但计划是**照着当时那份数据**算的 ——
     * 这中间用户完全可能自己在分类页新建了一个同名的。
     * 撞上就跳过（而不是硬改），因为两个同名同级分类在界面上分不清。
     */
    const current = categories[index] as Category
    const duplicate = categories.some(
      (c) => c.id !== targetId && (c.parentId ?? null) === (current.parentId ?? null) && c.name === newName,
    )
    if (duplicate) continue

    categories[index] = { ...current, name: newName }
    renamed++
  }

  /* ---------------- 3. 挪 ---------------- */
  for (const entry of effective.filter((e) => e.kind === 'move')) {
    const targetId = entry.targetId
    if (targetId === null) continue
    const newParentId = entry.newParentId ?? null
    const index = categories.findIndex((c) => c.id === targetId)
    if (index < 0) continue

    // 父级不在了（被前面某一步删了）→ 提到顶层，不留孤儿
    if (newParentId !== null && !categories.some((c) => c.id === newParentId)) {
      categories[index] = { ...(categories[index] as Category), parentId: null, order: nextOrder(null) }
      moved++
      continue
    }

    // 再挡一次成环：挪到自己或自己的子孙下面会让子树从界面上消失
    if (newParentId !== null) {
      const descendants = new Set<string>()
      const stack = [targetId]
      while (stack.length > 0) {
        const current = stack.pop() as string
        if (descendants.has(current)) continue
        descendants.add(current)
        for (const child of categories) if (child.parentId === current) stack.push(child.id)
      }
      if (descendants.has(newParentId)) continue
    }

    categories[index] = {
      ...(categories[index] as Category),
      parentId: newParentId,
      order: nextOrder(newParentId),
    }
    moved++
  }

  /* ---------------- 4. 删 ---------------- */
  for (const entry of effective.filter((e) => e.kind === 'delete')) {
    const targetId = entry.targetId
    if (targetId === null) continue
    const target = categories.find((c) => c.id === targetId)
    if (!target) continue

    const grandParentId = target.parentId ?? null

    // 子分类挂到祖父那一级 —— 绝不留下指向不存在父级的孤儿
    categories = categories.map((category) => {
      if (category.parentId !== targetId) return category
      reparentedChildren++
      return { ...category, parentId: grandParentId, order: nextOrder(grandParentId) }
    })

    // 物品只摘掉这**一个**分类归属，别的分类和字段一个字不动
    items = items.map((item) => {
      if (!item.categoryIds.includes(targetId)) return item
      affectedItems++
      return {
        ...item,
        categoryIds: item.categoryIds.filter((id) => id !== targetId),
        updatedAt: now,
      }
    })

    categories = categories.filter((c) => c.id !== targetId)
    deleted++
  }

  const touched = created + renamed + moved + deleted
  return {
    data: touched === 0 ? data : { ...data, categories, items, updatedAt: now },
    created,
    renamed,
    moved,
    deleted,
    reparentedChildren,
    affectedItems,
  }
}
