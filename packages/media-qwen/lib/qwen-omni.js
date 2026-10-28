/**
 * Host-side `qwen_omni` tool.
 *
 * Sends one local or remote video / audio / image to Qwen3.8-Omni-Flash through
 * the DashScope OpenAI-compatible endpoint and returns its text answer. The
 * caller's prompt decides the task: summarization, transcription, timestamped
 * transcription, question answering, and so on share one request path.
 *
 * File delivery mirrors the proven media-understand skill:
 * - inline base64 for local files up to 20 MiB;
 * - Bailian temporary-storage upload above that, up to the 1 GB upload limit;
 * - public http(s) and oss:// URLs passed through unchanged;
 * - one automatic retry through the upload channel if the gateway rejects an
 *   inline payload as too large.
 */

import { openAsBlob, statSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { basename, extname } from 'node:path'

import {
  ToolError,
  apiKeyOf,
  httpError,
  isRemote,
  localPathOf,
  providerMessage,
  withDeadline,
} from './shared.js'

const MODEL = 'qwen3.8-omni-flash'
const ENDPOINT = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'
const UPLOAD_POLICY_URL = 'https://dashscope.aliyuncs.com/api/v1/uploads'
const DASHSCOPE_REF = 'DASHSCOPE_API_KEY'
const OSS_RESOLVE_HEADER = 'X-DashScope-OssResourceResolve'

const BASE64_MAX_BYTES = 20 * 1024 * 1024
const TEMP_STORAGE_MAX_BYTES = 1024 * 1024 * 1024
const REQUEST_TIMEOUT_MS = 600000

const VIDEO_EXT = new Set(['.mp4', '.mov', '.mkv', '.webm', '.avi', '.flv', '.ts', '.m4v', '.wmv'])
const AUDIO_EXT = new Set(['.mp3', '.wav', '.m4a', '.flac', '.ogg', '.oga', '.aac', '.wma', '.m3a', '.opus'])
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif', '.tiff', '.tif'])

const MIME_BY_EXT = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.webm': 'video/webm',
  '.avi': 'video/x-msvideo',
  '.flv': 'video/x-flv',
  '.ts': 'video/mp2t',
  '.m4v': 'video/x-m4v',
  '.wmv': 'video/x-ms-wmv',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.aac': 'audio/aac',
  '.wma': 'audio/x-ms-wma',
  '.m3a': 'audio/mpeg',
  '.opus': 'audio/opus',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.gif': 'image/gif',
  '.tiff': 'image/tiff',
  '.tif': 'image/tiff',
}

/** Path basename for a local path or URL path. */
function nameOf(ref) {
  if (isRemote(ref)) {
    try {
      return basename(new URL(ref).pathname)
    } catch {
      return ''
    }
  }
  return basename(ref)
}

/** Classify a reference by its file extension. */
function kindOf(ref) {
  const ext = extname(nameOf(ref)).toLowerCase()
  if (VIDEO_EXT.has(ext)) return 'video'
  if (AUDIO_EXT.has(ext)) return 'audio'
  if (IMAGE_EXT.has(ext)) return 'image'
  throw new ToolError(
    'INVALID_MEDIA',
    `不支持的文件类型：${ext || '(无扩展名)'}。支持视频、音频、图片；无法判断类型时请提供带扩展名的文件。`,
  )
}

/** MIME type for a local file. */
function mimeOf(path, kind) {
  const ext = extname(path).toLowerCase()
  if (MIME_BY_EXT[ext] !== undefined) return MIME_BY_EXT[ext]
  if (kind === 'video') return 'video/mp4'
  if (kind === 'audio') return 'application/octet-stream'
  return 'image/png'
}

/** Audio format name required by the input_audio content part. */
function audioFormatOf(ref) {
  return extname(nameOf(ref)).toLowerCase().slice(1)
}

/** Build one OpenAI-compatible content part for a URL or data URL. */
function partForUrl(url, kind, sourceForAudio) {
  if (kind === 'video') {
    return { type: 'video_url', video_url: { url, fps: 2.0 } }
  }
  if (kind === 'audio') {
    const format = audioFormatOf(sourceForAudio ?? url)
    if (format === '') {
      throw new ToolError('INVALID_MEDIA', '无法判断音频格式；请提供带扩展名的音频文件或 URL。')
    }
    return { type: 'input_audio', input_audio: { data: url, format } }
  }
  return { type: 'image_url', image_url: { url } }
}

/** Fetch a temporary-storage upload policy. */
async function getUploadPolicy(apiKey, signal) {
  const url = new URL(UPLOAD_POLICY_URL)
  url.searchParams.set('action', 'getPolicy')
  url.searchParams.set('model', MODEL)

  let response
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
      signal,
    })
  } catch (error) {
    if (signal.aborted) throw error
    throw new ToolError('UPLOAD_FAILED', '无法连接百炼临时存储服务。')
  }

  const raw = await response.text()
  if (!response.ok) {
    throw new ToolError('UPLOAD_FAILED', `获取百炼上传策略失败：HTTP ${response.status}，${providerMessage(raw, apiKey)}`)
  }

  let payload
  try {
    payload = JSON.parse(raw)
  } catch {
    throw new ToolError('UPLOAD_FAILED', '百炼上传策略返回了无法识别的响应。')
  }
  const data = payload?.data
  if (data === null || typeof data !== 'object') {
    throw new ToolError('UPLOAD_FAILED', '百炼上传策略缺少 data。')
  }
  const required = [
    'upload_dir',
    'upload_host',
    'oss_access_key_id',
    'signature',
    'policy',
    'x_oss_object_acl',
    'x_oss_forbid_overwrite',
  ]
  for (const field of required) {
    if (typeof data[field] !== 'string' || data[field].length === 0) {
      throw new ToolError('UPLOAD_FAILED', `百炼上传策略缺少 ${field}。`)
    }
  }
  return data
}

/** MIME type for a local path, computed from its extension. */
function fileMimeOf(path) {
  return mimeOf(path, kindOf(path))
}

/** Upload one local file to Bailian temporary storage and return its oss:// URL. */
async function uploadToTempStorage(filePath, apiKey, signal) {
  const policy = await getUploadPolicy(apiKey, signal)
  const fileName = basename(filePath)
  const prefix = String(policy.upload_dir).replace(/\/+$/u, '')
  const key = `${prefix}/${fileName}`

  const form = new FormData()
  form.append('OSSAccessKeyId', String(policy.oss_access_key_id))
  form.append('Signature', String(policy.signature))
  form.append('policy', String(policy.policy))
  form.append('x-oss-object-acl', String(policy.x_oss_object_acl))
  form.append('x-oss-forbid-overwrite', String(policy.x_oss_forbid_overwrite))
  form.append('key', key)
  form.append('success_action_status', '200')

  try {
    const file = statSync(filePath)
    if (!file.isFile()) throw new ToolError('INVALID_MEDIA', `不是文件：${filePath}`)
  } catch (error) {
    if (error instanceof ToolError) throw error
    throw new ToolError('INVALID_MEDIA', `无法读取文件：${filePath}`)
  }

  try {
    const blob = await openAsBlob(filePath, { type: fileMimeOf(filePath) })
    form.append('file', blob, fileName)
  } catch {
    throw new ToolError('UPLOAD_FAILED', `无法打开文件：${filePath}`)
  }

  let response
  try {
    response = await fetch(String(policy.upload_host), {
      method: 'POST',
      body: form,
      signal,
    })
  } catch (error) {
    if (signal.aborted) throw error
    throw new ToolError('UPLOAD_FAILED', '上传到百炼临时存储失败。')
  }

  const raw = await response.text()
  if (!response.ok) {
    throw new ToolError('UPLOAD_FAILED', `上传到百炼临时存储失败：HTTP ${response.status}，${providerMessage(raw, apiKey)}`)
  }
  return `oss://${key}`
}

/** Inline one local file as a data URL. */
async function inlinePart(filePath, kind, signal) {
  const bytes = await readFile(filePath, { signal })
  const mime = mimeOf(filePath, kind)
  return partForUrl(`data:${mime};base64,${bytes.toString('base64')}`, kind, filePath)
}

/**
 * Prepare a media reference for the model.
 *
 * `retryUpload` is present only for an inlined local file: if the gateway
 * rejects the base64 payload as too large, the caller uploads the same file to
 * temporary storage and retries once.
 */
async function prepareMedia(ctx, exec, media, apiKey, signal) {
  if (isRemote(media)) {
    const kind = kindOf(media)
    return {
      kind,
      part: partForUrl(media, kind, media),
      headers: media.startsWith('oss://') ? { [OSS_RESOLVE_HEADER]: 'enable' } : {},
    }
  }

  const filePath = localPathOf(ctx, exec, media)
  let info
  try {
    info = await stat(filePath)
  } catch {
    throw new ToolError('INVALID_MEDIA', `文件不存在或无法读取：${filePath}`)
  }
  if (!info.isFile()) {
    throw new ToolError('INVALID_MEDIA', `不是文件：${filePath}`)
  }

  const kind = kindOf(filePath)
  if (info.size > TEMP_STORAGE_MAX_BYTES) {
    throw new ToolError(
      'FILE_TOO_LARGE',
      `文件 ${(info.size / 1024 / 1024).toFixed(1)} MB 超过百炼临时存储 1 GB 上限。请把文件放到可公开访问的 OSS/HTTP URL，再用 URL 调用。`,
    )
  }

  if (info.size <= BASE64_MAX_BYTES) {
    return {
      kind,
      part: await inlinePart(filePath, kind, signal),
      headers: {},
      retryUpload: async () => {
        const ossUrl = await uploadToTempStorage(filePath, apiKey, signal)
        return {
          kind,
          part: partForUrl(ossUrl, kind, filePath),
          headers: { [OSS_RESOLVE_HEADER]: 'enable' },
        }
      },
    }
  }

  const ossUrl = await uploadToTempStorage(filePath, apiKey, signal)
  return {
    kind,
    part: partForUrl(ossUrl, kind, filePath),
    headers: { [OSS_RESOLVE_HEADER]: 'enable' },
  }
}

/** Extract text from an OpenAI-compatible message content value. */
function textOfContent(content) {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter((part) => part !== null && typeof part === 'object' && part.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text)
      .join('')
  }
  return undefined
}

/** Post one request to the Qwen Omni endpoint. */
async function callModel({ apiKey, prepared, prompt, thinking, signal }) {
  const body = {
    model: MODEL,
    messages: [
      {
        role: 'user',
        content: [prepared.part, { type: 'text', text: prompt }],
      },
    ],
    enable_thinking: thinking,
  }

  let response
  try {
    response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...prepared.headers,
      },
      body: JSON.stringify(body),
      signal,
    })
  } catch (error) {
    if (signal.aborted) throw error
    throw new ToolError('UNREACHABLE', '无法连接 DashScope。')
  }

  const raw = await response.text()
  if (!response.ok) throw httpError(response.status, raw, apiKey)

  let payload
  try {
    payload = JSON.parse(raw)
  } catch {
    throw new ToolError('PROVIDER_ERROR', 'DashScope 返回了无法识别的响应。')
  }

  const text = textOfContent(payload?.choices?.[0]?.message?.content)
  if (typeof text !== 'string') {
    throw new ToolError('PROVIDER_ERROR', 'DashScope 响应中没有文本结果。')
  }

  const result = { text }
  if (payload.usage !== undefined && payload.usage !== null && typeof payload.usage === 'object') {
    result.usage = payload.usage
  }
  const requestId = response.headers.get('x-request-id') ?? payload.request_id ?? payload.id
  if (typeof requestId === 'string' && requestId.length > 0) result.requestId = requestId
  return result
}

/** Validate the two required tool arguments before any network work. */
function validateArgs(args) {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) {
    throw new ToolError('INVALID_ARGS', '参数必须是对象。')
  }
  const media = typeof args.media === 'string' ? args.media.trim() : ''
  const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : ''
  if (media.length === 0) throw new ToolError('INVALID_ARGS', 'media 不能为空。')
  if (prompt.length === 0) throw new ToolError('INVALID_ARGS', 'prompt 不能为空。')
  return {
    media,
    prompt,
    thinking: args.thinking !== false,
  }
}

/** The model-facing tool definition. */
function createQwenOmniTool(ctx) {
  return {
    name: 'qwen_omni',
    description:
      '用 Qwen3.8-Omni-Flash 理解单个视频、音频或图片，返回文本。'
      + '主要用于视频/音频理解；图片仅在用户明确要求用 Qwen 或 media-api 理解图片时使用，普通图片理解请直接用主模型视觉能力。'
      + 'prompt 是完整指令，转写、带时间戳转写、总结、问答都写在 prompt 里。'
      + '单文件、单任务、同步；不做批量或异步。大文件会自动上传百炼临时存储，上限 1 GB。',
    parameters: {
      type: 'object',
      properties: {
        media: {
          type: 'string',
          description: '本地视频/音频/图片路径，或 http(s):// / oss:// URL。',
        },
        prompt: {
          type: 'string',
          description: '完整指令，例如“转写对白”“转写并给出时间戳”“总结内容”“这个画面里发生了什么”。',
        },
        thinking: {
          type: 'boolean',
          description: '是否启用模型思考，默认 true；简单任务可设为 false 以降低延迟。',
        },
      },
      required: ['media', 'prompt'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          usage: { type: 'object', additionalProperties: true },
          requestId: { type: 'string' },
        },
        required: ['text'],
        additionalProperties: false,
      },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    timeoutMs: REQUEST_TIMEOUT_MS,
    async execute(args, exec) {
      const input = validateArgs(args)
      const apiKey = await apiKeyOf(ctx, DASHSCOPE_REF)
      const prepared = await prepareMedia(ctx, exec, input.media, apiKey, exec.signal)

      try {
        return await withDeadline(exec, (signal) => callModel({
          apiKey,
          prepared,
          prompt: input.prompt,
          thinking: input.thinking,
          signal,
        }), REQUEST_TIMEOUT_MS)
      } catch (error) {
        if (error instanceof ToolError && error.code === 'PAYLOAD_TOO_LONG' && prepared.retryUpload !== undefined) {
          const uploaded = await prepared.retryUpload()
          return await withDeadline(exec, (signal) => callModel({
            apiKey,
            prepared: uploaded,
            prompt: input.prompt,
            thinking: input.thinking,
            signal,
          }), REQUEST_TIMEOUT_MS)
        }
        throw error
      }
    },
  }
}

/** Register the Qwen Omni tool; disposing the plugin unregisters it. */
export function registerQwenOmniTool(ctx) {
  ctx.effect(() => ctx.tools.register(createQwenOmniTool(ctx)), 'media-qwen: qwen_omni tool')
}
