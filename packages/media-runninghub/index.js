/**
 * Host half of the media-runninghub bundle.
 *
 * `surface` selects which capability set this plugin registers:
 *
 * - `sync`  → `runninghub_image`, the synchronous Nano Banana 2 image tool, using
 *             the sync key.
 * - `jobs`  → reserved for the workflow task pool, using the jobs key.
 *
 * The switch is a Config field on purpose: changing it reloads the plugin, so the
 * tool list always matches the configured surface instead of offering tools that
 * would only reject their calls.
 *
 * Two independent key cards are exposed through one Remote controller:
 * `syncStatus` and `jobsStatus`. Each resolves its own credential reference
 * and reports "not configured" for itself — neither stands in for the other.
 *
 * A key belongs to exactly one RunningHub site. The account-status response
 * reports the account's balance currency, and that currency — not the key
 * type, not a probe — decides the site: `USD` is the international site and
 * `CNY` the China site. The verdict is stored in Config when the key is saved
 * (`syncSite` / `jobsSite`), so a tool call never asks the provider again.
 */

import { registerRunningHubSync } from './lib/image.js'
import {
  JOBS_REF,
  SYNC_REF,
  persistSite,
  resolveSiteForKey,
  siteOf,
  statusUrlOf,
} from './lib/shared.js'
import Schema from '@deepseek-ai/schemastery'

export const name = 'media-runninghub'
export const inject = ['credentials', 'tools']

/**
 * The profile entry id of this plugin.
 *
 * It is the namespace of this plugin's settings form, so the settings service
 * can find the Config fields it owns when a site verdict is written.
 */
const NAMESPACE = 'media-runninghub'

/**
 * Config schema.
 *
 * `surface` decides which tool set this plugin registers. It lives in Config
 * rather than Settings on purpose: changing it must reload the plugin so the
 * model-facing tool list always matches the configured surface.
 *
 * `syncSite` and `jobsSite` are the site verdicts. They are volatile: the
 * verdict is written when a key is saved and read by the tools on every call,
 * so a change must update the running values instead of remounting the plugin
 * and tearing down the tool list.
 */
export const Config = Schema.object({
  surface: Schema.union(['jobs', 'sync']).default('sync')
    .description('注册哪一套工具：sync 为同步图片生成，jobs 为工作流任务池。切换会重载插件。'),
  channel: Schema.union(['lowprice', 'official']).default('lowprice')
    .description('Nano Banana 2 渠道：lowprice 低价渠道，official 官方稳定版。'),
  syncSite: Schema.union(['cn', 'intl']).default('cn').volatile()
    .description('sync Key 所属站点：cn 为中国站，intl 为国际站。保存 Key 时按余额币种自动判定。'),
  jobsSite: Schema.union(['cn', 'intl']).default('cn').volatile()
    .description('jobs Key 所属站点：cn 为中国站，intl 为国际站。保存 Key 时按余额币种自动判定。'),
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

/**
 * One display-safe reply.
 *
 * Every reply carries the running surface and the site verdict already stored
 * for its key, so the page can tell which card is editable and which site the
 * tools will call without a second request.
 *
 * @param status - the reply kind.
 * @param extra - the reply body.
 * @param context - the running surface and the stored site verdict.
 * @param secrets - values that must never appear in the reply.
 */
function reply(status, extra, context, secrets = []) {
  const message = extra?.message === undefined
    ? undefined
    : String(extra.message).split(secrets[0] ?? '\u0000').join('***').slice(0, MAX_MESSAGE_LENGTH)
  return {
    status,
    surface: context.surface,
    ...(context.site === undefined ? {} : { site: context.site }),
    ...extra,
    ...(message === undefined ? {} : { message }),
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
 * The endpoint answers on either host for any key, and the balance currency it
 * reports belongs to the account, not to the host that answered. That makes it
 * the one reliable way to learn which site a key belongs to.
 *
 * @param credentials - the Host credential service.
 * @param ref - which key to use.
 * @param context - the running surface and the stored site verdict.
 * @returns the display-safe account status.
 */
async function queryStatus(credentials, ref, context) {
  const { resolved, failed } = await resolveCredential(credentials, ref)
  if (failed) return reply('error', { message: '读取凭据失败' }, context)
  if (resolved === undefined) return reply('no_key', {}, context)

  const key = resolved.value
  const source = resolved.source
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(statusUrlOf('cn'), {
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
      return reply('error', { source, message: 'RunningHub 返回了无法识别的响应' }, context, [key])
    }
    if (payload === null || typeof payload !== 'object' || payload.code === undefined || payload.code === null) {
      return reply('error', { source, message: 'RunningHub 返回了无法识别的响应' }, context, [key])
    }
    const code = Number(payload.code)
    if (!Number.isFinite(code)) {
      return reply('error', { source, message: 'RunningHub 返回了无法识别的响应' }, context, [key])
    }
    if (!response.ok) {
      return reply('http_error', { source, message: `HTTP ${response.status}` }, context, [key])
    }
    if (code !== 0) {
      const detail = textOf(payload.msg, 'API Key 校验失败')
      return reply('invalid_key', { source, message: detail.includes(key) ? 'API Key 校验失败' : detail }, context, [key])
    }

    const data = payload.data !== null && typeof payload.data === 'object' && !Array.isArray(payload.data)
      ? payload.data
      : {}
    const balance = textOf(data.remainMoney, '0')
    const currency = textOf(data.currency, 'CNY')
    const amount = Number.parseFloat(balance)
    return reply(
      Number.isFinite(amount) && amount > 0 ? 'ready' : 'no_balance',
      {
        source,
        balance,
        currency,
        coins: textOf(data.remainCoins, '0'),
        runningTasks: textOf(data.currentTaskCounts, '0'),
        ...(textOf(data.apiType, '').length === 0 ? {} : { apiType: textOf(data.apiType, '') }),
        ...(textOf(data.keyType, '').length === 0 ? {} : { keyType: textOf(data.keyType, '') }),
        ...(source === 'file' ? { fromStore: true } : {}),
      },
      context,
    )
  } catch (error) {
    if (error !== null && typeof error === 'object' && error.name === 'AbortError') {
      return reply('timeout', { source, message: '查询 RunningHub 超时' }, context, [key])
    }
    return reply('unreachable', { source, message: '无法连接 RunningHub' }, context, [key])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Judge the site of one key and store the verdict in Config.
 *
 * This runs when the key is saved, so the verdict is a configuration-time
 * decision: the tools later read it from Config instead of asking the provider
 * which host to use.
 *
 * @param ctx - plugin context.
 * @param ref - the credential reference that was saved.
 * @param field - the Config field that holds this key's site verdict.
 * @param context - the running surface and the stored site verdict.
 */
async function judgeSite(ctx, ref, field, context) {
  const credentials = ctx.get('credentials')
  if (credentials === undefined) return reply('error', { message: '凭据服务不可用' }, context)
  const { resolved, failed } = await resolveCredential(credentials, ref)
  if (failed) return reply('error', { message: '读取凭据失败' }, context)
  if (resolved === undefined) return reply('no_key', {}, context)

  const key = resolved.value
  const verdict = await resolveSiteForKey(key)
  if (!verdict.ok) {
    return reply('error', { source: resolved.source, message: verdict.message }, context, [key])
  }
  try {
    await persistSite(ctx, NAMESPACE, field, verdict.site)
  } catch (error) {
    // The verdict could not be stored, so the tools would fall back to a
    // default host. Report it instead of pretending the save succeeded.
    return reply(
      'error',
      { source: resolved.source, message: `无法保存站点判定：${textOf(error?.message, '未知原因')}` },
      context,
      [key],
    )
  }
  return reply(
    'ok',
    {
      source: resolved.source,
      site: verdict.site,
      currency: verdict.currency,
      ...(verdict.apiType === '' ? {} : { apiType: verdict.apiType }),
    },
    { surface: context.surface, site: verdict.site },
  )
}

/**
 * Register the `mediaRunningHubController` service exposing both status methods
 * and the site judgment.
 */
function registerController(ctx, config) {
  /**
   * The running surface and the site verdict stored for one key.
   *
   * The surface is the plugin's current Config value: it is what decides
   * which key the running tools read, so both status replies report it and
   * the page can show the other key read-only.
   *
   * The verdict is read from the live Config reference, so a key saved a
   * moment ago is reflected without reloading the plugin.
   */
  const contextOf = (field) => ({
    surface: config?.surface === 'jobs' ? 'jobs' : 'sync',
    site: siteOf(config, field),
  })

  const prototype = {
    async syncStatus() {
      const credentials = ctx.get('credentials')
      if (credentials === undefined) return reply('error', { message: '凭据服务不可用' }, contextOf('syncSite'))
      return queryStatus(credentials, SYNC_REF, contextOf('syncSite'))
    },
    async jobsStatus() {
      const credentials = ctx.get('credentials')
      if (credentials === undefined) return reply('error', { message: '凭据服务不可用' }, contextOf('jobsSite'))
      return queryStatus(credentials, JOBS_REF, contextOf('jobsSite'))
    },
    async syncSite() {
      return judgeSite(ctx, SYNC_REF, 'syncSite', contextOf('syncSite'))
    },
    async jobsSite() {
      return judgeSite(ctx, JOBS_REF, 'jobsSite', contextOf('jobsSite'))
    },
  }
  Object.defineProperty(prototype, REMOTE_METHODS_KEY, {
    value: {
      version: 1,
      methods: [
        { method: 'syncStatus', invocation: { kind: 'direct' } },
        { method: 'jobsStatus', invocation: { kind: 'direct' } },
        { method: 'syncSite', invocation: { kind: 'direct' } },
        { method: 'jobsSite', invocation: { kind: 'direct' } },
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
 * @param config - `{ surface, channel, syncSite, jobsSite }` from the profile patch.
 */
export function apply(ctx, config) {
  registerController(ctx, config)

  const surface = config?.surface === 'sync' ? 'sync' : 'jobs'
  if (surface === 'sync') {
    registerRunningHubSync(ctx, config)
  }
  // `jobs` surface is implemented by the workflow task pool; until it ships this
  // surface registers no tools and keeps only the configuration surfaces.
}
