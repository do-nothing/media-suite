/**
 * Run every test file without the Node test runner's file discovery.
 *
 * `node --test tests/` spawns a child process per file, which a confined shell
 * blocks (EPERM). This runs the files in-process instead, so `npm test` works
 * the same way whether or not a sandbox is present.
 *
 * Run: `node tests/run-all.mjs`
 */

import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const files = readdirSync(here)
  .filter((name) => name.endsWith('.test.mjs'))
  .sort()

if (files.length === 0) {
  console.error('no *.test.mjs files found in', here)
  process.exit(1)
}

for (const name of files) {
  console.log(`\n=== ${name} ===`)
  // Each file registers its tests with node:test on import; the runner reports
  // them as they complete and the process exit code reflects any failure.
  await import(pathToFileURL(join(here, name)).href)
}
