# media-suite 项目说明

> 精简版：只保留**不可再生的原理**与**日常要用的工作流**。
> 发布流程、上架流程、功能清单等操作性内容已移除——那些要么已固化在脚本里，
> 要么一次性的。新增经验往对应小节追加，不要另起一份文档。

三个包：`@tmmk/media-qwen`、`@tmmk/media-runninghub`、`@tmmk/media-suite`（分发壳）。

---

## 1. 插件加载机制

不理解这一节，后面所有的坑都看不懂。

### 1.1 组合顺序

一个 `dsh` 进程 = 一棵插件树。树从**空列表**长出，按顺序叠 patch：

```
① dsh.profile.bundles 里每个包的 dsh.bundle.patch（按数组顺序）
② profile 自己的 cordis.patch.yml
③ home patch
④ --patch 覆盖
```

patch 只有两种动作：**insert 新行**、或**按 `id` 替换已有行的 config**（整块替换，不深合并）。

### 1.2 一行怎么变成插件

```
patch insert { id, name: '@tmmk/media-qwen' }
  → Node 从 node_modules 解析 name → import 包的 index.js
  → 得到 { name, apply, inject, Config }
  → inject 的服务就绪后构建 fiber → apply(ctx) 执行
```

`inject` 是加载门槛：`['credentials','tools']` 意味着这两个服务就绪前不激活；服务消失会自动卸载、恢复自动重载。

### 1.3 Client 半

`client-modules` 扫 loader 里**声明了 `dsh.client` 的包**，组合成 `window.__DSH_BOOT__` 的 entry 图，浏览器按 entry 去 `/plugins/??<包名>/client.js&rev=<hash>` 拉取。

**关键**：entry id = **完整包名**。`client.js` 里 `window.__ModuleLoader__.load({ id, factory })` 的 `id` 必须与之一致。

---

## 2. 集成器为什么必须自己插三行

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
        concurrency: 2
        pollIntervalSeconds: 30
```

provider 的默认 config 也只能由壳给出——因为 provider 那层 patch 不跑，它声明的默认值不生效。

**UI 表现**：插件管理器「已安装 bundle」里只显示 media-suite 一个条目，其 `rows` 含三条。这是集成器模式的正常表现。

---

## 3. 四个必须记住的陷阱

### 3.1 `__ModuleLoader__.load` 的 `id` 必须是完整包名

写短名（`media-qwen`）而 entry id 是 `@tmmk/media-qwen` → 内核查不到 factory →

```
client-modules: could not load "@tmmk/media-qwen": ... loaded without registering
"@tmmk/media-qwen" via __ModuleLoader__.load
```

设置页不出现。**三个包的 `client.js` 都必须写完整包名。**

手写 `window.__ModuleLoader__.load({ id, factory })` 这个形态本身是合法的（官方 client bundle 就是这么生成的，lazy-CJS factory 格式），错的只是 id。

### 3.2 `files` 字段的通配符不匹配子目录

`"lib/*.js"` **不匹配** `lib/pool/*.js`。写错会让子目录整个漏出 tarball →

`index.js` 里 `import './lib/pool/config.js'` 抛错 → 插件 fiber 永远不激活（`fiberPhase: null`）→ 一直提示「重启后生效」。

**规则**：有子目录时必须写 `"lib/**/*.js"`。

排查口诀：`npm pack --dry-run` 看文件列表，比读代码快。

### 3.3 依赖范围必须跟版本走

`media-suite` 依赖写 `^0.1.0` 时，pnpm 会**复用已有的 0.1.0 解析**（已满足范围，不主动升级）→ 用户装了新壳却拿到旧的坏 provider。

**规则**：provider 修 bug 发版后，壳的依赖范围必须同步提到 `^<新版本>`，壳自身也要 bump 版本。

### 3.4 `package.json` 里的 BOM 会让插件静默消失

**这是最难查的一个**，因为没有任何报错。

loader 要读 `package.json` 才知道 `dsh.bundle.patch` 和 `dsh.client.inject`。**JSON 前面多一个 UTF-8 BOM（`EF BB BF`）→ 解析失败 → 插件没有 bundle 声明 → 不挂载。**

表现：

```
plugin_manager list_plugins → enabled: false, fiberPhase: null
设置页里这一项消失，但另外两个包正常
```

**为什么常规检查全都通过**：

| 检查 | 结果 | 原因 |
|---|---|---|
| `node --check` | ✅ | BOM 不影响 JS 解析 |
| `import index.js` | ✅ | JS 模块加载器容忍 BOM |
| `Config(...)` 校验 | ✅ | 不读 package.json |
| `apply(ctx)` 执行 | ✅ | 不读 package.json |
| 启动日志 | 干净 | loader 静默失败，不打印 |

**唯一暴露它的是 `set_plugin`**：

```
BOM 存在 → "application": "overridden"   ← 配置无效，拒绝应用
BOM 移除 → "application": "applied"      ← 正常
```

**根因**：Windows PowerShell 5 的 `Set-Content -Encoding UTF8` **会加 BOM**。同一个提交里用
`[System.IO.File]::WriteAllText(..., UTF8Encoding($false))` 写的包就没事——**写法不一致才中招**。

**规则**：改 JSON/JS 文件一律用

```powershell
[System.IO.File]::WriteAllText($path, $text, (New-Object System.Text.UTF8Encoding($false)))
```

**提交前自检**：

```powershell
Get-ChildItem -Recurse -File -Include *.json,*.js | ForEach-Object {
  $b = [System.IO.File]::ReadAllBytes($_.FullName)
  if ($b.Length -ge 3 -and $b[0] -eq 0xEF -and $b[1] -eq 0xBB -and $b[2] -eq 0xBF) { "⚠ $($_.FullName)" }
}
```

**已中招过**：npm 上的 `media-runninghub@0.1.4` 就是坏版本（tarball 带 BOM），已标记废弃，
0.1.5 修复。

---

## 4. 本地开发（热更新）

### 4.1 把 profile 切到开发态

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

### 4.2 两套 HMR 机制（关键）

改动的文件位置决定要不要手动重载，因为**监听机制完全不同**：

| 改什么 | 自动生效 | 机制 |
|---|---|---|
| `client.js`（浏览器侧） | ✅ **保存即生效** | `@deepseek-ai/dsh-client-hmr` 按 `pollIntervalMs`（**默认 500ms**）stat 轮询 bundle，rev 变化就通知浏览器重拉 |
| `index.js` / `lib/*.js`（Host 侧） | ❌ **必须手动重载** | `@deepseek-ai/dsh-hmr` 的 `root` 是空列表，**只监听 profile 配置，不监听模块文件** |
| `config/task-types.json` | ✅ **启停插件即生效** | 类型目录的缓存按文件 mtime 失效，改完启停一次就行 |
| profile `cordis.patch.yml` | ✅ 自动 | `dsh-hmr` 的配置监听 |
| Config 普通字段（`surface` / `concurrency`） | ✅ 自动重载插件 | 配置变更走 Loader 正常路径 |
| Config volatile 字段（`syncSite` / `jobsSite`） | ✅ 就地更新，**不重载** | `updateVolatile` 改写引用，fiber.config 身份不变 |

**所以「没配 `root` 也能热加载 `client.js`」不是异常**：`client.js` 走的是 client-hmr 的
轮询通道，和 `dsh-hmr` 的模块监听无关。

### 4.3 手动重载（不用重启 DSH）

```bash
plugin_manager set_plugin  target: include:media-runninghub  enabled: false
plugin_manager set_plugin  target: include:media-runninghub  enabled: true
```

**provider 可以单独启停**（它们是壳的 patch 插进来的行，但 entry 本身可操作）。
切 `media-suite` 也可以——它 patch 插入的三行会一起重载。

**看返回值**：`"application": "applied"` 才算生效；`"overridden"` 说明配置有问题
（见 §3.4）。

**不要**给 `dsh-hmr` 配 `root` 指向工作区：junction 会让每次保存都触发整插件重载，
频繁重载丢状态，且代码有语法错误时插件会直接失效。Host 侧改动频率低，手动重载更可控。

### 4.4 这条路已验证可行

`dependencies` 写 `link:` + pnpm 建 junction + 完整包名的 `load` id —— **三者同时成立时不崩**。

10-29 那次 junction 崩溃的真因是 `client.js` 的 `load` id 用了短名，不是 junction 本身。
修好 id 之后，开发态和发布态可以共存。

⚠️ 不要用无前缀 junction（`node_modules/media-qwen`）——解析名与声明名不一致会让 client source 分裂。始终用 scoped 名 `node_modules/@tmmk/media-qwen`。

⚠️ 装别的插件（或点市场升级）时 pnpm 会重写 `node_modules`，junction 可能被换回真实副本。
切回开发态只需重跑一次 `dsh plugin --profile desktop install`。

---

## 5. npm 凭据

需要**带 Bypass 2FA 的 granular access token**。

**已持久化**：token 存在 Windows **User 级环境变量 `NODE_AUTH_TOKEN`**，
`~/.npmrc` 写的是

```
//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}
```

**发布前**（DSH 进程启动时还没有这个变量，要从 User 级读进进程）：

```powershell
$env:NODE_AUTH_TOKEN = [Environment]::GetEnvironmentVariable('NODE_AUTH_TOKEN', 'User')
npm publish
```

普通 `.npmrc` token 若无 Bypass 2FA 会报 `403 Two-factor authentication ... required`。

**token 失效时**（`npm whoami` 返回 401）需要重新生成 granular token，
再执行一次上面的 `SetEnvironmentVariable`。

---

## 6. 已知限制

- 若用户**另外单独** `add` 了某个 provider（它也进了 `dsh.profile.bundles`），它的 patch 会和壳的三行 patch 插同一 row id，可能冲突。暂未处理。
