/**
 * RunningHub file transfer for workflow inputs and outputs.
 *
 * Upload (workflow inputs):
 *   POST <site>/task/openapi/upload   multipart: apiKey, fileType=input, file
 *   → data.fileName (e.g. "api/xxx.jpg") — this is the nodeInfoList fieldValue
 *
 * A node input value for a file-typed param is either a local path (upload it,
 * with a cache), an already-usable identifier (api/...), or a URL.
 */

import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { basename } from 'node:path'

const SITES = {
  cn: 'https://www.runninghub.cn',
  intl: 'https://www.runninghub.ai',
}
const UPLOAD_PATH = '/task/openapi/upload'

export const FILE_TYPES = new Set(['image', 'audio', 'video'])

/** How a file param value should be handled. */
export function classifyFileValue(value) {
  if (typeof value !== 'string' || !value.trim()) return 'unknown'
  const v = value.trim()
  if (v.startsWith('http://') || v.startsWith('https://')) return 'url'
  if (v.startsWith('api/')) return 'rh_id'
  return 'local'
}

/** Upload one input file to the workflow API. Never throws. */
export async function uploadFile(apiKey, filePath, site) {
  const url = `${SITES[site] ?? SITES.cn}${UPLOAD_PATH}`
  let info
  try {
    info = await stat(filePath)
  } catch {
    return { ok: false, errorType: 'FILE_NOT_FOUND', errorMessage: `file not found: ${filePath}` }
  }
  if (!info.isFile()) {
    return { ok: false, errorType: 'FILE_NOT_FOUND', errorMessage: `not a file: ${filePath}` }
  }

  const form = new FormData()
  form.append('apiKey', apiKey)
  form.append('fileType', 'input')
  let stream
  try {
    stream = createReadStream(filePath)
    form.append('file', new Blob([await new Response(stream).arrayBuffer()], {
      type: guessMime(filePath),
    }), basename(filePath))
  } catch (error) {
    return { ok: false, errorType: 'UPLOAD_FAILED', errorMessage: `cannot read file: ${error?.message ?? error}` }
  }

  let response
  try {
    response = await fetch(url, { method: 'POST', body: form })
  } catch (error) {
    return { ok: false, errorType: 'NETWORK', errorMessage: String(error) }
  }
  let parsed
  try {
    parsed = JSON.parse(await response.text())
  } catch {
    return { ok: false, errorType: 'NETWORK', errorMessage: 'invalid upload response' }
  }
  if (parsed.code !== 0) {
    return {
      ok: false,
      errorType: 'UPLOAD_FAILED',
      errorMessage: String(parsed.msg ?? `HTTP ${response.status}`),
    }
  }
  const fileName = parsed.data?.fileName
  if (!fileName) {
    return { ok: false, errorType: 'UPLOAD_FAILED', errorMessage: 'upload response missing fileName' }
  }
  return { ok: true, fileName: String(fileName), size: info.size }
}

function guessMime(filePath) {
  const ext = filePath.toLowerCase().split('.').pop()
  const table = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
    mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', flac: 'audio/flac',
    ogg: 'audio/ogg', aac: 'audio/aac',
    mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska', avi: 'video/x-msvideo',
  }
  return table[ext] ?? 'application/octet-stream'
}

/** Download one result URL to a local path. Never throws. */
export async function downloadFile(url, outputPath) {
  try {
    const response = await fetch(url)
    if (!response.ok) {
      return { ok: false, errorType: 'NETWORK', errorMessage: `HTTP ${response.status}` }
    }
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length === 0) {
      return { ok: false, errorType: 'NETWORK', errorMessage: 'empty download' }
    }
    await (await import('node:fs/promises')).writeFile(outputPath, buffer)
    return { ok: true, path: outputPath, size: buffer.length }
  } catch (error) {
    return { ok: false, errorType: 'NETWORK', errorMessage: String(error) }
  }
}
