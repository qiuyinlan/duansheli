/**
 * 让 AI 能**单独新建位置**。
 *
 * ── 用户的原话（这就是他报的那个）────────────────────────────────
 * > 「在 左边小小型一号白色四层收纳/顶层，新建这个位置」
 * > AI 回：「「新建位置」单独出现时建不了 —— 位置是跟着物品一起产生的。
 * >   你是想把某件东西放进…吗？」
 * > 「需要可以新建位置」
 *
 * 他说得对。位置只能跟着物品一起产生（`convert.ts` 里 `newLocationPath`
 * 的唯一来源是物品的 `location`），这条限制对「先把架子搭好、再往格子里放东西」
 * 的用法是完全挡路的 —— 而那正是他的用法（他一次要建好几层收纳架）。
 *
 * ── 为什么照「整理分类」的样子做 ────────────────────────────────
 * 位置和分类是**同一类东西**：都是结构，改错了没法用眼睛验
 * （你只会看到「树变了样子」）。所以这里沿用 `ai/categoryEdit.ts` 那套分工：
 *
 *   · 这一层**只算**：把 AI 的意图翻译成一份「打算建什么」的清单，一行都不碰数据
 *   · 落库由用户在界面上点「采纳」之后才发生（`store.applyLocationPlan`）
 *   · 采纳之后把「建了什么」如实报出来
 *
 * ── 这一版只有 `create` ───────────────────────────────────────
 * 他这次要的就是新建。改名 / 移动 / 删除在同一套协议上留了口子
 * （`LocationChangeKind` 是个联合类型，加一个就多一种），
 * 但**不先做**：`addLocation` 至今没有同级重名检查（和 `addCategory` 不一样），
 * 移动还会牵扯「物品跟着走」的说明，那两件事各有各的边界要定。
 * 真需要的时候照这份文件再写一遍就是了。
 *
 * ── 一条刻意的行为：路径里缺的层**一起建出来** ────────────────────
 * 用户写「左边小小型一号白色四层收纳 / 顶层」时，中间那级可能还不存在。
 * 这时候**不报「找不到」**，而是照他写的路径逐级建出来 —— 因为这不是在猜
 * 他是哪个意思，而是把他明确写出来的路径**物化**。而且界面上会一行一行列出
 * 「将新建：左边小小型一号白色四层收纳 → 顶层」，他过一眼就能否掉。
 * （报「找不到父级」把他挡住，才是真的没帮上忙：他还得先建中间那层。）
 */

import type { AppData, Location } from '../types'
import { uid } from '../lib/id'

/* ------------------------------------------------------------------ */
/* 意图（AI 说人话，程序翻译成这个）                                     */
/* ------------------------------------------------------------------ */

/** 这一版只支持新建。加动作时先回来看文件顶部那段说明。 */
export type LocationChangeKind = 'create'

export interface LocationChange {
  kind: LocationChangeKind
  /** 要建的位置的**名称路径**（从顶层到它自己） */
  path: string[]
  /** 新建时挂哪一级下；缺省 = 用 `path` 里最后一段之前的部分 */
  parentPath?: string[]
  /** 名字（缺省 = `path` 的最后一段） */
  newName?: string
}

/* ------------------------------------------------------------------ */
/* 解析后的计划                                                        */
/* ------------------------------------------------------------------ */

export type LocationPlanStatus =
  /** 能建（跟着会真的建出来） */
  | 'ok'
  /** 库里已经有这一条了（同名同级），不用建 */
  | 'duplicate'

export interface LocationPlanEntry {
  /** 界面上做 key，也让用户能单独取消某一条 */
  key: string
  kind: LocationChangeKind
  status: LocationPlanStatus
  /** 新建的条目没有「原来的位置」——措辞交给界面（这一层不该知道界面语言） */
  isNew: true
  /** 目标位置现在的路径文字（新建时是空字符串） */
  fromLabel: string
  /** 建完之后的完整路径，给界面显示 */
  toLabel: string
  /** 逐级要建的名字，从顶层往下 —— 缺的层也在里面，所以用户看得见会多出几级 */
  willCreate: string[]
  /** 父级 id（顶层为 null；status 为 duplicate 时是已有那条的父级） */
  newParentId: string | null
  /** 要建的名字（duplicate 时是已有那条的名字） */
  newName: string
  /** 用户勾掉了就不建（默认都建） */
  include: boolean
  /** AI 原本的话，用来在界面上如实展示（不用它做判断） */
  raw: LocationChange
}

export interface LocationPlanResult {
  entries: LocationPlanEntry[]
  /** 有问题的那些（现在只有 duplicate）—— 界面上要单独说一句 */
  problems: number
}

/* ------------------------------------------------------------------ */
/* 路径工具（和 AI、和录入那边同一套归一化）                             */
/* ------------------------------------------------------------------ */

const norm = (value: string) => value.trim()
const normKey = (value: string) => norm(value).replace(/\s+/g, ' ').toLowerCase()

function pathOf(locations: readonly Location[], id: string): string[] {
  const byId = new Map(locations.map((l) => [l.id, l]))
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

/** 某一级下面同名的那条（归一化后比 —— 和 `resolvePathIn` 的比法一致） */
function childNamed(
  locations: readonly Location[],
  parentId: string | null,
  name: string,
): Location | null {
  const key = normKey(name)
  for (const location of locations) {
    if ((location.parentId ?? null) !== parentId) continue
    if (normKey(location.name) === key) return location
  }
  return null
}

/* ------------------------------------------------------------------ */
/* 算计划                                                              */
/* ------------------------------------------------------------------ */

/**
 * 把 AI 的意图翻译成一份可执行的计划。**一行都不改数据。**
 *
 * 它只回答：这条要建什么路径、缺哪几级、是不是已经有了。
 */
export function planLocationChanges(
  data: AppData,
  changes: readonly LocationChange[],
): LocationPlanResult {
  const entries: LocationPlanEntry[] = []

  for (const change of changes) {
    const rawPath = change.path.map(norm).filter((part) => part !== '')
    if (rawPath.length === 0) continue

    const name = norm(change.newName ?? rawPath[rawPath.length - 1] ?? '')
    if (name === '') continue

    const parentPath = (
      change.parentPath !== undefined ? change.parentPath : rawPath.slice(0, -1)
    )
      .map(norm)
      .filter((part) => part !== '')

    /* 逐级往下走：走得到的那几级用现成的，走不到的记下来待建 */
    let parentId: string | null = null
    const willCreate: string[] = []
    let parentExists = true
    for (const levelName of parentPath) {
      if (parentExists) {
        const existing = childNamed(data.locations, parentId, levelName)
        if (existing !== null) {
          parentId = existing.id
          continue
        }
        parentExists = false
      }
      willCreate.push(levelName)
    }

    const duplicate =
      parentExists && childNamed(data.locations, parentId, name) !== null

    /*
     * 已经存在的路径：`willCreate` 空 + duplicate。
     * 这时给的是「不用建」，而不是把它当错误 —— 用户说「建这个位置」而它已经有了，
     * 不是他错了，是没什么可做的。
     */
    if (duplicate) {
      const existing = childNamed(data.locations, parentId, name)
      entries.push({
        key: uid(),
        kind: 'create',
        status: 'duplicate',
        isNew: true,
        fromLabel: '',
        toLabel: [...pathOf(data.locations, existing?.id ?? ''), name].join(' / '),
        willCreate: [],
        newParentId: parentId,
        newName: name,
        include: true,
        raw: change,
      })
      continue
    }

    willCreate.push(name)
    const parentPathLabel = parentPath.join(' / ')
    entries.push({
      key: uid(),
      kind: 'create',
      status: 'ok',
      isNew: true,
      fromLabel: '',
      toLabel: (parentPathLabel === '' ? '' : parentPathLabel + ' / ') + name,
      willCreate,
      newParentId: parentId,
      newName: name,
      include: true,
      raw: change,
    })
  }

  return { entries, problems: entries.filter((entry) => entry.status !== 'ok').length }
}

/** 有内容的条目数（界面上那个「采纳（N）」用的数） */
export function countLocationChanges(entries: readonly LocationPlanEntry[]): number {
  return entries.filter((entry) => entry.include && entry.status === 'ok').length
}

/* ------------------------------------------------------------------ */
/* 落到数据上                                                          */
/* ------------------------------------------------------------------ */

export interface LocationApplyResult {
  data: AppData
  /** 真的建了几个位置（含顺带建出来的中间层） */
  created: number
}

/**
 * 把计划落到数据上 —— **纯函数**，一行副作用都没有。
 *
 * 逐级建：`willCreate` 里每一级先看这一层有没有同名的（有就用现成的），
 * 没有才新建。所以「AI 说了要建 A / B，而 A 已经存在」不会建出第二个 A，
 * 中间层也不会重复。
 *
 * order 一级一级现算（`nextOrder`）—— 和 `addLocation` 一样，
 * 撞了的话界面上同级顺序就随缘了。
 */
export function applyLocationPlan(
  data: AppData,
  entries: readonly LocationPlanEntry[],
  now: string = new Date().toISOString(),
): LocationApplyResult {
  const effective = entries.filter((entry) => entry.include && entry.status === 'ok')
  const locations: Location[] = data.locations.map((location) => ({ ...location }))
  let created = 0

  const nextOrder = (parentId: string | null): number => {
    let max = -1
    for (const location of locations) {
      if ((location.parentId ?? null) === parentId) max = Math.max(max, location.order)
    }
    return max + 1
  }

  for (const entry of effective) {
    let parentId: string | null = entry.newParentId
    /* 父级如果在计划里刚被建出来，这一步要认出来：按名字逐级往下找 */
    for (const levelName of entry.willCreate) {
      const existing = childNamed(locations, parentId, levelName)
      if (existing !== null) {
        parentId = existing.id
        continue
      }
      const location: Location = {
        id: uid(),
        name: levelName,
        parentId,
        order: nextOrder(parentId),
        note: '',
        createdAt: now,
      }
      locations.push(location)
      parentId = location.id
      created++
    }
  }

  if (created === 0) return { data, created: 0 }
  return { data: { ...data, locations, updatedAt: now }, created }
}
