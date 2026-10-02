/**
 * 一次性探测脚本：检查 DeepSeek API 是否允许浏览器直连（CORS）。
 *
 * 这决定了整个 AI 功能能不能做成「纯静态 + Key 只存本地」。
 * 如果不返回 Access-Control-Allow-Origin，浏览器就会拦下响应，
 * 那时就只能靠第三方代理转发 —— 而那样 Key 必然会经过别人的服务器。
 *
 * 用完即删，不属于项目代码。
 */

const ORIGIN = 'https://example.github.io'
const URL = 'https://api.deepseek.com/chat/completions'

function show(label, res) {
  console.log(`\n=== ${label} ===`)
  console.log('HTTP 状态：', res.status)
  const headers = {}
  for (const [key, value] of res.headers) headers[key] = value
  const corsKeys = Object.keys(headers).filter((k) => k.startsWith('access-control-'))
  if (corsKeys.length === 0) {
    console.log('❌ 没有任何 Access-Control-* 响应头')
  } else {
    for (const key of corsKeys) console.log(`✅ ${key}: ${headers[key]}`)
  }
  return corsKeys.length > 0
}

// 1) 预检请求（OPTIONS）—— 浏览器在发 POST + Authorization 头之前一定会先发这个
let preflightOk = false
try {
  const res = await fetch(URL, {
    method: 'OPTIONS',
    headers: {
      Origin: ORIGIN,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization,content-type',
    },
  })
  preflightOk = show('预检 OPTIONS', res)
} catch (err) {
  console.log('\n=== 预检 OPTIONS ===')
  console.log('请求本身失败：', err.message)
}

// 2) 真实 POST（用假 Key，预期 401；重点是看 401 响应带不带 CORS 头）
let postOk = false
try {
  const res = await fetch(URL, {
    method: 'POST',
    headers: {
      Origin: ORIGIN,
      'Content-Type': 'application/json',
      Authorization: 'Bearer sk-this-is-not-a-real-key',
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 1,
    }),
  })
  postOk = show('实际 POST（假 Key）', res)
  const text = await res.text()
  console.log('响应体片段：', text.slice(0, 200))
} catch (err) {
  console.log('\n=== 实际 POST ===')
  console.log('请求本身失败：', err.message)
}

console.log('\n' + '─'.repeat(56))
if (preflightOk && postOk) {
  console.log('结论：DeepSeek 允许浏览器直连 ✅ —— Key 可以只存在本地，不需要任何代理')
} else if (!preflightOk && !postOk) {
  console.log('结论：DeepSeek 不允许浏览器直连 ❌ —— 纯静态方案需要另想办法')
} else {
  console.log('结论：结果不一致，需要进一步确认 ⚠️')
}
