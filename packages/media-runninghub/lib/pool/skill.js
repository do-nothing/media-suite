/**
 * The `runninghub-workflow` runtime skill: the process-level rules for using
 * the workflow task pool. It ships as a file inside the package and is
 * registered through `ctx.skills.register()` during apply, so every session
 * sees it regardless of cwd and no filesystem skill provider is involved.
 */

import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SKILL_PATH = join(PKG_DIR, 'skill', 'runninghub-workflow', 'SKILL.md')

/** Register the workflow skill on ctx.skills. Safe to call once per apply. */
export function registerWorkflowSkill(ctx) {
  const skills = ctx.get('skills')
  if (skills === undefined) return
  ctx.effect(
    () => registerOnce(skills),
    'media-runninghub: runninghub-workflow skill',
  )
}

async function registerOnce(skills) {
  let content
  try {
    content = await readFile(SKILL_PATH, 'utf8')
  } catch (error) {
    throw new Error(`media-runninghub: cannot read the workflow skill at ${SKILL_PATH}: ${error?.message ?? error}`)
  }
  const { name, description, whenToUse, body } = splitFrontmatter(content)
  skills.register({
    name,
    description,
    ...(whenToUse !== undefined ? { whenToUse } : {}),
    source: 'media-runninghub',
    content: body,
    path: SKILL_PATH,
  })
}

/** Split a SKILL.md into its frontmatter fields and body. */
function splitFrontmatter(raw) {
  const firstLineEnd = raw.indexOf('\n')
  if (firstLineEnd < 0 || raw.slice(0, firstLineEnd).replace(/\r$/, '') !== '---') {
    throw new Error('workflow skill file has no frontmatter')
  }
  const rest = raw.slice(firstLineEnd + 1)
  const closing = rest.indexOf('\n---')
  if (closing < 0) throw new Error('workflow skill frontmatter is unterminated')
  const header = rest.slice(0, closing)
  const body = rest.slice(closing + 4).replace(/^\r?\n/, '')
  const fields = {}
  for (const line of header.split(/\r?\n/)) {
    const match = /^([A-Za-z][A-Za-z0-9-]*):\s*(.*)$/.exec(line)
    if (!match) continue
    let value = match[2].trim()
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) value = value.slice(1, -1)
    fields[match[1]] = value
  }
  if (!fields.name || !fields.description) {
    throw new Error('workflow skill frontmatter requires name and description')
  }
  return {
    name: fields.name,
    description: fields.description,
    whenToUse: fields.whenToUse,
    body,
  }
}
