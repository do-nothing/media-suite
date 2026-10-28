/**
 * Host-side Qwen audio tools.
 *
 * - `qwen_tts` uses `qwen-audio-3.1-tts-plus`: text plus a preset voice, clean
 *   speech synthesis with optional emotional instruction.
 * - `qwen_audio` uses `qwen-audio-3.1-tts-next`: a text prompt plus optional
 *   reference audio, generating a complete audio scene.
 *
 * Both call the Bailian speech endpoint, download the resulting audio below the
 * configured output root, and return the local file path. Neither exposes the
 * API key or the provider URL to the model.
 */

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, extname, resolve } from 'node:path'

import {
  ToolError,
  apiKeyOf,
  extensionOf,
  httpError,
  isRemote,
  localPathOf,
  outputRoot,
  providerMessage,
  safeSegment,
  sessionCwd,
  stamp,
  textHash,
  withDeadline,
} from './shared.js'

const DASHSCOPE_REF = 'DASHSCOPE_API_KEY'
const SHARED_BASE = 'https://dashscope.aliyuncs.com/api/v1'
const REQUEST_TIMEOUT_MS = 600000
const MAX_REFERENCE_BYTES = 10 * 1024 * 1024
const MAX_REFERENCES = 3
const MAX_TEXT_PROMPT = 3000

const TTS_PLUS = 'qwen-audio-3.1-tts-plus'
const TTS_NEXT = 'qwen-audio-3.1-tts-next'

const TTS_FORMATS = ['mp3', 'pcm', 'wav', 'opus']
const TTS_SAMPLE_RATES = [8000, 12000, 16000, 22050, 24000, 44100, 48000]
const NEXT_FORMATS = ['wav', 'mp3', 'pcm']
const NEXT_SAMPLE_RATES = [8000, 16000, 24000, 44100, 48000]

const AUDIO_MIME = {
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/opus',
}

/**
 * Base URL for the speech endpoint.
 *
 * The shared domain works without extra configuration; setting
 * `DASHSCOPE_WORKSPACE_ID` switches to the workspace-scoped domain the provider
 * recommends for production traffic.
 */
function audioBaseUrl() {
  const workspace = process.env.DASHSCOPE_WORKSPACE_ID
  if (typeof workspace === 'string' && /^[A-Za-z0-9-]+$/u.test(workspace)) {
    return `https://${workspace}.cn-beijing.maas.aliyuncs.com/api/v1`
  }
  return SHARED_BASE
}

/** Post one speech-synthesis request and return the parsed payload. */
async function postSpeech(body, apiKey, signal) {
  let response
  try {
    response = await fetch(`${audioBaseUrl()}/services/audio/tts/SpeechSynthesizer`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal,
    })
  } catch (error) {
    if (signal.aborted) throw error
    throw new ToolError('UNREACHABLE', '无法连接 DashScope 语音服务。')
  }

  const raw = await response.text()
  if (!response.ok) throw httpError(response.status, raw, apiKey)

  let payload
  try {
    payload = JSON.parse(raw)
  } catch {
    throw new ToolError('PROVIDER_ERROR', 'DashScope 返回了无法识别的响应。')
  }

  const url = payload?.output?.audio?.url
  if (typeof url !== 'string' || url.length === 0) {
    throw new ToolError('PROVIDER_ERROR', 'DashScope 响应中没有音频下载地址。')
  }
  return { payload, url }
}

/**
 * Download generated audio below the configured output root.
 *
 * @param ctx - plugin context (for the output root).
 * @param exec - execution context (session directory fallback).
 * @param url - provider download URL.
 * @param sections - path segments below `<root>/media/qwen`.
 * @param fileName - output file name.
 * @param destination - explicit destination directory, when the caller asked for one.
 */
async function downloadAudio(ctx, exec, url, sections, fileName, signal, destination) {
  let response
  try {
    response = await fetch(url, { signal })
  } catch (error) {
    if (signal.aborted) throw error
    throw new ToolError('DOWNLOAD_FAILED', '无法下载生成的音频。')
  }
  if (!response.ok) {
    throw new ToolError('DOWNLOAD_FAILED', `下载生成的音频失败：HTTP ${response.status}。`)
  }

  const bytes = Buffer.from(await response.arrayBuffer())
  const directory = destination !== undefined
    ? resolve(sessionCwd(ctx, exec), destination)
    : resolve(outputRoot(ctx, exec), 'media', 'qwen', ...sections.map((section) => safeSegment(section)))
  await mkdir(directory, { recursive: true })
  const filePath = resolve(directory, safeSegment(fileName))
  await writeFile(filePath, bytes)
  return { filePath, bytes: bytes.length }
}

/** MIME type for a local reference audio file. */
function referenceMime(path) {
  return AUDIO_MIME[extname(path).toLowerCase()] ?? 'application/octet-stream'
}

/** Validate and normalize the reference audio list. */
async function prepareReferences(ctx, exec, references, signal) {
  if (references === undefined) return []
  if (!Array.isArray(references)) {
    throw new ToolError('INVALID_ARGS', 'references 必须是数组。')
  }
  if (references.length > MAX_REFERENCES) {
    throw new ToolError('INVALID_ARGS', `references 最多 ${MAX_REFERENCES} 段参考音频。`)
  }

  const prepared = []
  for (const reference of references) {
    if (typeof reference !== 'string' || reference.trim().length === 0) {
      throw new ToolError('INVALID_ARGS', 'references 的每一项都必须是非空路径或 URL。')
    }
    const ref = reference.trim()
    if (isRemote(ref)) {
      prepared.push({ audio_url: ref })
      continue
    }

    const path = localPathOf(ctx, exec, ref)
    let info
    try {
      info = await stat(path)
    } catch {
      throw new ToolError('INVALID_MEDIA', `参考音频不存在或无法读取：${path}`)
    }
    if (!info.isFile()) {
      throw new ToolError('INVALID_MEDIA', `参考音频不是文件：${path}`)
    }
    if (info.size > MAX_REFERENCE_BYTES) {
      throw new ToolError('INVALID_MEDIA', `参考音频 ${basename(path)} 超过 10 MB 上限。`)
    }
    const bytes = await readFile(path, { signal })
    prepared.push({ audio_data: `data:${referenceMime(path)};base64,${bytes.toString('base64')}` })
  }
  return prepared
}

/** Build the shared result object from a provider payload and downloaded file. */
function resultOf(payload, filePath, bytes, format) {
  const result = { file: filePath, format, bytes }
  const duration = payload?.output?.audio?.duration ?? payload?.usage?.duration
  if (typeof duration === 'number' && Number.isFinite(duration)) result.duration = duration
  if (typeof payload?.request_id === 'string' && payload.request_id.length > 0) {
    result.requestId = payload.request_id
  }
  if (payload?.usage !== undefined && payload?.usage !== null && typeof payload.usage === 'object') {
    result.usage = payload.usage
  }
  return result
}

/** Render one generated-audio result for the model. */
function renderAudio(_args, value) {
  const duration = value.duration === undefined ? '' : `，时长 ${value.duration}s`
  return [{
    type: 'text',
    text: `已生成音频：${value.file}（${value.format}${duration}）`,
  }]
}

/** The shared output schema for both audio tools. */
const audioOutput = {
  schema: {
    type: 'object',
    properties: {
      file: { type: 'string' },
      format: { type: 'string' },
      bytes: { type: 'integer' },
      duration: { type: 'number' },
      requestId: { type: 'string' },
      usage: { type: 'object', additionalProperties: true },
    },
    required: ['file', 'format', 'bytes'],
    additionalProperties: false,
  },
  render: renderAudio,
}

/** `qwen_tts`: qwen-audio-3.1-tts-plus speech synthesis. */
function createQwenTtsTool(ctx) {
  return {
    name: 'qwen_tts',
    description:
      '用 qwen-audio-3.1-tts-plus 把一段文字用指定预置音色朗读出来。'
      + '适合旁白、配音、有声书、课程讲解、角色台词等“干净人声”场景。'
      + '输入是 text + voice；可用 instruction 描述情绪、语速、语气。'
      + '不生成音效、环境声或音乐。单任务、同步；批量台词请用任务池。',
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: '要朗读的文字。',
        },
        voice: {
          type: 'string',
          description: '预置音色 ID，例如女声 longanhuan_v3.1、男声 xunanchuan_v3.1。',
        },
        instruction: {
          type: 'string',
          description: '自然语言情绪/语气指令，例如“暴怒，语速极快，音量很大”。',
        },
        format: {
          type: 'string',
          enum: TTS_FORMATS,
          description: '输出格式，默认 mp3。',
        },
        sample_rate: {
          type: 'integer',
          enum: TTS_SAMPLE_RATES,
          description: '采样率，默认 22050。',
        },
        output: {
          type: 'string',
          description: '可选的输出目录；相对路径按当前工作目录解析。默认写到 <当前目录>/output/media/qwen/TTS-Plus/。',
        },
      },
      required: ['text', 'voice'],
      additionalProperties: false,
    },
    output: audioOutput,
    timeoutMs: REQUEST_TIMEOUT_MS,
    async execute(args, exec) {
      const text = typeof args?.text === 'string' ? args.text.trim() : ''
      const voice = typeof args?.voice === 'string' ? args.voice.trim() : ''
      if (text.length === 0) throw new ToolError('INVALID_ARGS', 'text 不能为空。')
      if (voice.length === 0) throw new ToolError('INVALID_ARGS', 'voice 不能为空。')

      const format = typeof args?.format === 'string' ? args.format : 'mp3'
      if (!TTS_FORMATS.includes(format)) {
        throw new ToolError('INVALID_ARGS', `format 只支持 ${TTS_FORMATS.join(' / ')}。`)
      }
      const sampleRate = args?.sample_rate === undefined ? 22050 : args.sample_rate
      if (!TTS_SAMPLE_RATES.includes(sampleRate)) {
        throw new ToolError('INVALID_ARGS', `sample_rate 只支持 ${TTS_SAMPLE_RATES.join(' / ')}。`)
      }
      const instruction = typeof args?.instruction === 'string' ? args.instruction.trim() : ''

      const apiKey = await apiKeyOf(ctx, DASHSCOPE_REF)
      const input = { text, voice, format, sample_rate: sampleRate }
      if (instruction.length > 0) input.instruction = instruction
      const { payload, url } = await withDeadline(
        exec,
        (signal) => postSpeech({ model: TTS_PLUS, input }, apiKey, signal),
        REQUEST_TIMEOUT_MS,
      )
      const fileName = `${stamp()}-tts-${textHash(text)}.${extensionOf(format)}`
      const destination = typeof args?.output === 'string' && args.output.trim().length > 0
        ? args.output.trim()
        : undefined
      const { filePath, bytes } = await withDeadline(
        exec,
        (signal) => downloadAudio(ctx, exec, url, ['TTS-Plus'], fileName, signal, destination),
        REQUEST_TIMEOUT_MS,
      )
      return resultOf(payload, filePath, bytes, format)
    },
  }
}

/** `qwen_audio`: qwen-audio-3.1-tts-next scene audio generation. */
function createQwenAudioTool(ctx) {
  return {
    name: 'qwen_audio',
    description:
      '用 qwen-audio-3.1-tts-next 按描述生成一段完整音频。'
      + '适合多角色对话、带环境声/音效的短剧、播客片段、场景化独白；可用 references 传入最多 3 段参考音频，'
      + '并在 text_prompt 中用 @voice1/@voice2/@voice3 指代。'
      + '单次最长约 120 秒；批量或更长任务请用任务池。',
    parameters: {
      type: 'object',
      properties: {
        text_prompt: {
          type: 'string',
          description: '音频描述或台词；用 @voice1/@voice2/@voice3 引用参考音频。',
        },
        references: {
          type: 'array',
          items: { type: 'string' },
          description: '最多 3 段参考音频，本地路径或 http(s) URL；每段不超过 10 MB、30 秒。',
        },
        format: {
          type: 'string',
          enum: NEXT_FORMATS,
          description: '输出格式，默认 wav。',
        },
        sample_rate: {
          type: 'integer',
          enum: NEXT_SAMPLE_RATES,
          description: '采样率，默认 48000。',
        },
        channels: {
          type: 'integer',
          enum: [1, 2],
          description: '声道数，默认 2。',
        },
        output: {
          type: 'string',
          description: '可选的输出目录；相对路径按当前工作目录解析。默认写到 <当前目录>/output/media/qwen/TTS-Next/。',
        },
      },
      required: ['text_prompt'],
      additionalProperties: false,
    },
    output: audioOutput,
    timeoutMs: REQUEST_TIMEOUT_MS,
    async execute(args, exec) {
      const textPrompt = typeof args?.text_prompt === 'string' ? args.text_prompt.trim() : ''
      if (textPrompt.length === 0) throw new ToolError('INVALID_ARGS', 'text_prompt 不能为空。')
      if (textPrompt.length > MAX_TEXT_PROMPT) {
        throw new ToolError('INVALID_ARGS', `text_prompt 超过 ${MAX_TEXT_PROMPT} 字符上限。`)
      }

      const format = typeof args?.format === 'string' ? args.format : 'wav'
      if (!NEXT_FORMATS.includes(format)) {
        throw new ToolError('INVALID_ARGS', `format 只支持 ${NEXT_FORMATS.join(' / ')}。`)
      }
      const sampleRate = args?.sample_rate === undefined ? 48000 : args.sample_rate
      if (!NEXT_SAMPLE_RATES.includes(sampleRate)) {
        throw new ToolError('INVALID_ARGS', `sample_rate 只支持 ${NEXT_SAMPLE_RATES.join(' / ')}。`)
      }
      const channels = args?.channels === undefined ? 2 : args.channels
      if (channels !== 1 && channels !== 2) {
        throw new ToolError('INVALID_ARGS', 'channels 只支持 1 或 2。')
      }

      const apiKey = await apiKeyOf(ctx, DASHSCOPE_REF)
      const references = await prepareReferences(ctx, exec, args?.references, exec.signal)
      const input = {
        text_prompt: textPrompt,
        format,
        sample_rate: sampleRate,
        channels,
      }
      if (references.length > 0) input.references = references

      const { payload, url } = await withDeadline(
        exec,
        (signal) => postSpeech({ model: TTS_NEXT, input }, apiKey, signal),
        REQUEST_TIMEOUT_MS,
      )
      const fileName = `${stamp()}-audio-${textHash(textPrompt)}.${extensionOf(format)}`
      const destination = typeof args?.output === 'string' && args.output.trim().length > 0
        ? args.output.trim()
        : undefined
      const { filePath, bytes } = await withDeadline(
        exec,
        (signal) => downloadAudio(ctx, exec, url, ['TTS-Next'], fileName, signal, destination),
        REQUEST_TIMEOUT_MS,
      )
      return resultOf(payload, filePath, bytes, format)
    },
  }
}

/** Register both Qwen audio tools; disposal unregisters them. */
export function registerQwenAudioTools(ctx) {
  ctx.effect(() => ctx.tools.register(createQwenTtsTool(ctx)), 'media-qwen: qwen_tts tool')
  ctx.effect(() => ctx.tools.register(createQwenAudioTool(ctx)), 'media-qwen: qwen_audio tool')
}
