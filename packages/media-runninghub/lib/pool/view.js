/**
 * Pure view logic for the task-pool board.
 *
 * Everything here is a plain function over ledger rows or the `poolStatus`
 * reply: no React, no Cordis context, no sqlite handle. The board renders what
 * these return, and `index.js` builds the reply they read. Both halves import
 * this module, so a shape change happens in one place instead of two.
 *
 * Tests live in `tests/view.test.mjs` and run without a browser or a Harness
 * process.
 */

/** The fields a `poolStatus` reply must carry, in both its overview and detail forms. */
export const POOL_VIEW_KEYS = ['currentBatchId', 'latestBatchId', 'batches', 'counts', 'tasks']

/**
 * Build one `poolStatus` reply.
 *
 * Both callers — the settings board (`index.js`) and the `runninghub_workflow_status`
 * tool (`tools.js`) — go through here, so the two can no longer drift apart on
 * field names or on which branch enriches what. That drift is what made the board
 * render the whole ledger: the tool's reply and the board's reply disagreed.
 *
 * With `batchId` set it returns that batch's rows with parsed costs, params, and
 * outputs. Without it, it returns the newest `limit` rows across all batches,
 * enriched the same way, plus the batch list and the highest id so the board can
 * anchor on the last batch once the pool drains.
 *
 * @param store - the ledger module (`store.js`).
 * @param options - `{ batchId?, limit? }`.
 */
export async function poolView(store, options = {}) {
  const batchId = Number(options.batchId)
  const limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : 50
  const latestBatchId = await store.latestBatchId()
  const batches = await store.batches()
  const currentBatchId = await store.currentBatchId()

  if (Number.isInteger(batchId) && batchId > 0) {
    const tasks = await store.batchDetail(batchId)
    return {
      status: 'ok',
      currentBatchId,
      latestBatchId,
      batches,
      counts: countByStatus(tasks),
      tasks,
    }
  }

  const view = await store.overview(limit)
  const enriched = []
  for (const task of Array.isArray(view.tasks) ? view.tasks : []) {
    enriched.push({
      ...task,
      costs: safeJson(task.cost_json),
      params: safeJson(task.params_json),
      outputs: await store.outputsOf(task.id),
    })
  }
  return {
    status: 'ok',
    currentBatchId,
    latestBatchId,
    batches,
    counts: view.counts,
    tasks: enriched,
  }
}

/** Parse a JSON column, tolerating null and malformed text. */
function safeJson(value) {
  if (typeof value !== 'string' || value.length === 0) return null
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

/**
 * Assert a reply carries every field the board reads.
 *
 * A shape check rather than a silent `undefined`: a missing `batches` or
 * `latestBatchId` is what turns the board into a full-ledger dump, and that is
 * invisible until someone reads the rendered rows.
 *
 * @returns the names of the missing fields (empty when the reply is complete).
 */
export function missingViewKeys(view) {
  if (view === null || typeof view !== 'object') return [...POOL_VIEW_KEYS]
  return POOL_VIEW_KEYS.filter((key) => !(key in view))
}

/**
 * The batch the board anchors on.
 *
 * `currentBatchId` answers "what is running" and is 0 once drained; then the
 * board falls back to the highest batch in the ledger, so a finished batch stays
 * readable instead of the board going blank.
 *
 * @param pool - a `poolStatus` reply, or null before the first reply arrives.
 * @returns the batch id to show, or 0 when the ledger holds no tasks.
 */
export function anchorBatchOf(pool) {
  const current = Number(pool?.currentBatchId) || 0
  const latest = Number(pool?.latestBatchId) || 0
  return current > 0 ? current : latest
}

/**
 * Whether a reply already holds exactly the rows of one batch.
 *
 * The overview form carries the newest tasks across every batch, enriched with
 * `outputs` so a drained board still shows costs. Testing for `outputs` therefore
 * cannot tell the two forms apart — it is always true — and the board would render
 * the whole ledger. What identifies the detail form is that every row belongs to
 * the batch asked for.
 *
 * @param rows - `tasks` from a `poolStatus` reply.
 * @param desired - the batch id the board wants.
 */
export function isBatchDetail(rows, desired) {
  if (!Array.isArray(rows) || rows.length === 0) return false
  const wanted = Number(desired)
  if (!Number.isFinite(wanted)) return false
  return rows.every((task) => Number(task?.batch_id) === wanted)
}

/**
 * Batch navigation state for the board.
 *
 * @param pool - a `poolStatus` reply, or null.
 * @param viewBatch - the batch the user pinned, or null to follow the anchor.
 * @returns `{ shownBatch, anchorBatch, index, hasPrev, hasNext, isViewingAnchor }`.
 *   `hasPrev` walks to older batches, `hasNext` to newer ones.
 */
export function batchNav(pool, viewBatch) {
  const batches = Array.isArray(pool?.batches) ? pool.batches.map(Number) : []
  const anchorBatch = anchorBatchOf(pool)
  const pinned = viewBatch === null || viewBatch === undefined ? null : Number(viewBatch)
  const shownBatch = pinned !== null && Number.isFinite(pinned) ? pinned : anchorBatch
  const index = batches.indexOf(shownBatch)
  return {
    shownBatch,
    anchorBatch,
    batches,
    index,
    // The list is newest-first, so a larger index means an older batch.
    hasPrev: index >= 0 && index < batches.length - 1,
    hasNext: index > 0,
    isViewingAnchor: anchorBatch > 0 && shownBatch === anchorBatch,
  }
}

/**
 * Count tasks by status, in the shape the board's chips read.
 *
 * @param tasks - ledger rows.
 * @returns `{ total, PENDING, DISPATCHED, SUCCESS, FAILED, SUBMIT_FAILED, CANCELLED }`.
 */
export function countByStatus(tasks) {
  const counts = {
    total: 0, PENDING: 0, DISPATCHED: 0, SUCCESS: 0, FAILED: 0, SUBMIT_FAILED: 0, CANCELLED: 0,
  }
  for (const task of Array.isArray(tasks) ? tasks : []) {
    const status = task?.status
    if (typeof status !== 'string') continue
    counts.total += 1
    if (status in counts) counts[status] += 1
  }
  return counts
}

/** Tasks still queueing or running. */
export function outstandingOf(counts) {
  return (Number(counts?.PENDING) || 0) + (Number(counts?.DISPATCHED) || 0)
}

/**
 * A short human cost summary from a ledger cost object.
 *
 * @param cost - `{ coins, money, thirdParty }` or null.
 * @returns the summary, or null when every component is zero or absent.
 */
export function formatCost(cost) {
  if (cost === null || typeof cost !== 'object') return null
  const parts = []
  const coins = Number(cost.coins)
  const money = Number(cost.money)
  const third = Number(cost.thirdParty)
  if (Number.isFinite(coins) && coins !== 0) parts.push(`${coins} RH`)
  if (Number.isFinite(money) && money !== 0) parts.push(formatMoney(String(money), 'CNY'))
  if (Number.isFinite(third) && third !== 0) parts.push(`¥${third.toFixed(2)}`)
  return parts.length > 0 ? parts.join(' · ') : null
}

/** Format an amount with its currency mark; unknown currencies keep their code. */
export function formatMoney(value, currency) {
  const amount = Number.parseFloat(value)
  const text = Number.isFinite(amount) ? amount.toFixed(2) : String(value)
  if (currency === 'USD') return '$' + text
  if (currency === 'CNY' || currency === 'RMB') return '¥' + text
  return (currency ? currency + ' ' : '') + text
}

/**
 * Elapsed time for one task, matching what `pool.py ls` shows.
 *
 * @param task - a ledger row with `created_at` and optionally `finished_at`.
 * @param now - the current epoch in milliseconds.
 * @returns `{ seconds, text }`; `text` carries a trailing `…` while the task is
 *   still running, and is `-` when the row has no start time.
 */
export function taskDuration(task, now = Date.now()) {
  const start = Number(task?.created_at)
  if (!Number.isFinite(start) || start <= 0) return { seconds: null, text: '-' }
  const finished = Number(task?.finished_at)
  const running = !Number.isFinite(finished) || finished <= 0
  const end = running ? Number(now) : finished
  const seconds = Math.max(0, Math.floor((end - start) / 1000))
  return { seconds, text: formatDuration(seconds) + (running ? '…' : '') }
}

/** Compact duration: `12s`, `3m04s`, `1h12m`. */
export function formatDuration(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0))
  if (total < 60) return `${total}s`
  const minutes = Math.floor(total / 60)
  if (minutes < 60) return `${minutes}m${String(total % 60).padStart(2, '0')}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h${String(minutes % 60).padStart(2, '0')}m`
}

/**
 * A task that should be advancing but has not been touched recently.
 *
 * A healthy watcher re-polls every `pollIntervalSeconds` and refreshes
 * `updated_at`; silence for two intervals (and at least a minute) means the
 * detached watcher is likely gone while RunningHub may already be done. This is
 * the warning `pool.py ls` prints.
 *
 * @param task - a ledger row.
 * @param pollIntervalSeconds - the configured poll cadence.
 * @param now - the current epoch in milliseconds.
 * @returns the silent gap in seconds, or null when the task looks healthy.
 */
export function staleSeconds(task, pollIntervalSeconds, now = Date.now()) {
  const status = task?.status
  const anchor = status === 'DISPATCHED'
    ? Number(task?.updated_at)
    : status === 'PENDING' ? Number(task?.created_at) : NaN
  if (!Number.isFinite(anchor) || anchor <= 0) return null
  const threshold = Math.max(60, (Number(pollIntervalSeconds) || 30) * 2)
  const gap = Math.floor((Number(now) - anchor) / 1000)
  return gap > threshold ? gap : null
}
