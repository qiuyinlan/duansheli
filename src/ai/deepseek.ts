/**
 * DeepSeek API 客户端。
 *
 * 关键安全前提（已实测验证，见 scripts/probe-deepseek-cors.mjs）：
 * DeepSeek 的接口会回显 Origin 并允许 authorization 头，所以浏览器可以直连。
 * 这意味着 API Key **不需要经过任何第三方代理**，只在你自己的设备和
 * DeepSeek 服务器之间传递。
 *
 * 本模块不做任何持久化 —— Key 由调用方持有，用完即弃。
 */

export const DEEPSEEK_ENDPOINT = 'https://api.deepseek.com/chat/completions'
export const DEEPSEEK_MODEL = 'deepseek-chat'

export type AiErrorKind =
  | 'no_key'
  | 'auth'
  | 'balance'
  | 'rate_limit'
  | 'bad_request'
  | 'server'
  | 'network'
  | 'timeout'
  | 'aborted'
  | 'bad_response'

/** 带「该怎么办」的友好错误 —— 界面上直接把 message 显示给用户 */
export class AiError extends Error {
  readonly kind: AiErrorKind

  constructor(kind: AiErrorKind, message: string) {
    super(message)
    this.name = 'AiError'
    this.kind = kind
  }
}

export interface AiUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

export interface ChatMessage {
  /** assistant 用于多轮对话里回放上一轮 AI 的回复 */
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatOptions {
  apiKey: string
  messages: ChatMessage[]
  signal?: AbortSignal
  maxTokens?: number
  temperature?: number
}

export interface ChatResult {
  content: string
  usage: AiUsage
  /** 'stop' = 正常结束；'length' = 被 max_tokens 截断（结果大概率不完整） */
  finishReason: string | null
}

export function isAbortError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'name' in err &&
    (err as { name?: unknown }).name === 'AbortError'
  )
}

function messageForStatus(status: number, detail: string): { kind: AiErrorKind; message: string } {
  switch (status) {
    case 400:
      return {
        kind: 'bad_request',
        message: detail || '请求格式不对，DeepSeek 拒绝了这次调用。',
      }
    case 401:
      return {
        kind: 'auth',
        message: 'API Key 无效。请检查是否复制完整（通常以 sk- 开头），以及是否已经过期。',
      }
    case 402:
      return {
        kind: 'balance',
        message: '账户余额不足。请到 DeepSeek 开放平台充值后再试。',
      }
    case 422:
      return {
        kind: 'bad_request',
        message: detail || '请求参数不被接受。',
      }
    case 429:
      return {
        kind: 'rate_limit',
        message: '请求太频繁或已达到速率上限，等一会儿再试。',
      }
    case 500:
    case 502:
    case 503:
      return {
        kind: 'server',
        message: 'DeepSeek 服务端暂时出问题了，稍后再试。',
      }
    default:
      return {
        kind: 'server',
        message: detail || `DeepSeek 返回了意外的状态码 ${status}。`,
      }
  }
}

/** 从错误响应里抠出人能看懂的一句话 */
async function readErrorDetail(res: Response): Promise<string> {
  try {
    const text = await res.text()
    if (!text) return ''
    try {
      const parsed: unknown = JSON.parse(text)
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        'error' in parsed &&
        typeof (parsed as { error?: unknown }).error === 'object' &&
        (parsed as { error: { message?: unknown } }).error !== null
      ) {
        const message = (parsed as { error: { message?: unknown } }).error.message
        if (typeof message === 'string') return message
      }
    } catch {
      // 不是 JSON，就用原文
    }
    return text.slice(0, 300)
  } catch {
    return ''
  }
}

interface RawChatResponse {
  choices?: Array<{
    message?: { content?: unknown }
    finish_reason?: unknown
  }>
  usage?: {
    prompt_tokens?: unknown
    completion_tokens?: unknown
    total_tokens?: unknown
  }
}

function toNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/**
 * 调一次对话补全。
 *
 * 默认开启 JSON 模式（response_format: json_object）。DeepSeek 要求开启时
 * prompt 里必须出现 "json" 字样 —— 我们的 prompt 里都有，见 prompts.ts。
 * 万一接口将来不再支持这个参数，这里会自动去掉它重试一次。
 */
export async function chat(options: ChatOptions): Promise<ChatResult> {
  const apiKey = options.apiKey.trim()
  if (apiKey === '') {
    throw new AiError('no_key', '还没有填写 DeepSeek API Key。')
  }

  const body: Record<string, unknown> = {
    model: DEEPSEEK_MODEL,
    messages: options.messages,
    max_tokens: options.maxTokens ?? 8192,
    temperature: options.temperature ?? 0.3,
    stream: false,
    response_format: { type: 'json_object' },
  }

  let response = await rawFetch(apiKey, body, options.signal)

  // 有些账号 / 接口版本不支持 response_format。去掉它重试一次 ——
  // 解析层本来就能容忍代码围栏和多余前言，所以没有 JSON 模式也能用。
  if (response.status === 400) {
    const detail = await readErrorDetail(response.clone())
    if (/response_format|json_object|json mode/i.test(detail)) {
      delete body.response_format
      response = await rawFetch(apiKey, body, options.signal)
    }
  }

  if (!response.ok) {
    const detail = await readErrorDetail(response)
    const { kind, message } = messageForStatus(response.status, detail)
    throw new AiError(kind, message)
  }

  let payload: RawChatResponse
  try {
    payload = (await response.json()) as RawChatResponse
  } catch {
    throw new AiError('bad_response', 'DeepSeek 返回的内容不是合法 JSON，可能被网络拦了。')
  }

  const choice = payload.choices?.[0]
  const content = choice?.message?.content
  if (typeof content !== 'string' || content.trim() === '') {
    // JSON 模式偶尔会返回空内容，官方文档里也提到了这个已知情况
    throw new AiError(
      'bad_response',
      'DeepSeek 这次没有返回内容（偶发情况）。直接再点一次通常就好了。',
    )
  }

  return {
    content,
    usage: {
      promptTokens: toNumber(payload.usage?.prompt_tokens),
      completionTokens: toNumber(payload.usage?.completion_tokens),
      totalTokens: toNumber(payload.usage?.total_tokens),
    },
    finishReason: typeof choice?.finish_reason === 'string' ? choice.finish_reason : null,
  }
}

async function rawFetch(
  apiKey: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Response> {
  try {
    return await fetch(DEEPSEEK_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    })
  } catch (err) {
    if (isAbortError(err)) throw new AiError('aborted', '已取消。')
    throw new AiError(
      'network',
      '连不上 DeepSeek。请检查网络；如果你在用广告拦截插件，它可能拦了这个请求。',
    )
  }
}

/**
 * 给一次调用套上超时。
 * 返回的 cancel 用于用户主动取消，abort 时抛出的仍是 AiError('aborted')。
 */
export function createRequestController(timeoutMs = 180_000): {
  signal: AbortSignal
  cancel: () => void
  dispose: () => void
} {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  return {
    signal: controller.signal,
    cancel: () => controller.abort(),
    dispose: () => clearTimeout(timer),
  }
}

/** 粗略估算一段中文文本的 token 数，用于提前判断要不要分批 */
export function estimateTokens(text: string): number {
  // 中文大约 1 字 ≈ 0.7 token，英文约 4 字符 ≈ 1 token。
  // 这里取一个偏保守的估计，宁可多分一批也不要被截断。
  const cjk = (text.match(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/g) ?? []).length
  const rest = text.length - cjk
  return Math.ceil(cjk * 0.9 + rest / 3)
}
