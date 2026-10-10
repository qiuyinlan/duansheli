/**
 * 连接自检 —— 在**浏览器里**问 Supabase 三个问题。
 *
 * ── 为什么要在应用里做这件事 ────────────────────────────────────
 * 「同步失败」这四个字底下藏着至少五种完全不同的原因：
 *   1. 网络到不了那个域名
 *   2. 浏览器扩展／拦截器把请求干掉了（**这个最阴**：直接访问那个地址是好的，
 *      只有页面发出的请求会被拦）
 *   3. 钥匙错、被撤销、或者**用错了种类**
 *   4. 表还没建
 *   5. 邮箱登录没开
 * 它们的界面表现几乎一样，而**只有浏览器自己**能分辨 1 和 2 ——
 * 命令行脚本（scripts/check-supabase.mjs）走的是另一条网络路径，
 * 浏览器里的扩展它根本看不见。
 *
 * `fetchImpl` 是参数而不是直接写 `fetch`：这样这套判定逻辑可以用
 * 假的响应测（见 tests/cloud.ts）——「HTTP 401 到底算好还是坏」
 * 这种判断必须钉住，它直接决定提示是「一切正常」还是「你的数据谁都能读」。
 *
 * ── 探针地址是踩了两次坑才定下来的，别随手改 ─────────────────────
 * 第一次：拿 `/rest/v1/` 当「钥匙对不对」的判据。可建表脚本里那句
 *   `revoke all ... from anon` 会让未登录的请求拿到 401 —— 那是我们要的效果，
 *   却被读成「钥匙被拒绝」，用户差点去重发一把钥匙。
 * 第二次：改用它之后发现，`/rest/v1/` 这个**根路径在 Supabase 的新钥匙体系下
 *   只接受 Secret key**（它返回整个数据库的 OpenAPI 结构，官方不打算让浏览器拿到）：
 *   `{"message":"Secret API key required"}`。
 * 所以现在**只探应用真正会用的那个地址**（`/rest/v1/app_data`）——
 * 它既是数据路径，又能顺便验证钥匙，两件事一个请求答完。
 */

import type { DictKey } from '../i18n'
import type { CloudConfig } from './client'

export interface ProbeCheck {
  id: 'reach' | 'table' | 'auth'
  outcome: 'ok' | 'warn' | 'fail'
  messageKey: DictKey
  /** 补充一句（比如「注册该不该关掉」），没有就不显示 */
  noteKey?: DictKey
  /** HTTP 状态码，网络层就失败时是 null */
  status: number | null
  /** 原始返回，折叠起来给排查用 */
  detail: string
}

/** 只用到 fetch 的这一小部分，方便测试里换掉 */
export type FetchLike = (
  input: string,
  init?: { headers?: Record<string, string> },
) => Promise<{ status: number; text: () => Promise<string> }>

/**
 * 一次「不带钥匙」的请求，成功/失败只表示**这个域名通不通**。
 *
 * ── 为什么需要它 ────────────────────────────────────────────────
 * `fetch` 失败时抛的永远是同一句 "Failed to fetch"，它把好几种完全不同的
 * 原因糊成了一起：
 *   · 网络到不了（DNS / TLS）
 *   · 扩展或安全软件拦了
 *   · **预检（OPTIONS）没过** —— 浏览器在发带自定义头的跨域请求前会先发一个
 *     OPTIONS，那个预检被拦的话，正式的 GET 根本不会发出去
 * 前两种要换网络/关扩展，第三种是另一回事（代理规则、安全软件）。
 *
 * 不带自定义头的请求**不触发预检**（简单请求）。所以：
 *   带钥匙的失败 + 不带钥匙的成功 = 域名是通的，卡在预检这一环
 *   两个都失败                     = 根本没连上（网络或全局拦截）
 * 这一条对比能把上面三种原因一刀切开，而它只多花一个请求。
 */
export type NoCorsProbe = (baseUrl: string) => Promise<boolean>

interface AuthSettings {
  external?: { email?: boolean }
  disable_signup?: boolean
  mailer_autoconfirm?: boolean
}

const DETAIL_LIMIT = 300

function clip(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > DETAIL_LIMIT ? `${flat.slice(0, DETAIL_LIMIT)}…` : flat
}

function authHeaders(anonKey: string): Record<string, string> {
  return { apikey: anonKey, Authorization: `Bearer ${anonKey}` }
}

/** 数据路径那次请求的结论 */
type DataPathKind =
  | 'blocked' // 请求根本没发出去
  | 'keyRejected' // 网关说钥匙不对（或钥匙种类不对）
  | 'locked' // 表在，未登录读不到 —— 正是我们要的
  | 'missing' // 表还没建
  | 'open' // 未登录竟然读到了 —— 安全问题
  | 'other'

interface DataPathResult {
  kind: DataPathKind
  status: number | null
  body: string
}

/**
 * 网关认不认这把钥匙。
 *
 * 只认**明确**说钥匙有问题的字样。「permission denied」不算 ——
 * 那句话说明请求已经过了网关、被数据库按角色挡下来，正好证明钥匙是好的。
 */
function looksLikeKeyProblem(lower: string): boolean {
  return (
    lower.includes('invalid api key') ||
    lower.includes('no api key found') ||
    lower.includes('invalid authentication credentials') ||
    lower.includes('secret api key required') ||
    lower.includes('jwt expired')
  )
}

/**
 * 探一次**应用真正会用的地址**：`/rest/v1/app_data`。
 *
 * 一个请求同时回答两件事：
 *   · 钥匙被网关接受了吗（顺便证明网络通、CORS 通）
 *   · 未登录的人读得到吗（表在不在、访问规则生效没）
 */
async function probeDataPath(
  url: string,
  key: string,
  doFetch: FetchLike,
): Promise<DataPathResult> {
  try {
    const res = await doFetch(`${url}/rest/v1/app_data?select=user_id&limit=1`, {
      headers: authHeaders(key),
    })
    const body = await res.text()
    const lower = body.toLowerCase()

    if (lower.includes('could not find the table') || lower.includes('does not exist')) {
      return { kind: 'missing', status: res.status, body: clip(body) }
    }
    if (lower.includes('permission denied') && lower.includes('app_data')) {
      return { kind: 'locked', status: res.status, body: clip(body) }
    }
    if (looksLikeKeyProblem(lower)) {
      return { kind: 'keyRejected', status: res.status, body: clip(body) }
    }
    if (res.status === 200) {
      return { kind: 'open', status: res.status, body: clip(body) }
    }
    return { kind: 'other', status: res.status, body: clip(body) }
  } catch (err) {
    return { kind: 'blocked', status: null, body: clip(err instanceof Error ? err.message : String(err)) }
  }
}

/** 邮箱登录开了没、要不要点邮件确认 */
async function probeAuthSettings(
  url: string,
  key: string,
  doFetch: FetchLike,
): Promise<ProbeCheck | null> {
  let settings: AuthSettings | null = null
  try {
    const res = await doFetch(`${url}/auth/v1/settings`, { headers: authHeaders(key) })
    const body = await res.text()
    if (res.status === 200) {
      try {
        settings = JSON.parse(body) as AuthSettings
      } catch {
        settings = null
      }
    }
  } catch {
    return null
  }
  if (settings === null) return null

  if (settings.external?.email !== true) {
    return { id: 'auth', outcome: 'fail', messageKey: 'cloud.probeAuthOff', status: 200, detail: '' }
  }

  /*
   * mailer_autoconfirm = true 表示「不用点邮件确认就能登录」。
   * 这一条必须如实说：注册完登不上，十次里有九次是因为用户以为不用确认、
   * 或者以为要确认但其实不用。
   */
  return {
    id: 'auth',
    outcome: 'ok',
    messageKey:
      settings.mailer_autoconfirm === true ? 'cloud.probeAuthAuto' : 'cloud.probeAuthConfirm',
    noteKey: settings.disable_signup === true ? 'cloud.probeSignupClosed' : 'cloud.probeSignupOpen',
    status: 200,
    detail: '',
  }
}

/**
 * 跑完整自检。返回的数组直接按顺序渲染。
 *
 * 结论按「最该先处理的那件事」收敛，一屏说完：
 *   · 请求发不出去 → 只报这一条（后面必然一样，列三行只会让人以为是三个问题）
 *   · 钥匙不对     → 只报这一条（钥匙不对时，别的结论都没有意义）
 *   · 其余         → 「连接 + 访问规则」两条，再加一条邮箱登录
 *
 * 配置从参数进来（而不是读模块里那个 cloudConfig）是为了能测 ——
 * 环境变量在测试里是空的，读模块级的话整套判定就永远验不到。
 */
export async function probeCloud(
  config: CloudConfig | null,
  doFetch: FetchLike,
  noCorsProbe?: NoCorsProbe,
): Promise<ProbeCheck[]> {
  if (config === null) return []

  const data = await probeDataPath(config.url, config.anonKey, doFetch)

  if (data.kind === 'blocked') {
    // 再问一次「不带钥匙能不能通」—— 这一条把「网络不通」和「预检被拦」分开
    let reachable = false
    if (noCorsProbe) {
      try {
        reachable = await noCorsProbe(config.url)
      } catch {
        reachable = false
      }
    }

    return [
      {
        id: 'reach',
        outcome: 'fail',
        messageKey: reachable ? 'cloud.probeBlockedWithKey' : 'cloud.probeBlocked',
        noteKey: reachable ? 'cloud.probeBlockedWithKeyHint' : 'cloud.probeBlockedHint',
        status: null,
        detail: data.body,
      },
    ]
  }

  if (data.kind === 'keyRejected') {
    return [
      {
        id: 'reach',
        outcome: 'fail',
        messageKey: 'cloud.probeReachDenied',
        status: data.status,
        detail: data.body,
      },
    ]
  }

  if (data.kind === 'other') {
    // 认不出来的返回：不硬给结论，把原文摆出来让人判断
    return [
      { id: 'reach', outcome: 'warn', messageKey: 'cloud.probeOdd', status: data.status, detail: data.body },
    ]
  }

  const reach: ProbeCheck = {
    id: 'reach',
    outcome: 'ok',
    messageKey: 'cloud.probeReachOk',
    status: data.status,
    detail: data.body,
  }

  const table: ProbeCheck =
    data.kind === 'locked'
      ? {
          id: 'table',
          outcome: 'ok',
          messageKey: 'cloud.probeTableLocked',
          status: data.status,
          detail: data.body,
        }
      : data.kind === 'missing'
        ? {
            id: 'table',
            outcome: 'fail',
            messageKey: 'cloud.probeTableMissing',
            status: data.status,
            detail: data.body,
          }
        : {
            id: 'table',
            outcome: 'warn',
            messageKey: 'cloud.probeTableOpen',
            noteKey: 'cloud.probeTableOpenNote',
            status: data.status,
            detail: data.body,
          }

  const checks = [reach, table]
  const auth = await probeAuthSettings(config.url, config.anonKey, doFetch)
  if (auth !== null) checks.push(auth)
  return checks
}
