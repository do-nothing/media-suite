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
  id: '@tmmk/media-runninghub',
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
        {
          id: 'media-runninghub#mediaRunningHub/poolStatus',
          service: 'mediaRunningHubController',
          namespace: 'mediaRunningHub',
          method: 'poolStatus',
          invocation: { kind: 'direct' },
          parameters: [
            {
              name: 'input',
              wire: 'input',
              source: 'json',
              codec: {
                mode: 'strict',
                typeSymbol: 'media-runninghub#mediaRunningHub/poolStatus:input',
                create: () => ({ parse: value => value }),
              },
            },
          ],
          result: {
            mode: 'strict',
            typeSymbol: 'media-runninghub#mediaRunningHub/poolStatus:result',
            create: () => ({ parse: value => value }),
          },
        },
        {
          id: 'media-runninghub#mediaRunningHub/poolCancel',
          service: 'mediaRunningHubController',
          namespace: 'mediaRunningHub',
          method: 'poolCancel',
          invocation: { kind: 'direct' },
          parameters: [
            {
              name: 'cmd',
              wire: 'cmd',
              source: 'json',
              codec: {
                mode: 'strict',
                typeSymbol: 'media-runninghub#mediaRunningHub/poolCancel:cmd',
                create: () => ({ parse: value => value }),
              },
            },
          ],
          result: {
            mode: 'strict',
            typeSymbol: 'media-runninghub#mediaRunningHub/poolCancel:result',
            create: () => ({ parse: value => value }),
          },
        },
        {
          id: 'media-runninghub#mediaRunningHub/poolResubmit',
          service: 'mediaRunningHubController',
          namespace: 'mediaRunningHub',
          method: 'poolResubmit',
          invocation: { kind: 'direct' },
          parameters: [
            {
              name: 'cmd',
              wire: 'cmd',
              source: 'json',
              codec: {
                mode: 'strict',
                typeSymbol: 'media-runninghub#mediaRunningHub/poolResubmit:cmd',
                create: () => ({ parse: value => value }),
              },
            },
          ],
          result: {
            mode: 'strict',
            typeSymbol: 'media-runninghub#mediaRunningHub/poolResubmit:result',
            create: () => ({ parse: value => value }),
          },
        },
      ],
    }

    const DICTS = {
      zh: {
        sectionLabel: 'RunningHub 媒体',
        title: 'RunningHub 媒体',
        intro: '配置 RunningHub 的两个 API Key：sync 模式用于模型 API 同步出图，jobs 模式用于工作流任务池。通过顶部标签在两者间切换，当前运行的模式在此查看与编辑。',
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
        cfgCollapse: '收起配置',
        cfgExpand: '展开配置',
        statusTitle: '任务池运行状态',
        statusIntro: '任务池是全局共享的：任何会话提交的任务都在这里排队、流转和结算。当前批次与手动刷新保持一致。',
        statusRefresh: '刷新',
        statusRefreshing: '刷新中…',
        statusAuto: '自动刷新',
        statusAutoOn: '30s',
        statusAutoOff: '关',
        statusEmpty: '任务池为空，暂无任务。提交任务后，这里会实时显示进度与结果。',
        statusLoadFailed: '读取任务池状态失败：{message}',
        curBatch: '当前批次',
        batchNone: '已排空',
        batchLabel: '批次 #{id}',
        countsInFlight: '在飞',
        statusPending: '排队',
        statusDispatched: '运行中',
        statusSuccess: '成功',
        statusFailed: '失败',
        statusSubmitFailed: '提交失败',
        statusCancelled: '已取消',
        statusUnknown: '未知',
        stType: '类型',
        stId: '任务',
        stStatus: '状态',
        stCost: '费用',
        stOutput: '产物',
        stCreated: '创建时间',
        stActions: '操作',
        stNoCost: '—',
        stNoOutput: '—',
        stOutputOpen: '查看',
        stReplay: '再次生成',
        stCancel: '取消',
        stReplaying: '重放中…',
        stCancelling: '取消中…',
        stReplayDone: '已重新加入任务 #{id}',
        stReplayFailed: '重放失败：{message}',
        stCancelDone: '已取消任务 #{id}',
        stCancelFailed: '取消失败：{message}',
        stPrev: '‹ 上一批',
        stNext: '下一批 ›',
        stCurBatchBtn: '回当前批次',
        stBatchLoaded: '批次 #{id}',
        stBatchJump: '跳转',
        stBatchJumpPlaceholder: '批次号',
        stBatchJumpInvalid: '请输入正整数批次号',
      },
      en: {
        sectionLabel: 'RunningHub Media',
        title: 'RunningHub Media',
        intro: 'Configure the two RunningHub API keys: sync drives the model API for synchronous images, jobs drives the workflow task pool. Switch between them with the tab above and view or edit the running surface.',
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
        cfgCollapse: 'Collapse config',
        cfgExpand: 'Expand config',
        statusTitle: 'Task pool status',
        statusIntro: 'The task pool is shared globally: tasks submitted from any session queue, run and settle here.',
        statusRefresh: 'Refresh',
        statusRefreshing: 'Refreshing…',
        statusAuto: 'Auto refresh',
        statusAutoOn: '30s',
        statusAutoOff: 'off',
        statusEmpty: 'The task pool is empty. Submit tasks and their progress and results appear here in real time.',
        statusLoadFailed: 'Could not read task pool status: {message}',
        curBatch: 'Current batch',
        batchNone: 'drained',
        batchLabel: 'Batch #{id}',
        countsInFlight: 'in flight',
        statusPending: 'Queued',
        statusDispatched: 'Running',
        statusSuccess: 'Succeeded',
        statusFailed: 'Failed',
        statusSubmitFailed: 'Submit failed',
        statusCancelled: 'Cancelled',
        statusUnknown: 'Unknown',
        stType: 'Type',
        stId: 'Task',
        stStatus: 'Status',
        stCost: 'Cost',
        stOutput: 'Output',
        stCreated: 'Created',
        stActions: 'Actions',
        stNoCost: '—',
        stNoOutput: '—',
        stOutputOpen: 'View',
        stReplay: 'Replay',
        stCancel: 'Cancel',
        stReplaying: 'Replaying…',
        stCancelling: 'Cancelling…',
        stReplayDone: 'Re-added task #{id}',
        stReplayFailed: 'Replay failed: {message}',
        stCancelDone: 'Cancelled task #{id}',
        stCancelFailed: 'Cancel failed: {message}',
        stPrev: '‹ Prev',
        stNext: 'Next ›',
        stCurBatchBtn: 'Current batch',
        stBatchLoaded: 'Batch #{id}',
        stBatchJump: 'Go',
        stBatchJumpPlaceholder: 'Batch no.',
        stBatchJumpInvalid: 'Enter a positive batch number',
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
.media-rh-collapse { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 12px 16px; background: var(--dsw-alias-bg-layer-1); border: 0.5px solid var(--dsw-alias-border-l1); border-radius: 12px; cursor: pointer; }
.media-rh-collapse-title { font-size: 14px; line-height: 22px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.media-rh-collapse-caret { font-size: 12px; color: var(--dsw-alias-label-secondary); transition: transform 0.15s ease; }
.media-rh-collapse.is-open .media-rh-collapse-caret { transform: rotate(180deg); }
.media-rh-collapse-body { margin-top: 8px; }
.media-rh-status-wrap { display: flex; flex-direction: column; gap: 12px; padding: 14px 16px; background: var(--dsw-alias-bg-layer-1); border: 0.5px solid var(--dsw-alias-border-l1); border-radius: 12px; }
.media-rh-status-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.media-rh-status-toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.media-rh-auto { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
.media-rh-auto-chip { display: inline-flex; align-items: center; gap: 4px; padding: 1px 8px; font-size: 12px; line-height: 18px; border-radius: 8px; cursor: pointer; color: var(--dsw-alias-label-secondary); border: 0.5px solid var(--dsw-alias-border-l2); background: transparent; }
.media-rh-auto-chip:hover { background: var(--dsw-alias-bg-layer-2); }
.media-rh-auto-chip.is-on { color: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-brand-primary); font-weight: 600; }
.media-rh-counts { display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
.media-rh-count { display: inline-flex; align-items: center; gap: 5px; }
.media-rh-count b { font-weight: 600; color: var(--dsw-alias-label-primary); font-variant-numeric: tabular-nums; }
.media-rh-count .media-rh-account-dot { width: 6px; height: 6px; }
.media-rh-batch-nav { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
.media-rh-batch-nav-btn { height: 24px; padding: 0 8px; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); background: transparent; border: 0.5px solid var(--dsw-alias-border-l2); border-radius: 6px; cursor: pointer; }
.media-rh-batch-nav-btn:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); }
.media-rh-batch-nav-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.media-rh-batch-jump { display: inline-flex; align-items: center; gap: 6px; margin-left: 4px; }
.media-rh-batch-jump-input { width: 72px; height: 24px; padding: 0 6px; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-2); border: 0.5px solid var(--dsw-alias-border-l2); border-radius: 6px; }
.media-rh-batch-jump-input:disabled { opacity: 0.4; }
.media-rh-batch-jump-error { font-size: 12px; color: var(--dsw-alias-label-error, #d33); }
.media-rh-table-wrap { overflow-x: auto; border: 0.5px solid var(--dsw-alias-border-l1); border-radius: 10px; }
.media-rh-table { width: 100%; border-collapse: collapse; font-size: 12px; line-height: 18px; }
.media-rh-table th { text-align: left; padding: 8px 10px; font-weight: 600; color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-layer-2); border-bottom: 0.5px solid var(--dsw-alias-border-l1); white-space: nowrap; }
.media-rh-table td { padding: 8px 10px; color: var(--dsw-alias-label-primary); border-bottom: 0.5px solid var(--dsw-alias-border-l1); vertical-align: middle; }
.media-rh-table tr:last-child td { border-bottom: none; }
.media-rh-table .is-right { text-align: right; }
.media-rh-type { max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.media-rh-output-link { color: var(--dsw-alias-brand-primary); text-decoration: none; }
.media-rh-output-link:hover { text-decoration: underline; }
.media-rh-row-actions { display: inline-flex; align-items: center; gap: 6px; flex-wrap: nowrap; }
.media-rh-row-msg { max-width: 200px; font-size: 12px; line-height: 16px; }
.media-rh-status-tag { display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; }
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

    /** The display label of one ledger task status. */
    function poolStatusLabel(t, status) {
      switch (status) {
        case 'PENDING': return t('statusPending')
        case 'DISPATCHED': return t('statusDispatched')
        case 'SUCCESS': return t('statusSuccess')
        case 'FAILED': return t('statusFailed')
        case 'SUBMIT_FAILED': return t('statusSubmitFailed')
        case 'CANCELLED': return t('statusCancelled')
        default: return t('statusUnknown')
      }
    }

    /** Dot tone for one ledger task status. */
    function poolStatusTone(status) {
      if (status === 'SUCCESS') return 'ok'
      if (status === 'PENDING' || status === 'DISPATCHED') return 'warn'
      if (status === 'CANCELLED') return 'idle'
      return 'error'
    }

    // --- pure view logic -----------------------------------------------------
    // A client bundle runs inside a lazy-CJS factory whose `require` resolves
    // only packages named in `dsh.client.inject`; it cannot load a relative
    // file, and this package has no build step. So these helpers are repeated
    // here rather than imported from lib/pool/view.js. Keep them identical to
    // that module — `tests/view.test.mjs` asserts both implementations against
    // the same cases, so a drift fails a test instead of a page.
    //
    // Everything in this block is a plain function over the `poolStatus` reply:
    // no React, no state, no DOM.

    /** The fields a `poolStatus` reply must carry. Matches POOL_VIEW_KEYS. */
    const POOL_VIEW_KEYS = ['currentBatchId', 'latestBatchId', 'batches', 'counts', 'tasks']

    /**
     * The batch the board anchors on. `currentBatchId` is 0 once drained, so
     * the board falls back to the highest batch in the ledger and a finished
     * batch stays readable instead of the board going blank.
     */
    function anchorBatchOf(pool) {
      const current = Number(pool?.currentBatchId) || 0
      const latest = Number(pool?.latestBatchId) || 0
      return current > 0 ? current : latest
    }

    /**
     * Whether a reply already holds exactly one batch's rows. The overview form
     * spans every batch and is enriched with `outputs`, so testing for `outputs`
     * cannot tell the forms apart; batch membership can.
     */
    function isBatchDetail(rows, desired) {
      if (!Array.isArray(rows) || rows.length === 0) return false
      const wanted = Number(desired)
      if (!Number.isFinite(wanted)) return false
      return rows.every((task) => Number(task?.batch_id) === wanted)
    }

    /** Batch navigation state: `{ shownBatch, anchorBatch, batches, index, hasPrev, hasNext, isViewingAnchor }`. */
    function batchNav(pool, viewBatch) {
      const batches = Array.isArray(pool?.batches) ? pool.batches.map(Number) : []
      const anchorBatch = anchorBatchOf(pool)
      const pinned = viewBatch === null || viewBatch === undefined ? null : Number(viewBatch)
      const shownBatch = pinned !== null && Number.isFinite(pinned) ? pinned : anchorBatch
      const index = batches.indexOf(shownBatch)
      return {
        shownBatch,
        anchorBatch,
        batches,
        index,
        // Newest-first list: a larger index is an older batch.
        hasPrev: index >= 0 && index < batches.length - 1,
        hasNext: index > 0,
        isViewingAnchor: anchorBatch > 0 && shownBatch === anchorBatch,
      }
    }

    /** Count tasks by status in the shape the board's chips read. */
    function countByStatus(tasks) {
      const counts = {
        total: 0, PENDING: 0, DISPATCHED: 0, SUCCESS: 0, FAILED: 0, SUBMIT_FAILED: 0, CANCELLED: 0,
      }
      for (const task of Array.isArray(tasks) ? tasks : []) {
        const status = task?.status
        if (typeof status !== 'string') continue
        counts.total += 1
        if (status in counts) counts[status] += 1
      }
      return counts
    }

    /** Tasks still queueing or running. */
    function outstandingOf(counts) {
      return (Number(counts?.PENDING) || 0) + (Number(counts?.DISPATCHED) || 0)
    }

    /** Compact duration: `12s`, `3m04s`, `1h12m`. */
    function formatDuration(seconds) {
      const total = Math.max(0, Math.floor(Number(seconds) || 0))
      if (total < 60) return `${total}s`
      const minutes = Math.floor(total / 60)
      if (minutes < 60) return `${minutes}m${String(total % 60).padStart(2, '0')}s`
      const hours = Math.floor(minutes / 60)
      return `${hours}h${String(minutes % 60).padStart(2, '0')}m`
    }

    /** Elapsed time for one task; trailing `…` while it is still running. */
    function taskDuration(task, now) {
      const start = Number(task?.created_at)
      if (!Number.isFinite(start) || start <= 0) return { seconds: null, text: '-' }
      const finished = Number(task?.finished_at)
      const running = !Number.isFinite(finished) || finished <= 0
      const end = running ? (Number(now) || Date.now()) : finished
      const seconds = Math.max(0, Math.floor((end - start) / 1000))
      return { seconds, text: formatDuration(seconds) + (running ? '…' : '') }
    }

    /**
     * Silent gap in seconds for a task that should be advancing but has not
     * been touched for two poll intervals (and at least a minute), or null when
     * it looks healthy. This is what `pool.py ls` warns about.
     */
    function staleSeconds(task, pollIntervalSeconds, now) {
      const status = task?.status
      const anchor = status === 'DISPATCHED'
        ? Number(task?.updated_at)
        : status === 'PENDING' ? Number(task?.created_at) : NaN
      if (!Number.isFinite(anchor) || anchor <= 0) return null
      const threshold = Math.max(60, (Number(pollIntervalSeconds) || 30) * 2)
      const gap = Math.floor(((Number(now) || Date.now()) - anchor) / 1000)
      return gap > threshold ? gap : null
    }
    // --- end pure view logic -------------------------------------------------

    /** A short human cost summary from a ledger cost object. */
    function formatCost(cost) {
      if (cost === null || typeof cost !== 'object') return null
      const parts = []
      const coins = Number(cost.coins)
      const money = Number(cost.money)
      const third = Number(cost.thirdParty)
      if (Number.isFinite(coins) && coins !== 0) parts.push(`${coins} RH`)
      if (Number.isFinite(money) && money !== 0) parts.push(formatMoney(String(money), 'CNY'))
      if (Number.isFinite(third) && third !== 0) parts.push(`¥${third.toFixed(2)}`)
      return parts.length > 0 ? parts.join(' · ') : null
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

    /** The live task-pool dashboard: counts, batch navigation, and per-row actions. */
    function PoolDashboard({ ctx, t }) {
      const remote = ctx.get('remote.mediaRunningHub')
      const [pool, setPool] = React.useState(null) // { status, currentBatchId, counts, tasks, allBatches }
      const [viewBatch, setViewBatch] = React.useState(null) // null = current batch
      const [loading, setLoading] = React.useState(false)
      const [error, setError] = React.useState(null)
      const [busyRow, setBusyRow] = React.useState(null) // { row, action } or null
      const [rowMsg, setRowMsg] = React.useState(null) // { row, kind, text }
      const [auto, setAuto] = React.useState(true)
      const [jumpText, setJumpText] = React.useState('')
      const [jumpError, setJumpError] = React.useState(false)
      const autoRef = React.useRef(true)
      autoRef.current = auto
      const loadSeq = React.useRef(0)

      /**
       * Load the pool status. With `target` set it loads that batch's detail
       * (parsed costs + outputs); otherwise the current overview, then follows
       * into the current batch's detail when the pool is non-empty.
       */
      const load = React.useCallback((target) => {
        if (remote === undefined || typeof remote.poolStatus !== 'function') {
          setError(t('acctUnavailable'))
          return
        }
        const seq = ++loadSeq.current
        setError(null)
        setLoading(true)
        remote.poolStatus(target > 0 ? { batchId: target } : {})
          .then((response) => {
            if (seq !== loadSeq.current) return
            const value = unwrap(response, 'pool status was refused')
            if (value === null || typeof value !== 'object' || value.status !== 'ok') {
              setError(value && typeof value.message === 'string' ? value.message : '未知原因')
              setLoading(false)
              return
            }
            setPool(value)
            // Follow into a batch's detail even when the pool is drained: with
            // nothing running, currentBatchId is 0 and the board would otherwise
            // stop at the overview and show no rows.
            const anchor = anchorBatchOf(value)
            const desired = target > 0 ? target : anchor
            if (desired > 0) {
              // The overview reply carries the newest tasks across ALL batches,
              // enriched with outputs so a drained board still shows costs.
              // `isBatchDetail` distinguishes the two forms by batch membership.
              if (!isBatchDetail(value.tasks, desired)) {
                setViewBatch(desired)
                remote.poolStatus({ batchId: desired }).then((r2) => {
                  if (seq !== loadSeq.current) return
                  const d = unwrap(r2, 'batch detail was refused')
                  if (d !== null && typeof d === 'object' && d.status === 'ok') setPool(d)
                  setLoading(false)
                }).catch((err) => { if (seq === loadSeq.current) { setError(messageOf(err)); setLoading(false) } })
                return
              }
            }
            setLoading(false)
          })
          .catch((err) => {
            if (seq !== loadSeq.current) return
            setError(messageOf(err))
            setLoading(false)
          })
      }, [remote])

      const refresh = React.useCallback(() => load(viewBatch === null ? undefined : viewBatch), [load, viewBatch])

      React.useEffect(() => {
        load()
        const id = setInterval(() => { if (autoRef.current) refresh() }, 30000)
        return () => clearInterval(id)
      }, [load, refresh])

      // Batch navigation is pure logic, so it lives in lib/pool/view.js and is
      // tested without a browser. The board only reads the result.
      const nav = batchNav(pool, viewBatch)
      const { shownBatch, anchorBatch, batches: allBatches, index, hasPrev, hasNext } = nav
      const isViewingCurrent = nav.isViewingAnchor
      const counts = (pool && pool.counts) || {}
      const tasks = (pool && Array.isArray(pool.tasks)) ? pool.tasks : []

      const gotoBatch = (batchId) => {
        if (batchId === null || batchId === undefined) return
        setViewBatch(Number(batchId))
        load(Number(batchId))
      }
      const gotoPrev = () => { if (hasPrev) gotoBatch(allBatches[index + 1]) }
      const gotoNext = () => { if (hasNext) gotoBatch(allBatches[index - 1]) }
      const gotoCurrent = () => {
        if (anchorBatch > 0) { setViewBatch(anchorBatch); load(anchorBatch) }
        else { setViewBatch(null); load(undefined) }
      }

      /**
       * Replay one task verbatim. Only terminal rows offer it, so no confirm.
       */
      const replay = (row) => {
        if (busyRow !== null || remote === undefined || typeof remote.poolResubmit !== 'function') return
        setBusyRow({ row: row.id, action: 'replay' })
        setRowMsg(null)
        remote.poolResubmit({ rowId: row.id })
          .then((response) => {
            const value = unwrap(response, 'replay was refused')
            if (value === null || typeof value !== 'object' || value.status !== 'ok') {
              const message = value && typeof value.message === 'string' ? value.message : '未知原因'
              setRowMsg({ row: row.id, kind: 'error', text: t('stReplayFailed', { message }) })
              return
            }
            setRowMsg({ row: row.id, kind: 'ok', text: t('stReplayDone', { id: value.newRowId }) })
            refresh()
          })
          .catch((err) => setRowMsg({ row: row.id, kind: 'error', text: t('stReplayFailed', { message: messageOf(err) }) }))
          .then(() => setBusyRow(null))
      }

      /**
       * Cancel one task. Destructive (stops a running job), so confirm first.
       */
      const cancelRow = (row) => {
        if (busyRow !== null || remote === undefined || typeof remote.poolCancel !== 'function') return
        if (!window.confirm(t('statusTitle') + '\n' + t('stCancel') + ' #' + row.id + '?')) return
        setBusyRow({ row: row.id, action: 'cancel' })
        setRowMsg(null)
        remote.poolCancel({ rowId: row.id })
          .then((response) => {
            const value = unwrap(response, 'cancel was refused')
            if (value === null || typeof value !== 'object' || value.status !== 'ok') {
              const message = value && typeof value.message === 'string' ? value.message : '未知原因'
              setRowMsg({ row: row.id, kind: 'error', text: t('stCancelFailed', { message }) })
              return
            }
            setRowMsg({ row: row.id, kind: 'ok', text: t('stCancelDone', { id: row.id }) })
            refresh()
          })
          .catch((err) => setRowMsg({ row: row.id, kind: 'error', text: t('stCancelFailed', { message: messageOf(err) }) }))
          .then(() => setBusyRow(null))
      }

      const cancelable = (status) => status === 'PENDING' || status === 'DISPATCHED'
      const replayable = (status) => status === 'SUCCESS' || status === 'FAILED' || status === 'SUBMIT_FAILED' || status === 'CANCELLED'

      const countChip = (status, label) => h('span', { className: 'media-rh-count' },
        h('span', { className: 'media-rh-account-dot is-' + poolStatusTone(status), 'aria-hidden': 'true' }),
        label, ' ', h('b', null, Number(counts[status]) || 0))

      return h('div', { className: 'media-rh-status-wrap' },
        h('div', { className: 'media-rh-status-head' },
          h('span', { className: 'media-rh-account-title' }, t('statusTitle')),
          h('div', { className: 'media-rh-status-toolbar' },
            h('span', { className: 'media-rh-auto' },
              t('statusAuto'),
              h('button', {
                type: 'button',
                className: 'media-rh-auto-chip' + (auto ? ' is-on' : ''),
                'aria-pressed': auto ? 'true' : 'false',
                onClick: () => setAuto(a => !a),
                title: auto ? t('statusAutoOn') : t('statusAutoOff'),
              }, auto ? t('statusAutoOn') : t('statusAutoOff'))
            ),
            h('button', {
              type: 'button',
              className: 'media-rh-btn',
              disabled: loading,
              onClick: refresh,
            }, loading ? t('statusRefreshing') : t('statusRefresh'))
          )
        ),
        error !== null
          ? h('p', { className: 'media-rh-error', role: 'alert' }, t('statusLoadFailed', { message: error }))
          : null,
        pool === null && loading
          ? h('p', { className: 'media-rh-muted' }, t('acctLoading'))
          : null,
        pool === null || tasks.length === 0
          ? h('p', { className: 'media-rh-muted' }, t('statusEmpty'))
          : h(React.Fragment, null,
              h('div', { className: 'media-rh-counts' },
                countChip('DISPATCHED', t('statusDispatched')),
                countChip('PENDING', t('statusPending')),
                countChip('SUCCESS', t('statusSuccess')),
                countChip('FAILED', t('statusFailed')),
                countChip('SUBMIT_FAILED', t('statusSubmitFailed')),
                countChip('CANCELLED', t('statusCancelled')),
                h('span', { className: 'media-rh-count' }, t('curBatch'), ' ',
                  h('b', null, currentBatch > 0 ? '#' + currentBatch : t('batchNone')))
              ),
              h('div', { className: 'media-rh-batch-nav' },
                h('button', {
                  type: 'button',
                  className: 'media-rh-batch-nav-btn',
                  disabled: !hasPrev || loading,
                  onClick: gotoPrev,
                }, t('stPrev')),
                h('span', null,
                  shownBatch > 0 ? t('stBatchLoaded', { id: shownBatch }) : t('batchNone')),
                h('button', {
                  type: 'button',
                  className: 'media-rh-batch-nav-btn',
                  disabled: !hasNext || loading,
                  onClick: gotoNext,
                }, t('stNext')),
                !isViewingCurrent
                  ? h('button', {
                      type: 'button',
                      className: 'media-rh-batch-nav-btn',
                      disabled: loading,
                      onClick: gotoCurrent,
                    }, t('stCurBatchBtn'))
                  : null,
                // Jump straight to a batch number: the ledger keeps every batch
                // id, and Prev/Next only walk the ids that happen to exist, so a
                // known number needs its own entry point.
                h('form', {
                  className: 'media-rh-batch-jump',
                  onSubmit: (event) => {
                    event.preventDefault()
                    const wanted = Number(jumpText)
                    if (!Number.isInteger(wanted) || wanted <= 0) { setJumpError(true); return }
                    setJumpError(false)
                    gotoBatch(wanted)
                  },
                },
                  h('input', {
                    type: 'number',
                    min: 1,
                    className: 'media-rh-batch-jump-input',
                    placeholder: t('stBatchJumpPlaceholder'),
                    value: jumpText,
                    onChange: (event) => { setJumpText(event.target.value); setJumpError(false) },
                    disabled: loading,
                  }),
                  h('button', {
                    type: 'submit',
                    className: 'media-rh-batch-nav-btn',
                    disabled: loading,
                  }, t('stBatchJump')),
                  jumpError ? h('span', { className: 'media-rh-batch-jump-error' }, t('stBatchJumpInvalid')) : null
                )
              ),
              h('div', { className: 'media-rh-table-wrap' },
                h('table', { className: 'media-rh-table' },
                  h('thead', null,
                    h('tr', null,
                      h('th', null, t('stType')),
                      h('th', null, t('stId')),
                      h('th', null, t('stStatus')),
                      h('th', { className: 'is-right' }, t('stCost')),
                      h('th', null, t('stOutput')),
                      h('th', null, t('stCreated')),
                      h('th', null, t('stActions'))
                    )
                  ),
                  h('tbody', null, tasks.map((row) => {
                    const status = row.status || 'PENDING'
                    const costText = formatCost(row.costs)
                    const outputs = Array.isArray(row.outputs) ? row.outputs : []
                    const firstOut = outputs.find((o) => o && o.ok === true && (o.path || o.url))
                    const outLink = firstOut
                      ? h('a', {
                          className: 'media-rh-output-link',
                          href: firstOut.path || firstOut.url,
                          target: firstOut.path ? '_self' : '_blank',
                          rel: 'noreferrer',
                          onClick: firstOut.path ? (event) => event.preventDefault() : undefined,
                          title: firstOut.path || firstOut.url,
                        }, t('stOutputOpen'))
                      : (outputs.length > 0 ? h('span', { className: 'media-rh-muted' }, t('stNoOutput')) : h('span', { className: 'media-rh-muted' }, t('stNoOutput')))
                    const timeText = Number(row.created_at) > 0
                      ? new Date(Number(row.created_at)).toLocaleString()
                      : t('stNoOutput')
                    const busy = busyRow !== null && busyRow.row === row.id
                    const busyType = busy ? busyRow.action : null
                    const msg = (rowMsg !== null && rowMsg.row === row.id) ? rowMsg : null
                    return h('tr', { key: String(row.id) },
                      h('td', { className: 'media-rh-type', title: row.type_id }, row.type_id || t('statusUnknown')),
                      h('td', null, '#' + row.id),
                      h('td', null,
                        h('span', { className: 'media-rh-status-tag' },
                          h('span', { className: 'media-rh-account-dot is-' + poolStatusTone(status), 'aria-hidden': 'true' }),
                          poolStatusLabel(t, status)
                        )
                      ),
                      h('td', { className: 'is-right' }, costText !== null ? costText : h('span', { className: 'media-rh-muted' }, t('stNoCost'))),
                      h('td', null, outLink),
                      h('td', null, timeText),
                      h('td', null,
                        h('span', { className: 'media-rh-row-actions' },
                          replayable(status)
                            ? h('button', {
                                type: 'button',
                                className: 'media-rh-btn is-primary',
                                disabled: busy,
                                onClick: () => replay(row),
                              }, busyType === 'replay' ? t('stReplaying') : t('stReplay'))
                            : null,
                          cancelable(status)
                            ? h('button', {
                                type: 'button',
                                className: 'media-rh-btn is-danger',
                                disabled: busy,
                                onClick: () => cancelRow(row),
                              }, busyType === 'cancel' ? t('stCancelling') : t('stCancel'))
                            : null
                        ),
                        msg !== null
                          ? h('span', { className: 'media-rh-row-msg ' + (msg.kind === 'ok' ? 'is-ok' : 'is-error'), role: msg.kind === 'ok' ? 'status' : 'alert' }, msg.text)
                          : null
                      )
                    )
                  }))
                )
              )
            )
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
      const [collapsed, setCollapsed] = React.useState(true)

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
        h('div', {
          className: 'media-rh-collapse' + (collapsed ? '' : ' is-open'),
          role: 'button',
          tabIndex: 0,
          'aria-expanded': collapsed ? 'false' : 'true',
          onClick: () => setCollapsed(c => !c),
          onKeyDown: (event) => {
            if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setCollapsed(c => !c) }
          },
        },
          h('span', { className: 'media-rh-collapse-title' }, collapsed ? t('cfgExpand') : t('cfgCollapse')),
          h('span', { className: 'media-rh-collapse-caret', 'aria-hidden': 'true' }, collapsed ? '▸' : '▾')
        ),
        collapsed ? null : h('div', { className: 'media-rh-collapse-body' },
          cfgMessage !== null
            ? h('p', { className: 'media-rh-msg ' + (cfgMessage.kind === 'ok' ? 'is-ok' : 'is-error'), role: cfgMessage.kind === 'ok' ? 'status' : 'alert' }, cfgMessage.text)
            : null,
          loadError !== null
            ? h('p', { className: 'media-rh-error', role: 'alert' }, t('loadFailed', { message: loadError }))
            : null,
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
          infos === null
            ? h('p', { className: 'media-rh-muted' }, t('loading'))
            : KEYS.filter(entry => entry.surface === surface).map(entry => {
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
        ),
        h(PoolDashboard, { ctx, t })
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
