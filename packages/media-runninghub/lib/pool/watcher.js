/**
 * The single global watcher: one `ctx.jobs` job that polls every outstanding
 * task in the shared ledger, downloads finished outputs, and settles when the
 * pool drains.
 *
 * The job is owned by the session that started it (the first submitter of the
 * open batch), so its `job/settled` event wakes that session. Sessions that
 * submitted tasks later are not woken — their results stay in the ledger, and
 * they see them the next time they query.
 */

import * as client from './client.js'
import * as store from './store.js'
import { downloadFile } from './upload.js'

/**
 * One pool step: dispatch pending tasks within the concurrency budget, poll
 * dispatched ones, download newly finished outputs. Returns whether the pool
 * drained after this step.
 */
async function tick(apiKey, site, job, cfg) {
  const tasks = await store.outstandingTasks()
  if (tasks.length === 0) return { drained: true }

  // Dispatch pending tasks, bounded by the global concurrency budget.
  let inFlight = tasks.filter((t) => t.status === 'DISPATCHED' && t.task_id).length
  for (const task of tasks.filter((t) => t.status === 'PENDING')) {
    if (inFlight >= cfg.concurrency) break
    const request = JSON.parse(task.request_json)
    const nodes = JSON.parse(task.node_json ?? '[]')
    const payload = { apiKey, ...request }
    if (Array.isArray(nodes) && nodes.length > 0) payload.nodeInfoList = nodes
    const result = await client.createWorkflow(apiKey, payload, site)
    if (result.ok) {
      await store.setDispatched(task.id, result.taskId)
      inFlight += 1
    } else {
      await store.setSubmitFailed(task.id, result)
    }
  }

  // Poll every dispatched task.
  for (const task of tasks.filter((t) => t.status === 'DISPATCHED' && t.task_id)) {
    const result = await client.queryTask(apiKey, task.task_id, site)
    if (!result.ok) continue // network error: retry on the next tick

    if (result.terminal) {
      await store.setTerminal(task.id, result)
      if (result.status === 'SUCCESS') {
        for (const record of await downloadOutputs(task, result.results)) {
          await store.addOutput(task.id, record)
        }
      }
    } else {
      // Record the live RunningHub status without ending the task.
      await store.setRhStatus(task.id, result.rhStatus)
    }
  }

  const after = await store.outstandingTasks()
  const finished = tasks.length - after.length
  job.updateProgress(`${finished}/${tasks.length} 已完成`)
  return { drained: after.length === 0 }
}

/**
 * Download the result files of one finished task.
 *
 * The destination comes from the ledger's own `output_dir` / `output_name`
 * columns, not from `request_json`. The submit path has always written those
 * columns, but the download read them out of `request_json`, which only carries
 * `{ workflowId, instanceType }` — so a caller's `outputDir` was silently
 * ignored and every file landed in `output_root/batch-N/`. `request_json` is
 * still consulted as a fallback so rows written by the older build, or by a
 * caller that put the fields there, keep working.
 */
async function downloadOutputs(task, results) {
  const request = safeParseRequest(task.request_json)
  const customDir = task.output_dir || request.outputDir
  const customName = task.output_name || request.outputName
  const items = (results ?? []).filter((it) => it.url || it.outputUrl)
  const downloads = []
  for (const [index, item] of items.entries()) {
    const url = item.url ?? item.outputUrl
    const ext = item.outputType ?? 'bin'
    const node = item.nodeId ?? 'out'
    let filename
    if (customDir && customName) {
      const stem = String(customName).split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '') ?? 'output'
      filename = items.length > 1 ? `${stem}_${index}.${ext}` : `${stem}.${ext}`
    } else {
      // Default identity; idx in the raw result list keeps node-slot
      // correspondence stable across reruns.
      filename = `${task.id}_${node}_${index}.${ext}`
    }
    const target = customDir
      ? `${customDir.replace(/[\\/]+$/, '')}/${filename}`
      : `${task.output_root.replace(/[\\/]+$/, '')}/batch-${task.batch_id}/${filename}`
    const record = { nodeId: node, url, outputType: ext }
    const dl = await downloadFile(url, target)
    if (dl.ok) {
      record.path = dl.path
      record.size = dl.size
      record.ok = true
    } else {
      record.ok = false
      record.error = dl.errorMessage
    }
    downloads.push(record)
  }
  return downloads
}

/** Parse a `request_json` column, tolerating a null or malformed value. */
function safeParseRequest(text) {
  if (typeof text !== 'string' || text.length === 0) return {}
  try {
    const parsed = JSON.parse(text)
    return parsed !== null && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

/**
 * Start the single global watcher as a `ctx.jobs` job owned by the given
 * session. The job settles when the pool drains, which appends `job/settled`
 * to the owning session and wakes it.
 *
 * @returns the registry-issued job id, or undefined when ctx.jobs is absent.
 */
export function startWatcher(ctx, site, cfg, agent) {
  let cancelled = false
  let wakeSleep

  const done = (async () => {
    let apiKey
    try {
      const resolved = await ctx.get('credentials')?.resolve('RUNNINGHUB_JOBS_API_KEY')
      apiKey = resolved?.value
    } catch { apiKey = undefined }
    if (!apiKey) return { status: 'failed', detail: '未配置 RUNNINGHUB_JOBS_API_KEY' }

    while (!cancelled) {
      let outcome
      try {
        outcome = await tick(apiKey, site, { updateProgress: (line) => job?.updateProgress?.(line) }, cfg)
      } catch (error) {
        // Transient errors never kill the watcher; log and retry next tick.
        outcome = { drained: false }
        console.warn('[runninghub pool] tick error:', error?.message ?? error)
      }
      if (outcome.drained) return { status: 'completed', detail: '池已排空' }
      await new Promise((resolve) => {
        wakeSleep = resolve
        setTimeout(resolve, Math.max(5, cfg.pollIntervalSeconds) * 1000)
      })
      wakeSleep = undefined
    }
    return { status: 'killed', detail: 'cancelled' }
  })()

  let job
  const hooks = {
    cancel() {
      cancelled = true
      wakeSleep?.()
    },
    done,
  }

  const jobs = ctx.get('jobs')
  if (jobs === undefined) {
    // No job registry: run the loop detached so the pool still drains.
    done.catch(() => {})
    return undefined
  }
  // A registry job needs an owner agent: it is the permission fence and the
  // session a `job/settled` wake goes to. The settings page's replay button
  // calls this from a Remote method, which has no agent, and `jobs.start`
  // refuses with "no job controller serves this agent". With no agent there is
  // no session to wake, so run the loop detached instead — the pool still
  // drains and the board shows the results on its next refresh.
  if (agent?.id === undefined) {
    done.catch(() => {})
    return undefined
  }
  job = jobs.start({
    kind: 'runninghub-pool',
    label: 'RunningHub 任务池 watcher',
    owner: agent.id,
    run(handle) {
      job = { ...job, handle }
      return hooks
    },
  })
  return job
}
