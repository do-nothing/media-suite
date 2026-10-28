/**
 * Client half of the media-suite bundle: one Settings page for the cross-provider
 * settings that belong to the suite rather than to any single provider.
 *
 * The page edits the plugin's own Config through the profile's settings form, so
 * saving goes through the same validation and persistence path as the Plugins
 * page. It holds no secrets and performs no provider calls.
 */
window.__ModuleLoader__.load({
  id: 'media-suite',
  factory(require) {
    const module = { exports: {} }
    const exports = module.exports

    const React = require('react')
    const h = React.createElement

    const NS = 'mediaSuite'

    const DICTS = {
      zh: {
        sectionLabel: '媒体工具',
        title: '媒体工具',
        intro: '媒体插件家族的全局设置。各 provider 的 Key 在各自的设置页里配置。',
        outputRootLabel: '输出根目录',
        outputRootHint: '留空表示使用当前会话目录下的 output 文件夹。生成结果会写到 <根目录>/media/<provider>/ 下。',
        outputRootPlaceholder: '留空使用会话目录下的 output',
        save: '保存',
        saving: '保存中…',
        saved: '已保存',
        saveFailed: '保存失败：{message}',
        loadFailed: '读取设置失败：{message}',
        loading: '正在读取设置…',
        readonlyNote: '当前配置来源不允许写入；请在 profile 的 cordis.patch.yml 中修改。',
      },
      en: {
        sectionLabel: 'Media Tools',
        title: 'Media Tools',
        intro: 'Global settings for the media plugin family. Each provider configures its own keys on its own settings page.',
        outputRootLabel: 'Output root',
        outputRootHint: 'Leave empty to use the current session directory\'s output folder. Results are written under <root>/media/<provider>/.',
        outputRootPlaceholder: 'Empty uses the session output folder',
        save: 'Save',
        saving: 'Saving…',
        saved: 'Saved',
        saveFailed: 'Save failed: {message}',
        loadFailed: 'Could not read settings: {message}',
        loading: 'Reading settings…',
        readonlyNote: 'The active configuration source is read-only; edit the profile cordis.patch.yml instead.',
      },
    }

    const CSS = `
.media-suite-page { display: flex; flex-direction: column; gap: 14px; color: var(--dsw-alias-label-primary); }
.media-suite-page h2 { margin: 0; font-size: 16px; line-height: 24px; font-weight: 600; }
.media-suite-intro { margin: 0; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-secondary); }
.media-suite-card { display: flex; flex-direction: column; gap: 8px; padding: 14px 16px; background: var(--dsw-alias-bg-layer-1); border: 0.5px solid var(--dsw-alias-border-l1); border-radius: 12px; }
.media-suite-label { font-size: 14px; line-height: 22px; font-weight: 600; }
.media-suite-hint { margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
.media-suite-input { box-sizing: border-box; width: 100%; height: 32px; padding: 0 10px; font-size: 13px; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-base); border: 0.5px solid var(--dsw-alias-border-l2); border-radius: 8px; outline: none; }
.media-suite-input:focus { border-color: var(--dsw-alias-brand-primary); }
.media-suite-input:disabled { opacity: 0.5; cursor: not-allowed; }
.media-suite-input::placeholder { color: var(--dsw-alias-label-secondary); }
.media-suite-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.media-suite-btn { height: 28px; padding: 0 12px; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-primary); background: transparent; border: 0.5px solid var(--dsw-alias-border-l2); border-radius: 8px; cursor: pointer; }
.media-suite-btn:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); }
.media-suite-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.media-suite-btn.is-primary { color: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-brand-primary); }
.media-suite-msg { font-size: 12px; line-height: 18px; }
.media-suite-msg.is-ok { color: var(--dsw-alias-state-success-primary); }
.media-suite-msg.is-error { color: var(--dsw-alias-state-error-primary); }
.media-suite-error { margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-state-error-primary); }
.media-suite-muted { margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
`

    /** Render an error thrown or rejected by a Remote call into one line. */
    function messageOf(error) {
      if (error && typeof error.message === 'string' && error.message.length > 0) return error.message
      return String(error)
    }

    /** Re-render the page when the active locale changes. */
    function useLocaleRevision(locale) {
      const [, setRevision] = React.useState(0)
      React.useEffect(() => {
        if (locale === undefined || typeof locale.subscribe !== 'function') return undefined
        return locale.subscribe(() => setRevision(revision => revision + 1))
      }, [locale])
    }

    /**
     * The Settings page.
     *
     * `ctx.settings` owns the form for this plugin's own Config: `describe`
     * returns the current value and revision, `update` writes it back through the
     * profile patch. The entry id here is `media-suite`, matching the row the
     * bundle patch inserts.
     */
    function MediaSuitePage({ ctx }) {
      const locale = ctx.get('locale')
      useLocaleRevision(locale)
      const t = ctx.locale.bind(NS)

      const [draft, setDraft] = React.useState(null)
      const [revision, setRevision] = React.useState(undefined)
      const [writable, setWritable] = React.useState(true)
      const [busy, setBusy] = React.useState(false)
      const [message, setMessage] = React.useState(null)
      const [loadError, setLoadError] = React.useState(null)

      React.useEffect(() => {
        const remote = ctx.get('remote.settings')
        if (remote === undefined || typeof remote.describe !== 'function') {
          setLoadError(t('loadFailed', { message: 'settings namespace unavailable' }))
          return
        }
        let disposed = false
        Promise.resolve()
          .then(() => remote.describe())
          .then((described) => {
            if (disposed) return
            const views = Array.isArray(described?.namespaces)
              ? described.namespaces
              : Array.isArray(described) ? described : []
            const view = views.find(item => item?.namespace === 'media-suite' || item?.id === 'media-suite')
            if (view === undefined) {
              setDraft('')
              return
            }
            const value = view.value ?? view.values ?? view.config ?? {}
            setDraft(typeof value.outputRoot === 'string' ? value.outputRoot : '')
            setRevision(view.revision)
            if (view.writable === false) setWritable(false)
          })
          .catch((error) => {
            if (!disposed) setLoadError(t('loadFailed', { message: messageOf(error) }))
          })
        return () => { disposed = true }
      }, [])

      const save = () => {
        const remote = ctx.get('remote.settings')
        if (remote === undefined || typeof remote.update !== 'function' || draft === null) return
        setBusy(true)
        setMessage(null)
        Promise.resolve()
          .then(() => remote.update('media-suite', { outputRoot: draft.trim() }, revision))
          .then((view) => {
            if (view !== null && typeof view === 'object' && typeof view.revision === 'number') {
              setRevision(view.revision)
            }
            setMessage({ kind: 'ok', text: t('saved') })
          })
          .catch((error) => setMessage({ kind: 'error', text: t('saveFailed', { message: messageOf(error) }) }))
          .then(() => setBusy(false))
      }

      return h('section', { className: 'media-suite-page' },
        h('style', null, CSS),
        h('h2', null, t('title')),
        h('p', { className: 'media-suite-intro' }, t('intro')),
        loadError !== null
          ? h('p', { className: 'media-suite-error', role: 'alert' }, loadError)
          : null,
        draft === null
          ? h('p', { className: 'media-suite-muted' }, t('loading'))
          : h('div', { className: 'media-suite-card' },
              h('span', { className: 'media-suite-label' }, t('outputRootLabel')),
              h('p', { className: 'media-suite-hint' }, t('outputRootHint')),
              h('input', {
                className: 'media-suite-input',
                type: 'text',
                spellCheck: false,
                value: draft,
                placeholder: t('outputRootPlaceholder'),
                disabled: busy || !writable,
                onChange: (event) => setDraft(event.target.value),
              }),
              h('div', { className: 'media-suite-actions' },
                h('button', {
                  type: 'button',
                  className: 'media-suite-btn is-primary',
                  disabled: busy || !writable,
                  onClick: save,
                }, busy ? t('saving') : t('save')),
                message !== null
                  ? h('span', {
                      className: 'media-suite-msg ' + (message.kind === 'ok' ? 'is-ok' : 'is-error'),
                      role: message.kind === 'ok' ? 'status' : 'alert',
                    }, message.text)
                  : null
              ),
              writable ? null : h('p', { className: 'media-suite-muted' }, t('readonlyNote'))
            )
      )
    }

    exports.inject = ['slots', 'remote', 'remote.settings', 'locale']

    exports.apply = function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, DICTS), 'media-suite: locale')

      const t = ctx.locale.bind(NS)
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'media-suite',
        order: 39,
        label: () => t('sectionLabel'),
        locale: NS,
      }, function MediaSuiteSection() {
        return h(MediaSuitePage, { ctx })
      }))
    }

    return module.exports
  },
})
