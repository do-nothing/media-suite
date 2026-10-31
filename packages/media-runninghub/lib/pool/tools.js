/**
 * Host-side wiring for the `runninghub_workflow_*` tools and the pool watcher.
 *
 * The watcher is a single global job: the first submitter of an open batch
 * starts it as the owner, later submitters join the same batch and reuse the
 * running watcher. When the pool drains the watcher settles, which wakes the
 * owning session.
 */

import { resolve } from 'node:path'

import * as client from './client.js'
import { poolConfig } from './config.js'
import * as store from './store.js'
import { buildPayload, getTaskType, loadTaskTypes } from './types.js'
import { classifyFileValue, uploadFile } from './upload.js'
import { poolView, typeNameMap } from './view.js'
import { startWatcher } from './watcher.js'

// The single global watcher's identity, or null when the pool has drained.
// Whatever session started the watcher owns it; later submitters reuse it.
let activeWatcher = null

// True while a watcher started without an owner agent (a Remote-triggered
// replay) is polling. It has no registry job id and never settles, so this flag
// is the only guard against starting a second poller over the same ledger.
let detachedWatcher = false

/** Parse `cost_json` text from an overview row; null when not valid JSON. */
function safeJson(text) {
  if (typeof text !== 'string' || text.length === 0) return null
  try { return JSON.parse(text) } catch { return null }
}

/**
 * Register the workflow tools for the `jobs` surface.
 *
 * @param ctx - plugin context.
 */
export function registerWorkflowTools(ctx) {
  ctx.effect(
    () => ctx.tools.register(createSubmitTool(ctx)),
    'media-runninghub: runninghub_workflow_submit tool',
  )
  ctx.effect(
    () => ctx.tools.register(createTypesTool()),
    'media-runninghub: runninghub_workflow_types tool',
  )
  ctx.effect(
    () => ctx.tools.register(createStatusTool()),
    'media-runninghub: runninghub_workflow_status tool',
  )
}

function createSubmitTool(ctx) {
  return {
    name: 'runninghub_workflow_submit',
    description:
      '【当前运行时 = JOBS】向 RunningHub 工作流任务池提交任务（后台执行）。'
      + '提交后立即返回批次号和任务号，任务完成后会自动唤醒本会话。'
      + '提交后不要在本轮轮询或等待。使用前先加载 runninghub-workflow 技能了解类型选择规则。',
    parameters: {
      type: 'object',
      properties: {
        jobs: {
          type: 'array',
          description: '要提交的任务列表（一次可提交多条，未完成任务存在时自动并入当前批次）。',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', description: '任务类型 ID（用 runninghub_workflow_types 查询）' },
              params: { type: 'object', description: '任务参数，键值对；文件参数传本地路径', additionalProperties: true },
              outputDir: { type: 'string', description: '可选的产物目录（默认写在本会话 output 下）' },
              outputName: { type: 'string', description: '可选的产物文件名（不含扩展名）' },
            },
            required: ['type'],
            additionalProperties: false,
          },
        },
      },
      required: ['jobs'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          batchId: { type: 'integer' },
          taskIds: { type: 'array', items: { type: 'integer' } },
          submitted: { type: 'integer', description: '真正入队的任务数' },
          status: { type: 'string', description: 'ok=全部提交；partial=部分提交；needs_input=缺参数未提交；rejected=全部被拒' },
          needsInput: {
            type: 'array',
            description: '缺参数的任务清单；这些任务没有提交、也没有上传',
            items: {
              type: 'object',
              properties: {
                index: { type: 'integer' },
                typeId: { type: 'string' },
                label: { type: 'string' },
                missing: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      param: { type: 'string' },
                      label: { type: 'string' },
                      why: { type: 'string' },
                      accept: { type: 'array', items: { type: 'string' } },
                    },
                    required: ['param', 'label', 'why'],
                    additionalProperties: false,
                  },
                },
              },
              required: ['index', 'typeId', 'label', 'missing'],
              additionalProperties: false,
            },
          },
          watcher: { type: 'string', description: 'started=新起了 watcher；reused=复用了正在跑的' },
          errors: { type: 'array', items: { type: 'string' } },
        },
        required: ['batchId', 'taskIds', 'watcher'],
        additionalProperties: false,
      },
      render: (_args, value) => {
        const errors = Array.isArray(value.errors) ? value.errors : []
        const needsInput = Array.isArray(value.needsInput) ? value.needsInput : []
        const lines = []

        // needs_input leads, and says outright that nothing happened. Without
        // that sentence the model tends to read any non-empty answer as "a
        // submission went through" and reports a batch that does not exist.
        if (needsInput.length > 0) {
          lines.push(
            `needs_input：${needsInput.length} 个任务还缺参数，`
            + `没有提交、也没有上传任何文件（本次成功提交 ${Number(value.submitted) || 0} 个）。`,
          )
          for (const item of needsInput) {
            lines.push(`- 任务 ${item.index + 1}「${item.label}」(${item.typeId}):`)
            for (const miss of item.missing ?? []) {
              const accept = Array.isArray(miss.accept) && miss.accept.length > 0
                ? `，可选值：${miss.accept.map((v) => JSON.stringify(v)).join(' / ')}`
                : ''
              lines.push(`  · ${miss.param}（${miss.label}）：${miss.why}${accept}`)
            }
          }
          lines.push('请把上面这些值补齐后重新调用本工具。')
        }

        // A hard rejection is separate from "you did not tell me enough".
        if (errors.length > 0) {
          if (value.taskIds.length === 0 && needsInput.length === 0) {
            lines.push(`提交失败：0 个任务被接受（${errors.length} 个被拒绝）`)
          } else {
            lines.push(`另有 ${errors.length} 个任务被拒绝：`)
          }
          for (const e of errors) lines.push(`- ${e}`)
        }

        if (value.taskIds.length > 0) {
          lines.push(
            `已提交：批次 #${value.batchId}，${value.taskIds.length} 个任务`
            + `（watcher: ${value.watcher}）`,
          )
        }

        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(args, exec) {
      const jobs = Array.isArray(args?.jobs) ? args.jobs : []
      if (jobs.length === 0) {
        return { batchId: 0, taskIds: [], watcher: 'none', errors: ['jobs 不能为空'] }
      }

      const site = siteOfConfig(ctx)
      const sessionCwd = resolveSessionCwd(ctx, exec)
      const outputRoot = resolve(sessionCwd, 'output', 'media', 'runninghub')

      // Resolve every job: type lookup, param check, file upload.
      const resolved = []
      const errors = []
      // One entry per job that could not be assembled, carrying the structured
      // reason list. These are "tell the model what to collect", not failures:
      // nothing was submitted and nothing was uploaded for them.
      const needsInput = []
      for (const [index, job] of jobs.entries()) {
        try {
          const type = await getTaskType(String(job.type))
          const params = job.params ?? {}
          const result = await buildPayload(type, params, async (param, value) => {
            const kind = classifyFileValue(value)
            if (kind === 'url' || kind === 'rh_id') {
              return { rhFileName: value.trim(), input: { param: param.name, fieldName: param.fieldName, localPath: null, rhFileName: value.trim(), cached: true } }
            }
            if (kind !== 'local') throw new Error(`文件不存在或不可用: ${value}`)
            const upload = await uploadFileWithCache(ctx, site, value)
            if (!upload.ok) throw new Error(upload.errorMessage)
            return {
              rhFileName: upload.fileName,
              input: { param: param.name, fieldName: param.fieldName, localPath: resolve(value), rhFileName: upload.fileName, cached: upload.cached === true },
            }
          })
          if (!result.ok) {
            needsInput.push({ index, typeId: type.typeId, label: type.displayName, missing: result.missing })
            continue
          }
          resolved.push({
            typeId: type.typeId,
            workflowId: type.workflowId,
            instanceType: type.instanceType,
            nodeOverrides: result.payload.nodeInfoList,
            params,
            request: { workflowId: type.workflowId, instanceType: type.instanceType },
            outputDir: typeof job.outputDir === 'string' && job.outputDir.trim() ? resolve(sessionCwd, job.outputDir.trim()) : undefined,
            outputName: typeof job.outputName === 'string' && job.outputName.trim() ? job.outputName.trim() : undefined,
            outputRoot,
          })
        } catch (error) {
          errors.push(`任务 ${index + 1}: ${error?.message ?? error}`)
        }
      }

      // Nothing could be built and at least one job was merely under-specified:
      // report needs_input rather than a failure, and say plainly that no task
      // was created, so the model collects the values instead of assuming a
      // submission happened.
      if (resolved.length === 0 && needsInput.length > 0) {
        return {
          status: 'needs_input',
          batchId: 0,
          taskIds: [],
          watcher: 'none',
          submitted: 0,
          needsInput,
          ...(errors.length > 0 ? { errors } : {}),
        }
      }

      if (resolved.length === 0) {
        return { status: 'rejected', batchId: 0, taskIds: [], watcher: 'none', submitted: 0, errors }
      }

      const { ids, batchId } = await store.enqueue(resolved, exec.agent?.id)

      let watcherAction = 'reused'
      if (activeWatcher === null) {
        startWatcherJob(ctx, site, exec.agent)
        watcherAction = 'started'
      }

      return {
        status: needsInput.length > 0 ? 'partial' : 'ok',
        batchId,
        taskIds: ids,
        submitted: ids.length,
        watcher: watcherAction,
        ...(needsInput.length > 0 ? { needsInput } : {}),
        ...(errors.length > 0 ? { errors } : {}),
      }
    },
  }
}

function createTypesTool() {
  return {
    name: 'runninghub_workflow_types',
    description:
      '【当前运行时 = JOBS】列出 RunningHub 工作流任务池的全部任务类型：每个类型的参数、必填项、默认值和费用说明。'
      + '提交任务前先调用此工具选择类型和参数。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: {
      schema: {
        type: 'object',
        properties: {
          types: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                typeId: { type: 'string' },
                displayName: { type: 'string' },
                description: { type: 'string' },
                instanceType: { type: 'string' },
                params: { type: 'array', items: { type: 'object' } },
              },
              required: ['typeId', 'displayName', 'params'],
            },
          },
        },
        required: ['types'],
        additionalProperties: false,
      },
      render: (_args, value) => {
        // The model picks parameter values from this text alone, so it has to
        // carry the legal values, not just the type list. A bare "typeId —
        // name" listing left enum params to guesswork, and a guessed value
        // (e.g. "16:9" instead of "16:9 (Widescreen)") is accepted upstream,
        // charged, and reported SUCCESS with no output.
        const blocks = value.types.map((t) => {
          const head = `${t.typeId} — ${t.displayName}`
          const lines = [head]
          if (t.description) lines.push(`  ${t.description}`)
          for (const p of Array.isArray(t.params) ? t.params : []) {
            const required = p.required ? '必填' : '可选'
            const def = p.default !== undefined ? `，默认 ${JSON.stringify(p.default)}` : ''
            lines.push(`  · ${p.name}（${p.type}，${required}${def}）${p.label ? ' — ' + p.label : ''}`)
            // Enum values must be copied verbatim: the workflow node matches
            // them exactly and does not reject a near miss.
            if (Array.isArray(p.enum) && p.enum.length > 0) {
              lines.push(`      合法值（必须原样传）：${p.enum.map((v) => JSON.stringify(v)).join(' / ')}`)
            }
            if (Array.isArray(p.accept) && p.accept.length > 0) {
              lines.push(`      接受文件类型：${p.accept.join(' / ')}`)
            }
          }
          return lines.join('\n')
        })
        return [{
          type: 'text',
          text: `可用类型 ${value.types.length} 个：\n\n${blocks.join('\n\n')}`,
        }]
      },
    },
    async execute() {
      const types = await loadTaskTypes()
      return {
        types: types.map((t) => ({
          typeId: t.typeId,
          displayName: t.displayName,
          description: t.description,
          instanceType: t.instanceType,
          params: t.params.map((p) => ({
            name: p.name,
            label: p.label,
            type: p.type,
            required: p.required,
            ...(p.default !== null && p.default !== undefined ? { default: p.default } : {}),
            ...(p.enum.length > 0 ? { enum: p.enum } : {}),
            ...(p.accept.length > 0 ? { accept: p.accept } : {}),
          })),
        })),
      }
    },
  }
}

function createStatusTool() {
  return {
    name: 'runninghub_workflow_status',
    description:
      '【当前运行时 = JOBS】查询 RunningHub 任务池的状态：当前批次、各状态任务数、最近的任务列表。'
      + '池排空后 currentBatchId 为 0。',
    parameters: {
      type: 'object',
      properties: {
        batchId: { type: 'integer', description: '指定批次号（默认查当前）' },
        limit: { type: 'integer', description: '最近任务条数（默认 20）' },
      },
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          currentBatchId: { type: 'integer' },
          latestBatchId: { type: 'integer' },
          batches: { type: 'array', items: { type: 'integer' } },
          counts: { type: 'object' },
          tasks: { type: 'array', items: { type: 'object' } },
        },
        required: ['currentBatchId', 'counts'],
        additionalProperties: false,
      },
      render: (_args, value) => {
        const c = value.counts
        const outstanding = (c.PENDING ?? 0) + (c.DISPATCHED ?? 0)
        const batch = value.currentBatchId === 0 ? '已排空' : `#${value.currentBatchId}`
        let text = `批次 ${batch}：${c.total} 个任务（在飞 ${outstanding}，成功 ${c.SUCCESS ?? 0}，失败 ${c.FAILED ?? 0}）`

        // Surface fees so a delivery reports the amount. Accept both shapes:
        // batchDetail tasks have parsed `costs`, overview rows carry `cost_json`
        // as a JSON string. Aggregate coins / cash / third-party across all
        // successful tasks in this view.
        const costs = []
        for (const t of Array.isArray(value.tasks) ? value.tasks : []) {
          if (t === null || typeof t !== 'object') continue
          const raw = t.costs ?? (t.cost_json ? safeJson(t.cost_json) : null)
          if (raw === null || raw === undefined) continue
          const coins = Number(raw.coins) || 0
          const money = Number(raw.money) || 0
          const third = Number(raw.thirdParty) || 0
          if (coins || money || third) costs.push({ coins, money, third })
        }
        if (costs.length > 0) {
          const sum = costs.reduce((a, x) => ({
            coins: a.coins + x.coins, money: a.money + x.money, third: a.third + x.third,
          }), { coins: 0, money: 0, third: 0 })
          const parts = []
          if (sum.coins) parts.push(`${sum.coins} RH 币`)
          if (sum.money) parts.push(`现金 ${sum.money.toFixed(2)}`)
          if (sum.third) parts.push(`第三方 ${sum.third.toFixed(2)}`)
          if (parts.length > 0) text += `；已计费 ${parts.join('，')}`
        }
        return [{ type: 'text', text }]
      },
    },
    async execute(args) {
      // Same builder the settings board uses, so the tool and the board cannot
      // disagree on field names or on which branch enriches what. The type
      // catalogue is read here so a status reply carries display names too.
      let typeNames
      try {
        typeNames = typeNameMap(await loadTaskTypes())
      } catch {
        typeNames = undefined
      }
      return poolView(store, {
        batchId: typeof args?.batchId === 'number' ? args.batchId : undefined,
        limit: typeof args?.limit === 'number' ? args.limit : 20,
        typeNames,
      })
    },
  }
}

/** Start the single global watcher owned by the given agent. */
function startWatcherJob(ctx, site, agent) {
  if (activeWatcher !== null) return
  // A watcher started from a Remote call (the board's replay button) has no
  // agent to own a registry job, so `startWatcher` runs it detached and returns
  // no id. That loop still needs the singleton guard: without it every replay
  // click would start another poller over the same ledger.
  if (detachedWatcher) return
  const jobId = startWatcher(ctx, site, poolConfig, agent)
  if (jobId === undefined) {
    detachedWatcher = true
    return
  }
  const ownerId = agent?.id
  activeWatcher = { jobId, ownerId }
  // The watcher settles via ctx.jobs when the pool drains, which appends
  // `job/settled` to the owning session (the wake). Release the singleton so
  // the next batch can start a fresh watcher.
  const jobs = ctx.get('jobs')
  jobs?.events.subscribe({ owner: ownerId }, (event) => {
    if (event.type === 'settled' && event.job.id === jobId) activeWatcher = null
  })
}

function siteOfConfig(ctx) {
  const live = ctx.fiber?.config
  const site = live?.jobsSite
  return site === 'intl' ? 'intl' : 'cn'
}

function resolveSessionCwd(ctx, exec) {
  const service = ctx.get('workingDirectory')
  if (service !== undefined && exec?.agent !== undefined) {
    try { return service.get(exec.agent.session) } catch { /* fall through */ }
  }
  return process.cwd()
}

/** Upload with the ledger's cache: same path+size+mtime reuses the rh file. */
/**
 * Upload a local file, reusing the ledger's record when the same bytes were
 * already uploaded to the same site.
 *
 * The key is the content hash plus the site, not the path. Uploads are bound to
 * a site (a key can only upload to its own), so the site has to be in the key or
 * a `.cn` file name would be replayed at `.ai` and fail. The hash rather than
 * path+size+mtime means a file that was renamed, moved, or touched without its
 * content changing still hits the cache — which is the common case when a user
 * reorganises their inputs between runs.
 */
async function uploadFileWithCache(ctx, site, filePath) {
  const fs = await import('node:fs/promises')
  const crypto = await import('node:crypto')
  let digest = null
  try {
    const bytes = await fs.readFile(filePath)
    digest = crypto.createHash('sha256').update(bytes).digest('hex')
  } catch {
    // Unreadable file: fall through to the upload call, which reports the real
    // reason (missing path, permissions) instead of a hash failure.
    digest = null
  }
  const cacheKey = digest === null ? null : `sha256:${digest}:${site}`
  if (cacheKey !== null) {
    const cached = await store.cachedUpload(cacheKey)
    if (cached) return { ok: true, fileName: cached, cached: true }
  }
  const apiKey = await resolveJobsApiKey(ctx)
  if (!apiKey) return { ok: false, errorMessage: '未配置 RUNNINGHUB_JOBS_API_KEY' }
  const result = await uploadFile(apiKey, filePath, site)
  if (result.ok && cacheKey !== null) await store.rememberUpload(cacheKey, result.fileName)
  return result
}

async function resolveJobsApiKey(ctx) {
  try {
    const resolved = await ctx.get('credentials')?.resolve('RUNNINGHUB_JOBS_API_KEY')
    return resolved?.value
  } catch { return undefined }
}

/** Ensure the single global watcher is running (e.g. after a manual resubmit). */
export function ensurePoolWatcher(ctx) {
  if (activeWatcher !== null) return
  startWatcherJob(ctx, siteOfConfig(ctx), undefined)
}

/**
 * Restart the watcher when the ledger still holds outstanding work.
 *
 * The watcher is a `ctx.jobs` job, and the registry lives in the process: a
 * DSH restart drops it while the rows stay PENDING or DISPATCHED. Nothing polls
 * them any more, so they sit "running" forever and their outputs are never
 * downloaded even though RunningHub finished them long ago.
 *
 * Called once from `apply()`, after the config is known. There is no submitter
 * agent to own a registry job at that point, so the loop runs detached: it still
 * dispatches, polls and downloads, it just cannot wake a session.
 *
 * @returns the number of outstanding rows it resumed for, 0 when nothing to do.
 */
export async function resumeOutstanding(ctx) {
  let outstanding = []
  try {
    outstanding = await store.outstandingTasks()
  } catch (error) {
    ctx.logger?.warn?.('media-runninghub: could not read outstanding tasks: %o', error)
    return 0
  }
  if (outstanding.length === 0) return 0
  ensurePoolWatcher(ctx)
  ctx.logger?.info?.('media-runninghub: resumed the pool watcher for %d outstanding task(s)', outstanding.length)
  return outstanding.length
}

// Re-exports for the startWatcher wiring in index.js and the settings page's
// pool-status controller.
export { client, store, siteOfConfig, resolveJobsApiKey }
