/**
 * Tests for the ledger's batch queries, against a scratch sqlite database.
 *
 * These cover the batch rules that are easy to get wrong and expensive to
 * discover by restarting the app: which batch a new job joins, what the board
 * anchors on, and how the batch list looks with gaps.
 *
 * `store.js` resolves its database path from the package directory at import
 * time, so this test does not import it. It exercises the same SQL through a
 * temporary database instead, which also keeps the real ledger untouched.
 *
 * Run: `node tests/store-batches.test.mjs`
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** The tasks schema, mirroring store.js. */
const SCHEMA = `
CREATE TABLE tasks (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id      INTEGER NOT NULL,
  type_id       TEXT    NOT NULL,
  workflow_id   TEXT    NOT NULL,
  instance_type TEXT    NOT NULL,
  task_id       TEXT,
  request_json  TEXT    NOT NULL,
  node_json     TEXT    NOT NULL,
  params_json   TEXT    NOT NULL,
  output_dir    TEXT,
  output_name   TEXT,
  output_root   TEXT,
  status        TEXT    NOT NULL DEFAULT 'PENDING',
  rh_status     TEXT,
  session_id    TEXT,
  error_code    TEXT,
  error_message TEXT,
  cost_json     TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
)`

/** A fresh in-memory ledger for one test. */
function ledger() {
  const db = new DatabaseSync(':memory:')
  db.exec(SCHEMA)
  return db
}

function insert(db, batchId, status, extra = {}) {
  const ts = extra.created_at ?? 1_000
  db.prepare(`
    INSERT INTO tasks (batch_id, type_id, workflow_id, instance_type, request_json,
                       node_json, params_json, status, created_at, updated_at)
    VALUES (?, 'image-gen-qwen', 'wf', 'default', '{}', '[]', '{}', ?, ?, ?)
  `).run(batchId, status, ts, extra.updated_at ?? ts)
}

// --- the three batch queries, as store.js writes them ----------------------

const currentBatchId = (db) =>
  db.prepare("SELECT MAX(batch_id) AS b FROM tasks WHERE status IN ('PENDING','DISPATCHED')").get()?.b ?? 0
const latestBatchId = (db) =>
  db.prepare('SELECT MAX(batch_id) AS b FROM tasks').get()?.b ?? 0
const batches = (db) =>
  db.prepare('SELECT DISTINCT batch_id AS b FROM tasks ORDER BY b DESC').all().map((r) => Number(r.b))

/** The enqueue rule after the fix: join the highest still-open batch, else open the next. */
function nextBatchFor(db) {
  const openRow = db.prepare("SELECT MAX(batch_id) AS b FROM tasks WHERE status IN ('PENDING','DISPATCHED')").get()
  const maxRow = db.prepare('SELECT COALESCE(MAX(batch_id), 0) AS b FROM tasks').get()
  return openRow?.b ?? (maxRow?.b ?? 0) + 1
}

/** The rule before the fix: highest batch over the whole table while anything is open. */
function nextBatchBeforeFix(db) {
  const row = db.prepare('SELECT MAX(batch_id) AS b FROM tasks').get()
  const outstanding = db.prepare("SELECT COUNT(*) AS c FROM tasks WHERE status IN ('PENDING','DISPATCHED')").get()
  return outstanding.c > 0 ? (row.b ?? 1) : (row.b ?? 0) + 1
}

test('an empty ledger opens batch 1', () => {
  const db = ledger()
  assert.equal(nextBatchFor(db), 1)
  assert.equal(currentBatchId(db), 0)
  assert.equal(latestBatchId(db), 0)
})

test('a drained ledger opens the next batch', () => {
  const db = ledger()
  insert(db, 1, 'SUCCESS')
  insert(db, 2, 'SUCCESS')
  assert.equal(nextBatchFor(db), 3)
  assert.equal(currentBatchId(db), 0, 'nothing is open')
  assert.equal(latestBatchId(db), 2)
})

test('a job joins the open batch instead of opening a new one', () => {
  const db = ledger()
  insert(db, 1, 'SUCCESS')
  insert(db, 2, 'DISPATCHED')
  assert.equal(nextBatchFor(db), 2, 'batch 2 still has work')
})

test('a requeued task keeps its old batch, and the next job joins it', () => {
  // `requeue` copies a finished task's batch id, so a lower batch can reopen
  // while a higher one is already drained. The fix joins the open batch; the
  // old rule joined the drained one and split the batch in two.
  const db = ledger()
  insert(db, 5, 'SUCCESS')
  insert(db, 6, 'SUCCESS')
  insert(db, 5, 'PENDING') // the requeued row

  assert.equal(latestBatchId(db), 6, 'highest id in the ledger')
  assert.equal(currentBatchId(db), 5, 'the only batch with work')
  assert.equal(nextBatchFor(db), 5, 'a new job joins the batch that is actually open')
  assert.equal(nextBatchBeforeFix(db), 6, 'the old rule picked the drained batch — the bug')
})

test('the batch list skips ids that hold no tasks', () => {
  const db = ledger()
  insert(db, 1, 'SUCCESS')
  insert(db, 2, 'SUCCESS')
  insert(db, 4, 'SUCCESS') // 3 holds nothing, e.g. every task was rejected
  assert.deepEqual(batches(db), [4, 2, 1])
})

test('the batch list is empty for an empty ledger', () => {
  assert.deepEqual(batches(ledger()), [])
})

test('board anchoring follows current, then latest, then nothing', () => {
  const db = ledger()
  insert(db, 1, 'SUCCESS')
  insert(db, 2, 'DISPATCHED')
  // currentBatchId wins while work is open
  assert.equal(currentBatchId(db) || latestBatchId(db), 2)

  const drained = ledger()
  insert(drained, 1, 'SUCCESS')
  insert(drained, 2, 'SUCCESS')
  // drained: current is 0, so latest carries the board
  assert.equal(currentBatchId(drained) || latestBatchId(drained), 2)

  assert.equal(currentBatchId(ledger()) || latestBatchId(ledger()), 0)
})

test('a batch detail holds only its own rows', () => {
  const db = ledger()
  insert(db, 11, 'SUCCESS')
  insert(db, 12, 'SUCCESS')
  insert(db, 12, 'SUCCESS')
  const rows = db.prepare('SELECT * FROM tasks WHERE batch_id = ? ORDER BY id').all(12)
  assert.equal(rows.length, 2)
  assert.ok(rows.every((r) => r.batch_id === 12))
})
