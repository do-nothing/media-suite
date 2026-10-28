/**
 * Host-side `runninghub_image` tool: Nano Banana 2 image generation.
 *
 * One tool covers both directions, chosen by whether reference images were
 * given: no images uses `text-to-image`, one or more uses `image-to-image` with
 * `imageUrls`. The call is synchronous — submit, poll until the task settles,
 * then download the first result below the configured output root.
 *
 * `sync` surface uses the enterprise-shared key, because RunningHub's model API
 * only accepts that key type.
 */

import {
  BASE_URL,
  SHARED_REF,
  ToolError,
  apiKeyOf,
  downloadResult,
  extensionFor,
  postJson,
  providerError,
  resolveMedia,
  stamp,
  textHash,
  withDeadline,
} from './shared.js'

const CHANNEL_ENDPOINTS = {
  lowprice: {
    text: 'rhart-image-n-g31-flash/text-to-image',
    edit: 'rhart-image-n-g31-flash/image-to-image',
  },
  official: {
    text: 'rhart-image-n-g31-flash-official/text-to-image',
    edit: 'rhart-image-n-g31-flash-official/image-to-image',
  },
}

const ASPECT_RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9', '5:4', '4:5']
const RESOLUTIONS = ['1k', '2k', '4k']
const MAX_IMAGES = 10
const INLINE_LIMIT_BYTES = 5 * 1024 * 1024

const REQUEST_TIMEOUT_MS = 180000
const POLL_INTERVAL_MS = 5000
const RESULT_TIMEOUT_MS = 900000

/** A poll callback that sleeps without blocking the event loop. */
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new ToolError('CANCELLED', '请求已取消。'))
      return
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new ToolError('CANCELLED', '请求已取消。'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Submit one generation task and return its task id.
 *
 * A successful submit answers with a flat task object (`taskId`, `status`,
 * `errorCode`, `errorMessage`, `results`, ...) and no `code` envelope. Failures
 * use a `code`/`msg` envelope, so the two shapes are distinguished by the
 * presence of `taskId` rather than by a status code.
 */
async function submit(endpoint, payload, apiKey, signal) {
  const result = await postJson(`${BASE_URL}/${endpoint}`, payload, apiKey, signal)
  const taskId = result.payload?.taskId ?? result.payload?.data?.taskId
  if (result.ok && (typeof taskId === 'string' || typeof taskId === 'number')) {
    if (result.payload?.errorCode !== undefined && result.payload.errorCode !== '') {
      throw providerError(result.payload, apiKey, result.status)
    }
    return String(taskId)
  }
  throw providerError(result.payload, apiKey, result.status)
}

/** Poll one task until it settles; returns the settled task object. */
async function poll(taskId, apiKey, signal) {
  const deadline = Date.now() + RESULT_TIMEOUT_MS
  let lastStatus = 'UNKNOWN'

  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS, signal)
    const result = await postJson(`${BASE_URL}/query`, { taskId }, apiKey, signal)
    const task = result.payload?.data ?? result.payload
    if (!result.ok || task === null || typeof task !== 'object') {
      throw providerError(result.payload, apiKey, result.status)
    }

    lastStatus = typeof task.status === 'string' ? task.status : 'UNKNOWN'
    if (lastStatus === 'SUCCESS') return task
    if (lastStatus === 'FAILED') {
      const detail = task.errorMessage ?? task.failedReason?.errorMessage ?? task.errorCode ?? '未知原因'
      throw new ToolError('TASK_FAILED', `RunningHub 任务失败：${detail}`)
    }
  }

  throw new ToolError('TIMEOUT', `RunningHub 任务超时（最后状态 ${lastStatus}）。`)
}

/** Read the cost fields RunningHub reports, when present. */
function costOf(data) {
  const usage = data?.usage ?? {}
  const cost = {}
  const coins = usage.consumeCoins ?? usage.coins
  if (coins !== undefined && coins !== null && String(coins) !== '0') cost.coins = String(coins)
  const money = usage.consumeMoney ?? usage.cost
  if (money !== undefined && money !== null && String(money) !== '0') cost.cost = String(money)
  const third = usage.thirdPartyConsumeMoney
  if (third !== undefined && third !== null && String(third) !== '0') cost.thirdParty = String(third)
  if (typeof usage.taskCostTime === 'string' && usage.taskCostTime !== '0') {
    cost.durationSeconds = Number(usage.taskCostTime)
  } else if (typeof usage.taskCostTime === 'number' && usage.taskCostTime > 0) {
    cost.durationSeconds = usage.taskCostTime
  }
  return cost
}

/** Validate the tool arguments before any network work. */
function validateArgs(args) {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) {
    throw new ToolError('INVALID_ARGS', '参数必须是对象。')
  }
  const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : ''
  if (prompt.length === 0) throw new ToolError('INVALID_ARGS', 'prompt 不能为空。')

  let images = []
  if (args.images !== undefined) {
    if (!Array.isArray(args.images)) {
      throw new ToolError('INVALID_ARGS', 'images 必须是数组。')
    }
    if (args.images.length > MAX_IMAGES) {
      throw new ToolError('INVALID_ARGS', `images 最多 ${MAX_IMAGES} 张。`)
    }
    for (const image of args.images) {
      if (typeof image !== 'string' || image.trim().length === 0) {
        throw new ToolError('INVALID_ARGS', 'images 的每一项都必须是非空路径或 URL。')
      }
    }
    images = args.images.map((image) => image.trim())
  }

  const aspectRatio = typeof args.aspectRatio === 'string' ? args.aspectRatio : '16:9'
  if (!ASPECT_RATIOS.includes(aspectRatio)) {
    throw new ToolError('INVALID_ARGS', `aspectRatio 只支持 ${ASPECT_RATIOS.join(' / ')}。`)
  }

  const resolution = typeof args.resolution === 'string' ? args.resolution : '2k'
  if (!RESOLUTIONS.includes(resolution)) {
    throw new ToolError('INVALID_ARGS', `resolution 只支持 ${RESOLUTIONS.join(' / ')}。`)
  }

  return { prompt, images, aspectRatio, resolution }
}

/** The model-facing tool definition. */
function createRunningHubImageTool(ctx, config) {
  const channel = config?.channel === 'official' ? 'official' : 'lowprice'

  return {
    name: 'runninghub_image',
    description:
      '用 RunningHub​ Nano​ Banana 2 生成图片：不传 images 就是文生图，传 1–10 张参考图就是图生图/改图。'
      + '同步执行，一次返回一张图片文件。'
      + '适合单张出图、改图、多图融合；批量生成请等任务池能力。',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: '画面描述。建议用英文写详细描述，模型效果更好。',
        },
        images: {
          type: 'array',
          items: { type: 'string' },
          description: '参考图，最多 10 张；本地路径或 http(s) URL。不传就是文生图。',
        },
        aspectRatio: {
          type: 'string',
          enum: ASPECT_RATIOS,
          description: '画面比例，默认 16:9。',
        },
        resolution: {
          type: 'string',
          enum: RESOLUTIONS,
          description: '分辨率，默认 2k。',
        },
        output: {
          type: 'string',
          description: '可选的输出目录；相对路径按当前工作目录解析。默认写到 <当前目录>/output/media/runninghub/image/。',
        },
      },
      required: ['prompt'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          format: { type: 'string' },
          bytes: { type: 'integer' },
          mode: { type: 'string' },
          requestId: { type: 'string' },
          coins: { type: 'string' },
          cost: { type: 'string' },
          thirdParty: { type: 'string' },
          durationSeconds: { type: 'number' },
        },
        required: ['file', 'format', 'bytes', 'mode'],
        additionalProperties: false,
      },
      render: (_args, value) => {
        const fees = []
        if (value.coins !== undefined) fees.push(`${value.coins} RH 币`)
        if (value.cost !== undefined) fees.push(`现金 ${value.cost}`)
        if (value.thirdParty !== undefined) fees.push(`第三方 ${value.thirdParty}`)
        const cost = fees.length > 0 ? `，花费 ${fees.join('，')}` : ''
        return [{
          type: 'text',
          text: `已生成图片：${value.file}（${value.mode}${cost}）`,
        }]
      },
    },
    timeoutMs: RESULT_TIMEOUT_MS + REQUEST_TIMEOUT_MS,
    async execute(args, exec) {
      const input = validateArgs(args)
      const apiKey = await apiKeyOf(ctx, SHARED_REF, '企业级-共享，用于模型 API')

      const endpoints = CHANNEL_ENDPOINTS[channel]
      const mode = input.images.length === 0 ? 'text-to-image' : 'image-to-image'

      const payload = {
        prompt: input.prompt,
        aspectRatio: input.aspectRatio,
        resolution: input.resolution,
      }

      if (input.images.length > 0) {
        const resolved = []
        for (const image of input.images) {
          resolved.push(await resolveMedia(ctx, exec, image, apiKey, exec.signal, INLINE_LIMIT_BYTES))
        }
        payload.imageUrls = resolved
      }

      const taskId = await withDeadline(
        exec,
        (signal) => submit(input.images.length === 0 ? endpoints.text : endpoints.edit, payload, apiKey, signal),
        REQUEST_TIMEOUT_MS,
      )

      const data = await withDeadline(exec, (signal) => poll(taskId, apiKey, signal), RESULT_TIMEOUT_MS)

      const result = Array.isArray(data.results) ? data.results[0] : undefined
      const url = result?.url ?? result?.outputUrl
      if (typeof url !== 'string' || url.length === 0) {
        throw new ToolError('TASK_FAILED', 'RunningHub 任务成功但没有返回结果地址。')
      }

      const format = result?.outputType ?? extensionFor('image')
      const fileName = `${stamp()}-${mode}-${textHash(input.prompt)}.${format}`
      const destination = typeof args?.output === 'string' && args.output.trim().length > 0
        ? args.output.trim()
        : undefined
      const { filePath, bytes } = await withDeadline(
        exec,
        (signal) => downloadResult(ctx, exec, url, ['image'], fileName, signal, destination),
        REQUEST_TIMEOUT_MS,
      )

      const output = { file: filePath, format, bytes, mode }
      const requestId = data.requestId ?? result?.requestId
      if (typeof requestId === 'string' && requestId.length > 0) output.requestId = requestId
      Object.assign(output, costOf(data))
      return output
    },
  }
}

/** Register the RunningHub image tool for the `sync` surface. */
export function registerRunningHubSync(ctx, config) {
  ctx.effect(
    () => ctx.tools.register(createRunningHubImageTool(ctx, config)),
    'media-runninghub: runninghub_image tool',
  )
}
