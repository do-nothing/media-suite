/**
 * Parity test: the pure logic duplicated inside client.js must behave exactly
 * like lib/pool/view.js.
 *
 * A client bundle runs in a lazy-CJS factory that cannot load a relative file,
 * and this package has no build step, so the board carries its own copy of these
 * helpers. That copy is the one that actually renders; if it drifts from
 * `view.js`, the tests on `view.js` stop proving anything about the page.
 *
 * The block is extracted from client.js source rather than imported, because the
 * file is not a module — it is a script that calls `window.__ModuleLoader__.load`.
 * Extraction is deliberate and narrow: everything between the two markers is
 * plain function declarations and one const, evaluated in a fresh function scope.
 *
 * Run: `node tests/client-parity.test.mjs`
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import * as view from '../lib/pool/view.js'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, '..', 'client.js'), 'utf8')

const BEGIN = '// --- pure view logic'
const END = '// --- end pure view logic'

function extractBlock() {
  const start = source.indexOf(BEGIN)
  const stop = source.indexOf(END)
  assert.ok(start >= 0, 'client.js must carry the pure view logic block')
  assert.ok(stop > start, 'the block must be closed by its end marker')
  return source.slice(start, stop)
}

/** The client's copy of the helpers, evaluated in an isolated scope. */
function loadClientLogic() {
  const block = extractBlock()
  // The block declares functions and one const; run it and hand back the names.
  const factory = new Function(`${block}
    return { POOL_VIEW_KEYS, SAVE_PATH_WIDTH, anchorBatchOf, isBatchDetail, batchNav, countByStatus,
             outstandingOf, formatDuration, taskDuration, staleSeconds,
             clipFront, displayWidth, formatSavePath }
  `)
  return factory()
}

const client = loadClientLogic()

test('the block exists and exposes the expected helpers', () => {
  for (const name of ['anchorBatchOf', 'isBatchDetail', 'batchNav', 'countByStatus',
    'outstandingOf', 'formatDuration', 'taskDuration', 'staleSeconds',
    'clipFront', 'displayWidth', 'formatSavePath']) {
    assert.equal(typeof client[name], 'function', `${name} must be declared in client.js`)
  }
  assert.deepEqual(client.POOL_VIEW_KEYS, view.POOL_VIEW_KEYS)
  assert.equal(client.SAVE_PATH_WIDTH, view.SAVE_PATH_WIDTH)
})

test('anchorBatchOf matches', () => {
  for (const pool of [
    null,
    {},
    { currentBatchId: 5, latestBatchId: 12 },
    { currentBatchId: 0, latestBatchId: 12 },
    { currentBatchId: 0, latestBatchId: 0 },
    { latestBatchId: 7 },
  ]) {
    assert.equal(client.anchorBatchOf(pool), view.anchorBatchOf(pool), JSON.stringify(pool))
  }
})

test('isBatchDetail matches, including the overview case that caused the bug', () => {
  const cases = [
    [[{ batch_id: 12 }, { batch_id: 11 }], 12],
    [[{ batch_id: 12 }], 12],
    [[{ batch_id: '12' }], 12],
    [[], 12],
    [null, 12],
    [[{ batch_id: 12, outputs: [] }, { batch_id: 11, outputs: [] }], 12],
    [[{ batch_id: 12 }], undefined],
  ]
  for (const [rows, desired] of cases) {
    assert.equal(
      client.isBatchDetail(rows, desired),
      view.isBatchDetail(rows, desired),
      JSON.stringify({ rows, desired }),
    )
  }
})

test('batchNav matches', () => {
  const pools = [
    { currentBatchId: 0, latestBatchId: 12, batches: [12, 11, 10] },
    { currentBatchId: 0, latestBatchId: 4, batches: [4, 2, 1] },
    { latestBatchId: 12, batches: [12, 11] },
  ]
  for (const pool of pools) {
    for (const pinned of [null, undefined, 12, 11, 10, 7]) {
      assert.deepEqual(
        client.batchNav(pool, pinned),
        view.batchNav(pool, pinned),
        JSON.stringify({ pool, pinned }),
      )
    }
  }
})

test('countByStatus matches', () => {
  const tasks = [
    { status: 'SUCCESS' }, { status: 'FAILED' }, { status: 'PENDING' },
    { status: 'DISPATCHED' }, { status: 'SUBMIT_FAILED' }, { status: 'CANCELLED' },
    {}, null,
  ]
  assert.deepEqual(client.countByStatus(tasks), view.countByStatus(tasks))
  assert.deepEqual(client.countByStatus(null), view.countByStatus(null))
})

test('outstandingOf matches', () => {
  for (const counts of [{ PENDING: 2, DISPATCHED: 1 }, {}, null]) {
    assert.equal(client.outstandingOf(counts), view.outstandingOf(counts))
  }
})

test('formatDuration matches', () => {
  for (const seconds of [0, 59, 60, 184, 3600, 4320, -5, null]) {
    assert.equal(client.formatDuration(seconds), view.formatDuration(seconds), String(seconds))
  }
})

test('taskDuration matches', () => {
  const now = 1_000_000
  const cases = [
    { created_at: now - 91_000, finished_at: now },
    { created_at: now - 5_000 },
    { created_at: now - 1000, finished_at: 0 },
    {},
    { created_at: 0 },
  ]
  for (const task of cases) {
    assert.deepEqual(client.taskDuration(task, now), view.taskDuration(task, now), JSON.stringify(task))
  }
})

test('staleSeconds matches', () => {
  const now = 1_000_000_000
  const cases = [
    [{ status: 'DISPATCHED', updated_at: now - 61_000 }, 30],
    [{ status: 'DISPATCHED', updated_at: now - 30_000 }, 30],
    [{ status: 'DISPATCHED', updated_at: now - 61_000 }, 5],
    [{ status: 'PENDING', created_at: now - 120_000 }, 30],
    [{ status: 'SUCCESS', updated_at: now - 600_000 }, 30],
    [{ status: 'DISPATCHED' }, 30],
  ]
  for (const [task, poll] of cases) {
    assert.equal(
      client.staleSeconds(task, poll, now),
      view.staleSeconds(task, poll, now),
      JSON.stringify({ task, poll }),
    )
  }
})

test('clipFront and displayWidth match', () => {
  const cases = [
    ['E:\\2026\\dsh-plugins\\output\\media\\runninghub\\batch-12\\21_214_0.mp4', 30],
    ['E:\\out\\a.png', 48],
    ['E:\\输出\\批次\\结果.png', 10],
    ['', 10],
    ['abcdef', 1],
    ['abcdef', 100],
  ]
  for (const [text, width] of cases) {
    assert.equal(client.clipFront(text, width), view.clipFront(text, width), JSON.stringify({ text, width }))
    assert.equal(client.displayWidth(text), view.displayWidth(text), JSON.stringify(text))
  }
})

test('formatSavePath matches', () => {
  const cases = [
    [],
    [{ ok: 1, path: 'E:\\out\\a.png', url: 'https://x/a.png', node_id: '461' }],
    [{ ok: 0, path: null, error: 'empty download' }],
    [{ ok: 0, path: null, node_id: '13' }, { ok: 1, path: 'E:\\out\\ok.flac', node_id: '4' }],
    [{ ok: 1, path: 'E:\\out\\vocals.flac', node_id: '4' }, { ok: 1, path: 'E:\\out\\instruments.flac', node_id: '5' }],
    [{ ok: 1, path: 'E:\\out\\one.mp4', node_id: '131' }],
  ]
  for (const outputs of cases) {
    assert.equal(client.formatSavePath(outputs), view.formatSavePath(outputs), JSON.stringify(outputs))
  }
})
