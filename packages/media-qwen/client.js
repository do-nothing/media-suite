/**
 * Client half of the media-qwen bundle: one Settings page that configures the
 * DashScope API key and shows its validation status.
 *
 * The page never owns the secret. Reading goes through
 * `ctx.remote.credentials.describe`, which returns presence/source/writability
 * only, and writing goes through `ctx.remote.credentials.set` / `.unset` — the
 * built-in Host controller over `$DSH_HOME/.credentials.yaml`. No value is
 * echoed back, kept in page state, or cached anywhere else.
 */
window.__ModuleLoader__.load({
  id: '@tmmk/media-qwen',
  factory(require) {
    const module = { exports: {} }
    const exports = module.exports

    const React = require('react')
    const h = React.createElement

    const NS = 'mediaQwen'

    /** The credential this page owns. */
    const KEY = {
      ref: 'DASHSCOPE_API_KEY',
      provider: '阿里云百炼 · DashScope',
    }

    /**
     * The Host method this page calls. The Host registers `mediaQwenController`
     * with a `typertRemote` binding; this contribution installs the matching
     * `ctx.remote.mediaQwen` namespace on the Client. Only the method name
     * crosses the wire — no key ever leaves the Host.
     */
    const REMOTE_CONTRIBUTION = {
      package: 'media-qwen',
      descriptors: [
        {
          id: 'media-qwen#mediaQwen/dashscopeStatus',
          service: 'mediaQwenController',
          namespace: 'mediaQwen',
          method: 'dashscopeStatus',
          invocation: { kind: 'direct' },
          parameters: [],
          result: {
            mode: 'strict',
            typeSymbol: 'media-qwen#mediaQwen/dashscopeStatus:result',
            create: () => ({ parse: value => value }),
          },
        },
      ],
    }

    const DICTS = {
      zh: {
        sectionLabel: 'Qwen 媒体',
        title: 'Qwen 媒体',
        intro: '配置阿里云百炼 DashScope API Key。保存后立即写入本机凭据库，Qwen 工具在调用时读取。',
        loading: '正在读取密钥状态…',
        configured: '已配置',
        configuredStored: '已配置 · 凭据库',
        configuredEnv: '已配置 · 环境变量',
        configuredDotenv: '已配置 · .env',
        unconfigured: '未配置',
        save: '保存',
        saving: '保存中…',
        clear: '清除',
        clearing: '清除中…',
        saved: '已保存',
        cleared: '已清除',
        inputPlaceholder: '粘贴 DashScope API Key',
        replacePlaceholder: '已配置，输入新值可替换',
        readonlyNote: '当前凭据提供方不允许写入；请在 ~/.dsh/.credentials.yaml 中手动维护。',
        emptyInput: '请输入 API Key 后再保存。',
        loadFailed: '读取密钥状态失败：{message}',
        saveFailed: '保存失败：{message}',
        clearFailed: '清除失败：{message}',
        dsTitle: '账户状态',
        dsRefresh: '刷新',
        dsRefreshing: '刷新中…',
        dsRetry: '重试',
        dsLoading: '正在查询 DashScope 账户…',
        dsUnavailable: '账户状态服务不可用，请刷新页面后重试。',
        dsNoKey: '未配置',
        dsNoKeyHint: '保存 DashScope API Key 后，这里会显示账户状态。',
        dsReady: '账户就绪',
        dsInvalidKey: 'API Key 无效',
        dsUnreachable: '无法连接 DashScope',
        dsTimeout: '查询超时',
        dsHttpError: 'DashScope 返回错误',
        dsError: '查询失败',
        dsUnknown: '未知状态',
        dsModels: '{count} 个模型可用',
        dsRegionCn: '中国站',
        dsRegionIntl: '国际站',
        dsCheckedAt: '检查时间 {time}',
        dsInvalidDetail: 'DashScope 拒绝了该 Key：{message}',
        dsRequestFailed: '查询账户状态失败：{message}',
      },
      en: {
        sectionLabel: 'Qwen Media',
        title: 'Qwen Media',
        intro: 'Configure the Alibaba Cloud Model Studio (DashScope) API key. Saved keys go to the local credential store and are read by the Qwen tools at call time.',
        loading: 'Reading key status…',
        configured: 'Configured',
        configuredStored: 'Configured · store',
        configuredEnv: 'Configured · environment',
        configuredDotenv: 'Configured · .env',
        unconfigured: 'Not configured',
        save: 'Save',
        saving: 'Saving…',
        clear: 'Clear',
        clearing: 'Clearing…',
        saved: 'Saved',
        cleared: 'Cleared',
        inputPlaceholder: 'Paste the DashScope API key',
        replacePlaceholder: 'Configured — enter a new value to replace it',
        readonlyNote: 'The active credential provider is read-only; edit ~/.dsh/.credentials.yaml manually.',
        emptyInput: 'Enter an API key before saving.',
        loadFailed: 'Could not read key status: {message}',
        saveFailed: 'Save failed: {message}',
        clearFailed: 'Clear failed: {message}',
        dsTitle: 'Account',
        dsRefresh: 'Refresh',
        dsRefreshing: 'Refreshing…',
        dsRetry: 'Retry',
        dsLoading: 'Checking the DashScope account…',
        dsUnavailable: 'Account status is unavailable. Refresh the page and try again.',
        dsNoKey: 'Not configured',
        dsNoKeyHint: 'Save a DashScope API key to see account status here.',
        dsReady: 'Account ready',
        dsInvalidKey: 'Invalid API key',
        dsUnreachable: 'Cannot reach DashScope',
        dsTimeout: 'Request timed out',
        dsHttpError: 'DashScope returned an error',
        dsError: 'Status check failed',
        dsUnknown: 'Unknown status',
        dsModels: '{count} models available',
        dsRegionCn: 'China',
        dsRegionIntl: 'International',
        dsCheckedAt: 'Checked {time}',
        dsInvalidDetail: 'DashScope rejected this key: {message}',
        dsRequestFailed: 'Could not check account status: {message}',
      },
    }

    const CSS = `
.media-qwen-page { display: flex; flex-direction: column; gap: 14px; color: var(--dsw-alias-label-primary); }
.media-qwen-page h2 { margin: 0; font-size: 16px; line-height: 24px; font-weight: 600; }
.media-qwen-intro { margin: 0; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-secondary); }
.media-qwen-card { display: flex; flex-direction: column; gap: 10px; padding: 14px 16px; background: var(--dsw-alias-bg-layer-1); border: 0.5px solid var(--dsw-alias-border-l1); border-radius: 12px; }
.media-qwen-card-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.media-qwen-provider { font-size: 14px; line-height: 22px; font-weight: 600; }
.media-qwen-status { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
.media-qwen-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--dsw-alias-state-idle-primary); }
.media-qwen-status.is-on .media-qwen-dot { background: var(--dsw-alias-state-success-primary); }
.media-qwen-input { box-sizing: border-box; width: 100%; height: 32px; padding: 0 10px; font-size: 13px; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-base); border: 0.5px solid var(--dsw-alias-border-l2); border-radius: 8px; outline: none; }
.media-qwen-input:focus { border-color: var(--dsw-alias-brand-primary); }
.media-qwen-input:disabled { opacity: 0.5; cursor: not-allowed; }
.media-qwen-input::placeholder { color: var(--dsw-alias-label-secondary); }
.media-qwen-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.media-qwen-btn { height: 28px; padding: 0 12px; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-primary); background: transparent; border: 0.5px solid var(--dsw-alias-border-l2); border-radius: 8px; cursor: pointer; }
.media-qwen-btn:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); }
.media-qwen-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.media-qwen-btn.is-primary { color: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-brand-primary); }
.media-qwen-btn.is-danger { color: var(--dsw-alias-state-error-primary); border-color: transparent; }
.media-qwen-msg { font-size: 12px; line-height: 18px; }
.media-qwen-msg.is-ok { color: var(--dsw-alias-state-success-primary); }
.media-qwen-msg.is-error { color: var(--dsw-alias-state-error-primary); }
.media-qwen-error { margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-state-error-primary); }
.media-qwen-muted { margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
.media-qwen-account { display: flex; flex-direction: column; gap: 8px; padding: 12px; background: var(--dsw-alias-bg-layer-2); border: 0.5px solid var(--dsw-alias-border-l1); border-radius: 10px; }
.media-qwen-account-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.media-qwen-account-title { font-size: 12px; line-height: 18px; font-weight: 600; letter-spacing: 0.04em; color: var(--dsw-alias-label-secondary); text-transform: uppercase; }
.media-qwen-account-body { display: flex; flex-direction: column; gap: 6px; }
.media-qwen-account-main { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.media-qwen-account-status { display: inline-flex; align-items: center; gap: 6px; font-size: 14px; line-height: 22px; font-weight: 600; }
.media-qwen-account-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--dsw-alias-state-success-primary); }
.media-qwen-account-dot.is-warn { background: var(--dsw-alias-state-warn-primary); }
.media-qwen-account-dot.is-error { background: var(--dsw-alias-state-error-primary); }
.media-qwen-account-dot.is-idle { background: var(--dsw-alias-state-idle-primary); }
.media-qwen-account-meta { display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
.media-qwen-account-error { margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-state-error-primary); }
`

    /** Render an error thrown or rejected by a Remote call into one line. */
    function messageOf(error) {
      if (error && typeof error.message === 'string' && error.message.length > 0) return error.message
      return String(error)
    }

    /**
     * The Remote call envelope is `{ ok, value }` / `{ ok: false, error }`;
     * turn a refusal into a thrown error so the page's catch path reports the
     * provider's own message.
     */
    function unwrap(response, fallback = 'request was refused') {
      if (response && response.ok === true) return response.value
      const message = response && response.error && response.error.message
      throw new Error(typeof message === 'string' ? message : fallback)
    }

    /** Re-render the page when the active locale changes. */
    function useLocaleRevision(locale) {
      const [, setRevision] = React.useState(0)
      React.useEffect(() => {
        if (locale === undefined || typeof locale.subscribe !== 'function') return undefined
        return locale.subscribe(() => setRevision(revision => revision + 1))
      }, [locale])
    }

    /** A status that names the supplying layer, so ambient keys are distinct. */
    function statusText(t, info) {
      if (info === undefined || info.configured !== true) return t('unconfigured')
      switch (info.source) {
        case 'file': return t('configuredStored')
        case 'env': return t('configuredEnv')
        case 'project-env':
        case 'user-env': return t('configuredDotenv')
        default: return t('configured')
      }
    }

    /** A thousands-separated count for model totals. */
    function formatCount(value) {
      const number = Number.parseFloat(value)
      return Number.isFinite(number) ? number.toLocaleString() : String(value)
    }

    /** Dot tone for the DashScope key status. */
    function dashScopeTone(status) {
      if (status === 'ready') return 'ok'
      if (status === 'no_key') return 'idle'
      return 'error'
    }

    /** DashScope key status panel. */
    function DashScopeAccount({ t, status, loading, error, onRefresh }) {
      const keyStatus = status === null ? null : status.status
      const tone = keyStatus === null ? 'idle' : dashScopeTone(keyStatus)
      const keyLabels = {
        ready: t('dsReady'),
        no_key: t('dsNoKey'),
        invalid_key: t('dsInvalidKey'),
        unreachable: t('dsUnreachable'),
        timeout: t('dsTimeout'),
        http_error: t('dsHttpError'),
        error: t('dsError'),
      }
      const keyLabel = keyStatus === null ? t('dsUnknown') : (keyLabels[keyStatus] ?? t('dsUnknown'))
      const keyDetail = status !== null && typeof status.message === 'string' && status.message.length > 0
        ? status.message
        : null
      const keyMeta = []
      if (status !== null && typeof status.modelCount === 'string') {
        keyMeta.push(t('dsModels', { count: formatCount(status.modelCount) }))
      }
      if (status !== null && typeof status.region === 'string') {
        keyMeta.push(status.region === 'cn' ? t('dsRegionCn') : t('dsRegionIntl'))
      }
      if (status !== null && typeof status.checkedAt === 'string') {
        const date = new Date(status.checkedAt)
        if (!Number.isNaN(date.getTime())) keyMeta.push(t('dsCheckedAt', { time: date.toLocaleTimeString() }))
      }
      const canRetry = error !== null
        || (keyStatus !== null && keyStatus !== 'ready' && keyStatus !== 'no_key')

      return h('div', { className: 'media-qwen-account', 'aria-busy': loading ? 'true' : undefined },
        h('div', { className: 'media-qwen-account-head' },
          h('span', { className: 'media-qwen-account-title' }, t('dsTitle')),
          h('button', {
            type: 'button',
            className: 'media-qwen-btn',
            disabled: loading,
            onClick: onRefresh,
          }, loading ? t('dsRefreshing') : (canRetry ? t('dsRetry') : t('dsRefresh')))
        ),
        error !== null
          ? h('p', { className: 'media-qwen-account-error', role: 'alert' }, t('dsRequestFailed', { message: error }))
          : null,
        status === null
          ? (error === null
              ? h('p', { className: 'media-qwen-muted' }, loading ? t('dsLoading') : t('dsNoKeyHint'))
              : null)
          : h('div', { className: 'media-qwen-account-body' },
              keyStatus === 'no_key'
                ? h('p', { className: 'media-qwen-muted' }, t('dsNoKeyHint'))
                : h('div', { className: 'media-qwen-account-body' },
                    h('div', { className: 'media-qwen-account-main' },
                      h('span', { className: 'media-qwen-account-status' },
                        h('span', {
                          className: 'media-qwen-account-dot' + (tone === 'ok' ? '' : ' is-' + tone),
                          'aria-hidden': 'true',
                        }),
                        keyLabel
                      )
                    ),
                    keyMeta.length > 0
                      ? h('div', { className: 'media-qwen-account-meta' },
                          keyMeta.map((text, index) => h('span', { key: String(index) }, text)))
                      : null,
                    keyStatus === 'invalid_key' && keyDetail !== null
                      ? h('p', { className: 'media-qwen-account-error' }, t('dsInvalidDetail', { message: keyDetail }))
                      : null,
                    keyStatus !== 'ready'
                      && keyStatus !== 'invalid_key'
                      && keyStatus !== 'unreachable'
                      && keyStatus !== 'timeout'
                      && keyDetail !== null
                      ? h('p', { className: 'media-qwen-account-error' }, keyDetail)
                      : null
                  )
            )
      )
    }

    /** The single key card: status, a write-only input, Save and Clear. */
    function KeyCard({ ctx, t, entry, info, load, onChanged, extra }) {
      const ref = entry.ref
      const [draft, setDraft] = React.useState('')
      const [busy, setBusy] = React.useState(null)
      const [message, setMessage] = React.useState(null)
      const configured = info !== undefined && info.configured === true
      const managed = configured && info.source === 'file'
      const writable = info === undefined || info.writable !== false
      const disabled = busy !== null || !writable

      const report = (kind, text) => setMessage({ kind, text })

      const save = () => {
        const value = draft.trim()
        if (value.length === 0) {
          report('error', t('emptyInput'))
          return
        }
        setBusy('saving')
        setMessage(null)
        ctx.remote.credentials.set(ref, value)
          .then((response) => {
            unwrap(response)
            setDraft('')
            report('ok', t('saved'))
            return load().then(() => {
              if (typeof onChanged === 'function') onChanged()
            })
          })
          .catch((error) => report('error', t('saveFailed', { message: messageOf(error) })))
          .then(() => setBusy(null))
      }

      const clear = () => {
        setBusy('clearing')
        setMessage(null)
        ctx.remote.credentials.unset(ref)
          .then((response) => {
            unwrap(response)
            setDraft('')
            report('ok', t('cleared'))
            return load().then(() => {
              if (typeof onChanged === 'function') onChanged()
            })
          })
          .catch((error) => report('error', t('clearFailed', { message: messageOf(error) })))
          .then(() => setBusy(null))
      }

      const onKeyDown = (event) => {
        if (event.key === 'Enter' && !disabled) save()
      }

      return h('div', { className: 'media-qwen-card' },
        h('div', { className: 'media-qwen-card-head' },
          h('div', { className: 'media-qwen-provider' }, entry.provider),
          h('span', { className: 'media-qwen-status' + (configured ? ' is-on' : '') },
            h('span', { className: 'media-qwen-dot', 'aria-hidden': 'true' }),
            statusText(t, info)
          )
        ),
        h('input', {
          className: 'media-qwen-input',
          type: 'password',
          autoComplete: 'off',
          spellCheck: false,
          value: draft,
          placeholder: configured ? t('replacePlaceholder') : t('inputPlaceholder'),
          'aria-label': entry.provider + ' ' + ref,
          disabled,
          onChange: (event) => setDraft(event.target.value),
          onKeyDown,
        }),
        h('div', { className: 'media-qwen-actions' },
          h('button', {
            type: 'button',
            className: 'media-qwen-btn is-primary',
            disabled: disabled || draft.trim().length === 0,
            onClick: save,
          }, busy === 'saving' ? t('saving') : t('save')),
          configured && managed
            ? h('button', {
                type: 'button',
                className: 'media-qwen-btn is-danger',
                disabled,
                onClick: clear,
              }, busy === 'clearing' ? t('clearing') : t('clear'))
            : null,
          message !== null
            ? h('span', {
                className: 'media-qwen-msg ' + (message.kind === 'ok' ? 'is-ok' : 'is-error'),
                role: message.kind === 'ok' ? 'status' : 'alert',
              }, message.text)
            : null
        ),
        writable ? null : h('p', { className: 'media-qwen-muted' }, t('readonlyNote')),
        extra ?? null
      )
    }

    /** The Settings page registered under `settings.section`. */
    function MediaQwenPage({ ctx }) {
      const locale = ctx.get('locale')
      useLocaleRevision(locale)
      const t = ctx.locale.bind(NS)

      const [infos, setInfos] = React.useState(null)
      const [loadError, setLoadError] = React.useState(null)
      const [status, setStatus] = React.useState(null)
      const [loading, setLoading] = React.useState(false)
      const [error, setError] = React.useState(null)
      const sequence = React.useRef(0)

      const load = React.useCallback(() => {
        return ctx.remote.credentials.describe([KEY.ref])
          .then((response) => {
            setInfos(unwrap(response))
            setLoadError(null)
          })
          .catch((err) => setLoadError(messageOf(err)))
      }, [])

      const refresh = React.useCallback(() => {
        const remote = ctx.get('remote.mediaQwen')
        if (remote === undefined || typeof remote.dashscopeStatus !== 'function') {
          setLoading(false)
          setError(ctx.locale.bind(NS)('dsUnavailable'))
          return
        }
        const current = ++sequence.current
        setLoading(true)
        setError(null)
        remote.dashscopeStatus()
          .then((response) => {
            if (current !== sequence.current) return
            setStatus(unwrap(response, 'account status request was refused'))
          })
          .catch((err) => {
            if (current !== sequence.current) return
            setError(messageOf(err))
          })
          .finally(() => {
            if (current === sequence.current) setLoading(false)
          })
      }, [])

      React.useEffect(() => {
        load()
        refresh()
      }, [load, refresh])

      return h('section', { className: 'media-qwen-page' },
        h('style', null, CSS),
        h('h2', null, t('title')),
        h('p', { className: 'media-qwen-intro' }, t('intro')),
        loadError !== null
          ? h('p', { className: 'media-qwen-error', role: 'alert' }, t('loadFailed', { message: loadError }))
          : null,
        infos === null
          ? h('p', { className: 'media-qwen-muted' }, t('loading'))
          : h(KeyCard, {
              ctx,
              t,
              entry: KEY,
              info: infos[KEY.ref],
              load,
              onChanged: refresh,
              extra: h(DashScopeAccount, {
                t,
                status,
                loading,
                error,
                onRefresh: refresh,
              }),
            })
      )
    }

    exports.inject = ['slots', 'remote', 'remote.credentials', 'locale']

    exports.apply = async function apply(ctx) {
      if (typeof ctx.remote.$mount === 'function') {
        try {
          const unmount = await ctx.remote.$mount(REMOTE_CONTRIBUTION)
          ctx.effect(() => () => {
            if (typeof unmount === 'function') void unmount()
          }, 'media-qwen: Remote namespace')
        } catch (error) {
          // Keep the key-config page usable; its account panel reports the
          // missing namespace instead of failing the whole section.
          if (ctx.logger !== undefined) ctx.logger.warn('media-qwen: Remote namespace mount failed: %o', error)
        }
      }

      ctx.effect(() => ctx.locale.register(NS, DICTS), 'media-qwen: locale')

      const t = ctx.locale.bind(NS)
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'media-qwen',
        order: 40,
        label: () => t('sectionLabel'),
        locale: NS,
      }, function MediaQwenSection() {
        return h(MediaQwenPage, { ctx })
      }))
    }

    return module.exports
  },
})
