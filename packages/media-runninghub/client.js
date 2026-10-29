/**
 * Client half of the media-runninghub bundle: one Settings page with two
 * independent key cards and two independent account panels.
 *
 * The page never owns the secret values. Reading goes through
 * `ctx.remote.credentials.describe`, which returns presence/source/writability
 * only, and writing goes through `ctx.remote.credentials.set` / `.unset` — the
 * built-in Host controller over `$DSH_HOME/.credentials.yaml`. No value is
 * echoed back, kept in page state, or cached anywhere else.
 *
 * The two keys are independent. Which one the current `surface` uses decides
 * which card is editable: the active surface's key can be changed, the other
 * one is shown read-only, because a key the running surface does not read
 * would only look configured.
 *
 * Saving a key also judges the site that key belongs to. The verdict comes
 * from the account's balance currency — `USD` is the international site and
 * `CNY` the China site — and is stored in the plugin Config by the Host, so
 * the tools know which host to call without asking again.
 */
window.__ModuleLoader__.load({
  id: 'media-runninghub',
  factory(require) {
    const module = { exports: {} }
    const exports = module.exports

    const React = require('react')
    const h = React.createElement

    const NS = 'mediaRunningHub'

    /** The two keys this page owns. */
    const KEYS = [
      {
        ref: 'RUNNINGHUB_SYNC_API_KEY',
        surface: 'sync',
        provider: '同步模式 Key',
        purpose: '模型 API / 同步图片生成',
        status: 'syncStatus',
        site: 'syncSite',
        advice: 'sync 模式建议使用企业级-共享 Key。',
      },
      {
        ref: 'RUNNINGHUB_JOBS_API_KEY',
        surface: 'jobs',
        provider: '任务池模式 Key',
        purpose: '工作流 API / 任务池',
        status: 'jobsStatus',
        site: 'jobsSite',
        advice: 'jobs 模式建议使用消费级-会员 Key。',
      },
    ]

    /**
     * The Host methods this page calls. The Host registers
     * `mediaRunningHubController` with a `typertRemote` binding; this
     * contribution installs the matching `ctx.remote.mediaRunningHub` namespace.
     * Only method names and empty parameter lists cross the wire.
     */
    const REMOTE_CONTRIBUTION = {
      package: 'media-runninghub',
      descriptors: [
        {
          id: 'media-runninghub#mediaRunningHub/syncStatus',
          service: 'mediaRunningHubController',
          namespace: 'mediaRunningHub',
          method: 'syncStatus',
          invocation: { kind: 'direct' },
          parameters: [],
          result: {
            mode: 'strict',
            typeSymbol: 'media-runninghub#mediaRunningHub/syncStatus:result',
            create: () => ({ parse: value => value }),
          },
        },
        {
          id: 'media-runninghub#mediaRunningHub/jobsStatus',
          service: 'mediaRunningHubController',
          namespace: 'mediaRunningHub',
          method: 'jobsStatus',
          invocation: { kind: 'direct' },
          parameters: [],
          result: {
            mode: 'strict',
            typeSymbol: 'media-runninghub#mediaRunningHub/jobsStatus:result',
            create: () => ({ parse: value => value }),
          },
        },
        {
          id: 'media-runninghub#mediaRunningHub/syncSite',
          service: 'mediaRunningHubController',
          namespace: 'mediaRunningHub',
          method: 'syncSite',
          invocation: { kind: 'direct' },
          parameters: [],
          result: {
            mode: 'strict',
            typeSymbol: 'media-runninghub#mediaRunningHub/syncSite:result',
            create: () => ({ parse: value => value }),
          },
        },
        {
          id: 'media-runninghub#mediaRunningHub/jobsSite',
          service: 'mediaRunningHubController',
          namespace: 'mediaRunningHub',
          method: 'jobsSite',
          invocation: { kind: 'direct' },
          parameters: [],
          result: {
            mode: 'strict',
            typeSymbol: 'media-runninghub#mediaRunningHub/jobsSite:result',
            create: () => ({ parse: value => value }),
          },
        },
        {
          id: 'media-runninghub#mediaRunningHub/configStatus',
          service: 'mediaRunningHubController',
          namespace: 'mediaRunningHub',
          method: 'configStatus',
          invocation: { kind: 'direct' },
          parameters: [],
          result: {
            mode: 'strict',
            typeSymbol: 'media-runninghub#mediaRunningHub/configStatus:result',
            create: () => ({ parse: value => value }),
          },
        },
        {
          id: 'media-runninghub#mediaRunningHub/setSurface',
          service: 'mediaRunningHubController',
          namespace: 'mediaRunningHub',
          method: 'setSurface',
          invocation: { kind: 'direct' },
          parameters: [
            {
              name: 'target',
              wire: 'target',
              source: 'json',
              codec: {
                mode: 'strict',
                typeSymbol: 'media-runninghub#mediaRunningHub/setSurface:target',
                create: () => ({ parse: value => value }),
              },
            },
          ],
          result: {
            mode: 'strict',
            typeSymbol: 'media-runninghub#mediaRunningHub/setSurface:result',
            create: () => ({ parse: value => value }),
          },
        },
        {
          id: 'media-runninghub#mediaRunningHub/setPoolFields',
          service: 'mediaRunningHubController',
          namespace: 'mediaRunningHub',
          method: 'setPoolFields',
          invocation: { kind: 'direct' },
          parameters: [
            {
              name: 'fields',
              wire: 'fields',
              source: 'json',
              codec: {
                mode: 'strict',
                typeSymbol: 'media-runninghub#mediaRunningHub/setPoolFields:fields',
                create: () => ({ parse: value => value }),
              },
            },
          ],
          result: {
            mode: 'strict',
            typeSymbol: 'media-runninghub#mediaRunningHub/setPoolFields:result',
            create: () => ({ parse: value => value }),
          },
        },
      ],
    }

    const DICTS = {
      zh: {
        sectionLabel: 'RunningHub 媒体',
        title: 'RunningHub 媒体',
        intro: '配置 RunningHub 的两个 API Key：sync 模式用于模型 API 同步出图，jobs 模式用于工作流任务池。当前运行的模式可以编辑，另一个只读展示。',
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
        inputPlaceholder: '粘贴 API Key',
        replacePlaceholder: '已配置，输入新值可替换',
        readonlyNote: '当前凭据提供方不允许写入；请在 ~/.dsh/.credentials.yaml 中手动维护。',
        inactiveNote: '当前运行的是 {surface} 模式，这个 Key 暂不参与调用，只读展示。切换 surface 后可编辑。',
        inactiveBadge: '只读',
        emptyInput: '请输入 API Key 后再保存。',
        loadFailed: '读取密钥状态失败：{message}',
        saveFailed: '保存失败：{message}',
        clearFailed: '清除失败：{message}',
        purpose: '用途：{purpose}',
        advice: '建议：{advice}',
        surfaceSync: 'sync 模式',
        surfaceJobs: 'jobs 模式',
        siteCn: '中国站',
        siteIntl: '国际站',
        siteUnknown: '站点未判定',
        siteLabel: '站点',
        siteJudged: '已判定站点：{site}（按余额币种 {currency}）',
        siteJudging: '正在判定所属站点…',
        siteFailed: '站点判定失败：{message}',
        sitePending: '保存后将按余额币种自动判定所属站点。',
        acctTitle: '账户状态',
        acctRefresh: '刷新',
        acctRefreshing: '刷新中…',
        acctRetry: '重试',
        acctLoading: '正在查询 RunningHub 账户…',
        acctUnavailable: '账户状态服务不可用，请重启 Harness 后重试。',
        acctNoKey: '保存该 Key 后，这里会显示账户状态和余额。',
        acctReady: '账户就绪',
        acctNoBalance: '余额不足',
        acctInvalidKey: 'API Key 无效',
        acctUnreachable: '无法连接 RunningHub',
        acctTimeout: '查询超时',
        acctHttpError: 'RunningHub 返回错误',
        acctError: '查询失败',
        acctUnknown: '未知状态',
        acctBalance: '余额',
        acctTasks: '{count} 个任务运行中',
        acctCoins: '{count} RH 币',
        acctApiType: 'API 类型',
        acctCheckedAt: '检查时间 {time}',
        acctInvalidDetail: 'RunningHub 拒绝了该 Key：{message}',
        acctNoBalanceHint: '余额为零，请充值后再使用。',
        acctRequestFailed: '查询账户状态失败：{message}',
        surfaceToggleLabel: '运行模式',
        poolTitle: '任务池设置',
        poolConcurrencyLabel: '全局并发上限',
        poolIntervalLabel: '轮询间隔（秒）',
        poolRange: '（需在 {min}–{max} 内）',
        poolHint: '当前为 {surface}，任务池字段仅在 jobs 模式可编辑。',
        poolSave: '保存任务池设置',
        poolSaving: '保存中…',
        poolSaved: '任务池设置已保存',
        poolSaveFailed: '保存任务池设置失败：{message}',
        poolConcurrencyInvalid: '并发上限需为 1–100 的整数。',
        poolIntervalInvalid: '轮询间隔需为 5–600 的整数（秒）。',
      },
      en: {
        sectionLabel: 'RunningHub Media',
        title: 'RunningHub Media',
        intro: 'Configure the two RunningHub API keys: sync drives the model API for synchronous images, jobs drives the workflow task pool. The running surface is editable; the other one is shown read-only.',
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
        inputPlaceholder: 'Paste the API key',
        replacePlaceholder: 'Configured — enter a new value to replace it',
        readonlyNote: 'The active credential provider is read-only; edit ~/.dsh/.credentials.yaml manually.',
        inactiveNote: 'The running surface is {surface}, so this key is not used by any call and is shown read-only. Switch surfaces to edit it.',
        inactiveBadge: 'Read-only',
        emptyInput: 'Enter an API key before saving.',
        loadFailed: 'Could not read key status: {message}',
        saveFailed: 'Save failed: {message}',
        clearFailed: 'Clear failed: {message}',
        purpose: 'Used for: {purpose}',
        advice: 'Advice: {advice}',
        surfaceSync: 'sync',
        surfaceJobs: 'jobs',
        siteCn: 'China',
        siteIntl: 'International',
        siteUnknown: 'Site not determined',
        siteLabel: 'Site',
        siteJudged: 'Site determined: {site} (balance currency {currency})',
        siteJudging: 'Determining the owning site…',
        siteFailed: 'Could not determine the site: {message}',
        sitePending: 'The owning site is determined from the balance currency when the key is saved.',
        acctTitle: 'Account',
        acctRefresh: 'Refresh',
        acctRefreshing: 'Refreshing…',
        acctRetry: 'Retry',
        acctLoading: 'Checking the RunningHub account…',
        acctUnavailable: 'Account status is unavailable. Restart Harness and try again.',
        acctNoKey: 'Save this key to see account status and balance here.',
        acctReady: 'Account ready',
        acctNoBalance: 'No balance',
        acctInvalidKey: 'Invalid API key',
        acctUnreachable: 'Cannot reach RunningHub',
        acctTimeout: 'Request timed out',
        acctHttpError: 'RunningHub returned an error',
        acctError: 'Status check failed',
        acctUnknown: 'Unknown status',
        acctBalance: 'Balance',
        acctTasks: '{count} running',
        acctCoins: '{count} RH coins',
        acctApiType: 'API type',
        acctCheckedAt: 'Checked {time}',
        acctInvalidDetail: 'RunningHub rejected this key: {message}',
        acctNoBalanceHint: 'The wallet balance is zero; recharge before using the API.',
        acctRequestFailed: 'Could not check account status: {message}',
        surfaceToggleLabel: 'Running surface',
        poolTitle: 'Task pool settings',
        poolConcurrencyLabel: 'Global concurrency cap',
        poolIntervalLabel: 'Poll interval (seconds)',
        poolRange: ' (must be {min}–{max})',
        poolHint: 'The running surface is {surface}; task-pool fields are editable only in jobs mode.',
        poolSave: 'Save pool settings',
        poolSaving: 'Saving…',
        poolSaved: 'Task-pool settings saved',
        poolSaveFailed: 'Could not save task-pool settings: {message}',
        poolConcurrencyInvalid: 'Concurrency cap must be an integer from 1 to 100.',
        poolIntervalInvalid: 'Poll interval must be an integer from 5 to 600 seconds.',
      },
    }

    const CSS = `
.media-rh-page { display: flex; flex-direction: column; gap: 14px; color: var(--dsw-alias-label-primary); }
.media-rh-page h2 { margin: 0; font-size: 16px; line-height: 24px; font-weight: 600; }
.media-rh-intro { margin: 0; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-secondary); }
.media-rh-card { display: flex; flex-direction: column; gap: 10px; padding: 14px 16px; background: var(--dsw-alias-bg-layer-1); border: 0.5px solid var(--dsw-alias-border-l1); border-radius: 12px; }
.media-rh-card.is-inactive { opacity: 0.72; }
.media-rh-card-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.media-rh-provider { font-size: 14px; line-height: 22px; font-weight: 600; }
.media-rh-purpose { margin: 2px 0 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
.media-rh-status { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
.media-rh-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--dsw-alias-state-idle-primary); }
.media-rh-status.is-on .media-rh-dot { background: var(--dsw-alias-state-success-primary); }
.media-rh-badge { display: inline-flex; align-items: center; padding: 1px 6px; font-size: 11px; line-height: 16px; border-radius: 4px; color: var(--dsw-alias-label-secondary); border: 0.5px solid var(--dsw-alias-border-l2); }
.media-rh-input { box-sizing: border-box; width: 100%; height: 32px; padding: 0 10px; font-size: 13px; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-base); border: 0.5px solid var(--dsw-alias-border-l2); border-radius: 8px; outline: none; }
.media-rh-input:focus { border-color: var(--dsw-alias-brand-primary); }
.media-rh-input:disabled { opacity: 0.5; cursor: not-allowed; }
.media-rh-input::placeholder { color: var(--dsw-alias-label-secondary); }
.media-rh-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.media-rh-btn { height: 28px; padding: 0 12px; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-primary); background: transparent; border: 0.5px solid var(--dsw-alias-border-l2); border-radius: 8px; cursor: pointer; }
.media-rh-btn:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); }
.media-rh-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.media-rh-btn.is-primary { color: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-brand-primary); }
.media-rh-btn.is-danger { color: var(--dsw-alias-state-error-primary); border-color: transparent; }
.media-rh-msg { font-size: 12px; line-height: 18px; }
.media-rh-msg.is-ok { color: var(--dsw-alias-state-success-primary); }
.media-rh-msg.is-error { color: var(--dsw-alias-state-error-primary); }
.media-rh-error { margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-state-error-primary); }
.media-rh-muted { margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
.media-rh-site { display: flex; align-items: center; gap: 8px; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
.media-rh-account { display: flex; flex-direction: column; gap: 8px; padding: 12px; background: var(--dsw-alias-bg-layer-2); border: 0.5px solid var(--dsw-alias-border-l1); border-radius: 10px; }
.media-rh-account-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.media-rh-account-title { font-size: 12px; line-height: 18px; font-weight: 600; letter-spacing: 0.04em; color: var(--dsw-alias-label-secondary); text-transform: uppercase; }
.media-rh-account-body { display: flex; flex-direction: column; gap: 6px; }
.media-rh-account-main { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.media-rh-account-status { display: inline-flex; align-items: center; gap: 6px; font-size: 14px; line-height: 22px; font-weight: 600; }
.media-rh-account-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--dsw-alias-state-success-primary); }
.media-rh-account-dot.is-warn { background: var(--dsw-alias-state-warn-primary); }
.media-rh-account-dot.is-error { background: var(--dsw-alias-state-error-primary); }
.media-rh-account-dot.is-idle { background: var(--dsw-alias-state-idle-primary); }
.media-rh-account-balance { font-size: 20px; line-height: 28px; font-weight: 600; font-variant-numeric: tabular-nums; }
.media-rh-account-meta { display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
.media-rh-account-error { margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-state-error-primary); }
.media-rh-surface { display: inline-flex; align-items: center; align-self: flex-start; padding: 2px; gap: 2px; background: var(--dsw-alias-bg-layer-1); border: 0.5px solid var(--dsw-alias-border-l1); border-radius: 10px; }
.media-rh-surface-btn { height: 26px; padding: 0 14px; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); background: transparent; border: none; border-radius: 8px; cursor: pointer; }
.media-rh-surface-btn:hover:not(.is-active) { color: var(--dsw-alias-label-primary); }
.media-rh-surface-btn.is-active { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-2); font-weight: 600; box-shadow: 0 0 0 0.5px var(--dsw-alias-border-l2); }
.media-rh-input.is-invalid { border-color: var(--dsw-alias-state-error-primary); }
.media-rh-pool { display: flex; flex-direction: column; gap: 8px; padding: 12px; margin-top: 2px; background: var(--dsw-alias-bg-layer-2); border: 0.5px solid var(--dsw-alias-border-l1); border-radius: 10px; }
.media-rh-pool-head { font-size: 12px; line-height: 18px; font-weight: 600; letter-spacing: 0.04em; color: var(--dsw-alias-label-secondary); text-transform: uppercase; }
.media-rh-pool-field { display: flex; flex-direction: column; gap: 4px; }
.media-rh-pool-label { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-primary); }
.media-rh-pool-label .media-rh-pool-range { color: var(--dsw-alias-state-error-primary); }
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

    /** A balance reading with its currency symbol. */
    function formatMoney(value, currency) {
      const amount = Number.parseFloat(value)
      const text = Number.isFinite(amount) ? amount.toFixed(2) : String(value)
      if (currency === 'USD') return '$' + text
      if (currency === 'CNY' || currency === 'RMB') return '¥' + text
      return (currency ? currency + ' ' : '') + text
    }

    /** A thousands-separated count. */
    function formatCount(value) {
      const number = Number.parseFloat(value)
      return Number.isFinite(number) ? number.toLocaleString() : String(value)
    }

    /** Dot tone for one account status. */
    function accountTone(status) {
      if (status === 'ready') return 'ok'
      if (status === 'no_balance') return 'warn'
      if (status === 'no_key') return 'idle'
      return 'error'
    }

    /** The display name of one site id. */
    function siteLabel(t, site) {
      if (site === 'cn') return t('siteCn')
      if (site === 'intl') return t('siteIntl')
      return t('siteUnknown')
    }

    /** One account panel, bound to its own key. */
    function AccountPanel({ t, status, loading, error, onRefresh }) {
      const tone = status === null ? 'idle' : accountTone(status.status)
      const labels = {
        ready: t('acctReady'),
        no_balance: t('acctNoBalance'),
        no_key: t('acctNoKey'),
        invalid_key: t('acctInvalidKey'),
        unreachable: t('acctUnreachable'),
        timeout: t('acctTimeout'),
        http_error: t('acctHttpError'),
        error: t('acctError'),
      }
      const label = status === null ? t('acctUnknown') : (labels[status.status] ?? t('acctUnknown'))
      const detail = status !== null && typeof status.message === 'string' && status.message.length > 0
        ? status.message
        : null
      const money = status !== null && typeof status.balance === 'string'
        ? formatMoney(status.balance, status.currency)
        : null
      const meta = []
      if (status !== null && typeof status.coins === 'string') {
        meta.push(t('acctCoins', { count: formatCount(status.coins) }))
      }
      if (status !== null && typeof status.runningTasks === 'string') {
        meta.push(t('acctTasks', { count: formatCount(status.runningTasks) }))
      }
      if (status !== null && typeof status.apiType === 'string' && status.apiType.length > 0) {
        meta.push(t('acctApiType') + ' ' + status.apiType)
      }
      if (status !== null && typeof status.checkedAt === 'string') {
        const date = new Date(status.checkedAt)
        if (!Number.isNaN(date.getTime())) meta.push(t('acctCheckedAt', { time: date.toLocaleTimeString() }))
      }
      const showGenericDetail = detail !== null
        && status !== null
        && status.status !== 'ready'
        && status.status !== 'no_balance'
        && status.status !== 'invalid_key'
        && status.status !== 'unreachable'
        && status.status !== 'timeout'
      const canRetry = status !== null
        && status.status !== 'ready'
        && status.status !== 'no_balance'
        && status.status !== 'no_key'

      return h('div', { className: 'media-rh-account', 'aria-busy': loading ? 'true' : undefined },
        h('div', { className: 'media-rh-account-head' },
          h('span', { className: 'media-rh-account-title' }, t('acctTitle')),
          h('button', {
            type: 'button',
            className: 'media-rh-btn',
            disabled: loading,
            onClick: onRefresh,
          }, loading ? t('acctRefreshing') : (canRetry ? t('acctRetry') : t('acctRefresh')))
        ),
        error !== null
          ? h('p', { className: 'media-rh-account-error', role: 'alert' }, t('acctRequestFailed', { message: error }))
          : null,
        status === null
          ? (error === null
              ? h('p', { className: 'media-rh-muted' }, loading ? t('acctLoading') : t('acctNoKey'))
              : null)
          : status.status === 'no_key'
            ? h('p', { className: 'media-rh-muted' }, t('acctNoKey'))
            : h('div', { className: 'media-rh-account-body' },
                h('div', { className: 'media-rh-account-main' },
                  h('span', { className: 'media-rh-account-status' },
                    h('span', {
                      className: 'media-rh-account-dot' + (tone === 'ok' ? '' : ' is-' + tone),
                      'aria-hidden': 'true',
                    }),
                    label
                  ),
                  money !== null
                    ? h('span', { className: 'media-rh-account-balance', title: t('acctBalance') }, money)
                    : null
                ),
                meta.length > 0
                  ? h('div', { className: 'media-rh-account-meta' },
                      meta.map((text, index) => h('span', { key: String(index) }, text)))
                  : null,
                status.status === 'invalid_key' && detail !== null
                  ? h('p', { className: 'media-rh-account-error' }, t('acctInvalidDetail', { message: detail }))
                  : null,
                status.status === 'no_balance'
                  ? h('p', { className: 'media-rh-muted' }, t('acctNoBalanceHint'))
                  : null,
                showGenericDetail
                  ? h('p', { className: 'media-rh-account-error' }, detail)
                  : null
              )
      )
    }

    /** One key card with its own account panel. */
    function KeyCard({ ctx, t, entry, info, load, onChanged, status, loading, error, onRefresh, active, surfaceName, judge, surfaceRunning, cfg, applyPoolFields }) {
      const ref = entry.ref
      const [draft, setDraft] = React.useState('')
      const [busy, setBusy] = React.useState(null)
      const [message, setMessage] = React.useState(null)
      const [judged, setJudged] = React.useState(null)
      // Jobs-pool field drafts, initialized lazily from the shared config.
      const [pool, setPool] = React.useState(null)
      const [poolUpdating, setPoolUpdating] = React.useState(false)
      const poolTouched = React.useRef(false)
      if (pool === null && cfg !== null && entry.surface === 'jobs' && !poolTouched.current) {
        setPool({
          concurrency: String(cfg.concurrency === undefined ? 2 : cfg.concurrency),
          pollIntervalSeconds: String(cfg.pollIntervalSeconds === undefined ? 30 : cfg.pollIntervalSeconds),
        })
      }
      const configured = info !== undefined && info.configured === true
      const managed = configured && info.source === 'file'
      const writable = info === undefined || info.writable !== false
      // The key the running surface does not read is shown, not edited.
      const editable = active && writable
      const disabled = busy !== null || !editable

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
            // The key is stored; judge its site so the tools know which host
            // to call. A judgment failure does not undo the save.
            return Promise.resolve()
              .then(() => judge(entry))
              .then((verdict) => {
                setJudged({ kind: 'ok', site: verdict.site, currency: verdict.currency })
              })
              .catch((err) => {
                setJudged({ kind: 'error', message: messageOf(err) })
              })
              .then(() => load())
              .then(() => {
                if (typeof onChanged === 'function') onChanged()
              })
              .then(() => {
                report('ok', t('saved'))
              })
          })
          .catch((err) => report('error', t('saveFailed', { message: messageOf(err) })))
          .then(() => setBusy(null))
      }

      const clear = () => {
        setBusy('clearing')
        setMessage(null)
        ctx.remote.credentials.unset(ref)
          .then((response) => {
            unwrap(response)
            setDraft('')
            setJudged(null)
            report('ok', t('cleared'))
            return load().then(() => {
              if (typeof onChanged === 'function') onChanged()
            })
          })
          .catch((err) => report('error', t('clearFailed', { message: messageOf(err) })))
          .then(() => setBusy(null))
      }

      const onKeyDown = (event) => {
        if (event.key === 'Enter' && !disabled) save()
      }

      /**
       * Refresh the account and judge the site.
       *
       * Refreshing is a read-only action, so it is available on the inactive
       * card too — which is the only way its key ever gets judged, because the
       * inactive card has no save button.
       */
      const refreshAndJudge = () => {
        if (typeof onRefresh === 'function') onRefresh()
        if (typeof judge !== 'function') return
        setJudged({ kind: 'pending' })
        Promise.resolve()
          .then(() => judge(entry))
          .then((verdict) => {
            setJudged({ kind: 'ok', site: verdict.site, currency: verdict.currency })
          })
          .catch((err) => {
            setJudged({ kind: 'error', message: messageOf(err) })
          })
      }

      /**
       * Save the jobs-pool fields, gated to the jobs surface.
       *
       * Only a running jobs surface reads these fields; in sync mode the input
       * is disabled and nothing can be written.
       */
      const savePool = () => {
        if (pool === null || typeof applyPoolFields !== 'function') return
        const concurrency = Number.parseFloat(pool.concurrency)
        const pollIntervalSeconds = Number.parseFloat(pool.pollIntervalSeconds)
        if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 100) {
          setMessage({ kind: 'error', text: t('poolConcurrencyInvalid') })
          return
        }
        if (!Number.isInteger(pollIntervalSeconds) || pollIntervalSeconds < 5 || pollIntervalSeconds > 600) {
          setMessage({ kind: 'error', text: t('poolIntervalInvalid') })
          return
        }
        poolTouched.current = true
        setPoolUpdating(true)
        setMessage(null)
        Promise.resolve()
          .then(() => applyPoolFields({ concurrency, pollIntervalSeconds }))
          .then(() => report('ok', t('poolSaved')))
          .catch((err) => report('error', t('poolSaveFailed', { message: messageOf(err) })))
          .then(() => setPoolUpdating(false))
      }

      // The site shown is the one this session judged, falling back to the
      // verdict the Host already stores in the plugin Config.
      const storedSite = status !== null && typeof status === 'object' && typeof status.site === 'string'
        ? status.site
        : undefined
      const siteLine = judged !== null
        ? (judged.kind === 'error'
            ? h('p', { className: 'media-rh-account-error' }, t('siteFailed', { message: judged.message }))
            : judged.kind === 'pending'
              ? h('p', { className: 'media-rh-muted' }, t('siteJudging'))
              : h('p', { className: 'media-rh-muted' }, t('siteJudged', {
                  site: siteLabel(t, judged.site),
                  currency: judged.currency,
                })))
        : storedSite !== undefined
          ? h('p', { className: 'media-rh-muted' }, t('siteLabel') + '：' + siteLabel(t, storedSite))
          : h('p', { className: 'media-rh-muted' }, t('sitePending'))

      /**
       * The jobs-mode pool settings section.
       *
       * Only a running jobs surface reads concurrency and pollIntervalSeconds,
       * so the inputs are editable only then and disabled (with a hint) in sync
       * mode.
       */
      const renderPoolSection = () => {
        const jobsRunning = surfaceRunning !== 'jobs'
        const poolField = (field, labelKey, invalid, min, max) => h('div', { className: 'media-rh-pool-field' },
          h('label', { className: 'media-rh-pool-label', htmlFor: 'media-rh-pool-' + field },
            t(labelKey), invalid && pool !== null ? t('poolRange', { min, max }) : null),
          h('input', {
            id: 'media-rh-pool-' + field,
            className: 'media-rh-input' + (invalid ? ' is-invalid' : ''),
            type: 'number',
            min: String(min),
            max: String(max),
            step: '1',
            spellCheck: false,
            disabled: jobsRunning || poolUpdating,
            readOnly: jobsRunning,
            value: pool === null ? '' : pool[field],
            placeholder: field === 'concurrency'
              ? String(cfg === null ? 2 : (cfg.concurrency === undefined ? 2 : cfg.concurrency))
              : String(cfg === null ? 30 : (cfg.pollIntervalSeconds === undefined ? 30 : cfg.pollIntervalSeconds)),
            onChange: (event) => { poolTouched.current = true; setPool(prev => ({ ...prev, [field]: event.target.value })) },
          })
        )

        const concurrencyNum = pool === null ? NaN : Number.parseFloat(pool.concurrency)
        const intervalNum = pool === null ? NaN : Number.parseFloat(pool.pollIntervalSeconds)
        const concurrencyInvalid = !Number.isInteger(concurrencyNum) || concurrencyNum < 1 || concurrencyNum > 100
        const intervalInvalid = !Number.isInteger(intervalNum) || intervalNum < 5 || intervalNum > 600

        return h('div', { className: 'media-rh-pool' },
          h('div', { className: 'media-rh-pool-head' }, t('poolTitle')),
          !jobsRunning ? null : h('p', { className: 'media-rh-muted' }, t('poolHint', { surface: surfaceName })),
          poolField('concurrency', 'poolConcurrencyLabel', concurrencyInvalid, 1, 100),
          poolField('pollIntervalSeconds', 'poolIntervalLabel', intervalInvalid, 5, 600),
          h('div', { className: 'media-rh-actions' },
            h('button', {
              type: 'button',
              className: 'media-rh-btn is-primary',
              disabled: jobsRunning || poolUpdating || pool === null || concurrencyInvalid || intervalInvalid,
              onClick: savePool,
            }, poolUpdating ? t('poolSaving') : t('poolSave'))
          )
        )
      }

      return h('div', { className: 'media-rh-card' + (active ? '' : ' is-inactive') },
        h('div', { className: 'media-rh-card-head' },
          h('div', null,
            h('div', { className: 'media-rh-provider' }, entry.provider),
            h('p', { className: 'media-rh-purpose' }, t('purpose', { purpose: entry.purpose })),
            h('p', { className: 'media-rh-purpose' }, t('advice', { advice: entry.advice }))
          ),
          h('span', { className: 'media-rh-status' + (configured ? ' is-on' : '') },
            h('span', { className: 'media-rh-dot', 'aria-hidden': 'true' }),
            statusText(t, info)
          )
        ),
        active
          ? null
          : h('span', { className: 'media-rh-badge' }, t('inactiveBadge')),
        h('input', {
          className: 'media-rh-input',
          type: 'password',
          autoComplete: 'off',
          spellCheck: false,
          value: draft,
          placeholder: configured ? t('replacePlaceholder') : t('inputPlaceholder'),
          'aria-label': entry.provider + ' ' + ref,
          disabled,
          readOnly: !active,
          onChange: (event) => setDraft(event.target.value),
          onKeyDown,
        }),
        h('div', { className: 'media-rh-actions' },
          h('button', {
            type: 'button',
            className: 'media-rh-btn is-primary',
            disabled: disabled || draft.trim().length === 0,
            onClick: save,
          }, busy === 'saving' ? t('saving') : t('save')),
          configured && managed && active
            ? h('button', {
                type: 'button',
                className: 'media-rh-btn is-danger',
                disabled,
                onClick: clear,
              }, busy === 'clearing' ? t('clearing') : t('clear'))
            : null,
          message !== null
            ? h('span', {
                className: 'media-rh-msg ' + (message.kind === 'ok' ? 'is-ok' : 'is-error'),
                role: message.kind === 'ok' ? 'status' : 'alert',
              }, message.text)
            : null
        ),
        !writable ? h('p', { className: 'media-rh-muted' }, t('readonlyNote')) : null,
        !active ? h('p', { className: 'media-rh-muted' }, t('inactiveNote', { surface: surfaceName })) : null,
        siteLine,
        h(AccountPanel, { t, status, loading, error, onRefresh: refreshAndJudge }),
        entry.surface === 'jobs' ? renderPoolSection() : null
      )
    }

    /** The Settings page registered under `settings.section`. */
    function MediaRunningHubPage({ ctx }) {
      const locale = ctx.get('locale')
      useLocaleRevision(locale)
      const t = ctx.locale.bind(NS)

      const [infos, setInfos] = React.useState(null)
      const [loadError, setLoadError] = React.useState(null)
      const [surface, setSurface] = React.useState('sync')
      const [cfg, setCfg] = React.useState(null)
      const [cfgMessage, setCfgMessage] = React.useState(null)

      const [sync, setSync] = React.useState({ status: null, loading: false, error: null })
      const [jobs, setJobs] = React.useState({ status: null, loading: false, error: null })
      const syncSeq = React.useRef(0)
      const jobsSeq = React.useRef(0)

      const load = React.useCallback(() => {
        return ctx.remote.credentials.describe(KEYS.map(entry => entry.ref))
          .then((response) => {
            setInfos(unwrap(response))
            setLoadError(null)
          })
          .catch((err) => setLoadError(messageOf(err)))
      }, [])

      /**
       * Read the pool-oriented Config values the page can edit.
       *
       * The Host reports the running surface and the current pool fields, so
       * the page can show their values and gate editability on the surface.
       */
      const loadConfig = React.useCallback(() => {
        const remote = ctx.get('remote.mediaRunningHub')
        if (remote === undefined || typeof remote.configStatus !== 'function') return Promise.resolve()
        return remote.configStatus()
          .then((response) => {
            const value = unwrap(response, 'config status was refused')
            if (value !== null && typeof value === 'object') {
              if (typeof value.surface === 'string') setSurface(value.surface)
              setCfg(value)
            }
          })
          .catch(() => { /* keep the last-known config; the page stays usable */ })
      }, [])

      const refreshOne = React.useCallback((which) => {
        const remote = ctx.get('remote.mediaRunningHub')
        const setter = which === 'syncStatus' ? setSync : setJobs
        const seqRef = which === 'syncStatus' ? syncSeq : jobsSeq
        if (remote === undefined || typeof remote[which] !== 'function') {
          setter({ status: null, loading: false, error: ctx.locale.bind(NS)('acctUnavailable') })
          return
        }
        const current = ++seqRef.current
        setter(prev => ({ ...prev, loading: true, error: null }))
        remote[which]()
          .then((response) => {
            if (current !== seqRef.current) return
            const status = unwrap(response, 'account status request was refused')
            // The Host reports the running surface and the stored site
            // verdict alongside the account, so the page needs no second
            // request to know which card is editable.
            if (status !== null && typeof status === 'object') {
              if (typeof status.surface === 'string') setSurface(status.surface)
            }
            setter({ status, loading: false, error: null })
          })
          .catch((err) => {
            if (current !== seqRef.current) return
            setter({ status: null, loading: false, error: messageOf(err) })
          })
      }, [])

      const refreshSync = React.useCallback(() => refreshOne('syncStatus'), [refreshOne])
      const refreshJobs = React.useCallback(() => refreshOne('jobsStatus'), [refreshOne])

      /**
       * Judge the site of one saved key.
       *
       * The Host stores the verdict in the plugin Config, so the tools read it
       * on every call instead of asking the provider which host to use.
       */
      const judge = React.useCallback((entry) => {
        const remote = ctx.get('remote.mediaRunningHub')
        const method = entry.surface === 'sync' ? 'syncSite' : 'jobsSite'
        if (remote === undefined || typeof remote[method] !== 'function') {
          return Promise.reject(new Error(t('acctUnavailable')))
        }
        return remote[method]().then((response) => {
          const verdict = unwrap(response, 'site judgment was refused')
          if (verdict === null || typeof verdict !== 'object' || verdict.status !== 'ok') {
            const message = verdict && typeof verdict.message === 'string' ? verdict.message : '未知原因'
            throw new Error(message)
          }
          return verdict
        })
      }, [])

      /**
       * Switch the running surface.
       *
       * `surface` is an ordinary Config field, so writing it reloads the
       * plugin and re-registers the tools of the new surface. The page updates
       * optimistically; the load after the write refreshes config and status.
       */
      const applySurface = React.useCallback((target) => {
        const next = target === 'sync' ? 'sync' : 'jobs'
        const remote = ctx.get('remote.mediaRunningHub')
        if (remote === undefined || typeof remote.setSurface !== 'function') {
          setCfgMessage({ kind: 'error', text: t('acctUnavailable') })
          return Promise.resolve()
        }
        setCfgMessage(null)
        return remote.setSurface(next)
          .then((response) => {
            const value = unwrap(response, 'surface switch was refused')
            if (value === null || typeof value !== 'object' || value.status !== 'ok') {
              const message = value && typeof value.message === 'string' ? value.message : '未知原因'
              throw new Error(message)
            }
            setSurface(value.surface === 'jobs' ? 'jobs' : 'sync')
            return loadConfig().then(refreshSync).then(refreshJobs)
          })
          .catch((err) => setCfgMessage({ kind: 'error', text: messageOf(err) }))
      }, [loadConfig, refreshSync, refreshJobs])

      /**
       * Persist the jobs-mode pool fields.
       *
       * Both are ordinary Config fields, so writing reloads the plugin. Only a
       * jobs surface writes them, matching the page's edit-gate.
       */
      const applyPoolFields = React.useCallback((fields) => {
        const remote = ctx.get('remote.mediaRunningHub')
        if (remote === undefined || typeof remote.setPoolFields !== 'function') {
          setCfgMessage({ kind: 'error', text: t('acctUnavailable') })
          return Promise.resolve()
        }
        setCfgMessage(null)
        return remote.setPoolFields(fields)
          .then((response) => {
            const value = unwrap(response, 'pool settings were refused')
            if (value === null || typeof value !== 'object' || value.status !== 'ok') {
              const message = value && typeof value.message === 'string' ? value.message : '未知原因'
              throw new Error(message)
            }
            return loadConfig()
          })
          .catch((err) => setCfgMessage({ kind: 'error', text: messageOf(err) }))
      }, [loadConfig])

      React.useEffect(() => {
        load()
        refreshSync()
        refreshJobs()
        loadConfig()
      }, [load, refreshSync, refreshJobs, loadConfig])

      const panelFor = (entry) => {
        if (entry.surface === 'sync') {
          return { status: sync.status, loading: sync.loading, error: sync.error, onRefresh: refreshSync }
        }
        return { status: jobs.status, loading: jobs.loading, error: jobs.error, onRefresh: refreshJobs }
      }

      const surfaceName = surface === 'jobs' ? t('surfaceJobs') : t('surfaceSync')

      return h('section', { className: 'media-rh-page' },
        h('style', null, CSS),
        h('h2', null, t('title')),
        h('p', { className: 'media-rh-intro' }, t('intro')),
        h('div', { className: 'media-rh-surface', role: 'group', 'aria-label': t('surfaceToggleLabel') },
          h('button', {
            type: 'button',
            className: 'media-rh-surface-btn' + (surface !== 'jobs' ? ' is-active' : ''),
            'aria-pressed': surface !== 'jobs',
            onClick: () => { if (surface !== 'sync') applySurface('sync') },
          }, t('surfaceSync')),
          h('button', {
            type: 'button',
            className: 'media-rh-surface-btn' + (surface === 'jobs' ? ' is-active' : ''),
            'aria-pressed': surface === 'jobs',
            onClick: () => { if (surface !== 'jobs') applySurface('jobs') },
          }, t('surfaceJobs'))
        ),
        cfgMessage !== null
          ? h('p', { className: 'media-rh-msg ' + (cfgMessage.kind === 'ok' ? 'is-ok' : 'is-error'), role: cfgMessage.kind === 'ok' ? 'status' : 'alert' }, cfgMessage.text)
          : null,
        loadError !== null
          ? h('p', { className: 'media-rh-error', role: 'alert' }, t('loadFailed', { message: loadError }))
          : null,
        infos === null
          ? h('p', { className: 'media-rh-muted' }, t('loading'))
          : KEYS.map(entry => {
              const panel = panelFor(entry)
              return h(KeyCard, {
                key: entry.ref,
                ctx,
                t,
                entry,
                info: infos[entry.ref],
                load,
                onChanged: panel.onRefresh,
                status: panel.status,
                loading: panel.loading,
                error: panel.error,
                onRefresh: panel.onRefresh,
                active: entry.surface === surface,
                surfaceName,
                judge,
                surfaceRunning: surface,
                cfg,
                applyPoolFields,
              })
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
          }, 'media-runninghub: Remote namespace')
        } catch (error) {
          // Keep the key-config page usable; its account panels report the
          // missing namespace instead of failing the whole section.
          if (ctx.logger !== undefined) ctx.logger.warn('media-runninghub: Remote namespace mount failed: %o', error)
        }
      }

      ctx.effect(() => ctx.locale.register(NS, DICTS), 'media-runninghub: locale')

      const t = ctx.locale.bind(NS)
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'media-runninghub',
        order: 41,
        label: () => t('sectionLabel'),
        locale: NS,
      }, function MediaRunningHubSection() {
        return h(MediaRunningHubPage, { ctx })
      }))
    }

    return module.exports
  },
})
