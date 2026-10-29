# media-runninghub `jobs` 模式设计

本文记录 `surface: jobs`（RunningHub 工作流任务池）的设计决策与依据。
原技能参考实现：`C:\Users\lj110\dev\OpenClaw_RH_Skills\runninghub`。

> **状态**：设计已收敛、jobs 已实现（三个工具 + 单例 watcher + runtime skill）。
> 2026-10-29 首轮打穿测试通过全链路，并暴露两个真实 bug（均已被修复，见下）。已定论项见 §2，未定论项见 §8。
> 讨论已经过多轮，**本文是决策的唯一权威来源**——上下文被压缩后以本文为准。

---

## 1. 目标与范围

在 DSH 里复刻原技能的「工作流任务池」：把 RunningHub 的工作流任务（11 种类型）
作为**后台作业**提交，队列化执行、自动下载产物、完成时唤醒会话。

**范围**：只做 `task-types.json` 里的 11 个工作流类型。
RunningHub 的 420 个标准 API 端点属于 `sync` 模式的职责，不在 `jobs` 里重复实现。

---

## 2. 已定论

### 2.1 站点判定（已完成，提交 `1055e36`…`e3da1ed`）

每个 Key 只属于 RunningHub 的一个站。判定**只看账户余额币种**：

| 币种 | 站点 | Host |
|---|---|---|
| `USD` | 国际站 | `www.runninghub.ai` |
| `CNY` | 中国站 | `www.runninghub.cn` |

- `accountStatus` 在任一站都能用任何 Key 查询，且返回的 `currency` **属于账户本身**
  而非被查询的那一站（实测：USD 账户在 `.cn` 和 `.ai` 上都报 USD）。
- `apiType`（`SHARED`/`NORMAL`）**不能**用于判站点。
- 判定发生在**配置时**（设置页保存 Key 时），结论写入 Config 的 `syncSite`/`jobsSite`
  （volatile 字段，只热更新不重载插件）。
- 工具每次调用读 `ctx.fiber.config` 取该结论。

### 2.2 Key 命名

| ref | 用途 | 建议的 Key 类型（仅建议，不强制） |
|---|---|---|
| `RUNNINGHUB_SYNC_API_KEY` | 模型 API / 同步图片生成（`sync` surface） | 企业级-共享 |
| `RUNNINGHUB_JOBS_API_KEY` | 工作流 API / 任务池（`jobs` surface） | 消费级-会员 |

两个 Key 相互独立，允许相同值，不做相等校验，不按类型限制调用。

### 2.3 台账

- **作用域：共享全局**（跨会话）。
- **落点**：`packages/media-runninghub/data/pool/`（sqlite），`.gitignore` 忽略 `data/pool/`。
  放在工作区内的理由：避开沙箱、与包同树。
- 存什么：批次（batch）、任务（task）、taskId、类型、参数、来源会话、产物路径、费用、状态。

### 2.4 类型定义

- **保留 `config/task-types.json` 全部内容**——它同时是
  ①提交契约（`workflowId`/`instanceType`/`params[].nodeId`/`fieldName`/`required`/`default`）
  和②给模型看的说明（`label`/`description`/`enum`/`accept`/`fixedOverrides`）。
- **删除 `config/workflows/*.json`**，**不做校验**。
  原校验依赖归档的原始导出，是「对着过期快照自检」；RunningHub 侧报错才是权威。
  校验失败的信息直接报给用户。

### 2.5 实现形态

- **纯 DSH 工具**，不打包 Python 脚本，不依赖 `python3`/`curl`。
- 不需要沙箱逃逸（原技能特意警告「任务池命令请用非沙箱模式执行」，此坑不存在）。
- 不需要 `notify.lock` 单飞锁。

### 2.6 输出

- 产物目录：**程序自动下载**，不需要额外配置。
- 遵循既有约定：默认 `<会话目录>/output/media/runninghub/`；per-job 可带 `outputDir`/`outputName` 覆盖。
- **输出位置不是 profile 配置项**（与 `sync` 模式一致）。

### 2.7 配置项映射

原 `config/skill-config.json` → DSH Config：

| 原键 | DSH Config | 类型 | 说明 |
|---|---|---|---|
| `concurrency` | `concurrency` | number | **全局预算**（跨会话共享，见 §3.2） |
| `defaultInstanceType` | `defaultInstanceType` | string | |
| `pollIntervalSeconds` | `pollIntervalSeconds` | number | 轮询节奏 |
| `retry.startupFailures` | `retryStartupFailures` | boolean | 平铺 |
| `retry.maxStartupRetries` | `retryMaxStartupRetries` | number | 平铺 |
| `retry.startupFailCodes` | `retryStartupFailCodes` | string[] | 平铺 |
| `retry.startupFailMaxElapsedS` | `retryStartupFailMaxElapsedS` | number | 平铺 |
| `schemaVersion` | — | 丢弃 | DSH 用 Schema 自身校验 |
| `dataDir`/`outputDir` | — | 丢弃 | 见 §2.3 / §2.6 |

嵌套 `retry` 对象**平铺**：Schemastery 表单对嵌套对象不友好，且平铺后每字段可独立 volatile。

---

## 3. 核心机制

### 3.1 DSH 后台作业与唤醒（已实测）

`ctx.jobs`（`@deepseek-ai/dsh-jobs-local`，进程内 JobRegistry）：

- `start(spec)` **注册即返回**，不等 `run()` 完成。
- `spec.owner` 绑定 SessionId 作**权限栅栏**；owner 的 live Agent 被 dispose 时作业被取消。
- `run(job)` 必须同步返回 `{ done: Promise, cancel }`；`done` resolve 即作业 settle。
- settle 时经 `recordSessionEvent` 向 **owner 会话**追加 `job/settled` 事件 → **自动唤醒**。

源码依据 `dsh-jobs-local/lib/index.js:604-625`：

```js
recordSessionEvent(job, settlement) {
  const owner = job.owner
  if (owner === undefined) return;        // 无 owner → 不写会话事件 → 不唤醒
  ...session.append("job/settled", ...)
}
```

**实测（2026-10-28）**：用 `run_in_background` 起一个 sleep 90 秒的 node 进程，
启动后**立即结束轮次**（不做任何后续工具调用）；作业跑满 90 秒、退出码 0、
marker 文件写入；**会话被自动唤醒并开始新一轮**。✅

> 测试要点：启动后必须**立即结束轮次**。若启动后还有工具调用，loop 一直在跑，
> 「唤醒」就证明不了任何事。（第一次测试就犯了这个错。）

### 3.2 单例 watcher（用户 2026-10-28 修正）

> **「watcher 要做成单例，只跑一个，watch 完成后，只唤醒 watch 发起的会话，其余不管。」**

**这与「每会话一个 owner 作业」的方案不同，按此修正。**

- 全局**只有一个** watcher 作业在跑，负责轮询**全局台账**里的所有未完成任务。
- watcher 的 `owner` = **发起 watch 的那个会话**。
- watcher 排空后，**只唤醒发起它的会话**；其他会话的任务产物留在台账里，不主动唤醒。

**推论**：

1. watcher 是**全局单例**，因此 `concurrency` 天然是**全局预算**（与 §2.7 一致）。
2. 其他会话提交的任务，完成后**不会被唤醒**——它们下次查台账时能看到结果。
   这是用户明确接受的行为（「其余不管」）。
3. 单例意味着**只有一个会话能被唤醒**。若 A 会话提交、B 会话提交，只有 A 的 watcher
   在跑，B 不会被唤醒。
4. 因此「唤醒发起会话」实际意味着：**第一个提交任务并启动 watcher 的会话**是 owner。
   后续会话的提交**复用**这个 watcher（不新建、不换 owner）。

**待澄清**（见 §8 ②）：watcher 已存在时，后续会话提交的任务要不要换 owner？
不换 → 那些会话永不被唤醒；换 → 原 owner 会话被换掉，语义变复杂。

**用户 2026-10-28 确认：B 会话不用唤醒。** ✅
即：只有**第一个提交任务的会话**（watcher 的 owner）会被唤醒；其他会话的任务完成后
留在台账里，那些会话下次查询时能看到结果。

### 3.2.1 批次语义（用户 2026-10-28 复述，与原技能 `pool.py` 一致）

- **下发可以一次多条，也可以一条一条。**没有显式的"建批次"动作。
- **批次是自动派生的，不是显性控制的**：
  - 台账里有未完成任务时，**新下发的任务并入当前批次**（视为同一批次）。
  - 只有**上一批次全部结束**后，再下发任务才**新建一个批次**。
- 批次号在任务入队时分配并写进台账。

**推论**：批次是**台账的派生状态**（由任务行算出），不是需要单独维护的实体——
这正是原技能 `store.py` 的做法（"Batch state is derived from task rows (crash-safe)"）。
好处：崩溃后重启，批次状态自动恢复，不需要额外的持久化。

### 3.2.2 watcher 生命周期

- watcher **排空（所有任务终态）后结束**，释放 owner。
- 下次提交任务时**重新起一个 watcher**（新的 owner = 那个提交会话）。
- **单例**：任意时刻全局只有一个 watcher。

**「并发预算」的含义**（用户 2026-10-28 确认：**全局预算**）：

`concurrency` = 全局同时在飞的 **RunningHub 任务**数（不是作业数）。
一个 watcher 作业可能包含多个任务，所以这个预算**不能**靠 `ctx.jobs` 的
`maxConcurrentJobsPerOwner`（那是 per-owner 的作业数限制，默认 10），
**必须由池自己管**：一个模块级的信号量/等待队列，所有会话的 watcher 共用。

单例 watcher + 全局预算 = 原技能「一个全局批次循环」的结构复刻。

### 3.3 提交流程

```
runninghub_workflow_submit（工具，Host 侧）
  1. 读 task-types.json，按 typeId 取类型定义
  2. 校验参数：必填、类型、枚举、文件扩展名
  3. 文件参数上传到 RunningHub（站点由 jobsSite 决定）→ 得到 rhFileName
  4. 组 nodeInfoList：[{ nodeId, fieldName, fieldValue }]
  5. POST https://<site>/task/openapi/create  →  taskId
  6. 写台账：批次 + 任务行（含来源会话、参数、产物目录）
  7. 若无 watcher 在跑 → ctx.jobs.start({ owner: <发起会话>, run: 轮询循环 })
     若已有 watcher → 复用，只把任务写进台账
  8. 立即返回 { batchId, taskIds, ... }；agent 结束本轮
```

轮询循环（watcher 的 producer）：

```
while (还有未完成任务):
    查台账取未完成任务 → 查 RunningHub 状态
    job.updateProgress('已完成 3/5')
    全部终态 → 下载产物 → 写台账 → return { status: 'completed' }
    await sleep(pollIntervalSeconds)
```

### 3.4 RunningHub 工作流 API

| 用途 | 路径 | 说明 |
|---|---|---|
| 提交 | `POST /task/openapi/create` | body：`{ apiKey, workflowId, instanceType, nodeInfoList }` |
| 查询 | `POST /openapi/v2/query` | body：`{ taskId }`；返回**扁平任务对象** |

响应形状（实测）：

- 提交成功：`{ code: 0, data: { taskId, taskStatus } }`
- 查询成功：`{ status: 'SUCCESS'|'FAILED'|'QUEUED'|'RUNNING', results: [...], usage: {...} }`
  —— **没有 `code`/`data` 包装**；成功靠 `taskId` 非空 + `errorCode` 为空判断。
- 费用字段：`usage.consumeCoins` / `usage.consumeMoney` / `usage.thirdPartyConsumeMoney` / `usage.taskCostTime`。

原技能 `client.py` 的错误分类（`AUTH`/`INSUFFICIENT_BALANCE`/`WORKFLOW_INVALID`/
`RATE_LIMIT`/`NETWORK`/`TASK_NOT_FOUND`）值得沿用。

### 3.5 产物下载

原技能 `pool.py:_download_outputs`：

- 产物在 `results[]`，每项含 `url`/`outputUrl`、`outputType`、`nodeId`。
- 默认命名：`<poolId>_<nodeId>_<idx>.<ext>`（idx 取原始 results 下标，
  保证多次结果与 node 槽位对应稳定）。
- 指定 `outputName` 时：`<name>.<ext>`（单个）或 `<name>_<seq>.<ext>`（多个）。
- **多产物必须支持**：例如 `music-yue2` 一个任务产出 3 个 MP3（混音/伴奏/人声干声）。

### 3.6 首轮打穿测试记录（2026-10-29）

全链路验证通过：提交 → enqueue（批次自动派生）→ 单例 watcher 启动 →
轮询 → 判定 SUCCESS（捕获费用）→ 排空 → **自动唤醒提交会话**（无显式 prompt）。
3 张计费 `image-gen-qwen` 图，共 **66 RH 币**（20 + 21 + 19，每 ~20 币）。

**暴露并已修复的两个 bug：**

1. **产物下载 ENOENT**（已修，commit `95c6114`）：`downloadFile` 写盘前不建父目录，
   默认落点 `output_root/batch-<id>/<taskId>_<nodeId>_<idx>.<ext>` 的 `batch-<id>/`
   目录不存在 → 任务 SUCCESS 但所有产物 `ok:0`。修复：写前 `mkdir(dirname,{recursive})`。
2. **排空后 `currentBatchId` 类型**（已修，同 commit）：`currentBatchId()` 排空返回 `null`，
   status 工具的 `{type:'integer'}` schema 拒绝 → 报 "must be an integer"。修复：排空返回 `0`
   与"已排空→0"约定一致。

**测试期发现但非产品 bug：** 测试中多次失败提交实则在 enqueue 后、watcher 启动前抛错，
导致台账残留重复任务与 `SUBMIT_FAILED`（`404`、`421 TASK_QUEUE_MAXED`）。

---

## 4. 工具清单（暂定）

| 工具 | 作用 | 状态 |
|---|---|---|
| `runninghub_workflow_submit` | 提交任务（单任务或批量），起/复用 watcher，返回 batchId | 待定 |
| `runninghub_workflow_types` | 返回 11 个类型的目录（参数表） | 待定（§8 ③） |
| `runninghub_workflow_status` | 查批次/任务状态、费用 | 待定 |
| `runninghub_workflow_outputs` | 取批次产物 | **存疑**（§8 ④） |
| `runninghub_workflow_list` | 列出批次 | 待定 |

### 关于 `runninghub_workflow_outputs`

用户的疑问：「这个工具有啥用？」

**它不是必需的。** 产物是**程序自动下载**的（§2.6），watcher 完成后产物已经在
`<会话目录>/output/media/runninghub/batch-<id>/` 里。

它的可能用途只有三个：

1. **交付给用户**——告诉模型产物在哪（绝对路径）。
2. **汇总费用**——批次总费用。
3. **重试下载**——产物下载失败时的补救。

**结论倾向**：产物信息（路径 + 费用）可以**直接放在唤醒提示里**（watcher 完成时
构造那条消息），模型看到唤醒消息就知道产物在哪、花了多少，**不需要再调工具查**。
所以 `outputs` 工具**可以不做**。待你确认（§8 ④）。

---

## 5. skill 的职责

**工具 = 能力；skill = 何时用、怎么用。** 任务池流程复杂，需要 skill 约束。

| skill 负责 | 工具负责 |
|---|---|
| 11 种类型的选择规则（如「生图默认 Qwen，不用 Banana 2」） | 校验并提交 |
| **提交后必须结束轮次，不要轮询** | 起/复用 watcher |
| 唤醒后如何取产物、如何交付 | 台账查询（若保留状态工具） |
| 费用怎么报（`COINS:`/`COST:`/`THIRD_PARTY:`） | 返回结构化费用 |
| 产物放哪、怎么给用户 | 自动下载到约定目录 |

**原技能 SKILL.md 的关键规则**（需转写进 DSH skill）：

1. **提交后轮次即结束**——不轮询、不 sleep、不在轮次内等待。
2. **唤醒后再取产物**——用 submit 返回的 batchId，不要用 `--latest`。
3. **费用必须报**——非零的费用项都要报。
4. **不暴露 RunningHub 内部 URL**——用户打不开。
5. **类型必须用既定目录**——不许自己编模型列表。

**skill 放在哪**：待定（§8 ①）。

---

## 6. 与 DSH 既有机制的对应

| 原技能概念 | DSH 对应 |
|---|---|
| `pool.py enqueue` | `runninghub_workflow_submit` 工具 |
| detached watcher 进程 | `ctx.jobs` 的单个 watcher 作业（`owner` = 发起会话） |
| `notify.py watch` 循环 | watcher 的 `run(job)` 协程 |
| `openclaw agent --session-key` CLI 唤醒 | `job/settled` 事件（进程内，已实测） |
| `store.py` sqlite 台账 | `packages/media-runninghub/data/pool/*.sqlite` |
| `workflow_def.py` 类型加载 | 读 `config/task-types.json` |
| `task-pool.md` 流程文档 | DSH skill |
| `pool.py workflow list` | `runninghub_workflow_types` 工具 |

---

## 7. 与 `sync` 模式的关系

- `surface` 互斥：`sync` 注册 `runninghub_image`；`jobs` 注册上面这批工具。
- 切换 `surface` 重载插件（普通 Config 字段变更 → 插件重载）。
- `jobs` 模式用 `RUNNINGHUB_JOBS_API_KEY` + `jobsSite`；`sync` 用 `RUNNINGHUB_SYNC_API_KEY` + `syncSite`。
- **两套互不影响**：jobs 的 `concurrency`/`pollIntervalSeconds` 等配置只在 `jobs` 下有意义。

---

## 8. 未定论（待逐项敲定）

| # | 问题 | 现状 / 倾向 |
|---|---|---|
| ① | **skill 放哪？** | ✅ 已定：**`ctx.skills.register()`（runtime skill，随包分发）**，见 §8.3 |
| ② | ~~watcher 已有 owner 时换不换 owner？~~ | ✅ 已定：**不换**，B 会话不唤醒（§3.2） |
| ③ | **类型目录怎么给模型？** | 倾向 `runninghub_workflow_types` 工具（权威）+ skill 里放选择规则 |
| ④ | **`runninghub_workflow_outputs` 做不做？** | 倾向**不做**——产物路径和费用直接放进唤醒消息 |
| ⑤ | **失败的任务怎么报？** | 原技能有 `ERROR:<poolId>: …` 逐条列 + `SUBMIT_FAILED` 状态 |
| ⑥ | **启动失败重试**（`retry.*`）是否实现？ | 原技能对 errorCode `1000` 做窄门重试 |
| ⑦ | **批量提交**的入参形式？ | 批次是自动派生的（§3.2.1），但**一次调用提交多条**的入参形式待定 |
| ⑧ | **`surface` 默认值** | v1 默认 `sync`；jobs 落地后是否改默认 `jobs`？ |
| ⑨ | **产物交付方式** | DSH 里文件怎么给用户？链接？直接路径？ |
| ⑩ | **`media-drama`** 包何时做？ | jobs 落地之后 |

### 8.3 skill 怎么随插件分发？（已定，2026-10-28）

**结论：用 `ctx.skills.register()`（runtime skill）在插件 `apply()` 里直接注册，
skill 内容作为包内文件随包分发。**

**背景**：最初的倾向是「项目层 `.dsh/skills/`」，但用户指出两个问题：
①这个 skill 是 `media-runninghub` 的**配套技能**，不该放在 `media-suite` 项目里；
②要保证**每个安装插件的人**都能用——项目层只对 cwd 落在该仓库的会话可见，不满足。

**机制**（`@deepseek-ai/dsh-skill/lib/index.js:193-215`）：

```js
ctx.skills.register({
  name: 'runninghub-workflow',
  description: '...',
  whenToUse: '...',
  source: 'media-runninghub',
  content: '<SKILL.md 的正文>',   // validateDefinition 要求 content 是 string
})
```

- `register()` 在 `apply()` 里同步调用，注册进调用上下文的层
  （仓库插件 → 全局层），**所有会话可见，与 cwd 无关**。
- 无需 `skill-filesystem`、无需文件扫描、无需项目根。
- 运行时技能的 rank 是 250（介于 project 200 和 user 400 之间），
  同名冲突时 project 层优先。
- 重复注册同一名字会被忽略（first-wins + 警告）。
- 插件卸载时 disposer 自动移除并刷新目录缓存。
- `validateRuntimeSkill`（:465-469）要求 `name`（kebab-case）和 `description`
  非空；加载时 `validateDefinition`（:471-490）要求 `content` 是 string。

**content 的来源**：包内 `skill/runninghub-workflow/SKILL.md`（去掉 frontmatter
后的正文），在 `apply()` 里读一次。frontmatter 的 name/description/whenToUse
同时用于 `register()` 的元数据字段。

**对比被否掉的方案**：

| 方案 | 为什么不行 |
|---|---|
| 项目层 `.dsh/skills/` | 只对 cwd 落在该仓库的会话可见；且 skill 放在 media-suite 项目里而非插件包里 |
| 用户层 `$DSH_HOME/skills/` | 与包分离，装包不带 skill，用户要手动复制 |
| `customSkillDirs` 注入 | 要改 skill-filesystem 的 Config（profile patch），侵入面大 |
| `DSH_BUNDLED_SKILL_DIR` | 那是 DSH 安装自带的技能目录，不是插件的 |

**原 SKILL.md 的转写**：原技能 `SKILL.md`（141 行）里与任务池相关的规则
（§5 的表）转写进 runtime skill 的 content；其余部分（标准 API、AI 应用、
Persona、输出交付等）属于 `sync` 模式或 CLI 形态，不进这个 skill。

### 8.1 2026-10-28 补充：并发预算

**`concurrency` 是全局预算**（跨会话共享），与单例 watcher 一致——
单例 watcher 顺序处理任务，天然是全局串行/受限的。

### 8.2 2026-10-28 补充：`runninghub_workflow_outputs` 的用途

用户问「这个工具有啥用？」——**它不是必需的**。

产物是**程序自动下载**的（§2.6），watcher 完成后产物已在
`<会话目录>/output/media/runninghub/batch-<id>/`。

它唯一的潜在用途是「告诉模型产物在哪」——但这个信息**可以直接写进唤醒消息**。
所以倾向**不做这个工具**（§8 ④ 待你确认）。


---

## 9. 已排除的方案

| 方案 | 为什么排除 |
|---|---|
| 纯 CLI（agent 跑 Python 脚本） | 拿不到 `job/settled` 事件 → 没有自动唤醒（已实测 CLI 路线不行） |
| 打包 Python 脚本供交叉验证 | 用户决定：纯 DSH 工具，不考虑其它环境 |
| 每会话一个 owner 作业 | 用户修正为**单例 watcher，只唤醒发起会话** |
| 显式 `sessionController.prompt` 唤醒 | 用户决定：默认机制已够用，不增加复杂度 |
| 保留 `workflows/*.json` 做校验 | 用户决定：不做校验，报错直接给用户 |
| 输出位置做成 profile 配置 | 与既有约定冲突（输出不是 profile 配置） |
| 台账放 `$DSH_HOME` | 用户决定：放工作区内，避开沙箱 |
