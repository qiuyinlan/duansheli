/**
 * 自检脚本：云端同步的配置对不对。
 *
 * 用法（在项目根目录）：
 *   npm run check:supabase
 *
 * ── 为什么需要它 ──────────────────────────────────────────────────
 * 「表建了没 / 行级安全生效没 / 邮箱登录开了没」这三件事，在浏览器里
 * 只能靠「同步失败」那一句话间接猜 —— 而三种原因的界面表现几乎一样。
 * 这个脚本直接去问 Supabase，一次把三件事说清楚，
 * 而且**不需要登录、不写任何数据**（全是只读请求）。
 *
 * 和 probe-deepseek-cors.mjs 是同一个路子：写完就有用，可以一直留着
 * （健康检查这种东西留着比删掉值）。
 *
 * 它读的是 `.env.local`，所以你不必把 key 粘到命令行上。
 */

import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

const ENV_FILE = '.env.local'

/**
 * 读系统代理设置（Windows 的 IE/系统代理，Clash / v2ray 这类工具都是改它）。
 *
 * ── 为什么这个脚本要关心代理 ────────────────────────────────────
 * Node 的 fetch **默认不走系统代理**，而浏览器走。于是就有一个很坑的局面：
 * 浏览器里一切正常，这个脚本却报「连不上」—— 用户会以为是配置错了，
 * 去乱改 Supabase 那边的东西。所以失败时必须把这件事说清楚。
 */
function detectSystemProxy() {
  if (process.platform !== 'win32') {
    return process.env.HTTPS_PROXY ?? process.env.https_proxy ?? null
  }
  try {
    const out = execSync(
      'reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyServer',
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    )
    const match = /ProxyServer\s+REG_SZ\s+(\S+)/.exec(out)
    if (!match) return null
    const value = match[1]
    // 可能写成 "http=127.0.0.1:7890;https=..." 这种按协议分开的形式
    const https = /https=([^;]+)/.exec(value)
    const host = https ? https[1] : value
    return /^https?:\/\//.test(host) ? host : `http://${host}`
  } catch {
    return null
  }
}

function readEnv() {
  let text
  try {
    text = readFileSync(ENV_FILE, 'utf8')
  } catch {
    console.log(`❌ 读不到 ${ENV_FILE}`)
    console.log('   在项目根目录建一个，内容照抄 .env.example。')
    console.log('   ⚠️ Windows 上别用记事本建 —— 很容易变成 .env.local.txt。')
    process.exit(1)
  }

  const env = {}
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim()
  }
  return env
}

/** 和 src/cloud/client.ts 里 isSecretKey 的判断保持一致 */
function isSecretKey(key) {
  if (key.startsWith('sb_secret_')) return true
  const parts = key.split('.')
  if (parts.length !== 3) return false
  try {
    const json = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
    return JSON.parse(json).role === 'service_role'
  } catch {
    return false
  }
}

const env = readEnv()
const url = (env.VITE_SUPABASE_URL ?? '').replace(/\/$/, '')
const key = env.VITE_SUPABASE_ANON_KEY ?? ''

console.log('Supabase 配置自检')
console.log('─'.repeat(56))

/* ---------------- 1. 两个值本身 ---------------- */

let fatal = false

if (url === '' || key === '') {
  console.log('❌ 两个变量至少缺一个')
  console.log(`   VITE_SUPABASE_URL       = ${url === '' ? '（空）' : url}`)
  console.log(`   VITE_SUPABASE_ANON_KEY  = ${key === '' ? '（空）' : '（有值）'}`)
  fatal = true
} else if (!/^https:\/\/[^/]+$/i.test(url)) {
  console.log(`❌ VITE_SUPABASE_URL 看起来不对：${url}`)
  console.log('   应该形如 https://abcdefgh.supabase.co（不要带结尾的斜杠或路径）')
  fatal = true
} else {
  console.log(`✅ Project URL：${url}`)
}

if (isSecretKey(key)) {
  console.log('')
  console.log('🚫 危险：你填的是 Secret key（老界面叫 service_role）')
  console.log('   它能绕过行级安全策略读到所有人的数据，而前端代码会被打进网页 JS，谁都能看到。')
  console.log('   请去 Supabase 控制台 → API Keys 里撤销它并重发一把；如果你已经部署过页面，')
  console.log('   撤销是唯一能补救的动作。正确的那把叫 Publishable key（老界面叫 anon / public）。')
  fatal = true
} else if (key !== '') {
  const kind = key.startsWith('sb_publishable_') ? 'Publishable key（新版）' : '看起来是老格式的 anon key'
  console.log(`✅ 钥匙类型：${kind}`)
}

if (fatal) {
  console.log('\n先把上面这些处理掉，再跑一次这个脚本。')
  process.exit(1)
}

const headers = { apikey: key, Authorization: `Bearer ${key}` }

async function get(path) {
  const res = await fetch(url + path, { headers })
  const text = await res.text()
  return { status: res.status, text }
}

/* ---------------- 2. 网络能不能通 ---------------- */

console.log('')
console.log('─'.repeat(56))
console.log('1) 能不能连上这个项目')

try {
  const root = await get('/rest/v1/')
  if (root.status === 200) {
    console.log('✅ 连上了，而且这把钥匙被接受')
  } else if (root.status === 401) {
    console.log('❌ 连上了，但钥匙被拒绝（401）。多半是复制时少了字符，或者这把钥匙已经被撤销了')
    console.log(`   ${root.text.slice(0, 200)}`)
    process.exit(1)
  } else {
    console.log(`⚠️ 返回 HTTP ${root.status}，先继续往下看`)
  }
} catch (err) {
  const code = err.cause?.code ?? ''
  console.log(`❌ 连不上：${err.message}${code ? ` (${code})` : ''}`)
  console.log('')
  const proxy = detectSystemProxy()
  if (code === 'ECONNRESET' || code === 'UND_ERR_SOCKET' || code === 'ETIMEDOUT') {
    /*
     * 这一条是 mainland China 用户最常撞上的情况，而且它**看起来像配置错误**：
     * `*.supabase.co` 这个域名在不少网络下会被重置（TCP 连得上，TLS 握手被 RST），
     * 而 supabase.com（控制台那个域名）却是通的 —— 于是「我明明能打开控制台，
     * 怎么应用连不上」就成了一个很难自己想明白的谜。
     *
     * 这里必须说清楚：**这不是配置问题**，改 .env.local 和重跑 SQL 都没用。
     */
    console.log('   这多半不是配置问题，而是**网络到不了这个域名**：')
    console.log('   · 特征：TCP 能连上，但 TLS 握手被重置（ECONNRESET）')
    console.log('   · 而 supabase.com（控制台）通常是通的，所以很容易误以为是应用的问题')
    if (proxy) {
      console.log('')
      console.log(`   你系统上开着代理（${proxy}），但 Node 默认不走系统代理。带代理重跑：`)
      console.log('')
      console.log(`     $env:HTTPS_PROXY='${proxy}'; $env:NODE_USE_ENV_PROXY='1'; npm run check:supabase`)
      console.log('')
      console.log('   （NODE_USE_ENV_PROXY 需要 Node 20.12+ / 24+；不行就先把代理切成全局模式）')
    } else {
      console.log('   没有检测到系统代理。如果你平时靠代理上网，先把它打开。')
    }
    console.log('')
    console.log('   最快的验证办法（10 秒）：浏览器直接打开这个地址 ——')
    console.log(`     ${url}/rest/v1/`)
    console.log('   · 出现一段 JSON（说 No API key found 之类）→ 网络没问题，是应用那边的事')
    console.log('   · 打不开 / 连接被重置 / 一直转 → 网络到不了，换代理或换网络再试')
  } else {
    console.log('')
    console.log('   · 检查是否能正常上网 / 有没有开代理')
    console.log('   · Supabase 免费项目连续 7 天没请求会被自动暂停 —— 去控制台看看是不是 Paused')
  }
  process.exit(1)
}

/* ---------------- 3. 表建了没、行级安全生效没 ---------------- */

console.log('')
console.log('2) app_data 表建了没，未登录的人能不能读')

const table = await get('/rest/v1/app_data?select=user_id&limit=1')
const body = table.text.toLowerCase()

if (body.includes('could not find the table') || body.includes('does not exist')) {
  console.log('❌ 表还没建。去 Supabase 的 SQL Editor 里跑一遍 supabase/schema.sql')
  console.log(`   （原始返回：${table.text.slice(0, 200)}）`)
} else if (body.includes('permission denied')) {
  console.log('✅ 表建好了，而且未登录的人读不到 —— 这正是我们要的状态（RLS + 权限都生效）')
} else if (table.status === 200) {
  console.log('🚫 警告：未登录竟然能读到数据！')
  console.log(`   返回：${table.text.slice(0, 300)}`)
  console.log('   说明行级安全没生效，或者给 anon 角色开了读权限。请重跑 supabase/schema.sql。')
} else {
  console.log(`⚠️ 返回 HTTP ${table.status}：${table.text.slice(0, 200)}`)
  console.log('   如果这句里有 permission denied 就是正常的；否则把这段发出来看看')
}

/* ---------------- 4. 邮箱登录 ---------------- */

console.log('')
console.log('3) 邮箱登录开了没')

const auth = await get('/auth/v1/settings')
if (auth.status !== 200) {
  console.log(`⚠️ 拿不到登录设置（HTTP ${auth.status}）：${auth.text.slice(0, 200)}`)
} else {
  const settings = JSON.parse(auth.text)
  const emailOn = settings.external?.email === true
  console.log(emailOn ? '✅ 邮箱登录：已开启' : '❌ 邮箱登录：没开（去 Authentication → Providers → Email 打开）')

  if (settings.disable_signup === true) {
    console.log('ℹ️ 注册已关闭 —— 如果你还没注册过账号，先临时打开一次，注册完再关掉')
  } else {
    console.log('ℹ️ 注册开着。注册完自己的账号之后建议关掉（Authentication → 关掉 Allow new users to sign up）')
    console.log('   理由：你的网址是公开的，注册开着别人能自己注册来占用项目配额（读不到你的数据，但会白占资源）')
  }

  /*
   * mailer_autoconfirm = true 表示「不用点邮件确认就能登录」。
   * 这条要如实说，因为「注册完登不上」十次里有九次是因为它和用户的预期相反。
   */
  if (settings.mailer_autoconfirm === true) {
    console.log('ℹ️ 邮箱确认：已关闭 → 注册完可以直接登录')
  } else {
    console.log('ℹ️ 邮箱确认：开着 → 注册后要去邮箱点确认链接才能登录')
    console.log('   收不到邮件是常见情况（免费档发信有频率限制，也容易进垃圾箱）。')
    console.log('   个人自用嫌麻烦的话：Authentication → Providers → Email → 关掉 Confirm email')
  }
}

console.log('')
console.log('─'.repeat(56))
console.log('检查完毕。剩下的事在浏览器里做：')
console.log('  设置 → 云端同步 → 注册 / 登录 → 应该看到「已同步」')
