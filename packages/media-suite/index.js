/**
 * Host half of the media-suite bundle.
 *
 * The suite is a distribution shell: its bundle patch mounts the provider
 * packages, so installing the suite once gives the whole family.
 *
 * It deliberately has no Config, no Settings page, and no shared output setting.
 * Generated files always land under the Session directory's `output` folder, and
 * a tool call that needs a different destination passes an `output` argument for
 * that one call. Nothing about where a file goes belongs in profile
 * configuration.
 *
 * It performs no provider API calls, holds no API keys, and registers no model
 * tools.
 */

export const name = 'media-suite'
export const inject = []

/**
 * Mount the suite.
 *
 * The provider packages are separate bundles with their own patches; their rows
 * come from those patches, not from this one. Re-inserting the same ids here
 * would collide with them and stop both providers from activating.
 */
export function apply() {
  // Nothing to register: composition is the suite's whole contribution.
}
