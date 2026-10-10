/**
 * 云端同步引擎。
 *
 * ── 一句话说清它是怎么工作的 ──────────────────────────────────────
 * **本地 IndexedDB 仍然是唯一真相源**，云端是「另一台设备的副本」。
 * 每次同步：拉远端 → 和本地合并（envelope.ts）→ 落回本地 → 再把结果推上去。
 * 断网、没登录、没配 Supabase 的时候，这个文件一行都不跑，
 * 应用和以前完全一样 —— 这是刻意的：数据在自己手上，云端只是让两台设备对得上。
 *
 * ── 为什么不做成「SupabaseRepository」 ─────────────────────────────
 * docs/设计文档.md 8.2 留的口子是「换一个 Repository 实现」。真做同步时发现
 * 那条路会让体验倒退，所以这里刻意没走：
 *
 *   · Repository 的 load/save 是**整份覆盖**。两台设备都用它，就是
 *     谁后写谁赢 —— 手机上刚录的东西会被电脑上那份整份盖掉，而且是静默的。
 *     要不出这种事就必须有「合并」，而合并只能在**两份数据**之间做，
 *     所以引擎必须能同时拿到本地和远端两份，Repository 那个单一入口装不下。
 *   · 如果 load/save 变成网络调用，那**断网就开不了应用**。
 *     这个项目是 PWA、是离线优先的，为了同步把离线砸掉是倒过来的。
 *
 * 所以最终的形状是：Repository 一动不动，另加这一层。设计文档 5.2 / 8.2
 * 那句「业务代码一行不改」也仍然成立 —— store 只多了一个
 * `applySyncedData`（同步结果落地），别的一行没动。
 *
 * ── 什么时候同步 ──────────────────────────────────────────────────
 *   · 启动后（本地数据读出来了）
 *   · 每次本地改动落盘之后（防抖，见 PUSH_DELAY_MS）
 *   · 切回前台 / 窗口重新获得焦点 / 网络恢复（都要限流，见 MIN_INTERVAL_MS）
 *   · 用户点「立即同步」
 * 刻意**不做实时推送**（Realtime）：两台设备同时开着改同一份数据的情况很少，
 * 而多一条长连接就多一类「半夜断了没人知道」的故障。要的话后面再加。
 */

import type { AppData } from '../types'
import { SCHEMA_VERSION } from '../types'
import { t, tc } from '../i18n'
import { uid } from '../lib/id'
import { STORE_KV, idbGet, idbPut } from '../storage/idb'
import { useAppStore } from '../store/useAppStore'
import { CLOUD_TABLE, cloudConfig, getClient, isCloudConfigured } from './client'
import {
  ENVELOPE_VERSION,
  type CloudEnvelope,
  checkEnvelope,
  hasAnyItems,
  makeEnvelope,
  mergeEnvelopes,
  sameEnvelopeContent,
  collectRemovals,
  mergeTombstones,
} from './envelope'

/* ------------------------------------------------------------------ */
/* 参数                                                                */
/* ------------------------------------------------------------------ */

/** 本地改完之后等这么久再推 —— 连续录入时不会每敲一下都发一次请求 */
const PUSH_DELAY_MS = 2500

/** 焦点 / 切前台 / 联网这类触发的最小间隔，免得来回切窗口就疯狂同步 */
const MIN_INTERVAL_MS = 20_000

/** 版本冲突时最多重试几轮（每轮都会先合并再推） */
const MAX_CONFLICT_RETRIES = 3

/** 内部信号：连着冲突太多次，这一轮先放弃（不是错误，见 pushWithConflictRetry） */
const CONFLICT_PENDING = 'SYNC_CONFLICT_PENDING'

/** 内部信号：远端数据比本程序新（信封或数据结构版本更高） */
const OUTDATED = 'SYNC_OUTDATED_VERSION'

/* ------------------------------------------------------------------ */
/* 状态                                                                */
/* ------------------------------------------------------------------ */

export type SyncPhase = 'off' | 'idle' | 'syncing' | 'error' | 'outdated'

export interface FirstSyncChoice {
  localItems: number
  remoteItems: number
  remoteAt: string
}

export interface CloudState {
  /** 环境变量配了没有 */
  configured: boolean
  /** 这个浏览器上登录了没有 */
  signedIn: boolean
  email: string | null
  phase: SyncPhase
  lastSyncAt: string | null
  lastError: string | null
  /** 本地有改动还没推上去 */
  pending: boolean
  /** 首次绑定、两边都有数据 —— 等用户选一次用哪边 */
  choice: FirstSyncChoice | null
}

/**
 * ⚠️ 每次变化都换一个新对象。
 *
 * React 的 useSyncExternalStore 会拿两次快照做 Object.is 比较：
 * 每次都返回新对象 = 永远判定「变了」= 无限重渲染（React 会直接抛
 * "The result of getSnapshot should be cached"）。所以这里是**换引用**，
 * 不是原地改字段。
 */
let state: CloudState = {
  configured: isCloudConfigured(),
  signedIn: false,
  email: null,
  phase: 'off',
  lastSyncAt: null,
  lastError: null,
  pending: false,
  choice: null,
}

const listeners = new Set<() => void>()

function setState(patch: Partial<CloudState>): void {
  const next = { ...state, ...patch }
  if (
    next.configured === state.configured &&
    next.signedIn === state.signedIn &&
    next.email === state.email &&
    next.phase === state.phase &&
    next.lastSyncAt === state.lastSyncAt &&
    next.lastError === state.lastError &&
    next.pending === state.pending &&
    next.choice === state.choice
  ) {
    return
  }
  state = next
  for (const fn of [...listeners]) fn()
}

export function getCloudState(): CloudState {
  return state
}

export function subscribeCloud(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/* ------------------------------------------------------------------ */
/* 传输层 —— 抽成接口，生产实现是 supabase-js，测试里换成假的            */
/*                                                                     */
/* 为什么要留这个口子：整件事最容易错的不是「怎么发请求」，而是**顺序**    */
/* （先拉再合再推、冲突了要合并重试、首次绑定要先问用哪边）。            */
/* 有了这个接口，那些顺序可以用一个假服务端在测试里跑个通透，           */
/* 而不必真的去连 Supabase。                                            */
/* ------------------------------------------------------------------ */

export interface PulledRemote {
  envelope: CloudEnvelope | null
  rev: number
}

export interface CloudTransport {
  userId: string
  email: string
  pull(): Promise<PulledRemote>
  /** 成功 → 返回新的 rev；`null` → 版本冲突（期间别的设备写过了） */
  push(envelope: CloudEnvelope, baseRev: number): Promise<number | null>
}

let transport: CloudTransport | null = null

/**
 * 测试用的口子：这不是「配置」，是**测试开关**。
 *
 * 为什么非留不可：有没有配置是构建时定下来的（`import.meta.env`），测试里
 * 改不了。而引擎里最容易出错、出错了后果最严重的几条路径
 * （首次绑定不许替用户决定、版本冲突要先合并再推、远端版本更高要拒绝）
 * 全都在「已配置 + 已登录」的分支里 —— 没法切进去，就等于这部分没测过。
 *
 * 传 null 恢复成读真实环境变量。**生产代码里没有任何地方调用它。**
 */
let configuredOverride: boolean | null = null

function cloudEnabled(): boolean {
  return configuredOverride ?? isCloudConfigured()
}

/** 仅供测试：假装（或假装没有）配好 Supabase */
export function __setCloudConfiguredForTest(value: boolean | null): void {
  configuredOverride = value
  setState({ configured: cloudEnabled() })
}

/** 传输层是不是被测试换掉了 —— 换掉之后就不再走真实会话那条路 */
let injectedTransport = false

/** 仅供测试：塞一个假的传输层进来，或者传 null 恢复成真实实现 */
export function __setCloudTransportForTest(next: CloudTransport | null): void {
  injectedTransport = next !== null
  transport = next
  if (next) setState({ signedIn: true, email: next.email, phase: 'idle' })
}

/* ------------------------------------------------------------------ */
/* 本机标识与墓碑的持久化                                              */
/* ------------------------------------------------------------------ */

const DEVICE_KEY = 'duansheli:cloud-device'

/**
 * 这台设备的标识。
 *
 * 用途只有一个：判断「远端那份是不是我自己刚推上去的」，避免同一份数据
 * 来回推、来回合并。放在 localStorage 里 —— 它属于**这台设备**，
 * 不属于数据本身，所以不能混进 AppData（那会被导出、被同步、被快照）。
 */
function deviceId(): string {
  try {
    const saved = localStorage.getItem(DEVICE_KEY)
    if (saved) return saved
    const fresh = uid()
    localStorage.setItem(DEVICE_KEY, fresh)
    return fresh
  } catch {
    // 无痕模式：拿不到就当这次的设备是个临时设备，同步照样能用
    return 'ephemeral'
  }
}

const device = deviceId()

/**
 * 墓碑按**账号**分开放。
 *
 * 不能共用一个键：换账号登录时，上一个账号的删除墓碑会跟着过来，
 * 把新账号里 id 恰好相同的记录按掉（id 是 uuid，概率极低，但这不是
 * 「概率低就可以不做」的那类问题 —— 代价是不可恢复的删数据）。
 */
function tombstoneKey(userId: string): string {
  return `cloud:tombstones:${userId}`
}

function boundKey(userId: string): string {
  return `cloud:bound:${userId}`
}

async function loadTombstones(userId: string): Promise<Record<string, string>> {
  const saved = await idbGet<Record<string, string>>(STORE_KV, tombstoneKey(userId))
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return {}
  const out: Record<string, string> = {}
  for (const [id, at] of Object.entries(saved)) {
    if (typeof at === 'string') out[id] = at
  }
  return out
}

async function saveTombstones(userId: string, map: Record<string, string>): Promise<void> {
  await idbPut(STORE_KV, map, tombstoneKey(userId))
}

async function isBound(userId: string): Promise<boolean> {
  return (await idbGet<boolean>(STORE_KV, boundKey(userId))) === true
}

async function markBound(userId: string): Promise<void> {
  await idbPut(STORE_KV, true, boundKey(userId))
}

/* ------------------------------------------------------------------ */
/* 运行时状态                                                          */
/* ------------------------------------------------------------------ */

let tombstones: Record<string, string> = {}
let lastSyncMs = 0
let started = false
/** 本地改动之后那次延迟推送的定时器（连续改动只推最后一次） */
let pushTimer: ReturnType<typeof setTimeout> | null = null
/**
 * 所有同步排成一条链。
 *
 * ── 为什么非串行不可 ────────────────────────────────────────────
 * 一次同步是「拉 → 合 → 落地 → 推」四个来回，中间全是 await。
 * 两次同步叠着跑的话，后一次会在前一次还没推完时就重新拉一遍，
 * 拿到的是旧数据，于是前面刚合出来的东西又被合一次 —— 最坏的情况是
 * 两台设备的改动互相盖掉。
 *
 * ── 为什么是链、不是「正在跑就直接返回」 ────────────────────────
 * 「正在跑就返回」看起来更省事，但它会让 `await syncNow()` 变成一句谎话：
 * 调用方以为同步做完了，其实还没开始。登录之后立刻同步、首次绑定选完
 * 之后落数据，都是靠这个 await 的语义在往下走的（测试也一样）。
 * 排成链之后，`await syncNow()` 的含义就真的是「这次同步已经做完了」。
 */
let chain: Promise<void> = Promise.resolve()
/** 首次绑定那份远端信封，等用户选完再用 */
let pendingChoice: { envelope: CloudEnvelope; rev: number } | null = null
/** 最后一次同步失败的原因（英文原文，给排查用） */
let lastFailureDetail: string | null = null

/** 上一次同步失败的原始报错（界面上「技术细节」展开的就是它） */
export function cloudFailureDetail(): string | null {
  return lastFailureDetail
}

/* ------------------------------------------------------------------ */
/* 错误翻译                                                            */
/* ------------------------------------------------------------------ */

/**
 * 把 Supabase / 网络的报错翻成一句人话。
 *
 * 为什么要翻译：那些原始报错是给开发者看的（"Invalid login credentials"、
 * "Failed to fetch"），用户看到只会以为程序坏了。
 * 但**原文也要留着**（lastFailureDetail）+ 界面上能展开看 ——
 * 「密码错了」和「项目还没建表」都糊成一句「同步失败」的话，就只能靠猜。
 */
/**
 * 「连不上」那句话。
 *
 * 带上了域名 —— 这条提示的价值全在**可操作**上：
 * 用户遇到这个错时，最常见的原因不是网络断了，而是**网络到不了
 * `<项目>.supabase.co` 这个域名**（TCP 通、TLS 握手被重置），
 * 而控制台那个 `supabase.com` 却是通的，于是「我明明能打开控制台」会把人带偏。
 * 所以直接把「去浏览器打开这个地址试试」写进提示里。
 */
function networkMessage(): string {
  /*
   * 兜底那串**不能写中文**：它是个域名模板，两种语言下都该长一样
   * （中文写在这儿，英文界面里就会冒出来一句中文；audit:i18n 也会拦下来）。
   *
   * 而且实际上走不到兜底：这条提示只在「已经配好云端」的路径上出现，
   * 那时 cloudConfig 一定有值。留着是为了万一。
   */
  const host = cloudConfig?.url ?? 'https://<project-ref>.supabase.co'
  return t('cloud.errorNetwork', { host })
}

function describeError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  lastFailureDetail = raw
  const lower = raw.toLowerCase()

  if (looksLikeNetwork(lower)) return networkMessage()

  if (
    lower.includes('relation') &&
    lower.includes('does not exist')
  ) {
    return t('cloud.errorNoTable')
  }
  if (raw.includes('42P01') || raw.includes('PGRST205')) return t('cloud.errorNoTable')
  if (lower.includes('does not exist') && lower.includes('column')) {
    return t('cloud.errorNoTable')
  }

  return t('cloud.errorGeneric', { message: raw })
}

function looksLikeNetwork(lower: string): boolean {
  return (
    lower.includes('failed to fetch') ||
    lower.includes('networkerror') ||
    lower.includes('network request failed') ||
    lower.includes('load failed') ||
    lower.includes('timeout') ||
    lower.includes('offline')
  )
}

function describeAuthError(raw: string): string {
  lastFailureDetail = raw
  const lower = raw.toLowerCase()
  if (looksLikeNetwork(lower)) return networkMessage()
  if (lower.includes('invalid login credentials')) return t('cloud.errorBadCredentials')
  if (lower.includes('email not confirmed')) return t('cloud.errorEmailNotConfirmed')
  if (lower.includes('already registered') || lower.includes('already been registered')) {
    return t('cloud.errorAlreadyRegistered')
  }
  if (lower.includes('password should be at least') || lower.includes('password is too short')) {
    return t('cloud.errorWeakPassword')
  }
  if (lower.includes('rate limit') || lower.includes('too many requests')) {
    return t('cloud.errorRateLimited')
  }
  if (lower.includes('signups not allowed') || lower.includes('signup is disabled')) {
    return t('cloud.errorSignupDisabled')
  }
  if (lower.includes('unable to validate email') || lower.includes('invalid email')) {
    return t('cloud.errorBadEmail')
  }
  return t('cloud.errorGeneric', { message: raw })
}

/* ------------------------------------------------------------------ */
/* 真实传输层                                                          */
/* ------------------------------------------------------------------ */

function looksLikeMissingTable(error: { code?: string; message?: string }): boolean {
  const code = error.code ?? ''
  const message = (error.message ?? '').toLowerCase()
  return (
    code === '42P01' ||
    code === 'PGRST205' ||
    (message.includes('does not exist') && message.includes('relation'))
  )
}

function makeSupabaseTransport(): CloudTransport | null {
  const supabase = getClient()
  if (!supabase) return null

  // userId / email 由 ensureTransport() 填好之后才用
  const found: CloudTransport = {
    userId: '',
    email: '',
    async pull(): Promise<PulledRemote> {
      const { data, error } = await supabase
        .from(CLOUD_TABLE)
        .select('doc, rev')
        .eq('user_id', found.userId)
        .maybeSingle()
      if (error) {
        if (looksLikeMissingTable(error)) throw new Error(error.message)
        throw new Error(error.message)
      }
      if (!data) return { envelope: null, rev: 0 }
      return { envelope: data.doc as CloudEnvelope, rev: Number(data.rev) || 0 }
    },
    async push(envelope: CloudEnvelope, baseRev: number): Promise<number | null> {
      if (baseRev <= 0) {
        const { error } = await supabase.from(CLOUD_TABLE).insert({
          user_id: found.userId,
          doc: envelope,
          rev: 1,
          device_id: envelope.deviceId,
        })
        if (error) {
          // 23505 = 主键冲突：这一行已经被别人建出来了 → 当成版本冲突处理
          if (error.code === '23505') return null
          throw new Error(error.message)
        }
        return 1
      }

      /*
       * 乐观并发的关键就在这个 `.eq('rev', baseRev)`：
       * 只有「我读到的那个版本还没人动过」时才写得进去。
       * 期间别的设备写过 → rev 已经变了 → 这一行匹配不到 → data 为 null
       * → 返回 null 让调用方去合并。**不许无条件覆盖**，那会静默吃掉对方的改动。
       */
      const { data, error } = await supabase
        .from(CLOUD_TABLE)
        .update({
          doc: envelope,
          rev: baseRev + 1,
          device_id: envelope.deviceId,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', found.userId)
        .eq('rev', baseRev)
        .select('rev')
        .maybeSingle()
      if (error) throw new Error(error.message)
      if (!data) return null
      return Number(data.rev)
    },
  }
  return found
}

/** 拿当前会话建一个可用的传输层；没登录就返回 null */
async function ensureTransport(): Promise<CloudTransport | null> {
  if (!cloudEnabled()) return null
  const supabase = getClient()
  if (!supabase) return null

  const { data, error } = await supabase.auth.getSession()
  if (error) throw new Error(error.message)
  const session = data.session
  if (!session) {
    transport = null
    setState({ signedIn: false, email: null, phase: 'off' })
    return null
  }

  const email = session.user.email ?? ''
  if (transport === null || transport.userId !== session.user.id) {
    const built = makeSupabaseTransport()
    if (!built) return null
    built.userId = session.user.id
    built.email = email
    transport = built
    tombstones = await loadTombstones(session.user.id)
  }

  setState({ signedIn: true, email, phase: state.phase === 'off' ? 'idle' : state.phase })
  return transport
}

/* ------------------------------------------------------------------ */
/* 同步主流程                                                          */
/* ------------------------------------------------------------------ */

export type SyncTrigger = 'start' | 'local' | 'visible' | 'online' | 'manual'

/**
 * 同步一次。所有触发方式都走这里，于是「限流」「排队」「冲突重试」
 * 只有一份实现。
 */
export async function syncNow(trigger: SyncTrigger = 'manual'): Promise<void> {
  if (!cloudEnabled()) return
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    // 离线不是「出错」——本地照样能用，等联网了会自动再试
    setState({ phase: 'error', lastError: networkMessage() })
    return
  }

  // 焦点 / 切前台 / 联网这类高频触发要限流；手动点的不限
  if (trigger !== 'manual' && trigger !== 'local' && Date.now() - lastSyncMs < MIN_INTERVAL_MS) {
    return
  }

  /*
   * 排到链尾。用 then 的两个参数而不是 catch：不管上一次成功还是失败，
   * 这一次都要照跑（上一次失败不该把后面的同步堵死）。
   */
  const run = chain.then(
    () => performSync(),
    () => performSync(),
  )
  chain = run.then(
    () => undefined,
    () => undefined,
  )
  await run
}

/** 真正跑一次同步：状态、失败处理都在这里，链只负责排队 */
async function performSync(): Promise<void> {
  setState({ phase: 'syncing', lastError: null })
  try {
    await runSync()
    lastSyncMs = Date.now()
    setState({ phase: 'idle', lastSyncAt: new Date().toISOString(), lastError: null })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (message === CONFLICT_PENDING) {
      // 不是错误：还有东西没推上去，界面挂「待同步」，下次再试
      setState({ phase: 'idle', pending: true })
    } else if (message === OUTDATED) {
      setState({ phase: 'outdated', lastError: t('cloud.outdated') })
    } else {
      setState({ phase: 'error', lastError: describeError(err) })
    }
  }
}

async function runSync(): Promise<void> {
  // 本地数据还没读出来之前不能同步：那一刻 store 里是空数据，
  // 推上去等于把云端那份清空。
  if (useAppStore.getState().status !== 'ready') return

  // 测试里换过传输层就直接用它；生产路径永远是「从当前会话建一个」
  const active = injectedTransport ? transport : await ensureTransport()
  if (!active) return

  const local = useAppStore.getState().data
  const remote = await active.pull()

  /* ---------------- 云端还没有数据 ---------------- */
  if (remote.envelope === null) {
    const envelope = makeEnvelope(local, tombstones, device)
    await pushWithConflictRetry(active, envelope, remote.rev)
    await markBound(active.userId)
    setState({ pending: false })
    return
  }

  /* ---------------- 远端那份能不能用 ---------------- */
  const check = checkEnvelope(remote.envelope)
  if (!check.ok) {
    /*
     * 形状不对就**绝不合并** —— 本地那份是用户唯一的东西，
     * 不能拿一份读不懂的数据去合它。这里宁可报错让人来找原因。
     *
     * 但「数据结构版本比我高」要单独说：那不是数据坏了，是**程序该升级了**，
     * 说成「同步失败」会让人以为数据出问题，去干更危险的事。
     */
    if (check.reason === 'badSchema') throw new Error(OUTDATED)
    throw new Error(`bad envelope: ${check.reason}`)
  }
  if (remote.envelope.v > ENVELOPE_VERSION) throw new Error(OUTDATED)
  if (remote.envelope.schemaVersion > SCHEMA_VERSION) throw new Error(OUTDATED)

  /* ---------------- 首次绑定：两边都有东西就先问 ---------------- */
  /*
   * 只在**两边都真的录了物品**时才问。
   *
   * 新设备第一次打开会被铺一套脚手架（分类、位置、属性都有，物品是空的），
   * 那时候问「用这台设备还是用云端」是多余的吓唬 —— 合并只会做加法，
   * 本来就没有可丢的东西，直接合了更省事。
   */
  const bound = await isBound(active.userId)
  if (!bound && hasAnyItems(local) && hasAnyItems(remote.envelope.data)) {
    pendingChoice = { envelope: remote.envelope, rev: remote.rev }
    setState({
      choice: {
        localItems: local.items.length,
        remoteItems: remote.envelope.data.items.length,
        remoteAt: remote.envelope.savedAt,
      },
    })
    return
  }

  /* ---------------- 合并 → 落地 → 推 ---------------- */
  await reconcile(active, remote.envelope, remote.rev)

  if (!bound) await markBound(active.userId)
}

/**
 * 合并远端、把结果落到本地、必要时推回去。
 *
 * 顺序不能动：**先合、再落、最后推**。
 * 先推的话，推上去的是没合过的那份，对方的改动就被整份盖掉了。
 */
async function reconcile(
  active: CloudTransport,
  remoteEnvelope: CloudEnvelope,
  rev: number,
): Promise<void> {
  const local = useAppStore.getState().data
  const mine = makeEnvelope(local, tombstones, device)
  const merged = mergeEnvelopes(mine, remoteEnvelope)

  if (merged.dataChanged || merged.removed > 0) {
    const dropped = missingIds(local, merged.data)
    await useAppStore.getState().applySyncedData(merged.data, {
      aiSessionStale: dropped.length > 0,
    })
    if (dropped.length > 0) {
      /*
       * 别的设备删掉了东西 —— 这台设备上它刚刚消失。
       *
       * 必须说一声。不说的话用户看到的是「我这儿东西怎么少了」，
       * 而这是他最不能接受的一类变化（详见 store 里那句
       * 「默默少做一部分还不说，正是这个项目一直在避免的事」）。
       */
      useAppStore.getState().notify(tc(dropped.length, 'cloud.removedByOtherDevice'), 'info')
    }
  }

  tombstones = merged.deleted
  await saveTombstones(active.userId, tombstones)

  const outgoing = makeEnvelope(merged.data, merged.deleted, device)
  // 内容没变就别推了：每次推都会让另一台设备白拉一次
  if (sameEnvelopeContent(outgoing, remoteEnvelope)) {
    setState({ pending: false })
    return
  }

  await pushWithConflictRetry(active, outgoing, rev)
  setState({ pending: false })
}

/**
 * 推上去；如果版本冲突（期间别的设备写过），拉下来合并再推。
 *
 * 这里是「手机上的改动被电脑整份盖掉」唯一的防线：
 * 冲突时**没有一条路径是无条件覆盖**，必须先合并。
 */
async function pushWithConflictRetry(
  active: CloudTransport,
  envelope: CloudEnvelope,
  baseRev: number,
): Promise<number> {
  let current = envelope
  let rev = baseRev

  for (let attempt = 0; attempt < MAX_CONFLICT_RETRIES; attempt++) {
    const nextRev = await active.push(current, rev)
    if (nextRev !== null) return nextRev

    // 冲突：先看对方写了什么
    const remote = await active.pull()
    if (remote.envelope === null) {
      // 对方把那一行删了（换账号 / 手工清理）→ 当成重新插入
      rev = 0
      continue
    }
    const check = checkEnvelope(remote.envelope)
    if (!check.ok) {
      if (check.reason === 'badSchema') throw new Error(OUTDATED)
      throw new Error(`bad envelope: ${check.reason}`)
    }
    if (remote.envelope.v > ENVELOPE_VERSION) throw new Error(OUTDATED)
    if (remote.envelope.schemaVersion > SCHEMA_VERSION) throw new Error(OUTDATED)

    const local = useAppStore.getState().data
    const merged = mergeEnvelopes(makeEnvelope(local, tombstones, device), remote.envelope)
    if (merged.dataChanged) {
      const dropped = missingIds(local, merged.data)
      await useAppStore.getState().applySyncedData(merged.data, {
        aiSessionStale: dropped.length > 0,
      })
      if (dropped.length > 0) {
        useAppStore.getState().notify(tc(dropped.length, 'cloud.removedByOtherDevice'), 'info')
      }
    }
    tombstones = merged.deleted
    await saveTombstones(active.userId, tombstones)
    current = makeEnvelope(merged.data, merged.deleted, device)
    rev = remote.rev
  }

  // 连着冲突好几次（两边都在猛写）—— **不弹错误**，只挂个「还有没推上去的」。
  // 下一次同步或用户点一下就好了；这里弹错反而会让人以为数据坏了。
  throw new Error(CONFLICT_PENDING)
}

/* ------------------------------------------------------------------ */
/* 首次绑定：用哪一边                                                  */
/* ------------------------------------------------------------------ */

export type FirstSyncStrategy = 'merge' | 'push' | 'pull'

/**
 * 第一次在这台设备上开启同步、而云端已经有数据时，用哪一边？
 *
 * 为什么不替用户决定：两边都有东西时，「合并」会得到双份的分类和位置
 * （各自建的 id 不同），「覆盖」会丢掉一边。哪一种更合适只有他自己知道
 * （比如手机上是刚开始录的空壳，电脑上才是正经数据）。
 * 所以这里只是把三种结果讲清楚，让他选，并且**默认选中合并**。
 */
export async function resolveFirstSync(strategy: FirstSyncStrategy): Promise<void> {
  const pending = pendingChoice
  const active = transport
  if (!pending || !active) return

  pendingChoice = null
  setState({ choice: null, phase: 'syncing' })

  try {
    const local = useAppStore.getState().data

    if (strategy === 'pull') {
      // 用云端的覆盖本机：连墓碑一起接过来，否则本机的删除会反过来删云端
      tombstones = mergeTombstones({}, pending.envelope.deleted)
      await saveTombstones(active.userId, tombstones)
      const dropped = missingIds(local, pending.envelope.data)
      await useAppStore.getState().applySyncedData(pending.envelope.data, {
        aiSessionStale: dropped.length > 0,
      })
      await markBound(active.userId)
      setState({ phase: 'idle', pending: false, lastSyncAt: new Date().toISOString() })
      useAppStore.getState().notify(t('cloud.firstSyncPulled'), 'success')
      return
    }

    if (strategy === 'push') {
      // 用本机的覆盖云端：墓碑清空（本机现在这份就是唯一真相）
      tombstones = {}
      await saveTombstones(active.userId, tombstones)
      const envelope = makeEnvelope(local, tombstones, device)
      await pushWithConflictRetry(active, envelope, pending.rev)
      await markBound(active.userId)
      setState({ phase: 'idle', pending: false, lastSyncAt: new Date().toISOString() })
      useAppStore.getState().notify(t('cloud.firstSyncPushed'), 'success')
      return
    }

    await reconcile(active, pending.envelope, pending.rev)
    await markBound(active.userId)
    setState({ phase: 'idle', lastSyncAt: new Date().toISOString() })
    useAppStore.getState().notify(t('cloud.firstSyncMerged'), 'success')
  } catch (err) {
    setState({ phase: 'error', lastError: describeError(err) })
    throw err
  }
}

/* ------------------------------------------------------------------ */
/* 登录 / 退出                                                         */
/* ------------------------------------------------------------------ */

export interface AuthOutcome {
  ok: boolean
  /** 注册成功但还需要去邮箱点确认链接 */
  needsEmailConfirm?: boolean
  error?: string
}

export async function signUpCloud(email: string, password: string): Promise<AuthOutcome> {
  const supabase = getClient()
  if (!supabase) return { ok: false, error: t('cloud.notConfiguredShort') }
  try {
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
    })
    if (error) return { ok: false, error: describeAuthError(error.message) }
    // 项目开了「确认邮箱」时，注册完还拿不到会话 —— 必须让人知道要去点邮件
    if (!data.session) return { ok: true, needsEmailConfirm: true }
    await afterSignIn()
    return { ok: true }
  } catch (err) {
    return { ok: false, error: describeAuthError(err instanceof Error ? err.message : String(err)) }
  }
}

export async function signInCloud(email: string, password: string): Promise<AuthOutcome> {
  const supabase = getClient()
  if (!supabase) return { ok: false, error: t('cloud.notConfiguredShort') }
  try {
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (error) return { ok: false, error: describeAuthError(error.message) }
    await afterSignIn()
    return { ok: true }
  } catch (err) {
    return { ok: false, error: describeAuthError(err instanceof Error ? err.message : String(err)) }
  }
}

export async function signOutCloud(): Promise<void> {
  const supabase = getClient()
  transport = null
  tombstones = {}
  pendingChoice = null
  setState({
    signedIn: false,
    email: null,
    phase: 'off',
    lastSyncAt: null,
    lastError: null,
    pending: false,
    choice: null,
  })
  if (supabase) await supabase.auth.signOut()
}

async function afterSignIn(): Promise<void> {
  await ensureTransport()
  // 登录之后立刻同步一次 —— 用户在手机上登录，本来就是想看到电脑上的数据
  await syncNow('manual')
}

/* ------------------------------------------------------------------ */
/* 启动与触发                                                          */
/* ------------------------------------------------------------------ */

/**
 * 本地数据变了 → 记墓碑 + 排一次推送。
 *
 * 为什么用「前后两份数据的差」而不是让 store 主动报告删了什么：
 * 删除的入口有很多（物品页彻底删除、分类页删节点、清空所有、回退快照、
 * 导入覆盖……），漏掉任何一个都会让删除悄悄失去同步能力。
 * 比对两份数据的差是**唯一一个不可能漏**的位置。
 */
function onLocalChange(prev: AppData, next: AppData): void {
  const at = new Date().toISOString()
  const removals = collectRemovals(prev, next, at)
  if (Object.keys(removals).length > 0 && transport !== null) {
    tombstones = mergeTombstones(tombstones, removals)
    const userId = transport.userId
    // 不 await：这是一条订阅回调，不能拖住界面
    void saveTombstones(userId, tombstones).catch(() => {})
  }
  if (transport === null) return
  if (state.choice !== null) return // 等用户选完再推，否则等于替他做了决定

  setState({ pending: true })
  if (pushTimer !== null) clearTimeout(pushTimer)
  pushTimer = setTimeout(() => {
    pushTimer = null
    void syncNow('local')
  }, PUSH_DELAY_MS)
}

/**
 * 启动云端同步。
 *
 * 幂等 —— React 的 StrictMode 会把 effect 跑两遍，重复调用不会挂两套监听。
 */
export function initCloud(): void {
  if (started) return
  started = true

  if (!cloudEnabled()) {
    setState({ configured: false, phase: 'off' })
    return
  }

  useAppStore.subscribe((current, previous) => {
    if (current.data === previous.data) return
    // 本地数据还没读出来之前不管：那一刻 store 里是空壳，比对出来的差没有意义
    if (current.status !== 'ready') return
    onLocalChange(previous.data, current.data)
  })

  // 本地数据读完（status: ready）之后自动来一次 —— 打开手机就想看到最新的
  const unsubscribeBoot = useAppStore.subscribe((current) => {
    if (current.status === 'ready') {
      unsubscribeBoot()
      void syncNow('start')
    }
  })

  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => void syncNow('online'))
    window.addEventListener('focus', () => void syncNow('visible'))
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void syncNow('visible')
    })
  }

  const supabase = getClient()
  supabase?.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') {
      transport = null
      setState({ signedIn: false, email: null, phase: 'off', choice: null })
      return
    }
    /*
     * 会话续期（TOKEN_REFRESHED）也会走到这里，但**不在这里触发同步**：
     * 它可能在任何时刻发生，跟着它同步会让网络请求变得不可预测。
     * 需要同步的地方（登录后、改动后、切前台）都已经各自触发了。
     */
  })

  void ensureTransport()
    .then((active) => {
      if (active && useAppStore.getState().status === 'ready') void syncNow('start')
    })
    .catch(() => {
      // 拿会话失败不是致命错误：没登录就等于没开同步，界面上会说明
    })
}

/** 仅供测试：把引擎恢复成「没启动过」的样子 */
export function __resetCloudForTest(): void {
  started = false
  if (pushTimer !== null) clearTimeout(pushTimer)
  pushTimer = null
  chain = Promise.resolve()
  transport = null
  injectedTransport = false
  tombstones = {}
  lastSyncMs = 0
  pendingChoice = null
  lastFailureDetail = null
  state = {
    configured: cloudEnabled(),
    signedIn: false,
    email: null,
    phase: 'off',
    lastSyncAt: null,
    lastError: null,
    pending: false,
    choice: null,
  }
  for (const fn of [...listeners]) fn()
}

/** 仅供测试：直接读引擎里的墓碑（不落盘那一步） */
export function __tombstonesForTest(): Record<string, string> {
  return tombstones
}

/** 当前本机设备号（界面上要显示，方便用户分辨「这台是哪台」） */
export function currentDeviceId(): string {
  return device
}

/** 本地有哪几个 id 在对方那份里没有了 —— 用来决定「要不要说一声」 */
function missingIds(before: AppData, after: AppData): string[] {
  const has = (data: AppData, key: 'items' | 'categories' | 'locations' | 'collections' | 'checklists' | 'attributeDefs') =>
    new Set((data[key] as Array<{ id: string }>).map((node) => node.id))
  const out: string[] = []
  for (const key of ['items', 'categories', 'locations', 'collections', 'checklists', 'attributeDefs'] as const) {
    const inAfter = has(after, key)
    for (const node of before[key] as Array<{ id: string }>) {
      if (!inAfter.has(node.id)) out.push(node.id)
    }
  }
  return out
}
