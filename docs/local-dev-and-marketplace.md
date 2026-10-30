# media-suite 项目说明

> 本文是**当前状态的权威说明**。排障过程已结束，历史弯路不再保留——只记结论、机制和规则。
> 想改包、发版、或排查加载失败，读这一份就够。

---

## 1. 包结构

三个包，`@tmmk` scope，已发布到 npm（账号 `lj110119`）：

| 包 | 版本 | 角色 | 依赖 |
|---|---|---|---|
| `@tmmk/media-qwen` | 0.1.1 | 真插件：Qwen 多模态 / TTS / 音频生成 | 无 |
| `@tmmk/media-runninghub` | 0.1.1 | 真插件：RunningHub 同步出图 + 工作流任务池 | 无 |
| `@tmmk/media-suite` | 0.1.3 | **分发壳**：只负责把上面两个挂起来 | qwen `^0.1.1`、runninghub `^0.1.1` |

三个包都声明了 `dsh.bundle.patch` 和 `dsh.client`（`platform: web`），都有 `index.js`（Host 半）和 `client.js`（Client 半）。

`media-suite` 自己**没有 Config、没有设置页、没有工具**——它的 `apply()` 是空的，唯一贡献就是 patch。

---

## 2. 插件加载机制（理解这一节才能理解后面的坑）

### 2.1 组合顺序

一个 `dsh` 进程 = 一棵插件树。树从**空列表**长出，按顺序叠 patch：

```
① dsh.profile.bundles 里每个包的 dsh.bundle.patch（按数组顺序）
② profile 自己的 cordis.patch.yml
③ home patch
④ --patch 覆盖
```

patch 只有两种动作：**insert 新行**、或**按 `id` 替换已有行的 config**（整块替换，不深合并）。

### 2.2 一行怎么变成插件

```
patch insert { id, name: '@tmmk/media-qwen' }
  → Node 从 node_modules 解析 name → import 包的 index.js
  → 得到 { name, apply, inject, Config }
  → inject 的服务就绪后构建 fiber → apply(ctx) 执行
```

`inject` 是加载门槛：`['credentials','tools']` 意味着这两个服务就绪前不激活；服务消失会自动卸载、恢复自动重载。

### 2.3 Client 半

`client-modules` 扫 loader 里**声明了 `dsh.client` 的包**，组合成 `window.__DSH_BOOT__` 的 entry 图，浏览器按 entry 去 `/plugins/??<包名>/client.js&rev=<hash>` 拉取。

**关键**：entry id = **完整包名**。`client.js` 里 `window.__ModuleLoader__.load({ id, factory })` 的 `id` 必须与之一致。

---

## 3. 集成器为什么必须自己插三行

这是本项目最重要的设计决策。

`dsh plugin add @tmmk/media-suite` 的行为是不对称的：

```
media-suite            → dependencies ✅  dsh.profile.bundles ✅
@tmmk/media-qwen       → dependencies ✅  dsh.profile.bundles ❌  (传递依赖)
@tmmk/media-runninghub → dependencies ✅  dsh.profile.bundles ❌  (传递依赖)
```

而 **只有 `dsh.profile.bundles` 里包的 patch 会被应用**。所以 provider 自己的 `cordis.patch.yml` 永远不跑，它的行永远不会被插入。

**结论**：壳必须自己插入三行。见 `packages/media-suite/cordis.patch.yml`：

```yaml
- insert:
    - id: media-suite
      name: '@tmmk/media-suite'
    - id: media-qwen
      name: '@tmmk/media-qwen'
    - id: media-runninghub
      name: '@tmmk/media-runninghub'
      config:
        surface: jobs
        channel: lowprice
        concurrency: 2
        pollIntervalSeconds: 30
```

provider 的默认 config 也只能由壳给出——因为 provider 那层 patch 不跑，它声明的默认值不生效。

**UI 表现**：插件管理器「已安装 bundle」里只显示 media-suite 一个条目，其 `rows` 含三条。这是集成器模式的正常表现。

---

## 4. 两个必须记住的陷阱

### 4.1 `__ModuleLoader__.load` 的 `id` 必须是完整包名

写短名（`media-qwen`）而 entry id 是 `@tmmk/media-qwen` → 内核查不到 factory →

```
client-modules: could not load "@tmmk/media-qwen": ... loaded without registering
"@tmmk/media-qwen" via __ModuleLoader__.load
```

设置页不出现。**三个包的 `client.js` 都必须写完整包名。**

手写 `window.__ModuleLoader__.load({ id, factory })` 这个形态本身是合法的（官方 client bundle 就是这么生成的，lazy-CJS factory 格式），错的只是 id。

### 4.2 `files` 字段的通配符不匹配子目录

`"lib/*.js"` **不匹配** `lib/pool/*.js`。写错会让子目录整个漏出 tarball →

`index.js` 里 `import './lib/pool/config.js'` 抛错 → 插件 fiber 永远不激活（`fiberPhase: null`）→ 一直提示「重启后生效」。

**规则**：有子目录时必须写 `"lib/**/*.js"`。

排查口诀：`npm pack --dry-run` 看文件列表，比读代码快。

### 4.3 依赖范围必须跟版本走

`media-suite` 依赖写 `^0.1.0` 时，pnpm 会**复用已有的 0.1.0 解析**（已满足范围，不主动升级）→ 用户装了新壳却拿到旧的坏 provider。

**规则**：provider 修 bug 发版后，壳的依赖范围必须同步提到 `^<新版本>`，壳自身也要 bump 版本。

---

## 5. 发布流程

### 5.1 顺序

provider 先、壳后（壳依赖它们）：

```bash
cd packages/media-qwen        && npm publish
cd packages/media-runninghub  && npm publish
cd packages/media-suite       && npm publish
```

### 5.2 凭据

需要**带 Bypass 2FA 的 granular access token**，内联传参，不要写进 `.npmrc`、不要提交：

```bash
npm publish --//registry.npmjs.org/:_authToken=<token>
```

普通 `.npmrc` token 若无 Bypass 2FA 会报 `403 Two-factor authentication ... required`。

### 5.3 发布前自检

- [ ] 版本号已 bump（npm 不允许覆盖同版本）
- [ ] `npm pack --dry-run` 文件列表完整（尤其子目录）
- [ ] `client.js` 的 `load` id = 完整包名
- [ ] 壳的依赖范围已跟上 provider 新版本
- [ ] 壳的 patch 插入三行

### 5.4 安装验证

```bash
dsh plugin --profile desktop add @tmmk/media-suite
```

装完重启 DSH，确认两个设置页出现。

⚠️ 注意 lockfile 会锁旧版本。要强制升级用显式范围：

```bash
dsh plugin --profile desktop add @tmmk/media-suite@^<新版本>
```

---

## 6. 上架插件市场

- 给 <https://github.com/deepseek-ai/awesome-dsh-plugin> 提 PR，加 `data/plugins/<owner>__<repo>.yml`：`url / name / category / description.en`。一个 PR 最多 3 条。
- 硬性要求：声明 `dsh.bundle`（✅ 已满足）、真实代码、仓库满 1 天、加 `dsh-plugin` topic、描述属实。
- **media-suite 是纯聚合壳，不会单独收录**；media-qwen / media-runninghub 可收录。
- category 可取 tools / ai / vision / voice / workflow。

---

## 7. 各包实现要点

### media-qwen

- `inject: ['credentials','tools']`
- 工具：`qwen_omni`、`qwen_tts`、`qwen_audio`
- 凭据：`DASHSCOPE_API_KEY`（走 `ctx.remote.credentials.describe/set/unset`，页面永不持有明文）
- Host 侧提供 `mediaQwenController`，remote 方法 `dashscopeStatus`

### media-runninghub

Config（`packages/media-runninghub/index.js`）：

| 字段 | 类型 | 默认 | volatile |
|---|---|---|---|
| `surface` | `jobs` \| `sync` | **`jobs`** | 否（改动会重载插件） |
| `channel` | `lowprice` \| `official` | `lowprice` | 否 |
| `syncSite` | `cn` \| `intl` | `cn` | ✅ |
| `jobsSite` | `cn` \| `intl` | `cn` | ✅ |
| `concurrency` | 1–100 | 2 | 否 |
| `defaultInstanceType` | string | `default` | 否 |
| `pollIntervalSeconds` | 5–600 | 30 | 否 |

- `surface: sync` → 注册 `runninghub_image`
- `surface: jobs` → 注册 `runninghub_workflow_submit` / `_types` / `_status`，并注册 runtime skill `runninghub-workflow`
- 站点判定：**只看账户余额币种**（`USD`→国际站 `www.runninghub.ai`，`CNY`→中国站 `www.runninghub.cn`）。`accountStatus` 在任一站都能用任何 key 查，返回的 currency 属于账户本身。`apiType` 不能用于判站点。
- 两个 Key：`RUNNINGHUB_SYNC_API_KEY`（sync）、`RUNNINGHUB_JOBS_API_KEY`（jobs）。相互独立，允许同值。
- 台账：`packages/media-runninghub/data/pool/pool.sqlite`，gitignored，运行时自动重建。
- 设置页：两张 Key 卡都显示；非当前 `surface` 的那张为**只读展示**（提示「切换 surface 后可编辑」）。

### 任务池机制

- 单例 watcher：全局只有一个，owner = **第一个提交任务的会话**；排空后只唤醒该会话，其他会话下次查台账可见。
- 批次是**派生态**：台账有未完成任务时新任务并入当前批次；全部结束后再提交才新建批次。
- `concurrency` 是**全局预算**（同时在飞的 RunningHub 任务数），由池自己管，不能用 `ctx.jobs` 的 per-owner 限制。
- 11 种任务类型见 `config/task-types.json`（提交契约 + 给模型看的说明，单一来源）。
- 提交后**立即结束轮次**，不要轮询；唤醒后再取产物。
- 产物自动下载到 `<会话目录>/output/media/runninghub/batch-<id>/`。

---

## 8. 本地开发（热更新）

### 8.1 怎么把 profile 切到开发态

改 `C:\Users\lj110\.dsh\profiles\desktop\package.json`，把三个包都写成 `link:` 绝对路径（正斜杠）：

```json
"@tmmk/media-qwen": "link:E:/2026/dsh-plugins/media-suite/packages/media-qwen",
"@tmmk/media-runninghub": "link:E:/2026/dsh-plugins/media-suite/packages/media-runninghub",
"@tmmk/media-suite": "link:E:/2026/dsh-plugins/media-suite/packages/media-suite",
```

然后：

```bash
cd C:\Users\lj110\.dsh\profiles\desktop
dsh plugin --profile desktop install
```

profile 的 `pnpm-workspace.yaml` 里有 `nodeLinker: hoisted`，pnpm 会按 `link:` 在
`node_modules/@tmmk/*` 建 **junction** 指向工作区。**必须三个都写**——只写 suite 的话，
两个 provider 会从 npm 装真实副本，只有 suite 是 junction。

验证：

```powershell
Get-ChildItem C:\Users\lj110\.dsh\profiles\desktop\node_modules\@tmmk -Force |
  Select-Object Name, LinkType, @{n='Target';e={$_.Target}}
```

三个都应是 `Junction` 且指向 `E:\2026\dsh-plugins\media-suite\packages\*`。

### 8.2 两套 HMR 机制（关键）

改动的文件位置决定要不要手动重载，因为**监听机制完全不同**：

| 改什么 | 自动生效 | 机制 |
|---|---|---|
| `client.js`（浏览器侧） | ✅ **保存即生效** | `@deepseek-ai/dsh-client-hmr` 按 `pollIntervalMs`（**默认 500ms**）stat 轮询 bundle，rev 变化就通知浏览器重拉 |
| `index.js` / `lib/*.js`（Host 侧） | ❌ **必须手动重载** | `@deepseek-ai/dsh-hmr` 的 `root` 是空列表，**只监听 profile 配置，不监听模块文件** |
| profile `cordis.patch.yml` | ✅ 自动 | `dsh-hmr` 的配置监听 |
| Config 普通字段（`surface` / `concurrency`） | ✅ 自动重载插件 | 配置变更走 Loader 正常路径 |
| Config volatile 字段（`syncSite` / `jobsSite`） | ✅ 就地更新，**不重载** | `updateVolatile` 改写引用，fiber.config 身份不变 |

**所以「没配 `root` 也能热加载 `client.js`」不是异常**：`client.js` 走的是 client-hmr 的
轮询通道，和 `dsh-hmr` 的模块监听无关。

### 8.3 Host 侧改完怎么重载

`media-qwen` / `media-runninghub` 在 `plugin_manager list_plugins` 里带
`readOnlyReason: unaddressable`（它们是壳的 patch 插进来的行，不是独立 bundle），**不能单独开关**。

但 **`media-suite` 本身可以**——切一次 disabled → enabled，它 patch 插入的三行会一起重载：

```
plugin_manager set_plugin  target: include:media-suite  enabled: false
plugin_manager set_plugin  target: include:media-suite  enabled: true
```

**不要**给 `dsh-hmr` 配 `root` 指向工作区：junction 会让每次保存都触发整插件重载，
频繁重载丢状态，且代码有语法错误时插件会直接失效。Host 侧改动频率低，手动重载更可控。

### 8.4 这条路已验证可行

`dependencies` 写 `link:` + pnpm 建 junction + 完整包名的 `load` id —— **三者同时成立时不崩**。

10-29 那次 junction 崩溃的真因是 `client.js` 的 `load` id 用了短名，不是 junction 本身。
修好 id 之后，开发态和发布态可以共存。

⚠️ 不要用无前缀 junction（`node_modules/media-qwen`）——解析名与声明名不一致会让 client source 分裂。始终用 scoped 名 `node_modules/@tmmk/media-qwen`。

⚠️ 装别的插件（或点市场升级）时 pnpm 会重写 `node_modules`，junction 可能被换回真实副本。
切回开发态只需重跑一次 `dsh plugin --profile desktop install`。

---

## 9. 已知限制

- 若用户**另外单独** `add` 了某个 provider（它也进了 `dsh.profile.bundles`），它的 patch 会和壳的三行 patch 插同一 row id，可能冲突。暂未处理。
