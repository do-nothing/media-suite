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
import { startWatcher } from './watcher.js'

// The single global watcher's identity, or null when the pool has drained.
// Whatever session started the watcher owns it; later submitters reuse it.
let activeWatcher = null

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
          watcher: { type: 'string', description: 'started=新起了 watcher；reused=复用了正在跑的' },
          errors: { type: 'array', items: { type: 'string' } },
        },
        required: ['batchId', 'taskIds', 'watcher'],
        additionalProperties: false,
      },
      render: (_args, value) => {
        const errors = Array.isArray(value.errors) ? value.errors : []
        // Nothing was accepted: lead with the failure so the model cannot read
        // this as a success, and always list the reasons. Silently collapsing
        // every rejection into "N 个被拒绝" hid the actual cause (an unsupported
        // parameter looked like a broken plugin).
        if (value.taskIds.length === 0) {
          const lines = [`提交失败：0 个任务被接受（${errors.length} 个被拒绝）`]
          for (const e of errors) lines.push(`- ${e}`)
          return [{ type: 'text', text: lines.join('\n') }]
        }
        const lines = [`已提交：批次 #${value.batchId}，${value.taskIds.length} 个任务（watcher: ${value.watcher}）`]
        if (errors.length > 0) {
          lines.push(`另有 ${errors.length} 个任务被拒绝：`)
          for (const e of errors) lines.push(`- ${e}`)
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
      for (const [index, job] of jobs.entries()) {
        try {
          const type = await getTaskType(String(job.type))
          const params = job.params ?? {}
          const result = await buildPayload(type, params, async (param, value) => {
            const kind = classifyFileValue(value)
            if (kind === 'url' || kind === 'rh_id') {
              return { rhFileName: value.trim(), input: { param: param.name, fieldName: param.fieldName, localPath: null, rhFileName: value.trim(), cached: true } }
            }
            if (kind !== 'local') throw new Error(`param '${param.name}': 文件不存在或不可用: ${value}`)
            const upload = await uploadFileWithCache(ctx, site, value)
            if (!upload.ok) throw new Error(`param '${param.name}': ${upload.errorMessage}`)
            return {
              rhFileName: upload.fileName,
              input: { param: param.name, fieldName: param.fieldName, localPath: resolve(value), rhFileName: upload.fileName, cached: upload.cached === true },
            }
          })
          if (!result.ok) throw new Error(result.error)
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

      if (resolved.length === 0) {
        return { batchId: 0, taskIds: [], watcher: 'none', errors }
      }

      const { ids, batchId } = await store.enqueue(resolved, exec.agent?.id)

      let watcherAction = 'reused'
      if (activeWatcher === null) {
        startWatcherJob(ctx, site, exec.agent)
        watcherAction = 'started'
      }

      return { batchId, taskIds: ids, watcher: watcherAction, ...(errors.length > 0 ? { errors } : {}) }
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
      if (typeof args?.batchId === 'number') {
        const tasks = await store.batchDetail(args.batchId)
        const counts = { total: tasks.length }
        for (const t of tasks) counts[t.status] = (counts[t.status] ?? 0) + 1
        return { currentBatchId: (await store.currentBatchId()) ?? 0, counts, tasks }
      }
      return store.overview(typeof args?.limit === 'number' ? args.limit : 20)
    },
  }
}

/** Start the single global watcher owned by the given agent. */
function startWatcherJob(ctx, site, agent) {
  if (activeWatcher !== null) return
  const jobId = startWatcher(ctx, site, poolConfig, agent)
  if (jobId === undefined) return
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
async function uploadFileWithCache(ctx, site, filePath) {
  const fs = await import('node:fs/promises')
  const info = await fs.stat(filePath).catch(() => null)
  const cacheKey = `${resolve(filePath)}:${info?.size ?? 0}:${Math.trunc(info?.mtimeMs ?? 0)}`
  const cached = await store.cachedUpload(cacheKey)
  if (cached) return { ok: true, fileName: cached, cached: true }
  const apiKey = await resolveJobsApiKey(ctx)
  if (!apiKey) return { ok: false, errorMessage: '未配置 RUNNINGHUB_JOBS_API_KEY' }
  const result = await uploadFile(apiKey, filePath, site)
  if (result.ok) await store.rememberUpload(cacheKey, result.fileName)
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

// Re-exports for the startWatcher wiring in index.js and the settings page's
// pool-status controller.
export { client, store, siteOfConfig, resolveJobsApiKey }
