/**
 * Client half of the media-suite bundle.
 *
 * The suite has no settings of its own: provider keys live on each provider's
 * page, and the output location is a per-call argument rather than a profile
 * setting. This module deliberately registers nothing, and exists only because a
 * bundle's client entry is declared in `package.json`.
 */
window.__ModuleLoader__.load({
  id: '@tmmk/media-suite',
  factory(require) {
    const module = { exports: {} }
    const exports = module.exports

    /**
     * No slots, no locale, no Remote contribution. The suite is a composition
     * layer: installing it mounts the provider bundles, and each of those owns
     * its own settings page.
     */
    exports.inject = []
    exports.apply = function apply() {}

    return module.exports
  },
})
