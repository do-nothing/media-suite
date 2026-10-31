/**
 * Tests for `buildPayload`'s failure shape.
 *
 * The submit tool turns these into a `needs_input` answer, so what matters is
 * not the wording but the structure: every problem is reported in one pass,
 * each carries the param, its human label, a reason, and — for an enum — the
 * accepted values. A single opaque error string made the model guess.
 *
 * Run: `node tests/types.test.mjs`
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { buildPayload, getTaskType, loadTaskTypes } from '../lib/pool/types.js'

/** A resolveFile stub: no uploads, just echo the value back. */
const echoResolve = async (_param, value) => ({
  rhFileName: String(value),
  input: { param: _param.name, fieldName: _param.fieldName, localPath: null, rhFileName: String(value), cached: true },
})

test('a missing required param is reported with its label', async () => {
  const type = await getTaskType('image-gen-qwen')
  const result = await buildPayload(type, {}, echoResolve)
  assert.equal(result.ok, false)
  assert.ok(Array.isArray(result.missing))
  const prompt = result.missing.find((m) => m.param === 'prompt')
  assert.ok(prompt, 'prompt must be reported')
  assert.equal(prompt.label, '画面描述')
  assert.equal(prompt.why, '必填参数缺失')
})

test('every problem is reported in one pass, not just the first', async () => {
  // The old shape returned on the first problem, so a caller fixed one thing at
  // a time across several turns. One pass means one correction round.
  const type = await getTaskType('image-gen-qwen')
  const enumParam = type.params.find((p) => Array.isArray(p.enum) && p.enum.length > 0)
  assert.ok(enumParam, 'this type is expected to carry an enum param')
  const params = { [enumParam.name]: '__NOT_IN_LIST__' }
  const result = await buildPayload(type, params, echoResolve)
  assert.equal(result.ok, false)
  assert.ok(result.missing.length >= 2, 'both the missing prompt and the bad enum must appear')
  assert.ok(result.missing.some((m) => m.param === 'prompt'))
  assert.ok(result.missing.some((m) => m.param === enumParam.name))
})

test('an out-of-list enum carries the accepted values', async () => {
  const type = await getTaskType('image-gen-qwen')
  const enumParam = type.params.find((p) => Array.isArray(p.enum) && p.enum.length > 0)
  const result = await buildPayload(type, { prompt: 'x', [enumParam.name]: '__NOT_IN_LIST__' }, echoResolve)
  assert.equal(result.ok, false)
  const bad = result.missing.find((m) => m.param === enumParam.name)
  assert.ok(bad)
  assert.deepEqual(bad.accept, enumParam.enum)
  assert.ok(bad.why.includes('不在允许值内'))
})

test('an unknown param is reported rather than silently ignored', async () => {
  const type = await getTaskType('image-gen-qwen')
  const result = await buildPayload(type, { prompt: 'x', notAParam: 1 }, echoResolve)
  assert.equal(result.ok, false)
  const unknown = result.missing.find((m) => m.param === 'notAParam')
  assert.ok(unknown, 'the unknown name must be reported')
  assert.ok(unknown.why.includes('不是'))
})

test('a media value that cannot be resolved is reported as missing', async () => {
  // Upload failure is as "missing" as an absent value: the caller has to supply
  // a usable path or URL, and the message must say which param.
  const types = await loadTaskTypes()
  const withMedia = types.find((t) => t.params.some((p) => p.type === 'image' || p.type === 'video' || p.type === 'audio'))
  assert.ok(withMedia, 'expected at least one type with a media param')
  const mediaParam = withMedia.params.find((p) => p.type === 'image' || p.type === 'video' || p.type === 'audio')
  const params = {}
  for (const p of withMedia.params) if (p.required && p.name !== mediaParam.name) params[p.name] = 'x'
  const failing = async () => { throw new Error('文件不存在或不可用: nope.png') }
  const result = await buildPayload(withMedia, { ...params, [mediaParam.name]: 'nope.png' }, failing)
  assert.equal(result.ok, false)
  const entry = result.missing.find((m) => m.param === mediaParam.name)
  assert.ok(entry, 'the media param must be reported')
  assert.ok(entry.why.includes('不存在'))
})

test('a complete payload has no missing list', async () => {
  const type = await getTaskType('image-gen-qwen')
  const params = { prompt: 'a cat' }
  const result = await buildPayload(type, params, echoResolve)
  assert.equal(result.ok, true)
  assert.equal(result.missing, undefined)
  assert.ok(Array.isArray(result.payload.nodeInfoList))
})
