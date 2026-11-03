/**
 * One-off migration: add the `music-yue2-cover` task type to our bundled
 * task-types.json, copying it verbatim from the skill repo so the two stay
 * identical.
 *
 * Run: node scripts/add-cover-type.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const ours = join(here, '..', 'config', 'task-types.json')
const skill = 'C:/Users/lj110/dev/OpenClaw_RH_Skills/runninghub/config/task-types.json'

const ourDoc = JSON.parse(readFileSync(ours, 'utf8'))
const skillDoc = JSON.parse(readFileSync(skill, 'utf8'))

const TYPE_ID = 'music-yue2-cover'

if (ourDoc.types.some((t) => t.typeId === TYPE_ID)) {
  console.log(`${TYPE_ID} already present; nothing to do`)
  process.exit(0)
}

const source = skillDoc.types.find((t) => t.typeId === TYPE_ID)
if (!source) {
  console.error(`${TYPE_ID} not found in the skill config`)
  process.exit(1)
}

// Insert right after `music-yue2` so related types stay together.
const anchor = ourDoc.types.findIndex((t) => t.typeId === 'music-yue2')
if (anchor < 0) {
  console.error('anchor type music-yue2 not found; append instead')
  ourDoc.types.push(source)
} else {
  ourDoc.types.splice(anchor + 1, 0, source)
}

writeFileSync(ours, `${JSON.stringify(ourDoc, null, 2)}\n`, 'utf8')
console.log(`inserted ${TYPE_ID} after music-yue2; total types: ${ourDoc.types.length}`)
