/**
 * Helper shared by the RunningHub tools: credential resolution, display-safe
 * error mapping, deadline handling, session-directory resolution, output
 * naming, media upload, and site resolution.
 *
 * A key is not tied to a site by name or type: the account-status response's
 * `currency` decides which host the key belongs to (`USD` → international,
 * `CNY` → China), and that verdict is stored in the plugin Config at
 * configuration time.
 */

import { openAsBlob } from 'node:fs'
import { createHash } from 'node:crypto'
import { mkdir, stat, writeFile } from 'node:fs/promises'
import { basename, extname, isAbsolute, resolve } from 'node:path'

/** The two RunningHub sites, and the host each one serves. */
export const SITES = {
  cn: { host: 'https://www.runninghub.cn', label: '中国站', currency: 'CNY' },
  intl: { host: 'https://www.runninghub.ai', label: '国际站', currency: 'USD' },
}

export const SYNC_REF = 'RUNNINGHUB_SYNC_API_KEY'
export const JOBS_REF = 'RUNNINGHUB_JOBS_API_KEY'

/** The account-status path, relative to either site host. */
const STATUS_PATH = '/uc/openapi/accountStatus'

/**
 * Resolve the host for one site id.
 *
 * @param site - `'cn' | 'intl'`, or undefined when the site is not yet known.
 */
export function hostOf(site) {
  return (SITES[site] ?? SITES.cn).host
}

/** The API base for one site. */
export function baseUrlOf(site) {
  return hostOf(site) + '/openapi/v2'
}

/** The upload endpoint for one site. */
export function uploadUrlOf(site) {
  return hostOf(site) + '/openapi/v2/media/upload/binary'
}

/** The account-status endpoint for one site. */
export function statusUrlOf(site) {
  return hostOf(site) + STATUS_PATH
}

/**
 * Map an account-status `currency` to a site id.
 *
 * `USD` is the international site and `CNY` the China site. An unknown currency
 * returns undefined so the caller can report it instead of guessing.
 */
export function siteOfCurrency(currency) {
  if (typeof currency !== 'string') return undefined
  const value = currency.trim().toUpperCase()
  if (value === 'USD') return 'intl'
  if (value === 'CNY' || value === 'RMB') return 'cn'
  return undefined
}

/**
 * Ask one key's account status and derive its site.
 *
 * Used at configuration time, when the key is saved, so later calls only read
 * the stored verdict. Returns `{ ok, site, apiType, currency, balance }` or
 * `{ ok: false, code, message }` with a display-safe message.
 *
 * @param apiKey - the resolved key value.
 */
export async function resolveSiteForKey(apiKey) {
  let response
  try {
    response = await fetch(statusUrlOf('cn'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ apikey: apiKey }),
    })
  } catch {
    return { ok: false, code: 'UNREACHABLE', message: '无法连接 RunningHub。' }
  }

  const raw = await response.text()
  let payload
  try {
    payload = JSON.parse(raw)
  } catch {
    return { ok: false, code: 'BAD_RESPONSE', message: 'RunningHub 返回了无法识别的响应。' }
  }
  if (payload?.code !== 0) {
    return {
      ok: false,
      code: 'INVALID_KEY',
      message: `RunningHub 拒绝了该 Key：${payload?.msg ?? payload?.code ?? '未知原因'}`,
    }
  }

  const data = payload?.data ?? {}
  const currency = typeof data.currency === 'string' ? data.currency : ''
  const site = siteOfCurrency(currency)
  if (site === undefined) {
    return {
      ok: false,
      code: 'UNKNOWN_CURRENCY',
      message: `无法从余额币种判断站点（currency=${currency || '空'}）；目前只支持 USD / CNY。`,
    }
  }

  return {
    ok: true,
    site,
    currency,
    apiType: typeof data.apiType === 'string' ? data.apiType : '',
    balance: typeof data.remainMoney === 'string' ? data.remainMoney : '',
  }
}

/** An error whose code is useful in the model-facing message. */
export class ToolError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'MediaRunningHubError'
    this.code = code
  }
}

/**
 * Read one Config value that may be a live reference or a plain value.
 *
 * A `Volatile<T>` field arrives as a reference that is read with `.get()`; an
 * ordinary field arrives as its plain value. Site verdicts are stored in
 * Config, so the reader has to accept both shapes.
 *
 * @param value - the raw Config field.
 */
export function configValue(value) {
  if (value === null || value === undefined) return undefined
  if (typeof value === 'object' && typeof value.get === 'function') {
    try {
      return value.get()
    } catch {
      return undefined
    }
  }
  return value
}

/**
 * The site a key belongs to, as stored in Config at configuration time.
 *
 * The verdict was written when the key was saved, so a normal call never asks
 * the provider which site it belongs to. A missing verdict means the key was
 * never saved through the settings page, and the caller reports that instead
 * of guessing a host.
 *
 * @param config - the plugin Config.
 * @param field - `syncSite` or `jobsSite`.
 */
export function siteOf(config, field) {
  const value = configValue(config?.[field])
  return value === 'cn' || value === 'intl' ? value : undefined
}

/**
 * Persist one site verdict into the plugin Config.
 *
 * The verdict is a derived value: it is written when the key is saved and read
 * by the tools on every call, so it is a volatile Config field. A volatile
 * write updates the running reference without remounting the plugin, which
 * keeps the tool list stable while the user swaps a key.
 *
 * The write goes through the settings service, which owns the profile patch
 * write and the revision check. The namespace is the profile entry id, the
 * same id the plugin's own patch declares.
 *
 * @param ctx - plugin context.
 * @param ns - the profile entry id of this plugin.
 * @param field - `syncSite` or `jobsSite`.
 * @param site - `cn` or `intl`.
 */
export async function persistSite(ctx, ns, field, site) {
  const settings = ctx.get('settings')
  if (settings === undefined) return false
  await settings.update(ns, { [field]: site })
  return true
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
 * The upload endpoint is site-bound: the key must belong to the same site as the
 * host, which is why the caller passes the resolved site alongside the key.
 *
 * `/openapi/v2/media/upload/binary` authenticates with the `Authorization`
 * header and takes exactly one form field, `file`. It answers with
 * `data.download_url` and `data.fileName`; the value usable as an `imageUrls`
 * entry is the download URL, because the standard model API consumes URLs rather
 * than node file names (those belong to the workflow/app APIs).
 */
export async function uploadFile(filePath, apiKey, site, signal) {
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
    response = await fetch(uploadUrlOf(site), {
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
 * sent as a data URI, larger files are uploaded to the key's own site.
 */
export async function resolveMedia(ctx, exec, ref, apiKey, site, signal, inlineLimitBytes) {
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
    return uploadFile(path, apiKey, site, signal)
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
