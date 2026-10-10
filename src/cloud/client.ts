/**
 * Supabase 客户端 —— 只负责「怎么连上」，不管同步怎么合。
 *
 * ── 配置从哪来 ────────────────────────────────────────────────────
 * 两个环境变量（Vite 只把 VITE_ 开头的暴露给前端）：
 *   VITE_SUPABASE_URL       形如 https://abcdefg.supabase.co
 *   VITE_SUPABASE_ANON_KEY  浏览器用的那把公开钥匙
 *
 * ── 关于「用哪把钥匙」这件事，取名换过一轮，特别容易拿错 ──────────
 * 老界面（现在很多教程还是这么写）：
 *   · anon / public          → **就是这个**，公开、可以放进网页
 *   · service_role           → 🚫 能绕过 RLS 读全库，绝不能进前端
 * 新界面（2025 年起）把它俩改名叫：
 *   · Publishable key   `sb_publishable_...`  → **就是这个**（anon 的新名字）
 *   · Secret key        `sb_secret_...`       → 🚫 同上，绝不能进前端
 *
 * 两个名字指的是同一种角色，**Publishable key 就是 anon key**，
 * 不用去别处再找那个 eyJ... 开头的老格式。
 *
 * ⚠️ 拿错了不是「同步失败」那么轻：Secret key 会绕过数据库的访问规则。
 * 而前端代码是人人可见的 —— 它被打进 JS 之后，等于把整个数据库的钥匙
 * 挂在网页上。所以下面专门认这两种「危险钥匙」并拒绝启动云端功能，
 * 而不是等它「能连上」之后再出事。
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/** 云端那张表的名字（建表脚本里有，改名的话这里也要改） */
export const CLOUD_TABLE = 'app_data'

export interface CloudConfig {
  url: string
  anonKey: string
}

/**
 * 配置为什么用不了。
 *
 * 分这么细是因为「没配云端」这一句话不够用：拿错钥匙的人需要的是
 * **「你拿的是 Secret key，而且它必须马上删掉重发一把」**，
 * 而不是一句「还没配置云端」让他继续去翻别的地方。
 */
export type CloudConfigProblem = 'missing' | 'placeholder' | 'secretKey'

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const json = atob(base64)
    const parsed: unknown = JSON.parse(json)
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/**
 * 这把钥匙是不是「能绕过安全规则」的那种。
 *
 * 两种都要认出来：
 *   · 新的 Secret key：`sb_secret_...`
 *   · 老的 service_role：一段 JWT，载荷里写着 `"role": "service_role"`
 * 老格式现在控制台里还在（也能继续用），所以不能只看前缀。
 */
export function isSecretKey(key: string): boolean {
  if (key.startsWith('sb_secret_')) return true
  const payload = decodeJwtPayload(key)
  return payload !== null && payload.role === 'service_role'
}

function looksLikePlaceholder(value: string): boolean {
  return /x{6,}/i.test(value) || value.includes('your-project')
}

/**
 * 判断一组环境变量能不能用。
 *
 * 抽成**纯函数**（而不是直接读 import.meta.env）是为了能测：
 * 环境变量是构建时定下来的，测试里改不了 import.meta.env，
 * 于是「哪些值算配好、哪些算拿错了钥匙」这段判断就永远验不到 ——
 * 而它恰好是**唯一**能拦住「把全库钥匙挂到网页上」的地方。
 */
export function evaluateConfig(env: Record<string, string | undefined>): {
  config: CloudConfig | null
  problem: CloudConfigProblem | null
} {
  const url = (env.VITE_SUPABASE_URL ?? '').trim()
  const anonKey = (env.VITE_SUPABASE_ANON_KEY ?? '').trim()

  if (url === '' || anonKey === '') return { config: null, problem: 'missing' }

  // 危险钥匙**优先**判断：拿错的人必须看到的是这一条，不是「占位值」之类的小问题
  if (isSecretKey(url) || isSecretKey(anonKey)) return { config: null, problem: 'secretKey' }

  // 还是 .env.example 里那份模板，照着填了一半
  if (looksLikePlaceholder(url) || looksLikePlaceholder(anonKey)) {
    return { config: null, problem: 'placeholder' }
  }

  return { config: { url, anonKey }, problem: null }
}

function readConfig(): { config: CloudConfig | null; problem: CloudConfigProblem | null } {
  // 测试环境（Node 里跑 esbuild 打包的产物）没有 import.meta.env，用可选链兜住
  const env = (import.meta as { env?: Record<string, string | undefined> }).env
  return evaluateConfig(env ?? {})
}

const read = readConfig()

export const cloudConfig: CloudConfig | null = read.config

/** 少配了 / 填的是模板 / 填了危险的钥匙 —— 三种都不是「能用」 */
export const cloudConfigProblem: CloudConfigProblem | null = read.problem

export function isCloudConfigured(): boolean {
  return cloudConfig !== null
}

let client: SupabaseClient | null = null

/**
 * 懒创建。没有配置时返回 null —— 调用方（sync.ts）在每一步开头都要先问这一句，
 * 于是「没配云端」的路径上不会有人去碰 SDK。
 *
 * 另外这里刻意**不用** SDK 自带的本地会话存储改造：
 * 它默认把会话存在 localStorage（键名 sb-<ref>-auth-token），这正好是我们想要的 ——
 * 刷新页面不用重新登录，而 localStorage 按网址隔离，所以
 * localhost 和 GitHub Pages 上是两条独立的登录状态（跟数据一样，见设置页那句提示）。
 */
export function getClient(): SupabaseClient | null {
  if (cloudConfig === null) return null
  if (client === null) {
    client = createClient(cloudConfig.url, cloudConfig.anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // 魔链 / OAuth 的回调解析用不上（我们只做邮箱+密码），显式关掉，
        // 免得它去解析地址栏里不属于自己的东西
        detectSessionInUrl: false,
      },
    })
  }
  return client
}
