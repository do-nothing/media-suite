/**
 * Tests for the task-pool view logic.
 *
 * Run with `node --test tests/` from the package directory. No browser, no
 * Harness process, no sqlite handle: `lib/pool/view.js` is plain functions over
 * ledger rows, and the cases below are the ones that cost a restart to
 * discover before this existed.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  POOL_VIEW_KEYS,
  SAVE_PATH_WIDTH,
  anchorBatchOf,
  batchNav,
  clipFront,
  countByStatus,
  displayWidth,
  formatCost,
  formatDuration,
  formatMoney,
  formatSavePath,
  isBatchDetail,
  missingViewKeys,
  outstandingOf,
  staleSeconds,
  taskDuration,
  typeNameMap,
} from '../lib/pool/view.js'

// --- batch anchoring -------------------------------------------------------

test('anchor uses currentBatchId while something is running', () => {
  assert.equal(anchorBatchOf({ currentBatchId: 5, latestBatchId: 12 }), 5)
})

test('anchor falls back to latestBatchId once drained', () => {
  // This is the drained-board case: currentBatchId is 0, and anchoring on it
  // would leave the board showing nothing instead of the last batch.
  assert.equal(anchorBatchOf({ currentBatchId: 0, latestBatchId: 12 }), 12)
})

test('anchor is 0 when the ledger is empty', () => {
  assert.equal(anchorBatchOf({ currentBatchId: 0, latestBatchId: 0 }), 0)
  assert.equal(anchorBatchOf(null), 0)
})

test('anchor tolerates missing fields', () => {
  assert.equal(anchorBatchOf({}), 0)
  assert.equal(anchorBatchOf({ latestBatchId: 7 }), 7)
})

// --- overview vs detail ----------------------------------------------------

test('an overview reply spanning batches is not a detail reply', () => {
  // The overview form returns the newest tasks across every batch. The board
  // must not mistake it for the detail of one batch, or it renders the whole
  // ledger — the defect that motivated this module.
  const overview = [
    { batch_id: 12 }, { batch_id: 11 }, { batch_id: 10 }, { batch_id: 9 },
  ]
  assert.equal(isBatchDetail(overview, 12), false)
})

test('a reply whose rows all belong to the wanted batch is a detail reply', () => {
  assert.equal(isBatchDetail([{ batch_id: 12 }], 12), true)
  assert.equal(isBatchDetail([{ batch_id: 12 }, { batch_id: 12 }], 12), true)
})

test('enrichment fields do not affect the overview/detail decision', () => {
  // The overview form is enriched with `outputs` so a drained board still shows
  // costs. Testing for that field is what made the old guard always true.
  const overview = [
    { batch_id: 12, outputs: [] }, { batch_id: 11, outputs: [] },
  ]
  assert.equal(isBatchDetail(overview, 12), false)
})

test('empty rows are never a detail reply', () => {
  assert.equal(isBatchDetail([], 12), false)
  assert.equal(isBatchDetail(null, 12), false)
  assert.equal(isBatchDetail(undefined, 12), false)
})

test('a non-numeric target is never a detail reply', () => {
  assert.equal(isBatchDetail([{ batch_id: 12 }], undefined), false)
  assert.equal(isBatchDetail([{ batch_id: 12 }], 'x'), false)
})

test('batch ids compare numerically, not as strings', () => {
  // sqlite may hand back numbers, JSON round-trips may not; both must match.
  assert.equal(isBatchDetail([{ batch_id: '12' }], 12), true)
  assert.equal(isBatchDetail([{ batch_id: 12 }], '12'), true)
})

// --- navigation ------------------------------------------------------------

test('nav follows the anchor when no batch is pinned', () => {
  const pool = { currentBatchId: 0, latestBatchId: 12, batches: [12, 11, 10] }
  const nav = batchNav(pool, null)
  assert.equal(nav.shownBatch, 12)
  assert.equal(nav.index, 0)
  assert.equal(nav.hasPrev, true, 'older batches exist')
  assert.equal(nav.hasNext, false, 'nothing newer')
  assert.equal(nav.isViewingAnchor, true)
})

test('nav walks older on Prev and newer on Next', () => {
  const pool = { currentBatchId: 0, latestBatchId: 12, batches: [12, 11, 10] }
  const nav = batchNav(pool, 11)
  assert.equal(nav.index, 1)
  assert.equal(nav.hasPrev, true, 'batch 10 is older')
  assert.equal(nav.hasNext, true, 'batch 12 is newer')
  assert.equal(nav.isViewingAnchor, false)
})

test('nav at the oldest batch has no Prev', () => {
  const pool = { latestBatchId: 12, batches: [12, 11, 10] }
  const nav = batchNav(pool, 10)
  assert.equal(nav.hasPrev, false)
  assert.equal(nav.hasNext, true)
})

test('nav pins a batch id that is absent from the list', () => {
  // Jumping to a number that holds no tasks: index is -1, both arrows stay off.
  const pool = { latestBatchId: 12, batches: [12, 11] }
  const nav = batchNav(pool, 7)
  assert.equal(nav.shownBatch, 7)
  assert.equal(nav.index, -1)
  assert.equal(nav.hasPrev, false)
  assert.equal(nav.hasNext, false)
})

test('nav skips gaps because it walks the real batch list', () => {
  // Batch 3 holds no tasks; Prev from 4 lands on 2, not on the missing 3.
  const pool = { latestBatchId: 4, batches: [4, 2, 1] }
  const nav = batchNav(pool, 4)
  assert.equal(nav.batches[nav.index + 1], 2)
})

// --- counts ----------------------------------------------------------------

test('countByStatus totals and buckets every row', () => {
  const tasks = [
    { status: 'SUCCESS' }, { status: 'SUCCESS' }, { status: 'FAILED' },
    { status: 'PENDING' }, { status: 'DISPATCHED' }, { status: 'SUBMIT_FAILED' },
    { status: 'CANCELLED' },
  ]
  const counts = countByStatus(tasks)
  assert.equal(counts.total, 7)
  assert.equal(counts.SUCCESS, 2)
  assert.equal(counts.FAILED, 1)
  assert.equal(counts.PENDING, 1)
  assert.equal(counts.DISPATCHED, 1)
  assert.equal(counts.SUBMIT_FAILED, 1)
  assert.equal(counts.CANCELLED, 1)
  assert.equal(outstandingOf(counts), 2, 'pending plus dispatched')
})

test('countByStatus ignores rows without a status', () => {
  assert.equal(countByStatus([{}, null, { status: 'SUCCESS' }]).total, 1)
  assert.equal(countByStatus([]).total, 0)
  assert.equal(countByStatus(null).total, 0)
})

// --- formatting ------------------------------------------------------------

test('formatDuration switches units at a minute and an hour', () => {
  assert.equal(formatDuration(0), '0s')
  assert.equal(formatDuration(59), '59s')
  assert.equal(formatDuration(60), '1m00s')
  assert.equal(formatDuration(184), '3m04s')
  assert.equal(formatDuration(3600), '1h00m')
  assert.equal(formatDuration(4320), '1h12m')
})

test('taskDuration marks a running task with an ellipsis', () => {
  const now = 1_000_000
  const finished = taskDuration({ created_at: now - 91_000, finished_at: now, status: 'SUCCESS' }, now)
  assert.equal(finished.text, '1m31s')
  assert.equal(finished.seconds, 91)

  // "Running" is now decided by status, not by a missing `finished_at`: a row
  // written before that column existed is terminal, not in progress.
  const running = taskDuration({ created_at: now - 5_000, status: 'DISPATCHED' }, now)
  assert.equal(running.text, '5s…')
})

test('taskDuration is a dash without a start time', () => {
  assert.equal(taskDuration({}, 1_000_000).text, '-')
  assert.equal(taskDuration({ created_at: 0 }, 1_000_000).text, '-')
})

test('formatCost joins only the non-zero components', () => {
  assert.equal(formatCost({ points: 25, money: 0, thirdParty: 0 }), '25 积分')
  assert.equal(formatCost({ points: 0, money: 0.1, thirdParty: 0 }), '¥0.10')
  assert.equal(formatCost({ points: 0, money: 0, thirdParty: 0.19 }), '¥0.19')
  assert.equal(formatCost({ points: 25, money: 0.1, thirdParty: 0.19 }), '25 积分 · ¥0.10 · ¥0.19')
  assert.equal(formatCost({ points: 0, money: 0, thirdParty: 0 }), null)
  assert.equal(formatCost(null), null)
})

test('formatCost ignores the retired RH coin', () => {
  // The platform no longer charges in RH coins. A record that still carries
  // the old field shows no fee rather than a currency that no longer exists.
  assert.equal(formatCost({ coins: 25, money: 0, thirdParty: 0 }), null)
  assert.equal(formatCost({ coins: 25, money: 0.1, thirdParty: 0 }), '¥0.10')
})

test('formatMoney keeps an unknown currency code', () => {
  assert.equal(formatMoney('1.5', 'USD'), '$1.50')
  assert.equal(formatMoney('1.5', 'CNY'), '¥1.50')
  assert.equal(formatMoney('1.5', 'EUR'), 'EUR 1.50')
})

// --- stale detection -------------------------------------------------------

test('a dispatched task silent for three intervals is stale', () => {
  const now = 1_000_000_000
  // pollIntervalSeconds 30 → threshold 90s, raised to the 180s floor.
  assert.equal(staleSeconds({ status: 'DISPATCHED', updated_at: now - 181_000 }, 30, now), 181)
  assert.equal(staleSeconds({ status: 'DISPATCHED', updated_at: now - 120_000 }, 30, now), null)
})

test('one missed poll is not enough to warn', () => {
  const now = 1_000_000_000
  // A long-running task is re-polled every interval and its row is rewritten
  // each time. Missing one poll — a slow query, a busy tick — must stay quiet.
  assert.equal(staleSeconds({ status: 'DISPATCHED', updated_at: now - 60_000 }, 30, now), null)
  assert.equal(staleSeconds({ status: 'DISPATCHED', updated_at: now - 120_000 }, 30, now), null)
})

test('the stale threshold never drops below three minutes', () => {
  const now = 1_000_000_000
  // pollIntervalSeconds 5 → 15s, raised to the 180s floor.
  assert.equal(staleSeconds({ status: 'DISPATCHED', updated_at: now - 120_000 }, 5, now), null)
  assert.equal(staleSeconds({ status: 'DISPATCHED', updated_at: now - 181_000 }, 5, now), 181)
})

test('a pending task measures silence from its creation', () => {
  const now = 1_000_000_000
  // Same 180s floor applies to a row waiting for a slot.
  assert.equal(staleSeconds({ status: 'PENDING', created_at: now - 200_000 }, 30, now), 200)
  assert.equal(staleSeconds({ status: 'PENDING', created_at: now - 120_000 }, 30, now), null)
})

test('terminal and undated tasks are never stale', () => {
  const now = 1_000_000_000
  assert.equal(staleSeconds({ status: 'SUCCESS', updated_at: now - 600_000 }, 30, now), null)
  assert.equal(staleSeconds({ status: 'DISPATCHED' }, 30, now), null)
})

// --- contract --------------------------------------------------------------

test('a complete reply has no missing keys', () => {
  const reply = {
    currentBatchId: 0, latestBatchId: 12, batches: [12], counts: { total: 1 }, tasks: [],
  }
  assert.deepEqual(missingViewKeys(reply), [])
})

test('a reply missing batches or latestBatchId is reported', () => {
  // This is the shape defect that made the board render the whole ledger: the
  // Host returned `allBatches` while the board read `batches`.
  assert.deepEqual(
    missingViewKeys({ currentBatchId: 0, counts: {}, tasks: [] }),
    ['latestBatchId', 'batches'],
  )
})

test('a null reply misses every key', () => {
  assert.deepEqual(missingViewKeys(null), POOL_VIEW_KEYS)
})

// --- the 保存位置 cell -----------------------------------------------------

test('the saved-path cell is built from local paths only', () => {
  // Remote URLs are deliberately ignored: "saved where" means a file the user
  // can open, and a row whose download failed has no local path.
  const saved = formatSavePath([
    { ok: 1, path: 'E:\\out\\a.png', url: 'https://example.com/a.png', node_id: '461' },
  ])
  assert.equal(saved, 'E:\\out\\a.png')
})

test('a task with no outputs reads as a dash', () => {
  assert.equal(formatSavePath([]), '-')
  assert.equal(formatSavePath(undefined), '-')
})

test('a task whose downloads all failed says so', () => {
  // `ok` is the SQLite integer 0/1, which is why a strict `=== true` test
  // matched nothing and every row once read "—".
  assert.equal(formatSavePath([{ ok: 0, path: null, error: 'empty download' }]), '下载失败')
})

test('a failed row beside a saved one still shows the saved path', () => {
  const text = formatSavePath([
    { ok: 0, path: null, node_id: '13' },
    { ok: 1, path: 'E:\\out\\ok.flac', node_id: '4' },
  ])
  assert.ok(text.includes('ok.flac'))
  assert.ok(!text.includes('下载失败'))
})

test('multiple saved outputs are node-tagged and joined', () => {
  const text = formatSavePath([
    { ok: 1, path: 'E:\\out\\vocals.flac', node_id: '4' },
    { ok: 1, path: 'E:\\out\\instruments.flac', node_id: '5' },
  ])
  assert.equal(text, '4:E:\\out\\vocals.flac ; 5:E:\\out\\instruments.flac')
})

test('a single saved output is not node-tagged', () => {
  const text = formatSavePath([{ ok: 1, path: 'E:\\out\\one.mp4', node_id: '131' }])
  assert.ok(!text.includes('131:'))
})

test('a long path is clipped from the front, keeping the tail', () => {
  const full = 'E:\\2026\\dsh-plugins\\output\\media\\runninghub\\batch-12\\21_214_0.mp4'
  const clipped = clipFront(full, 30)
  assert.equal(displayWidth(clipped), 30)
  assert.ok(clipped.startsWith('…'))
  assert.ok(clipped.endsWith('21_214_0.mp4'))
  assert.ok(clipped.length < full.length)
})

test('a path that fits is returned untouched', () => {
  const short = 'E:\\out\\a.png'
  assert.equal(clipFront(short, 48), short)
  assert.equal(clipFront(short, 1000), short)
})

test('the default clip budget matches pool.py', () => {
  assert.equal(SAVE_PATH_WIDTH, 48)
})

test('display width counts CJK as two columns', () => {
  assert.equal(displayWidth('ab'), 2)
  assert.equal(displayWidth('中文'), 4)
  assert.equal(displayWidth(''), 0)
})

test('clipping respects display width for CJK tails', () => {
  const clipped = clipFront('E:\\输出\\批次\\结果.png', 10)
  assert.equal(displayWidth(clipped), 10)
  assert.ok(clipped.endsWith('结果.png') || clipped.endsWith('.png'))
})

// --- type display names ----------------------------------------------------

test('typeNameMap maps ids to display names', () => {
  const map = typeNameMap([
    { typeId: 'image-gen-qwen', displayName: 'Qwen Image 2.1 文生图' },
    { typeId: 'digital-human', displayName: '数字人生成' },
  ])
  assert.equal(map.get('image-gen-qwen'), 'Qwen Image 2.1 文生图')
  assert.equal(map.get('digital-human'), '数字人生成')
  assert.equal(map.size, 2)
})

test('typeNameMap skips entries it cannot name', () => {
  // A catalogue row with no displayName leaves the board showing the raw id
  // rather than an empty cell, so it must not enter the map at all.
  const map = typeNameMap([
    { typeId: 'a', displayName: '' },
    { typeId: 'b' },
    { displayName: 'no id' },
    null,
    'not an object',
  ])
  assert.equal(map.size, 0)
})

test('typeNameMap tolerates a non-array input', () => {
  assert.equal(typeNameMap(undefined).size, 0)
  assert.equal(typeNameMap(null).size, 0)
  assert.equal(typeNameMap({}).size, 0)
})

// --- duration --------------------------------------------------------------

test('a terminal row without finished_at ends at its last write', () => {
  // Rows written before the column existed carry NULL there. Treating that as
  // "still running" is the bug this case pins down: it printed `5m00s…` for a
  // task that had finished an hour ago.
  const now = 1_000_000_000
  const task = { created_at: now - 300_000, updated_at: now - 240_000, status: 'SUCCESS' }
  assert.deepEqual(taskDuration(task, now), { seconds: 60, text: '1m00s' })
})

test('a terminal row prefers finished_at over updated_at', () => {
  const now = 1_000_000_000
  const task = { created_at: now - 300_000, updated_at: now - 240_000, finished_at: now - 250_000, status: 'SUCCESS' }
  assert.deepEqual(taskDuration(task, now), { seconds: 50, text: '50s' })
})

test('an outstanding row measures against the clock and marks itself', () => {
  const now = 1_000_000_000
  for (const status of ['PENDING', 'DISPATCHED']) {
    const task = { created_at: now - 300_000, updated_at: now - 20_000, status }
    const out = taskDuration(task, now)
    assert.equal(out.seconds, 300, status)
    assert.ok(out.text.endsWith('…'), status)
    assert.ok(out.text.startsWith('5m00s'), status)
  }
})

test('a terminal row with no usable end reads as a dash', () => {
  const now = 1_000_000_000
  assert.equal(taskDuration({ created_at: now - 300_000, status: 'FAILED' }, now).text, '-')
})

test('a row with no start time reads as a dash', () => {
  assert.equal(taskDuration({ status: 'SUCCESS' }, 1_000_000_000).text, '-')
  assert.equal(taskDuration(null, 1_000_000_000).text, '-')
})

// --- watcher resume decision -----------------------------------------------

test('outstandingOf counts only the two live states', () => {
  // resumeOutstanding starts the watcher exactly when this is > 0, so the
  // counting rule is what decides whether a restart recovers anything.
  assert.equal(outstandingOf({ PENDING: 2, DISPATCHED: 3 }), 5)
  assert.equal(outstandingOf({ PENDING: 0, DISPATCHED: 0, SUCCESS: 9 }), 0)
  assert.equal(outstandingOf({}), 0)
  assert.equal(outstandingOf(null), 0)
})

test('a drained ledger reports nothing to resume', () => {
  // The real ledger shape after a clean run: every row terminal.
  const counts = { total: 28, PENDING: 0, DISPATCHED: 0, SUCCESS: 19, FAILED: 8, SUBMIT_FAILED: 2, CANCELLED: 1 }
  assert.equal(outstandingOf(counts), 0)
})

test('one in-flight row is enough to need a resume', () => {
  // This is the restart case: the watcher is gone but one row is still
  // DISPATCHED, so nothing will ever poll it without a fresh watcher.
  const counts = { total: 28, PENDING: 0, DISPATCHED: 1, SUCCESS: 27 }
  assert.equal(outstandingOf(counts), 1)
})

// --- reply shape -----------------------------------------------------------

test('the shape of a reply changes when the pool changes', async () => {
  const { poolShape } = await import('../lib/pool/view.js')
  const base = {
    status: 'ok',
    currentBatchId: 3,
    latestBatchId: 12,
    counts: { total: 2, PENDING: 0, DISPATCHED: 1, SUCCESS: 1 },
    tasks: [{ id: 10, status: 'DISPATCHED' }, { id: 9, status: 'SUCCESS' }],
  }
  assert.equal(poolShape(base), poolShape({ ...base, tasks: [...base.tasks] }))
  assert.notEqual(poolShape(base), poolShape({ ...base, currentBatchId: 4 }))
  assert.notEqual(poolShape(base), poolShape({ ...base, counts: { ...base.counts, PENDING: 1 } }))
  assert.notEqual(poolShape(base), poolShape({ ...base, tasks: [{ id: 10, status: 'SUCCESS' }, { id: 9, status: 'SUCCESS' }] }))
})

test('the shape of a reply is null when there is no reply', async () => {
  const { poolShape } = await import('../lib/pool/view.js')
  assert.equal(poolShape(null), null)
  assert.equal(poolShape(undefined), null)
  assert.equal(poolShape('nope'), null)
})

// --- concurrency budget ----------------------------------------------------

test('the dispatch budget honours the concurrency ceiling', async () => {
  const { dispatchBudget } = await import('../lib/pool/view.js')
  const pending = (n) => Array.from({ length: n }, (_, i) => ({ id: i + 1, status: 'PENDING', task_id: null }))
  const flying = (n) => Array.from({ length: n }, (_, i) => ({ id: 100 + i, status: 'DISPATCHED', task_id: `t${i}` }))

  // Nothing in flight: the ceiling is the whole budget.
  assert.equal(dispatchBudget([...pending(5)], 2).dispatch, 2)
  assert.equal(dispatchBudget([...pending(5)], 2).free, 2)

  // Two already flying with a ceiling of two: nothing may be dispatched.
  assert.equal(dispatchBudget([...flying(2), ...pending(5)], 2).dispatch, 0)
  assert.equal(dispatchBudget([...flying(2), ...pending(5)], 2).free, 0)

  // One of two slots free: exactly one goes out.
  assert.equal(dispatchBudget([...flying(1), ...pending(5)], 2).dispatch, 1)

  // A row that is DISPATCHED but has no task id does not occupy a slot.
  assert.equal(dispatchBudget([{ id: 1, status: 'DISPATCHED', task_id: null }, ...pending(3)], 2).dispatch, 2)

  // Fewer pending than the ceiling: only what exists is dispatched.
  assert.equal(dispatchBudget([...pending(1)], 10).dispatch, 1)
})

test('the dispatch budget refuses an unusable ceiling', async () => {
  const { dispatchBudget } = await import('../lib/pool/view.js')
  const pending = (n) => Array.from({ length: n }, (_, i) => ({ id: i + 1, status: 'PENDING', task_id: null }))

  // A missing or broken limit falls back to 2, never to "no limit".
  for (const bad of [undefined, null, 0, -1, NaN, 'x']) {
    const b = dispatchBudget([...pending(9)], bad)
    assert.equal(b.ceiling, 2, `ceiling for ${String(bad)}`)
    assert.equal(b.dispatch, 2, `dispatch for ${String(bad)}`)
  }
})
