/**
 * Host half of the media-suite bundle.
 *
 * The suite is a distribution shell and a shared-settings owner:
 *
 * - its bundle patch mounts the provider packages, so installing the suite once
 *   gives the whole family;
 * - it publishes `mediaSettings`, the one place cross-provider settings live;
 * - it renders one Settings page for those global values.
 *
 * It performs no provider API calls, holds no API keys, and registers no model
 * tools. Provider packages read `mediaSettings` when present and fall back to
 * their own defaults when the suite is absent, so every package stays usable on
 * its own.
 */

import Schema from '@deepseek-ai/schemastery'
import { resolve, isAbsolute } from 'node:path'

export const name = 'media-suite'
export const inject = []

/**
 * Config schema.
 *
 * `outputRoot` is the single cross-provider setting: every provider writes below
 * `<outputRoot>/media/<provider>/...`. An empty value means "the Session
 * directory's `output` folder", which is also what a provider uses when the
 * suite is not installed.
 */
export const Config = Schema.object({
  outputRoot: Schema.string().default('')
    .description('生成文件的根目录。留空表示使用当前会话目录下的 output 文件夹。可以填绝对路径或相对路径。'),
})

/** Resolve the configured root, or the Session-relative fallback. */
function configuredRoot(config) {
  const value = typeof config?.outputRoot === 'string' ? config.outputRoot.trim() : ''
  return value.length === 0 ? '' : value
}

/**
 * Mount the shared settings service and the Settings page.
 *
 * @param ctx - plugin context.
 * @param config - `{ outputRoot }` from the profile patch.
 */
export function apply(ctx, config) {
  const service = {
    /** The configured root, or an empty string for the provider default. */
    get outputRoot() {
      return configuredRoot(config)
    },
    /** Resolve a root value against a session directory. */
    resolveRoot(sessionDirectory) {
      const value = configuredRoot(config)
      if (value.length === 0) return resolve(sessionDirectory, 'output')
      return isAbsolute(value) ? value : resolve(sessionDirectory, value)
    },
  }

  ctx.effect(() => ctx.provide('mediaSettings', service), 'media-suite: mediaSettings service')
}
