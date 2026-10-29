/**
 * The pool's runtime configuration: a module-level snapshot that the live
 * watcher reads on every tick. Set once per apply() from the plugin Config.
 */

let config = {
  concurrency: 2,
  defaultInstanceType: 'default',
  pollIntervalSeconds: 30,
  retryStartupFailures: true,
  maxStartupRetries: 2,
  startupFailCodes: ['1000'],
  startupFailMaxElapsedS: 90,
}

/** Replace the pool config the live watcher reads. */
export function setPoolConfig(next) {
  config = { ...config, ...next }
}

/** The current pool config snapshot. */
export function poolConfig() {
  return config
}
