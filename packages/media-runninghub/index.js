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
import { setPoolConfig } from './lib/pool/config.js'
import { registerWorkflowSkill } from './lib/pool/skill.js'
import {
  registerWorkflowTools,
  ensurePoolWatcher,
  resumeOutstanding,
  client as rhClient,
  store as poolStore,
  siteOfConfig as poolSiteOfConfig,
  resolveJobsApiKey as resolveJobsKey,
} from './lib/pool/tools.js'
import { poolView, typeNameMap } from './lib/pool/view.js'
import { loadTaskTypes } from './lib/pool/types.js'
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
  surface: Schema.union(['jobs', 'sync']).default('jobs')
    .description('注册哪一套工具：jobs 为工作流任务池，sync 为同步图片生成。切换会重载插件。'),
  syncSite: Schema.union(['cn', 'intl']).default('cn').volatile()
    .description('sync Key 所属站点：cn 为中国站，intl 为国际站。保存 Key 时按余额币种自动判定。'),
  jobsSite: Schema.union(['cn', 'intl']).default('cn').volatile()
    .description('jobs Key 所属站点：cn 为中国站，intl 为国际站。保存 Key 时按余额币种自动判定。'),
  concurrency: Schema.number().step(1).min(1).max(100).default(2)
    .description('任务池的全局并发上限：同时在飞的 RunningHub 任务数。'),
  defaultInstanceType: Schema.string().default('default')
    .description('任务池默认实例类型；任务类型未单独固定 instanceType 时生效（如 "default" / "plus"）。'),
  pollIntervalSeconds: Schema.number().step(1).min(5).max(600).default(30)
    .description('任务池的轮询节奏（秒）。'),
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
function registerController(ctx) {
  /**
   * The running surface and the site verdict stored for one key.
   *
   * The surface is the plugin's current Config value: it is what decides
   * which key the running tools read, so both status replies report it and
   * the page can show the other key read-only.
   *
   * The verdict is read from the live fiber config. A volatile-only write
   * updates the running reference in place, so the value is current either
   * way; reading the fiber's config is what also keeps this correct when a
   * write carries an ordinary field too, because that path replaces the
   * fiber's config object instead of mutating the previous one.
   */
  const contextOf = (field) => {
    const live = ctx.fiber.config
    return {
      surface: live?.surface === 'jobs' ? 'jobs' : 'sync',
      site: siteOf(live, field),
    }
  }

  /**
   * Write one or more Config values through the profile config editor.
   *
   * `surface`, `concurrency` and `pollIntervalSeconds` are ordinary (volatile
   * absent) Config fields, so `settings.update` — which only accepts volatile
   * fields — rejects them. `configEditor.edit` edits the complete raw config and
   * applies it through the normal Loader path, so ordinary-field changes reload
   * the plugin and re-register the tools of the new surface, which is exactly
   * the lifecycle `surface` switching intends.
   */
  const writeConfig = async (patch, message) => {
    const editor = ctx.get('configEditor')
    const entry = ctx.fiber.entry
    if (editor === undefined || entry === undefined) {
      return { ok: false, status: 'error', message: '配置编辑器不可用' }
    }
    try {
      await editor.edit(entry, (current) => ({ ...current, ...patch }))
      return { ok: true, status: 'ok', message: undefined }
    } catch (error) {
      return { ok: false, status: 'error', message: `${message}：${error?.message ?? '未知原因'}` }
    }
  }

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
    async configStatus() {
      const live = ctx.fiber.config ?? {}
      return {
        status: 'ok',
        surface: live.surface === 'jobs' ? 'jobs' : 'sync',
        concurrency: typeof live.concurrency === 'number' ? live.concurrency : 2,
        pollIntervalSeconds: typeof live.pollIntervalSeconds === 'number' ? live.pollIntervalSeconds : 30,
        syncSite: siteOf(live, 'syncSite') ?? 'cn',
        jobsSite: siteOf(live, 'jobsSite') ?? 'cn',
      }
    },
    async setSurface(target) {
      const surface = target === 'sync' ? 'sync' : 'jobs'
      const wrote = await writeConfig({ surface }, '切换 surface 失败')
      return wrote.ok
        ? { status: 'ok', surface, message: undefined }
        : { status: 'error', surface: contextOf('syncSite').surface, message: wrote.message }
    },
    async setPoolFields(fields) {
      const patch = {}
      if (typeof fields?.concurrency === 'number') patch.concurrency = fields.concurrency
      if (typeof fields?.pollIntervalSeconds === 'number') patch.pollIntervalSeconds = fields.pollIntervalSeconds
      if (Object.keys(patch).length === 0) return { status: 'error', message: '没有可写入的字段' }
      // Writing an ordinary Config field reloads the plugin; the live surface
      // context is read before the write so the reply is still meaningful.
      const wrote = await writeConfig(patch, '保存任务池设置失败')
      return wrote.ok
        ? { status: 'ok', message: undefined }
        : { status: 'error', message: wrote.message }
    },
    /**
     * Read the task-pool ledger for the settings dashboard.
     *
     * With a `batchId` it returns that batch's full detail (parsed costs and
     * outputs); otherwise the current overview (current batch, counts, the
     * newest tasks). Works regardless of the running `surface` — the ledger is
     * shared.
     */
    async poolStatus(input) {
      // Same builder the status tool uses, so the board and the tool cannot
      // disagree on field names or on which branch enriches what. The type
      // catalogue is read here so the board can show display names; a catalogue
      // that fails to load leaves the ids in place rather than breaking the page.
      let typeNames
      try {
        typeNames = typeNameMap(await loadTaskTypes())
      } catch {
        typeNames = undefined
      }
      return poolView(poolStore, {
        batchId: Number(input?.batchId),
        limit: Number.isInteger(input?.limit) && input.limit > 0 ? Number(input.limit) : 50,
        typeNames,
      })
    },
    /**
     * Cancel one task: ask RunningHub to cancel a dispatched task, then mark
     * the ledger row CANCELLED.
     */
    async poolCancel(cmd) {
      const rowId = Number(cmd?.rowId)
      if (!Number.isInteger(rowId) || rowId <= 0) return { status: 'error', message: '无效的任务编号' }
      const task = await poolStore.taskById(rowId)
      if (!task) return { status: 'error', message: '任务不存在' }
      if (task.status !== 'DISPATCHED' && task.status !== 'PENDING') {
        return { status: 'error', message: `任务已处于 ${task.status} 状态，不能取消` }
      }
      if (task.status === 'DISPATCHED' && task.task_id) {
        const apiKey = await resolveJobsKey(ctx)
        if (!apiKey) return { status: 'error', message: '未配置 RUNNINGHUB_JOBS_API_KEY' }
        const result = await rhClient.cancelTask(apiKey, task.task_id, poolSiteOfConfig(ctx))
        if (!result.ok) return { status: 'error', message: `取消失败：${result.errorMessage}` }
      }
      await poolStore.setCancelled(rowId)
      return { status: 'ok', message: undefined }
    },
    /**
     * Replay one terminal task verbatim: a fresh PENDING row reusing the stored
     * RunningHub中转 file ids (no local re-upload). Ensures the watcher runs.
     */
    async poolResubmit(cmd) {
      const rowId = Number(cmd?.rowId)
      if (!Number.isInteger(rowId) || rowId <= 0) return { status: 'error', message: '无效的任务编号' }
      const replayed = await poolStore.requeue(rowId)
      if (!replayed) return { status: 'error', message: '任务不存在' }
      // The requeue already succeeded, so a watcher that cannot start must not
      // turn this into a failure: the row is queued either way, and reporting
      // an error here left users believing the replay was lost when it was not.
      // A Remote call has no owner agent, so the registry may refuse to serve it
      // and `startWatcher` falls back to a detached loop; anything else that
      // throws is reported to the log instead.
      try {
        ensurePoolWatcher(ctx)
      } catch (error) {
        ctx.logger?.warn?.('media-runninghub: pool watcher did not start: %o', error)
      }
      return { status: 'ok', newRowId: replayed.id, batchId: replayed.batchId, message: undefined }
    },
    /**
     * Re-start the pool watcher on demand.
     *
     * The board's stall warning tells the user a task stopped advancing; this
     * is the button that actually fixes it. `apply()` already resumes on
     * restart, so this covers the other case — a watcher that died while the
     * process stayed up.
     */
    async poolResumeWatcher() {
      try {
        ensurePoolWatcher(ctx)
      } catch (error) {
        return { status: 'error', message: `watcher 未能启动：${error?.message ?? error}` }
      }
      const outstanding = await poolStore.outstandingTasks().catch(() => [])
      return { status: 'ok', outstanding: outstanding.length, message: undefined }
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
        { method: 'configStatus', invocation: { kind: 'direct' } },
        { method: 'setSurface', invocation: { kind: 'direct' } },
        { method: 'setPoolFields', invocation: { kind: 'direct' } },
        { method: 'poolStatus', invocation: { kind: 'direct' } },
        { method: 'poolCancel', invocation: { kind: 'direct' } },
        { method: 'poolResubmit', invocation: { kind: 'direct' } },
        { method: 'poolResumeWatcher', invocation: { kind: 'direct' } },
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
 */
export function apply(ctx) {
  registerController(ctx)

  const surface = ctx.fiber.config?.surface === 'sync' ? 'sync' : 'jobs'
  const live = ctx.fiber.config ?? {}
  if (surface === 'sync') {
    registerRunningHubSync(ctx)
  } else {
    setPoolConfig({
      concurrency: typeof live.concurrency === 'number' ? live.concurrency : 2,
      defaultInstanceType: typeof live.defaultInstanceType === 'string' && live.defaultInstanceType.trim() ? live.defaultInstanceType.trim() : 'default',
      pollIntervalSeconds: typeof live.pollIntervalSeconds === 'number' ? live.pollIntervalSeconds : 30,
    })
    registerWorkflowTools(ctx)
    registerWorkflowSkill(ctx)
    // The watcher is a ctx.jobs job, so a DSH restart drops it while the rows
    // stay PENDING or DISPATCHED. Without this, a task that was in flight when
    // the app restarted is never polled again: the board keeps showing it as
    // running and its outputs are never downloaded, even though RunningHub has
    // already finished it.
    ctx.effect(() => {
      void resumeOutstanding(ctx)
    }, 'media-runninghub: resume the pool watcher')
  }
}
