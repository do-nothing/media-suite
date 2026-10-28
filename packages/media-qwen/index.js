/**
 * Host half of the media-qwen bundle.
 *
 * It owns no secrets: DashScope keys are resolved per operation through the
 * Harness credential service. The Host exposes two things:
 *
 * - three model-facing tools (`qwen_omni`, `qwen_tts`, `qwen_audio`);
 * - one read-only Remote method (`mediaQwen/dashscopeStatus`) that validates the
 *   configured key against the DashScope model-list endpoint. That request is
 *   free: it does not invoke a model or consume tokens.
 *
 * Status deliberately does not query billing: a DashScope API key cannot read
 * the Alibaba Cloud account balance, which would require a separate AccessKey
 * pair and an account-wide BSS request this plugin does not configure.
 *
 * Every reply carries display-safe fields only: never a key, never a request
 * body.
 */

import { registerQwenAudioTools } from './lib/qwen-audio.js'
import { registerQwenOmniTool } from './lib/qwen-omni.js'

export const name = 'media-qwen'
export const inject = ['credentials', 'tools']

const DASHSCOPE_REF = 'DASHSCOPE_API_KEY'
const REQUEST_TIMEOUT_MS = 15000
const MAX_MESSAGE_LENGTH = 200

/**
 * The China and international DashScope OpenAI-compatible model-list endpoints.
 * A key belongs to one region; a 401/403 on the China endpoint falls through to
 * the international one so both key types validate.
 */
const DASHSCOPE_MODELS = [
  {
    region: 'cn',
    url: 'https://dashscope.aliyuncs.com/compatible-mode/v1/models',
  },
  {
    region: 'intl',
    url: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/models',
  },
]

/** Marker key read by the Typert Gateway's SRC fallback. */
const REMOTE_METHODS_KEY = '@deepseek-ai/dsh-typert-protocol/remote-methods'

/** Current time as the wire-safe ISO string every status reply carries. */
function checkedAt() {
  return new Date().toISOString()
}

/** A trimmed string, or the fallback when the value is absent or blank. */
function textOf(value, fallback) {
  if (value === undefined || value === null) return fallback
  const text = String(value).trim()
  return text.length === 0 ? fallback : text
}

/** Remove any secret accidentally echoed by a provider, then cap the text. */
function scrubMessage(message, secrets) {
  let text = String(message)
  for (const secret of secrets) {
    if (typeof secret === 'string' && secret.length > 0) text = text.split(secret).join('***')
  }
  return text.slice(0, MAX_MESSAGE_LENGTH)
}

/** One display-safe failure reply. */
function failure(status, source, message, secrets = []) {
  return {
    status,
    ...(source === undefined ? {} : { source }),
    ...(message === undefined ? {} : { message: scrubMessage(message, secrets) }),
    checkedAt: checkedAt(),
  }
}

/** Add the credential source to a status object. */
function withSource(result, source) {
  return {
    ...result,
    ...(source === undefined ? {} : { source }),
    ...(source === 'file' ? { fromStore: true } : {}),
  }
}

/**
 * Resolve one credential. A read failure is distinct from an absent value so the
 * page can say "凭据服务不可用" instead of "未配置".
 */
async function resolveCredential(credentials, ref) {
  try {
    const resolved = await credentials.resolve(ref)
    return { resolved, failed: false }
  } catch {
    return { resolved: undefined, failed: true }
  }
}

/** Extract the human-readable message from a DashScope error body. */
function dashScopeMessage(text) {
  try {
    const payload = JSON.parse(text)
    return textOf(payload?.error?.message ?? payload?.message, '')
  } catch {
    return ''
  }
}

/**
 * Validate one DashScope key against a region's model-list endpoint.
 *
 * @returns a display-safe key status.
 */
async function requestDashScopeModels(endpoint, key) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(endpoint.url, {
      headers: { Authorization: `Bearer ${key}` },
      signal: controller.signal,
    })
    const text = await response.text()
    if (response.status === 200) {
      let payload
      try {
        payload = JSON.parse(text)
      } catch {
        return failure('error', undefined, 'DashScope 返回了无法识别的响应', [key])
      }
      if (!Array.isArray(payload?.data)) {
        return failure('error', undefined, 'DashScope 返回了无法识别的响应', [key])
      }
      return {
        status: 'ready',
        modelCount: String(payload.data.length),
        region: endpoint.region,
        checkedAt: checkedAt(),
      }
    }

    const detail = dashScopeMessage(text)
    if (response.status === 401 || response.status === 403) {
      return failure('invalid_key', undefined, detail.length > 0 ? detail : `HTTP ${response.status}`, [key])
    }
    return failure('http_error', undefined, `HTTP ${response.status}`, [key])
  } catch (error) {
    if (error !== null && typeof error === 'object' && error.name === 'AbortError') {
      return failure('timeout', undefined, '查询 DashScope 超时', [key])
    }
    return failure('unreachable', undefined, '无法连接 DashScope', [key])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Validate the DashScope key. The China endpoint is tried first; a 401/403 falls
 * through to the international endpoint so keys from either region work.
 */
async function queryDashScopeKey(credentials) {
  const { resolved, failed } = await resolveCredential(credentials, DASHSCOPE_REF)
  if (failed) return failure('error', undefined, '读取凭据失败')
  if (resolved === undefined) return failure('no_key')

  const key = resolved.value
  const source = resolved.source
  const primary = await requestDashScopeModels(DASHSCOPE_MODELS[0], key)
  if (primary.status === 'ready') return withSource(primary, source)
  if (primary.status !== 'invalid_key') return withSource(primary, source)

  const fallback = await requestDashScopeModels(DASHSCOPE_MODELS[1], key)
  if (fallback.status === 'ready') return withSource(fallback, source)
  return withSource(primary, source)
}

/**
 * Register the `mediaQwenController` service. The Gateway discovers services
 * through the shared reflect table, so a plain object provided from this
 * plugin's fiber is enough; the marker on its prototype tells the SRC fallback
 * which methods are callable.
 */
function registerController(ctx) {
  const prototype = {
    async dashscopeStatus() {
      const credentials = ctx.get('credentials')
      if (credentials === undefined) {
        return failure('error', undefined, '凭据服务不可用')
      }
      return queryDashScopeKey(credentials)
    },
  }
  Object.defineProperty(prototype, REMOTE_METHODS_KEY, {
    value: {
      version: 1,
      methods: [
        { method: 'dashscopeStatus', invocation: { kind: 'direct' } },
      ],
    },
    configurable: true,
  })
  const service = Object.create(prototype)
  service.ctx = ctx
  service.name = 'mediaQwenController'
  service.typertRemote = { service, serviceKey: 'mediaQwenController', namespace: 'mediaQwen' }
  ctx.reflect.provide('mediaQwenController', service)
}

/**
 * Mount the tools and the status service. `inject` keeps the plugin inactive
 * until the credential and tool seams are present.
 */
export function apply(ctx) {
  registerController(ctx)
  registerQwenOmniTool(ctx)
  registerQwenAudioTools(ctx)
}
