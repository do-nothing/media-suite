/**
 * Workflow task-type definitions: loading, lookup, and payload building.
 *
 * Loads `config/task-types.json` (shipped with the package). A task type is
 * the *callable contract* — a small whitelist of input params, each mapped to
 * a workflow node slot (nodeId + fieldName). There is no offline validation
 * against an archived graph: RunningHub's own error is the authority.
 */

import { readFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const TASK_TYPES_PATH = join(PKG_DIR, 'config', 'task-types.json')

const SCHEMA_VERSION = 'rh-task-types/1'

const SCALAR_TYPES = new Set(['text', 'string', 'int', 'float', 'bool', 'enum', 'json'])
const FILE_TYPES = new Set(['image', 'audio', 'video'])
const ALL_TYPES = new Set([...SCALAR_TYPES, ...FILE_TYPES])

/** The empty marker some LoadImage/LoadAudio nodes ship as their unused value. */
const EMPTY_MARKERS = new Set(['', 'None'])

export class DefinitionError extends Error {}

/**
 * One parameter of a task type: the whitelist entry a caller may fill, mapped
 * to the workflow node slot it feeds.
 */
export class Param {
  constructor(d) {
    for (const key of ['name', 'type', 'nodeId', 'fieldName']) {
      if (!d[key]) throw new DefinitionError(`param missing '${key}': ${JSON.stringify(d)}`)
    }
    if (!ALL_TYPES.has(d.type)) throw new DefinitionError(`param '${d.name}' has unknown type '${d.type}'`)
    this.name = String(d.name)
    this.label = String(d.label ?? d.name)
    this.type = String(d.type)
    this.nodeId = String(d.nodeId)
    this.fieldName = String(d.fieldName)
    this.required = Boolean(d.required)
    this.default = d.default
    this.accept = Array.isArray(d.accept) ? d.accept : []
    this.enum = Array.isArray(d.enum) ? d.enum : []
  }
}

/** One task type: the contract for one RunningHub workflow. */
export class TaskType {
  constructor(d) {
    for (const key of ['typeId', 'workflowId']) {
      if (!d[key]) throw new DefinitionError(`task type missing '${key}'`)
    }
    this.typeId = String(d.typeId)
    this.version = Number(d.version ?? 1)
    this.displayName = String(d.displayName ?? d.typeId)
    this.description = String(d.description ?? '')
    this.workflowId = String(d.workflowId)
    this.instanceType = String(d.instanceType ?? 'default')
    this.params = (d.params ?? []).map((p) => new Param(p))
    this.fixedOverrides = Array.isArray(d.fixedOverrides) ? d.fixedOverrides : []
  }

  param(name) {
    return this.params.find((p) => p.name === name) ?? null
  }
}

// The catalog is small and static for the process lifetime; load it once.
let cache = null

/** Load and parse all task types. Throws DefinitionError on malformed data. */
export async function loadTaskTypes() {
  if (cache) return cache
  let raw
  try {
    raw = JSON.parse(await readFile(TASK_TYPES_PATH, 'utf8'))
  } catch (error) {
    throw new DefinitionError(`cannot read task types at ${TASK_TYPES_PATH}: ${error?.message ?? error}`)
  }
  if (raw.schemaVersion !== SCHEMA_VERSION) {
    throw new DefinitionError(`unexpected schemaVersion '${raw.schemaVersion}', expected '${SCHEMA_VERSION}'`)
  }
  const types = (raw.types ?? []).map((d) => new TaskType(d))
  if (types.length === 0) throw new DefinitionError('task-types config defines no types')
  const seen = new Set()
  for (const t of types) {
    if (seen.has(t.typeId)) throw new DefinitionError(`duplicate typeId '${t.typeId}'`)
    seen.add(t.typeId)
    const names = new Set()
    for (const p of t.params) {
      if (names.has(p.name)) throw new DefinitionError(`type '${t.typeId}' has duplicate param name '${p.name}'`)
      names.add(p.name)
    }
  }
  cache = types
  return types
}

export async function getTaskType(typeId) {
  const types = await loadTaskTypes()
  const found = types.find((t) => t.typeId === typeId)
  if (!found) {
    const known = types.map((t) => t.typeId).join(', ')
    throw new DefinitionError(`task type '${typeId}' not found (known: ${known})`)
  }
  return found
}

/**
 * Build the RunningHub create payload for one resolved job.
 *
 * @param t - the TaskType definition.
 * @param params - caller-supplied parameter values, keyed by param name.
 * @param resolveFile - async (param, value) => rhFileName for file params.
 * @returns { ok, payload?, inputs?, error? }
 */
export async function buildPayload(t, params, resolveFile) {
  const unknown = Object.keys(params).filter((name) => !t.param(name))
  if (unknown.length > 0) {
    const known = t.params.map((p) => p.name).join(', ')
    return { ok: false, error: `unknown params ${unknown.join(', ')} for type '${t.typeId}' (known: ${known})` }
  }
  const nodes = []
  const inputs = []
  for (const p of t.params) {
    let value
    if (Object.hasOwn(params, p.name)) value = params[p.name]
    else if (p.default !== null && p.default !== undefined) value = p.default
    else if (p.required) return { ok: false, error: `type '${t.typeId}': required param '${p.name}' missing` }
    else continue

    let fieldValue
    if (FILE_TYPES.has(p.type)) {
      const stripped = typeof value === 'string' ? value.trim() : value
      // Leave an optional media slot unset using the published graph's own
      // empty marker: "" for LoadImage/VHS_LoadVideo slots, or the literal
      // "None" some nodes ship as their unused value.
      if (typeof stripped === 'string' && (stripped === '' || stripped === 'None')) {
        fieldValue = stripped
      } else {
        const resolved = await resolveFile(p, value)
        fieldValue = resolved.rhFileName
        inputs.push(resolved.input)
      }
    } else {
      fieldValue = coerceScalar(p, value)
    }
    nodes.push({ nodeId: p.nodeId, fieldName: p.fieldName, fieldValue })
  }
  nodes.push(...t.fixedOverrides)
  return { ok: true, payload: { workflowId: t.workflowId, instanceType: t.instanceType, nodeInfoList: nodes }, inputs }
}

function coerceScalar(p, value) {
  if (p.type === 'int') return Math.trunc(Number(value))
  if (p.type === 'float') return Number(value)
  if (p.type === 'bool') return Boolean(value)
  return String(value)
}
