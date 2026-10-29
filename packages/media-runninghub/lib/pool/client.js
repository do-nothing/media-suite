/**
 * RunningHub workflow API client for the task pool.
 *
 * Two endpoints, both on the key's own site (the pool runs under the
 * `jobs` surface, whose key belongs to one site — see the site judgment):
 *
 *   create:  POST <site>/task/openapi/create   → { code, data: { taskId } }
 *   query:   POST <site>/openapi/v2/query      → flat task object (no envelope)
 *
 * Every helper returns a structured result and never throws, so the pool can
 * record failure types and keep scheduling independent tasks.
 */

const SITES = {
  cn: 'https://www.runninghub.cn',
  intl: 'https://www.runninghub.ai',
}

const CREATE_PATH = '/task/openapi/create'
const QUERY_PATH = '/openapi/v2/query'
const CANCEL_PATH = '/task/openapi/cancel'

/** Error-type taxonomy (recorded only; the watcher decides what to do). */
export const ET = {
  AUTH: 'AUTH',
  BALANCE: 'INSUFFICIENT_BALANCE',
  WORKFLOW: 'WORKFLOW_INVALID',
  RENDER: 'RENDER_FAILED',
  RATELIMIT: 'RATE_LIMIT',
  NETWORK: 'NETWORK',
  UNKNOWN: 'UNKNOWN',
  TASK_NOT_FOUND: 'TASK_NOT_FOUND',
}

const AUTH_HINTS = ['auth', '401', '403', 'token', 'unauthor', '鉴权', '授权']
const BALANCE_HINTS = ['balance', 'insufficient', '余额', 'credit', '欠费', 'arreas']
const WORKFLOW_HINTS = ['workflow', 'node', 'param', 'invalid', 'validate', '工作流', '节点', '参数']
const RATELIMIT_HINTS = ['rate limit', 'ratelimit', 'too many', 'frequency', '频繁', '限流', '429']
const NOTFOUND_HINTS = ['not found', 'does not exist', '不存在', '过期', 'expired', '已删除']

/** Map a RunningHub error code + message onto the failure taxonomy. */
export function classifyError(code = '', message = '') {
  const text = `${code} ${message}`.toLowerCase()
  if (NOTFOUND_HINTS.some((hint) => text.includes(hint))) return ET.TASK_NOT_FOUND
  if (AUTH_HINTS.some((hint) => text.includes(hint))) return ET.AUTH
  if (BALANCE_HINTS.some((hint) => text.includes(hint))) return ET.BALANCE
  if (RATELIMIT_HINTS.some((hint) => text.includes(hint))) return ET.RATELIMIT
  if (WORKFLOW_HINTS.some((hint) => text.includes(hint))) return ET.WORKFLOW
  return ET.UNKNOWN
}

function siteHost(site) {
  return SITES[site] ?? SITES.cn
}

async function postJson(url, body, apiKey) {
  let response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    })
  } catch (error) {
    return { networkError: error }
  }
  const raw = await response.text()
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    parsed = null
  }
  return { status: response.status, ok: response.ok, parsed, raw }
}

/**
 * Submit one workflow task.
 *
 * Success: { ok: true, taskId, taskStatus }
 * Failure: { ok: false, errorType, errorCode, errorMessage }
 */
export async function createWorkflow(apiKey, payload, site) {
  const url = `${siteHost(site)}${CREATE_PATH}`
  const result = await postJson(url, payload, apiKey)
  if (result.networkError) {
    return { ok: false, errorType: ET.NETWORK, errorCode: '', errorMessage: String(result.networkError) }
  }
  const { parsed } = result
  if (parsed === null || typeof parsed !== 'object') {
    return { ok: false, errorType: ET.UNKNOWN, errorCode: '', errorMessage: 'RunningHub 返回了无法识别的响应' }
  }
  if (parsed.code !== 0) {
    const message = String(parsed.msg ?? 'Unknown error')
    return {
      ok: false,
      errorType: classifyError(parsed.code, message),
      errorCode: String(parsed.code),
      errorMessage: message,
    }
  }
  const data = parsed.data ?? {}
  const taskId = data.taskId
  if (!taskId) {
    return { ok: false, errorType: ET.WORKFLOW, errorCode: '', errorMessage: 'create 响应缺少 taskId' }
  }
  return { ok: true, taskId: String(taskId), taskStatus: data.taskStatus }
}

function asNumber(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/**
 * Cancel a dispatched task at RunningHub.
 *
 * Success: { ok: true } (the ledger then marks the row CANCELLED)
 * Failure: { ok: false, errorType, errorCode, errorMessage }
 */
export async function cancelTask(apiKey, taskId, site) {
  const url = `${siteHost(site)}${CANCEL_PATH}`
  const result = await postJson(url, { apiKey, taskId }, apiKey)
  if (result.networkError) {
    return { ok: false, errorType: ET.NETWORK, errorCode: '', errorMessage: String(result.networkError) }
  }
  const { parsed } = result
  if (parsed === null || typeof parsed !== 'object') {
    return { ok: false, errorType: ET.UNKNOWN, errorCode: '', errorMessage: 'RunningHub 返回了无法识别的响应' }
  }
  // The endpoint answers `{ code, msg, data }`; code !== 0 is a refusal.
  if (parsed.code !== undefined && parsed.code !== 0) {
    const message = String(parsed.msg ?? 'Unknown error')
    return {
      ok: false,
      errorType: classifyError(parsed.code, message),
      errorCode: String(parsed.code),
      errorMessage: message,
    }
  }
  return { ok: true }
}

/**
 * Poll one task.
 *
 * Pending:  { ok: true, terminal: false, rhStatus }
 * Success:  { ok: true, terminal: true, status: 'SUCCESS', results, costs }
 * Failed:   { ok: true, terminal: true, status: 'FAILED', errorType, ... }
 * Net fail: { ok: false, errorType: NETWORK } — the caller may retry later.
 */
export async function queryTask(apiKey, taskId, site) {
  const url = `${siteHost(site)}${QUERY_PATH}`
  const result = await postJson(url, { taskId }, apiKey)
  if (result.networkError) {
    return { ok: false, errorType: ET.NETWORK, errorCode: '', errorMessage: String(result.networkError) }
  }
  const { parsed } = result
  if (parsed === null || typeof parsed !== 'object') {
    return { ok: false, errorType: ET.UNKNOWN, errorCode: '', errorMessage: 'RunningHub 返回了无法识别的响应' }
  }

  // The query endpoint answers with a flat task object; failures may still use
  // an envelope. Handle both.
  if (parsed.code !== undefined && parsed.code !== 0 && parsed.status === undefined) {
    const message = String(parsed.msg ?? 'Unknown error')
    return {
      ok: false,
      errorType: classifyError(parsed.code, message),
      errorCode: String(parsed.code),
      errorMessage: message.slice(0, 500),
    }
  }

  const rhStatus = parsed.status ?? 'UNKNOWN'

  if (rhStatus === 'SUCCESS') {
    const usage = parsed.usage ?? {}
    return {
      ok: true,
      terminal: true,
      status: 'SUCCESS',
      rhStatus,
      results: parsed.results ?? [],
      costs: {
        money: asNumber(usage.consumeMoney),
        thirdParty: asNumber(usage.thirdPartyConsumeMoney),
        coins: asNumber(usage.consumeCoins) === null ? null : Math.round(usage.consumeCoins),
        timeSeconds: asNumber(usage.taskCostTime) === null ? null : Math.round(usage.taskCostTime),
      },
    }
  }

  if (rhStatus === 'FAILED') {
    const code = String(parsed.errorCode ?? '')
    const message = String(parsed.errorMessage ?? 'Unknown error')
    return {
      ok: true,
      terminal: true,
      status: 'FAILED',
      rhStatus,
      errorCode: code,
      errorType: classifyError(code, message),
      errorMessage: message,
    }
  }

  if (rhStatus === 'QUEUED' || rhStatus === 'RUNNING') {
    return { ok: true, terminal: false, status: 'PENDING', rhStatus }
  }

  // Empty/unknown status: inspect the error envelope. A task that is gone
  // (cancelled/expired/purged) must become terminal, otherwise the pool could
  // never drain. Hard errors are terminal too; everything else is transient.
  const code = String(parsed.errorCode ?? '')
  const message = String(parsed.errorMessage ?? '')
  const errorType = classifyError(code, message)
  if (errorType === ET.TASK_NOT_FOUND || errorType === ET.AUTH || errorType === ET.BALANCE || errorType === ET.WORKFLOW) {
    return {
      ok: true,
      terminal: true,
      status: 'FAILED',
      rhStatus: rhStatus || 'UNKNOWN',
      errorCode: code,
      errorType,
      errorMessage: message || 'task status unknown',
    }
  }
  return { ok: true, terminal: false, status: 'PENDING', rhStatus: rhStatus || 'UNKNOWN' }
}
