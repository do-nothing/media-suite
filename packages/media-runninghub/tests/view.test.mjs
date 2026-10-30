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
  anchorBatchOf,
  batchNav,
  countByStatus,
  formatCost,
  formatDuration,
  formatMoney,
  isBatchDetail,
  missingViewKeys,
  outstandingOf,
  staleSeconds,
  taskDuration,
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
  const finished = taskDuration({ created_at: now - 91_000, finished_at: now }, now)
  assert.equal(finished.text, '1m31s')
  assert.equal(finished.seconds, 91)

  const running = taskDuration({ created_at: now - 5_000 }, now)
  assert.equal(running.text, '5s…')
})

test('taskDuration is a dash without a start time', () => {
  assert.equal(taskDuration({}, 1_000_000).text, '-')
  assert.equal(taskDuration({ created_at: 0 }, 1_000_000).text, '-')
})

test('formatCost joins only the non-zero components', () => {
  assert.equal(formatCost({ coins: 25, money: 0, thirdParty: 0 }), '25 RH')
  assert.equal(formatCost({ coins: 0, money: 0.1, thirdParty: 0 }), '¥0.10')
  assert.equal(formatCost({ coins: 0, money: 0, thirdParty: 0.19 }), '¥0.19')
  assert.equal(formatCost({ coins: 25, money: 0.1, thirdParty: 0.19 }), '25 RH · ¥0.10 · ¥0.19')
  assert.equal(formatCost({ coins: 0, money: 0, thirdParty: 0 }), null)
  assert.equal(formatCost(null), null)
})

test('formatMoney keeps an unknown currency code', () => {
  assert.equal(formatMoney('1.5', 'USD'), '$1.50')
  assert.equal(formatMoney('1.5', 'CNY'), '¥1.50')
  assert.equal(formatMoney('1.5', 'EUR'), 'EUR 1.50')
})

// --- stale detection -------------------------------------------------------

test('a dispatched task silent for two intervals is stale', () => {
  const now = 1_000_000_000
  // pollIntervalSeconds 30 → threshold 60s.
  assert.equal(staleSeconds({ status: 'DISPATCHED', updated_at: now - 61_000 }, 30, now), 61)
  assert.equal(staleSeconds({ status: 'DISPATCHED', updated_at: now - 30_000 }, 30, now), null)
})

test('the stale threshold never drops below a minute', () => {
  const now = 1_000_000_000
  // pollIntervalSeconds 5 → 10s, raised to the 60s floor.
  assert.equal(staleSeconds({ status: 'DISPATCHED', updated_at: now - 20_000 }, 5, now), null)
  assert.equal(staleSeconds({ status: 'DISPATCHED', updated_at: now - 61_000 }, 5, now), 61)
})

test('a pending task measures silence from its creation', () => {
  const now = 1_000_000_000
  assert.equal(staleSeconds({ status: 'PENDING', created_at: now - 120_000 }, 30, now), 120)
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
