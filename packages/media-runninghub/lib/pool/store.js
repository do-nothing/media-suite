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
  updated_at    INTEGER NOT NULL,
  submitted_at  INTEGER,
  finished_at   INTEGER
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

/** The ledger schema version this build expects. */
const SCHEMA_VERSION = '2'

/**
 * Columns added after the first release. `CREATE TABLE IF NOT EXISTS` only
 * builds a fresh table, so an existing ledger needs these added in place.
 */
const ADDED_COLUMNS = [
  ['submitted_at', 'INTEGER'],
  ['finished_at', 'INTEGER'],
]

/**
 * Add any missing column to an existing ledger.
 *
 * Runs on every open and is idempotent: `PRAGMA table_info` tells us which
 * columns exist, and only the missing ones are added. Rows written before the
 * column existed keep NULL, which callers already treat as "unknown" — the
 * duration falls back to `updated_at` and the submit time to `created_at`.
 */
function migrate(db) {
  const existing = new Set(db.prepare('PRAGMA table_info(tasks)').all().map((c) => c.name))
  for (const [name, type] of ADDED_COLUMNS) {
    if (existing.has(name)) continue
    db.exec(`ALTER TABLE tasks ADD COLUMN ${name} ${type}`)
  }
}

/** Open (and migrate) the ledger once; later calls reuse the same handle. */
async function open() {
  if (dbPromise) return dbPromise
  dbPromise = (async () => {
    await mkdir(dirname(DB_PATH), { recursive: true })
    const { DatabaseSync } = await import('node:sqlite')
    const db = new DatabaseSync(DB_PATH)
    db.exec(SCHEMA)
    migrate(db)
    db.prepare('INSERT OR REPLACE INTO schema_meta (key, value) VALUES (?, ?)').run('schema', SCHEMA_VERSION)
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
  // The open batch is the highest batch id that still has unfinished rows — the
  // same query currentBatchId() uses, so what the board calls "current" is
  // exactly what a new job joins. Taking the highest id over the whole table
  // instead would disagree after `requeue`: it copies a finished task's old
  // batch id, which can leave a lower batch open while a higher one is already
  // drained, and a new job would then land in the finished batch.
  const openRow = db.prepare(
    "SELECT MAX(batch_id) AS b FROM tasks WHERE status IN ('PENDING','DISPATCHED')",
  ).get()
  const maxRow = db.prepare('SELECT COALESCE(MAX(batch_id), 0) AS b FROM tasks').get()
  const batchId = openRow?.b ?? (maxRow?.b ?? 0) + 1
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
  // `submitted_at` records when RunningHub actually accepted the task, which can
  // be minutes after `created_at` when the row waited for a concurrency slot.
  const at = now()
  db.prepare("UPDATE tasks SET task_id = ?, status = 'DISPATCHED', submitted_at = ?, updated_at = ? WHERE id = ?")
    .run(taskId, at, at, rowId)
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
  // `finished_at` is when the task stopped being outstanding; the board's
  // duration column reads it instead of guessing from `updated_at`.
  const at = now()
  db.prepare(`
    UPDATE tasks SET status = ?, rh_status = ?, error_code = ?, error_message = ?, cost_json = ?, finished_at = ?, updated_at = ?
    WHERE id = ?
  `).run(
    result.status, result.rhStatus ?? null, result.errorCode ?? null, result.errorMessage ?? null,
    result.costs === undefined ? null : JSON.stringify(result.costs), at, at, rowId,
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

/** The batch that still has outstanding tasks, or 0 when the pool drained. */
export async function currentBatchId() {
  const db = await open()
  const row = db.prepare("SELECT MAX(batch_id) AS b FROM tasks WHERE status IN ('PENDING','DISPATCHED')").get()
  return row?.b ?? 0
}

/**
 * The highest batch id in the ledger whether or not it is still open, or 0 when
 * the ledger is empty.
 *
 * `currentBatchId()` answers "what is running now" and falls to 0 once drained;
 * this answers "which batch should the board show when nothing is running" — the
 * last one, so a finished batch stays readable instead of the board going blank.
 */
export async function latestBatchId() {
  const db = await open()
  const row = db.prepare('SELECT MAX(batch_id) AS b FROM tasks').get()
  return row?.b ?? 0
}

/** Overview for the status tool: current batch, counts, and the newest tasks. */
export async function overview(limit = 20) {
  const db = await open()
  const counts = {
    total: 0, PENDING: 0, DISPATCHED: 0, SUCCESS: 0, FAILED: 0, SUBMIT_FAILED: 0, CANCELLED: 0,
  }
  for (const row of db.prepare('SELECT status, COUNT(*) AS c FROM tasks GROUP BY status').all()) {
    counts.total += row.c
    if (row.status in counts) counts[row.status] = row.c
  }
  const tasks = db.prepare('SELECT * FROM tasks ORDER BY id DESC LIMIT ?').all(limit)
  return { currentBatchId: await currentBatchId(), counts, tasks }
}

/** All distinct batch ids, newest first, for dashboard batch navigation. */
export async function batches() {
  const db = await open()
  return db.prepare('SELECT DISTINCT batch_id AS b FROM tasks ORDER BY b DESC').all().map((r) => Number(r.b))
}

/** Mark a task row cancelled. Its RunningHub counterpart (if any) is its caller's job. */
export async function setCancelled(rowId) {
  const db = await open()
  const at = now()
  db.prepare("UPDATE tasks SET status = 'CANCELLED', finished_at = ?, updated_at = ? WHERE id = ?").run(at, at, rowId)
}

/**
 * Replay one finished/terminal task verbatim: a fresh PENDING row in the same
 * batch, copying `request_json` and `node_json` so the RunningHub中转 file ids
 * are reused without re-uploading local files.
 *
 * @returns { { id: number, batchId: number } } or null when the row is missing.
 */
export async function requeue(rowId) {
  const db = await open()
  const src = db.prepare('SELECT * FROM tasks WHERE id = ?').get(rowId)
  if (!src) return null
  const ts = now()
  const info = db.prepare(`
    INSERT INTO tasks (batch_id, type_id, workflow_id, instance_type, request_json,
                       node_json, params_json, output_dir, output_name, output_root,
                       status, session_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?)
  `).run(
    src.batch_id, src.type_id, src.workflow_id, src.instance_type,
    src.request_json, src.node_json, src.params_json,
    src.output_dir, src.output_name, src.output_root,
    src.session_id, ts, ts,
  )
  return { id: Number(info.lastInsertRowid), batchId: Number(src.batch_id) }
}

/** Every task in one batch, plus its outputs. */
export async function batchDetail(batchId) {
  const db = await open()
  const tasks = db.prepare('SELECT * FROM tasks WHERE batch_id = ? ORDER BY id').all(batchId)
  for (const task of tasks) {
    task.outputs = await outputsOf(task.id)
    task.params = safeParse(task.params_json)
    task.costs = safeParse(task.cost_json)
  }
  return tasks
}

/** The downloaded outputs of one task row. */
export async function outputsOf(taskRowId) {
  const db = await open()
  return db.prepare('SELECT * FROM outputs WHERE task_row = ? ORDER BY id').all(taskRowId)
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
