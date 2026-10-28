/**
 * The task-pool ledger: a shared-global SQLite database in the package's
 * `data/pool/` directory (gitignored).
 *
 * One database serves every session: batches are derived from the task rows
 * (crash-safe), each task records the session that submitted it, and the
 * watcher polls every outstanding task regardless of which session owns it.
 */

import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
export const POOL_DIR = join(PKG_DIR, 'data', 'pool')
export const DB_PATH = join(POOL_DIR, 'pool.sqlite')

const SCHEMA = `
CREATE TABLE IF NOT EXISTS schema_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tasks (
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
);
CREATE INDEX IF NOT EXISTS idx_tasks_batch  ON tasks (batch_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks (status);
CREATE TABLE IF NOT EXISTS outputs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  task_row   INTEGER NOT NULL REFERENCES tasks (id),
  node_id    TEXT    NOT NULL,
  url        TEXT    NOT NULL,
  output_type TEXT   NOT NULL,
  path       TEXT,
  size       INTEGER,
  ok         INTEGER NOT NULL DEFAULT 1,
  error      TEXT
);
CREATE INDEX IF NOT EXISTS idx_outputs_task ON outputs (task_row);
CREATE TABLE IF NOT EXISTS uploads (
  cache_key  TEXT PRIMARY KEY,
  rh_file    TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
`

let dbPromise = null

/** Open (and migrate) the ledger once; later calls reuse the same handle. */
async function open() {
  if (dbPromise) return dbPromise
  dbPromise = (async () => {
    await mkdir(dirname(DB_PATH), { recursive: true })
    const { DatabaseSync } = await import('node:sqlite')
    const db = new DatabaseSync(DB_PATH)
    db.exec(SCHEMA)
    db.prepare("INSERT OR IGNORE INTO schema_meta (key, value) VALUES ('schema', '1')").run()
    return db
  })()
  return dbPromise
}

function now() {
  return Date.now()
}

/**
 * Enqueue resolved jobs. While any task is outstanding the new jobs join the
 * open batch; only a drained pool opens the next batch.
 *
 * @param jobs - resolved jobs from buildPayload(): { typeId, workflowId,
 *   instanceType, nodeOverrides, params, request, outputDir?, outputName?,
 *   outputRoot } — outputRoot is the submitting session's output directory,
 *   where the batch subdirectory is created when this task finishes.
 * @param sessionId - the submitting session (for the wake record).
 * @returns { ids: number[], batchId: number }
 */
/** Coerce a bind value to a SQLite-safe scalar, or null when absent. */
function scalar(value) {
  if (value === null || value === undefined) return null
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint' ? value : String(value)
}

export async function enqueue(jobs, sessionId) {
  const db = await open()
  const row = db.prepare('SELECT MAX(batch_id) AS b FROM tasks').get()
  const outstanding = db.prepare("SELECT COUNT(*) AS c FROM tasks WHERE status IN ('PENDING','DISPATCHED')").get()
  // While a batch is open, new jobs join it; only a drained pool opens the next.
  const batchId = outstanding.c > 0 ? (row.b ?? 1) : (row.b ?? 0) + 1
  const ids = []
  const ts = now()
  const insert = db.prepare(`
    INSERT INTO tasks (batch_id, type_id, workflow_id, instance_type, request_json,
                       node_json, params_json, output_dir, output_name, output_root,
                       status, session_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?)
  `)
  const sid = scalar(sessionId)
  for (const job of jobs) {
    const info = insert.run(
      scalar(batchId), scalar(job.typeId), scalar(job.workflowId), scalar(job.instanceType),
      scalar(JSON.stringify(job.request)), scalar(JSON.stringify(job.nodeOverrides)), scalar(JSON.stringify(job.params)),
      scalar(job.outputDir), scalar(job.outputName), scalar(job.outputRoot),
      sid, ts, ts,
    )
    ids.push(Number(info.lastInsertRowid))
  }
  return { ids, batchId }
}

/** Record the RunningHub taskId for a dispatched task row. */
export async function setDispatched(rowId, taskId) {
  const db = await open()
  db.prepare("UPDATE tasks SET task_id = ?, status = 'DISPATCHED', updated_at = ? WHERE id = ?")
    .run(taskId, now(), rowId)
}

/** Record a submit-level failure (RunningHub refused the create call). */
export async function setSubmitFailed(rowId, result) {
  const db = await open()
  db.prepare(`
    UPDATE tasks SET status = 'SUBMIT_FAILED', error_code = ?, error_message = ?, updated_at = ?
    WHERE id = ?
  `).run(result.errorCode ?? null, `[${result.errorType}] ${result.errorMessage}`, now(), rowId)
}

/** Record a terminal poll result (SUCCESS or FAILED) with costs. */
export async function setTerminal(rowId, result) {
  const db = await open()
  db.prepare(`
    UPDATE tasks SET status = ?, rh_status = ?, error_code = ?, error_message = ?, cost_json = ?, updated_at = ?
    WHERE id = ?
  `).run(
    result.status, result.rhStatus ?? null, result.errorCode ?? null, result.errorMessage ?? null,
    result.costs === undefined ? null : JSON.stringify(result.costs), now(), rowId,
  )
}

/** Record the live RunningHub status without ending the task. */
export async function setRhStatus(rowId, rhStatus) {
  const db = await open()
  db.prepare('UPDATE tasks SET rh_status = ?, updated_at = ? WHERE id = ?')
    .run(rhStatus ?? null, now(), rowId)
}

/** Record one poll result for a task row. */
export async function setPollResult(rowId, { status, rhStatus, errorCode, errorMessage, costs }) {
  const db = await open()
  db.prepare(`
    UPDATE tasks SET status = ?, rh_status = ?, error_code = ?, error_message = ?, cost_json = ?, updated_at = ?
    WHERE id = ?
  `).run(
    status, rhStatus ?? null, errorCode ?? null, errorMessage ?? null,
    costs === undefined ? null : JSON.stringify(costs), now(), rowId,
  )
}

/** Record one downloaded output file. */
export async function addOutput(taskRowId, output) {
  const db = await open()
  db.prepare(`
    INSERT INTO outputs (task_row, node_id, url, output_type, path, size, ok, error)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    taskRowId, output.nodeId, output.url, output.outputType,
    output.path ?? null, output.size ?? null, output.ok === true ? 1 : 0, output.error ?? null,
  )
}

/** All outstanding (non-terminal) task rows, across every batch and session. */
export async function outstandingTasks() {
  const db = await open()
  return db.prepare(`
    SELECT * FROM tasks WHERE status IN ('PENDING', 'DISPATCHED') ORDER BY id
  `).all()
}

/** One task row by its ledger id. */
export async function taskById(rowId) {
  const db = await open()
  return db.prepare('SELECT * FROM tasks WHERE id = ?').get(rowId) ?? null
}

/** The batch that still has outstanding tasks, or null when the pool drained. */
export async function currentBatchId() {
  const db = await open()
  const row = db.prepare("SELECT MAX(batch_id) AS b FROM tasks WHERE status IN ('PENDING','DISPATCHED')").get()
  return row?.b ?? null
}

/** Overview for the status tool: current batch, counts, and the newest tasks. */
export async function overview(limit = 20) {
  const db = await open()
  const counts = { total: 0, PENDING: 0, DISPATCHED: 0, SUCCESS: 0, FAILED: 0, SUBMIT_FAILED: 0 }
  for (const row of db.prepare('SELECT status, COUNT(*) AS c FROM tasks GROUP BY status').all()) {
    counts.total += row.c
    if (row.status in counts) counts[row.status] = row.c
  }
  const tasks = db.prepare('SELECT * FROM tasks ORDER BY id DESC LIMIT ?').all(limit)
  return { currentBatchId: await currentBatchId(), counts, tasks }
}

/** Every task in one batch, plus its outputs. */
export async function batchDetail(batchId) {
  const db = await open()
  const tasks = db.prepare('SELECT * FROM tasks WHERE batch_id = ? ORDER BY id').all(batchId)
  for (const task of tasks) {
    task.outputs = db.prepare('SELECT * FROM outputs WHERE task_row = ? ORDER BY id').all(task.id)
    task.params = safeParse(task.params_json)
    task.costs = safeParse(task.cost_json)
  }
  return tasks
}

/** Distinct sessions that submitted tasks into one batch (for wake records). */
export async function batchSessions(batchId) {
  const db = await open()
  return db.prepare(`
    SELECT DISTINCT session_id AS s FROM tasks
    WHERE batch_id = ? AND session_id IS NOT NULL AND session_id != ''
  `).all(batchId).map((r) => r.s)
}

/** Cached upload lookup: one cache key → rh file name. */
export async function cachedUpload(cacheKey) {
  const db = await open()
  return db.prepare('SELECT rh_file FROM uploads WHERE cache_key = ?').get(cacheKey)?.rh_file ?? null
}

export async function rememberUpload(cacheKey, rhFile) {
  const db = await open()
  db.prepare('INSERT OR REPLACE INTO uploads (cache_key, rh_file, created_at) VALUES (?, ?, ?)')
    .run(cacheKey, rhFile, now())
}

function safeParse(text) {
  if (!text) return null
  try { return JSON.parse(text) } catch { return null }
}
