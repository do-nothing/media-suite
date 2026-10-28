/**
 * Helpers shared by the Qwen tools: credential resolution, display-safe error
 * mapping, deadline handling, session-directory resolution, and output naming.
 *
 * Nothing here knows about a specific model or endpoint.
 */

import { createHash } from 'node:crypto'
import { isAbsolute, resolve } from 'node:path'

/** An error whose code is useful in the model-facing message. */
export class ToolError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'MediaQwenError'
    this.code = code
  }
}

/** Whether a reference is passed to the provider instead of read locally. */
export function isRemote(ref) {
  return /^(?:https?|oss):\/\//i.test(ref)
}

/** Resolve a relative reference against the active Session directory. */
export function sessionCwd(ctx, exec) {
  const service = ctx.get('workingDirectory')
  if (service !== undefined && exec.agent !== undefined) {
    try {
      return service.get(exec.agent.session)
    } catch {
      // Fall through to the process directory.
    }
  }
  return process.cwd()
}

/** Resolve a local reference to an absolute path. */
export function localPathOf(ctx, exec, ref) {
  return isAbsolute(ref) ? ref : resolve(sessionCwd(ctx, exec), ref)
}

/**
 * Read one API key through the Host credential service.
 *
 * @param ctx - the plugin context.
 * @param ref - credential reference such as `DASHSCOPE_API_KEY`.
 * @param hint - where the user can set it, used in the no-key message.
 */
export async function apiKeyOf(ctx, ref, hint) {
  const credentials = ctx.get('credentials')
  if (credentials === undefined) {
    throw new ToolError('NO_CREDENTIAL_SERVICE', '凭据服务不可用；请重启 Harness 后重试。')
  }
  let resolved
  try {
    resolved = await credentials.resolve(ref)
  } catch {
    throw new ToolError('CREDENTIAL_READ_FAILED', `读取 ${ref} 失败；请在“媒体工具”设置页检查。`)
  }
  if (resolved === undefined || typeof resolved.value !== 'string' || resolved.value.length === 0) {
    throw new ToolError(
      'NO_API_KEY',
      `未配置 ${ref}。${hint ?? `请打开“媒体工具”设置页保存 ${ref}，或在运行环境中配置该变量。`}`,
    )
  }
  return resolved.value
}

/** Hide an accidentally echoed credential and bound the text. */
export function scrub(text, secret, maxLength = 300) {
  let value = String(text)
  if (typeof secret === 'string' && secret.length > 0) value = value.split(secret).join('***')
  return value.slice(0, maxLength)
}

/** One display-safe provider error message. */
export function providerMessage(raw, secret, maxLength = 300) {
  try {
    const payload = JSON.parse(raw)
    const message = payload?.error?.message ?? payload?.message ?? payload?.code
    if (typeof message === 'string' && message.length > 0) return scrub(message, secret, maxLength)
  } catch {
    // Not JSON; use the bounded raw text.
  }
  return scrub(raw, secret, maxLength)
}

/**
 * Build a classified error for a failed provider response.
 *
 * @param status - HTTP status.
 * @param raw - response body.
 * @param secret - value to scrub from the message.
 * @param provider - provider label used in the message.
 */
export function httpError(status, raw, secret, provider = 'DashScope') {
  if (status === 401 || status === 403) {
    return new ToolError('AUTH_FAILED', `${provider} 拒绝了该 Key（HTTP ${status}）。请检查 Key 是否有效。`)
  }
  if (status === 429) {
    return new ToolError('RATE_LIMITED', `${provider} 请求过于频繁，请稍后重试。`)
  }
  return new ToolError('PROVIDER_ERROR', `${provider} 返回 HTTP ${status}：${providerMessage(raw, secret)}`)
}

/**
 * Run one operation with a deadline and the caller's cancellation signal.
 *
 * @param exec - tool execution context carrying `signal`.
 * @param fn - receives the deadline signal.
 * @param timeoutMs - deadline in milliseconds.
 */
export async function withDeadline(exec, fn, timeoutMs) {
  if (exec.signal.aborted) throw new ToolError('CANCELLED', '请求已取消。')
  const controller = new AbortController()
  const onAbort = () => controller.abort()
  exec.signal.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fn(controller.signal)
  } catch (error) {
    if (exec.signal.aborted) throw new ToolError('CANCELLED', '请求已取消。')
    if (controller.signal.aborted) throw new ToolError('TIMEOUT', '请求超时。')
    throw error
  } finally {
    clearTimeout(timer)
    exec.signal.removeEventListener('abort', onAbort)
  }
}

/**
 * Root directory for generated files.
 *
 * The location is fixed: `<session directory>/output`. Callers that want a
 * specific destination pass an explicit `output` path to the tool instead of
 * reconfiguring the plugin.
 */
export function outputRoot(ctx, exec) {
  return resolve(sessionCwd(ctx, exec), 'output')
}

/** A filesystem-safe timestamp for output names. */
export function stamp() {
  return new Date().toISOString().replace(/[-:T]/gu, '').slice(0, 14)
}

/** A short stable suffix derived from the prompt text. */
export function textHash(text) {
  return createHash('sha1').update(text).digest('hex').slice(0, 8)
}

/** Output extension for a requested format. */
export function extensionOf(format) {
  return format === 'pcm' ? 'pcm' : format
}

/** Make a value safe as a single path segment. */
export function safeSegment(value) {
  return String(value).replace(/[\\/:*?"<>|]/gu, '-').trim() || 'unnamed'
}
