/**
 * Helpers shared by the RunningHub tools: credential resolution, display-safe
 * error mapping, deadline handling, session-directory resolution, output
 * naming, and media upload.
 */

import { openAsBlob } from 'node:fs'
import { createHash } from 'node:crypto'
import { mkdir, stat, writeFile } from 'node:fs/promises'
import { basename, extname, isAbsolute, resolve } from 'node:path'

export const BASE_URL = 'https://www.runninghub.cn/openapi/v2'
export const UPLOAD_URL = 'https://www.runninghub.cn/openapi/v2/media/upload/binary'
export const STATUS_URL = 'https://www.runninghub.cn/uc/openapi/accountStatus'

export const SHARED_REF = 'RUNNINGHUB_SHARED_API_KEY'
export const MEMBER_REF = 'RUNNINGHUB_MEMBER_API_KEY'

/** An error whose code is useful in the model-facing message. */
export class ToolError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'MediaRunningHubError'
    this.code = code
  }
}

/** Whether a reference is passed to the provider instead of read locally. */
export function isRemote(ref) {
  return /^https?:\/\//i.test(ref)
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
 * Root directory for generated files.
 *
 * The location is fixed: `<session directory>/output`. Callers that want a
 * specific destination pass an explicit `output` path to the tool instead of
 * reconfiguring the plugin.
 */
export function outputRoot(ctx, exec) {
  return resolve(sessionCwd(ctx, exec), 'output')
}

/**
 * Read one API key through the Host credential service.
 *
 * @param ctx - plugin context.
 * @param ref - credential reference.
 * @param purpose - human description used in the no-key message.
 */
export async function apiKeyOf(ctx, ref, purpose) {
  const credentials = ctx.get('credentials')
  if (credentials === undefined) {
    throw new ToolError('NO_CREDENTIAL_SERVICE', '凭据服务不可用；请重启 Harness 后重试。')
  }
  let resolved
  try {
    resolved = await credentials.resolve(ref)
  } catch {
    throw new ToolError('CREDENTIAL_READ_FAILED', `读取 ${ref} 失败；请在“RunningHub 媒体”设置页检查。`)
  }
  if (resolved === undefined || typeof resolved.value !== 'string' || resolved.value.length === 0) {
    throw new ToolError(
      'NO_API_KEY',
      `未配置 ${ref}（${purpose}）。请打开“RunningHub 媒体”设置页保存，或在运行环境中配置该变量。`,
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

/**
 * One display-safe provider message.
 *
 * RunningHub answers both success and failure with a flat task object, so
 * `errorCode` / `errorMessage` are the fields that matter; the `code` / `msg`
 * envelope is kept for endpoints that still use it.
 */
export function providerMessage(payload, secret, maxLength = 300) {
  const message = payload?.errorMessage
    ?? payload?.msg
    ?? payload?.message
    ?? payload?.error?.message
    ?? payload?.code
  if (typeof message === 'string' && message.length > 0) return scrub(message, secret, maxLength)
  return scrub(typeof payload === 'string' ? payload : JSON.stringify(payload ?? {}), secret, maxLength)
}

/** Build a classified error from one RunningHub failure payload. */
export function providerError(payload, secret, httpStatus) {
  const code = payload?.errorCode ?? payload?.code ?? ''
  const text = `${code} ${providerMessage(payload, secret)}`.toLowerCase()
  if (/auth|401|403|token|unauthor|鉴权|授权/.test(text)) {
    return new ToolError('AUTH_FAILED', 'RunningHub 拒绝了该 Key。请检查 Key 是否有效、是否属于对应类型。')
  }
  if (/balance|insufficient|余额|credit|欠费/.test(text)) {
    return new ToolError('INSUFFICIENT_BALANCE', 'RunningHub 余额不足，请充值后重试。')
  }
  if (/rate limit|too many|频繁|限流|429/.test(text) || httpStatus === 429) {
    return new ToolError('RATE_LIMITED', 'RunningHub 请求过于频繁，请稍后重试。')
  }
  const detail = providerMessage(payload, secret)
  return new ToolError('PROVIDER_ERROR', `RunningHub 返回错误${code === '' ? '' : `（${code}）`}：${detail}`)
}

/**
 * Run one operation with a deadline and the caller's cancellation signal.
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

/** A filesystem-safe timestamp for output names. */
export function stamp() {
  return new Date().toISOString().replace(/[-:T]/gu, '').slice(0, 14)
}

/** A short stable suffix derived from the prompt text. */
export function textHash(text) {
  return createHash('sha1').update(text).digest('hex').slice(0, 8)
}

/** Make a value safe as a single path segment. */
export function safeSegment(value) {
  return String(value).replace(/[\\/:*?"<>|]/gu, '-').trim() || 'unnamed'
}

/** Post JSON and return `{ ok, status, payload }` without throwing on 4xx. */
export async function postJson(url, body, apiKey, signal) {
  let response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal,
    })
  } catch (error) {
    if (signal.aborted) throw error
    throw new ToolError('UNREACHABLE', '无法连接 RunningHub。')
  }

  const raw = await response.text()
  let payload
  try {
    payload = JSON.parse(raw)
  } catch {
    payload = { message: raw }
  }
  return { ok: response.ok, status: response.status, payload }
}

/**
 * Upload one local media file and return the provider-side reference.
 *
 * `/openapi/v2/media/upload/binary` authenticates with the `Authorization`
 * header and takes exactly one form field, `file`. It answers with
 * `data.download_url` and `data.fileName`; the value usable as an `imageUrls`
 * entry is the download URL, because the standard model API consumes URLs rather
 * than node file names (those belong to the workflow/app APIs).
 */
export async function uploadFile(filePath, apiKey, signal) {
  let info
  try {
    info = await stat(filePath)
  } catch {
    throw new ToolError('INVALID_MEDIA', `文件不存在或无法读取：${filePath}`)
  }
  if (!info.isFile()) throw new ToolError('INVALID_MEDIA', `不是文件：${filePath}`)

  const form = new FormData()
  try {
    const blob = await openAsBlob(filePath)
    form.append('file', blob, basename(filePath))
  } catch {
    throw new ToolError('UPLOAD_FAILED', `无法打开文件：${filePath}`)
  }

  let response
  try {
    response = await fetch(UPLOAD_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal,
    })
  } catch (error) {
    if (signal.aborted) throw error
    throw new ToolError('UPLOAD_FAILED', '上传到 RunningHub 失败。')
  }

  const raw = await response.text()
  let payload
  try {
    payload = JSON.parse(raw)
  } catch {
    payload = { message: raw }
  }
  if (!response.ok || payload?.code !== 0) {
    throw new ToolError('UPLOAD_FAILED', `上传到 RunningHub 失败：${providerMessage(payload, apiKey)}`)
  }

  const url = payload?.data?.download_url
  if (typeof url === 'string' && url.length > 0) return url
  const fileName = payload?.data?.fileName
  if (typeof fileName === 'string' && fileName.length > 0) return fileName
  throw new ToolError('UPLOAD_FAILED', 'RunningHub 上传响应缺少 download_url / fileName。')
}

/**
 * Resolve one media reference for a RunningHub node value.
 *
 * A remote URL passes through; a local file at or below `inlineLimitBytes` is
 * sent as a data URI, larger files are uploaded because RunningHub requires a
 * provider-side file name for them.
 */
export async function resolveMedia(ctx, exec, ref, apiKey, signal, inlineLimitBytes) {
  if (isRemote(ref)) return ref
  const path = localPathOf(ctx, exec, ref)
  let info
  try {
    info = await stat(path)
  } catch {
    throw new ToolError('INVALID_MEDIA', `文件不存在或无法读取：${path}`)
  }
  if (!info.isFile()) throw new ToolError('INVALID_MEDIA', `不是文件：${path}`)
  if (inlineLimitBytes !== undefined && info.size > inlineLimitBytes) {
    return uploadFile(path, apiKey, signal)
  }

  const { readFile } = await import('node:fs/promises')
  const bytes = await readFile(path, { signal })
  const ext = extname(path).toLowerCase()
  const mime = ext === '.jpg' || ext === '.jpeg'
    ? 'image/jpeg'
    : ext === '.webp' ? 'image/webp' : 'image/png'
  return `data:${mime};base64,${bytes.toString('base64')}`
}

/**
 * Download one result URL below the configured output root.
 *
 * @param destination - explicit destination directory, when the caller asked for one.
 */
export async function downloadResult(ctx, exec, url, sections, fileName, signal, destination) {
  let response
  try {
    response = await fetch(url, { signal })
  } catch (error) {
    if (signal.aborted) throw error
    throw new ToolError('DOWNLOAD_FAILED', '无法下载生成结果。')
  }
  if (!response.ok) {
    throw new ToolError('DOWNLOAD_FAILED', `下载生成结果失败：HTTP ${response.status}。`)
  }

  const bytes = Buffer.from(await response.arrayBuffer())
  const directory = destination !== undefined
    ? resolve(sessionCwd(ctx, exec), destination)
    : resolve(outputRoot(ctx, exec), 'media', 'runninghub', ...sections.map((section) => safeSegment(section)))
  await mkdir(directory, { recursive: true })
  const filePath = resolve(directory, safeSegment(fileName))
  await writeFile(filePath, bytes)
  return { filePath, bytes: bytes.length }
}

/** Guess a result extension from the provider's `outputType`. */
export function extensionFor(outputType) {
  return { image: 'png', video: 'mp4', audio: 'mp3', '3d': 'glb' }[outputType] ?? 'bin'
}
