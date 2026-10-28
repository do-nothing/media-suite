/**
 * Host half of the media-runninghub bundle.
 *
 * `surface` selects which capability set this plugin registers:
 *
 * - `sync`  → `runninghub_image`, the synchronous Nano Banana 2 image tool, using
 *             the enterprise-shared key (RunningHub's model API only accepts it).
 * - `jobs`  → reserved for the workflow task pool, using the consumer-member key.
 *
 * The switch is a Config field on purpose: changing it reloads the plugin, so the
 * tool list always matches the configured surface instead of offering tools that
 * would only reject their calls.
 *
 * Two independent key cards are exposed through one Remote controller:
 * `sharedStatus` and `memberStatus`. Each resolves its own credential reference
 * and reports "not configured" for itself — neither stands in for the other.
 */

import { registerRunningHubSync } from './lib/image.js'
import {
  MEMBER_REF,
  SHARED_REF,
  STATUS_URL,
} from './lib/shared.js'
import Schema from '@deepseek-ai/schemastery'

export const name = 'media-runninghub'
export const inject = ['credentials', 'tools']

/**
 * Config schema.
 *
 * `surface` decides which tool set this plugin registers. It lives in Config
 * rather than Settings on purpose: changing it must reload the plugin so the
 * model-facing tool list always matches the configured surface.
 */
export const Config = Schema.object({
  surface: Schema.union(['jobs', 'sync']).default('sync')
    .description('注册哪一套工具：sync 为同步图片生成，jobs 为工作流任务池。切换会重载插件。'),
  channel: Schema.union(['lowprice', 'official']).default('lowprice')
    .description('Nano Banana 2 渠道：lowprice 低价渠道，official 官方稳定版。'),
})

const REQUEST_TIMEOUT_MS = 15000
const MAX_MESSAGE_LENGTH = 200

/** Marker key read by the Typert Gateway's SRC fallback. */
const REMOTE_METHODS_KEY = '@deepseek-ai/dsh-typert-protocol/remote-methods'

/** Current time as the wire-safe ISO string every status reply carries. */
function checkedAt() {
  return new Date().toISOString()
}

/** A trimmed string, or the fallback when the value is absent or blank. */
function textOf(value, fallback) {
  if (value === undefined || value === null) return fallback
  const text = String(value).trim()
  return text.length === 0 ? fallback : text
}

/** One display-safe failure reply. */
function failure(status, source, message, secrets = []) {
  return {
    status,
    ...(source === undefined ? {} : { source }),
    ...(message === undefined
      ? {}
      : { message: String(message).split(secrets[0] ?? '\u0000').join('***').slice(0, MAX_MESSAGE_LENGTH) }),
    checkedAt: checkedAt(),
  }
}

/**
 * Resolve one credential. A read failure is distinct from an absent value so the
 * page can say "凭据服务不可用" instead of "未配置".
 */
async function resolveCredential(credentials, ref) {
  try {
    const resolved = await credentials.resolve(ref)
    return { resolved, failed: false }
  } catch {
    return { resolved: undefined, failed: true }
  }
}

/**
 * Query the account status endpoint with one key.
 *
 * @param credentials - the Host credential service.
 * @param ref - which key to use.
 * @returns the display-safe account status.
 */
async function queryStatus(credentials, ref) {
  const { resolved, failed } = await resolveCredential(credentials, ref)
  if (failed) return failure('error', undefined, '读取凭据失败')
  if (resolved === undefined) return failure('no_key')

  const key = resolved.value
  const source = resolved.source
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(STATUS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ apikey: key }),
      signal: controller.signal,
    })
    const text = await response.text()
    let payload
    try {
      payload = JSON.parse(text)
    } catch {
      return failure('error', source, 'RunningHub 返回了无法识别的响应', [key])
    }
    if (payload === null || typeof payload !== 'object' || payload.code === undefined || payload.code === null) {
      return failure('error', source, 'RunningHub 返回了无法识别的响应', [key])
    }
    const code = Number(payload.code)
    if (!Number.isFinite(code)) {
      return failure('error', source, 'RunningHub 返回了无法识别的响应', [key])
    }
    if (!response.ok) {
      return failure('http_error', source, `HTTP ${response.status}`, [key])
    }
    if (code !== 0) {
      const detail = textOf(payload.msg, 'API Key 校验失败')
      return failure('invalid_key', source, detail.includes(key) ? 'API Key 校验失败' : detail, [key])
    }

    const data = payload.data !== null && typeof payload.data === 'object' && !Array.isArray(payload.data)
      ? payload.data
      : {}
    const balance = textOf(data.remainMoney, '0')
    const currency = textOf(data.currency, 'CNY')
    const amount = Number.parseFloat(balance)
    return {
      status: Number.isFinite(amount) && amount > 0 ? 'ready' : 'no_balance',
      balance,
      currency,
      coins: textOf(data.remainCoins, '0'),
      runningTasks: textOf(data.currentTaskCounts, '0'),
      ...(textOf(data.apiType, '').length === 0 ? {} : { apiType: textOf(data.apiType, '') }),
      ...(textOf(data.keyType, '').length === 0 ? {} : { keyType: textOf(data.keyType, '') }),
      source,
      ...(source === 'file' ? { fromStore: true } : {}),
      checkedAt: checkedAt(),
    }
  } catch (error) {
    if (error !== null && typeof error === 'object' && error.name === 'AbortError') {
      return failure('timeout', source, '查询 RunningHub 超时', [key])
    }
    return failure('unreachable', source, '无法连接 RunningHub', [key])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Register the `mediaRunningHubController` service exposing both status methods.
 */
function registerController(ctx) {
  const prototype = {
    async sharedStatus() {
      const credentials = ctx.get('credentials')
      if (credentials === undefined) return failure('error', undefined, '凭据服务不可用')
      return queryStatus(credentials, SHARED_REF)
    },
    async memberStatus() {
      const credentials = ctx.get('credentials')
      if (credentials === undefined) return failure('error', undefined, '凭据服务不可用')
      return queryStatus(credentials, MEMBER_REF)
    },
  }
  Object.defineProperty(prototype, REMOTE_METHODS_KEY, {
    value: {
      version: 1,
      methods: [
        { method: 'sharedStatus', invocation: { kind: 'direct' } },
        { method: 'memberStatus', invocation: { kind: 'direct' } },
      ],
    },
    configurable: true,
  })
  const service = Object.create(prototype)
  service.ctx = ctx
  service.name = 'mediaRunningHubController'
  service.typertRemote = {
    service,
    serviceKey: 'mediaRunningHubController',
    namespace: 'mediaRunningHub',
  }
  ctx.reflect.provide('mediaRunningHubController', service)
}

/**
 * Mount the configured surface.
 *
 * @param ctx - plugin context.
 * @param config - `{ surface, channel }` from the profile patch.
 */
export function apply(ctx, config) {
  registerController(ctx)

  const surface = config?.surface === 'sync' ? 'sync' : 'jobs'
  if (surface === 'sync') {
    registerRunningHubSync(ctx, config)
  }
  // `jobs` surface is implemented by the workflow task pool; until it ships this
  // surface registers no tools and keeps only the configuration surfaces.
}
