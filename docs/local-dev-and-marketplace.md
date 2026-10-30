# media-suite 开发 / 上架 / npm 统一要点备忘

> 目的：一份能脱离上下文、独立自洽的备忘，记录本仓库如何在「上架插件市场」「本地热更新开发」「npm 发布」三种场景下共用一套一致的包 解析布局，以及历史踩过的冷启动崩溃坑。

## 1. 背景：包名加前缀

- 发布/上架使用 `@tmmk` scope：
  - `@tmmk/media-qwen`
  - `@tmmk/media-runninghub`
  - `@tmmk/media-suite`（分发壳，仅聚合，不会单独上架）
- 三个包已 `npm publish` 到 registry（@tmmk scope，账号 lj110119）。
- 包各自 `package.json#name` 即上述 scoped 名；`exports["./client"]`、`dsh.bundle.patch`、`dsh.client` 齐全。

## 2. 关键约束：URL 解析必须单一来源（冷启动崩溃根因）

DSH(client-modules) 在启动时按 `baseUrl + loaderName` 收集插件的 client 资源。
**同一插件若存在两条加载路径 / 两个不同 base URL**，同一份 client bundle 会被执行两次，
渲染端抛：

```
client-modules: duplicate factory registration for "<id>"
(bundle executed twice without invalidate?)
-> web boot 崩溃（应用无法进入会话）
```

官方同款报告：<https://github.com/deepseek-ai/deepseek-harness/discussions/9722>

- **不崩的情况**：真实 npm 安装，包落在 `node_modules/@tmmk/media-*`，
  文件夹名 = 声明名（scoped），deps 条目与 bundle.patch 自我插入收敛到同一 base URL → sourceKey 去重为 1。
- **崩的情况（我们曾踩过）**：本地 junction 用**无前缀文件夹名**（`node_modules/media-runninghub`），
  而声明名是 `@tmmk/media-runninghub`。名字对不上 → 两条来源 base URL 不同 → 双重加载。
  现象：**任意一个 media 包单独开启，DSH 冷启动就崩**；全部禁用才能启动。

### 核心原则

> **node_modules 里的解析名（文件夹）必须与 package.json 声明的名字一致。**
> 本地开发态要和 npm 发布态用同一条解析路径，才能保证「开发时好好的、上架后也好好」。

## 3. 统一方案

**本地开发也对齐 scoped 名（folder name = declared name）**，与发布态完全一致：

1. profile `package.json` 的 dependencies 用 scoped 键 + `link:`：
   ```json
   "@tmmk/media-qwen": "link:E:/2026/dsh-plugins/media-suite/packages/media-qwen",
   "@tmmk/media-runninghub": "link:E:/2026/dsh-plugins/media-suite/packages/media-runninghub",
   "@tmmk/media-suite": "link:E:/2026/dsh-plugins/media-suite/packages/media-suite"
   ```
2. `node_modules` 下建立 scoped 目录与 junction（指向工作区，保留热更新）：
   ```
   node_modules/@tmmk/media-qwen       -> E:\2026\dsh-plugins\media-suite\packages\media-qwen
   node_modules/@tmmk/media-runninghub -> E:\2026\dsh-plugins\media-suite\packages\media-runninghub
   node_modules/@tmmk/media-suite      -> E:\2026\dsh-plugins\media-suite\packages\media-suite
   ```
3. **移除无前缀 junction**（`node_modules/media-qwen`、`media-runninghub`、`media-suite`），
   避免两个名字同时可解析，杜绝双来源。
4. 每个包各自的 `cordis.patch.yml` 自我插入**保留**（市场安装、`dsh plugin add` 靠它挂载；在唯一 scoped 解析下不会重复）。

### 三种场景如何共用

| 场景 | 解析路径 | 备注 |
|---|---|---|
| 本地热更新开发 | `node_modules/@tmmk/media-*` junction → 工作区 | 改 `client.js`/`lib/*.js` 保存即生效；junction 指向工作区 |
| npm 发布 | 发布物 = 包的 `files` 所列文件 | 源码/`cordis.patch.yml`/tarball 结构与本地一致 |
| 插件市场上架 | 用户 `dsh plugin add <包名>` → 真实 npm 装到 `node_modules/@tmmk/*` | 与本地 scoped 布局一致，不崩 |

### 上架流程速记

- 给 <https://github.com/deepseek-ai/awesome-dsh-plugin> 提 PR，加 `data/plugins/<owner>__<repo>.yml`：
  `url / name / category / description.en`。一个 PR 最多 3 条。
- 硬性要求：包 declare `dsh.bundle`（▲满足）、真实代码、仓库满 1 天、加 `dsh-plugin` topic、描述属实。
- **media-suite 是分发壳（纯聚合）不会单独收录**；media-qwen / media-runninghub 可收录。
- 依赖指向原作者（这里是自家 @tmmk，OK）。
- category 取值可含 tools / ai / vision / voice / workflow。

## 4. 历史教训 / 避免回退

- 别再在 profile 的 node_modules 里用**无前缀** junction 指向工作区——那正是崩溃根因。
- HMR 热更新依赖「junction 指向工作区源码」，不要退回真实拷贝安装（会失去改完即生效）。
- 改 profile（package.json / node_modules / cordis.patch.yml）前先备份；改完需重启 DSH。

## 5. 当前状态（备忘快照）

> ⚠️ 本节为 2026-10-29 早期快照，**已过时**。当前真实状态见第 7 节「最终结论」。

- profile: `C:\Users\lj110\.dsh\profiles\desktop`
- 早期：本地 node_modules 是无前缀 junction，media 插件禁用才能启动。
- 上架前置：仓库当前 commit 需推送、topic、1 天等。

---

## 6. 近期实操记录（时间线，2026-10-29）

> 本节记录每次实际执行过的步骤与结果，防止下次忘记"走到哪、为什么、下一步"。
> 日期为操作日期；与第 5 节（早期快照）不同，本节反映当前真实进度。

### 2026-10-29 崩溃根因最终确诊（官方 #9722）

- 根因（官方权威确认）：`@deepseek-ai/dsh-client-modules` 的 `reconcilePackage()` 按
  `baseUrl + "\0" + loaderName` 收集 client source。**同一包有两条 base URL 不同的来源**
  时，同一 client bundle 被执行两次 → `duplicate factory registration for "<id>"` → web boot 崩。
- 两条来源：profile deps（`link:`，baseUrl=`profiles/desktop/`）+ 每包 `cordis.patch.yml`
  自我插入（baseUrl=checkout 工作区真实路径 / junction realpath）。
- **junction 内部 realpath 永远锚定工作区**，与 `profiles/desktop` 的 baseUrl 必然不同，
  所以只要同时存在「deps 条目 + 自我插入」两条来源，就必定 duplicate。
- 把 junction 改成 scoped 名（`@tmmk/media-*`）**只改了 loaderName，没消除两条 baseUrl 差异** → 仍崩。
  （这个错误尝试已废弃。）

### 2026-10-29 方案 2（去 profile deps、留 self-insert）—— 只治崩，不治"未安装"

- 动作：从 profile `package.json` 摘掉三包 `@tmmk/media-*` 的 `link:` deps，保留各包
  `cordis.patch.yml` 自我插入。脚本：`fix-media-profile-method2.ps1`（apply2 / verify2 / rollback2）。
- 结果：**冷启动不再崩**（证明 self-insert 单源不重复）。但副作用：media 包缺 deps 后
  **完全不被 DSH 登记为已安装 bundle** → 插件面板显示"未安装"。
  （`plugin_manager list_bundles` 只有 31 个 `@deepseek-ai/*`，无 `@tmmk/media-*`。）
- 结论：**方案 2 不是正解**。只摘 deps 会让 self-insert 也随之失效（self-insert 是"包作为
  已安装 bundle 的附属 patch"，包不被安装则不应用）。

### 2026-10-29 清理 node_modules（为真实安装铺路）

- 用提权清理了 profile `node_modules` 里全部 media 残留：
  - `@tmmk/{media-qwen,media-runninghub,media-suite}`（3 个 scoped junction）
  - 空的 `@tmmk` 目录
  - 悬空的 `media-api` junction（指向不存在的 `E:\2026\dsh-plugins\media-api`）
- 脚本：`cleanup-media-profile.ps1`（已用）。
- 清理后 `node_modules` 无任何 media 残留，是干净基座。

### 2026-10-29 决定：方案 A（真实 npm 安装集成器 media-suite）<——当前所在

- **方向确认**：media-suite 是分发壳/集成器，`dsh plugin add @tmmk/media-suite` 会 pnpm link
  media-suite 并解析它声明依赖的 `@tmmk/media-qwen` / `@tmmk/media-runninghub`，三包一起装到
  `node_modules/@tmmk/*`（真实 npm 副本，单 baseUrl）→ **不崩 + 全部显示已安装**。
  这才是「真实用户安装路径」，且正是 #9722 说的"真实安装才不崩"。
- **前提**：三包已 `npm publish` 到 registry（@tmmk scope）。⚠️ **media-runninghub 发布版本
  落后于工作区最新** —— 装到的补齐版本可能不是本地正在开发的最新版；这是真实用户会遇到的
  版本，属预期。
- 执行命令（在 desktop profile）：
  ```
  dsh plugin --profile desktop add @tmmk/media-suite
  ```
- 下一步 / 待验证：跑上面命令 → 重启 DSH → 确认 media-qwen / media-runninghub /
  media-suite 三个都能正常显示、启用、不崩。**安装命令由谁执行（用户终端 or 代理提权）待确认。**

### 脚本清单（media-suite 根目录）

- `fix-and-verify-media-profile.ps1` —— 早期 scoped 布局 apply/verify/rollback，**已弃用**。
- `fix-media-profile-method2.ps1` —— 方案 2 的 apply2/verify2/rollback2，历史参考。
- `cleanup-media-profile.ps1` —— 清理 profile node_modules 里 media junction，已用。

---

## 7. 最终结论（2026-10-30 定稿，问题已全部解决）

> 本节是**唯一权威结论**。前面 1–6 节是排障过程记录，含若干被推翻的假设，不要按它们操作。

### 7.1 真正的根因（两个独立缺陷，与双 baseUrl 无关）

排障过程中曾长期误判为「双 baseUrl → duplicate」。真实 npm 安装后仍崩，才暴露真因是下面两个**独立的发布缺陷**：

**缺陷 A：`__ModuleLoader__.load` 的 `id` 用了短名，缺 `@tmmk/` 前缀**

- `client-modules` 内核用 **entry id = 完整包名**（`@tmmk/media-qwen`）去 `__ModuleLoader__`
  查已注册 factory。包内 `client.js` 写的是 `id: 'media-qwen'`（短名）→ 查不到 →
  ```
  client-modules: could not load "@tmmk/media-qwen": ... loaded without registering
  "@tmmk/media-qwen" via __ModuleLoader__.load
  ```
- 官方依据（`dsh-plugin-guide` 知识库）：
  - `docs/subsystems/client-modules.md`：`WebBootEntry.id` = 包名。
  - `docs/cookbook/adding-a-settings-card.md`：client 必须是 lazy-CJS factory 格式，
    「向页面的模块加载器登记 **包名** 和一个 `factory(require)`」。
  - `references/community-repo-deep-dive.md`：真实 client 插件（plugin-console）正是用
    `window.__ModuleLoader__.load({ id, factory })` 的 CJS banner/footer 生成 ——
    **所以这个手写形态本身合法，错的只是 id**。
- 修复：三个包 `client.js` 的 `__ModuleLoader__.load` 的 `id` 全部改成完整包名
  `@tmmk/media-qwen` / `@tmmk/media-runninghub` / `@tmmk/media-suite`。
- 验证：只改 media-qwen 一个包 → 报错消失、「Qwen 媒体」设置页出现（充分证明）。

**缺陷 B：`files` 字段 `lib/*.js` 漏掉子目录，npm 包里缺 `lib/pool/`**

- `media-runninghub` 的 `package.json` `files` 写的是 `"lib/*.js"`，**通配符不匹配子目录**，
  导致 `lib/pool/` 下 8 个文件（client/config/skill/store/tools/types/upload/watcher）
  **没有被打进 tarball**。
- `index.js` 开头就 `import ... from './lib/pool/config.js'` → import 抛错 → 插件 `apply`
  起不来 → loader 里 entry 存在且 `enabled: true`，但 **`fiberPhase: null`（从未激活）** →
  设置页永远不出现，且提示「重启后生效」（重启多少次都没用）。
- 修复：`files` 改为 `"lib/**/*.js"`。验证：`npm pack --dry-run` 确认 10 个 lib 文件全在。

### 7.2 集成器（media-suite）的正确设计

**问题**：`dsh plugin add @tmmk/media-suite` 只把 **media-suite 本身**写进
`dsh.profile.bundles`；它的两个 provider 作为**传递依赖**只进 `dependencies`，**不进 bundles**。
而 DSH **只应用 `dsh.profile.bundles` 里包的 bundle patch** → provider 的
`cordis.patch.yml` 永远不跑 → provider 行不挂载 → 设置页不出现。

**解决**：让集成器**自己插入三行**。`packages/media-suite/cordis.patch.yml`：

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

这样**一条命令装齐三个插件**，且 provider 行的 config 也由集成器统一给出。

### 7.3 依赖范围必须跟版本走（易踩的坑）

`media-suite` 的 dependencies 若写 `^0.1.0`，pnpm 会**复用已有的 0.1.0 解析结果**
（0.1.0 已满足范围，不会主动升到 0.1.1）→ 用户装到新版集成器，拿到的仍是**旧的坏 provider**。

**规则**：provider 每次修 bug 发版，集成器的依赖范围必须同步提到 `^<新版本>`。

### 7.4 最终发布矩阵（当前线上版本）

| 包 | 版本 | 关键修复 |
|---|---|---|
| `@tmmk/media-qwen` | **0.1.1** | `client.js` id → 完整包名 |
| `@tmmk/media-runninghub` | **0.1.1** | `client.js` id → 完整包名；`files` → `lib/**/*.js`（补回 `lib/pool/`） |
| `@tmmk/media-suite` | **0.1.3** | 依赖范围 `^0.1.1`；patch 插入三行（一键装齐） |

### 7.5 用户侧安装（最终形态）

```bash
dsh plugin --profile desktop add @tmmk/media-suite
```

装完重启 DSH → Qwen 媒体 / RunningHub 两个设置页都出现，工具全部可用。

⚠️ **UI 表现**：插件管理器的「已安装 bundle」列表里**只显示 media-suite 一个条目**
（version 0.1.3），其 `rows` 内含 media-suite / media-qwen / media-runninghub 三条。
这是集成器模式的正常表现，不是缺陷 —— provider 不作为独立 bundle 安装。

### 7.6 已实测通过（端到端）

- `plugin_manager list_plugins`：三个 entry 全部 `enabled: true` + `fiberPhase: active`。
- 设置页：Qwen 媒体、RunningHub 均正常出现。
- **真实出图**：`runninghub_workflow_submit` + `image-gen-qwen` 成功生成
  `output/media/runninghub/batch-1/1_461_0.png`（2016×1136，4.4 MB），
  计费 RunningHub 现金 0.10。
- 工具注册：`runninghub_workflow_types` / `_submit` / `_status`、
  `qwen_omni` / `qwen_tts` / `qwen_audio` 全部可见。

### 7.7 遗留的小改进（非阻塞）

- `runninghub_workflow_submit` 参数校验失败时只返回 `watcher: none`，**不呈现 `errors` 详情**，
  用户看不到「哪个参数不对」。建议把 `errors` 一并返回。（实测：给 `image-gen-qwen`
  传不支持的 `aspect_ratio` 就会静默失败。）
- 若用户**另外单独** add 了某个 provider（它进了 bundles），它的 patch 会和集成器的三行 patch
  插同一 row id，可能报冲突。边缘情况，暂未处理。

### 7.8 发布凭据

`npm publish` 需要**带 Bypass 2FA 的 granular access token**，用内联方式传，不要写进 `.npmrc`
或提交到仓库：

```bash
npm publish --//registry.npmjs.org/:_authToken=<token>
```

（`.npmrc` 里那个 40 字符 `npm_` 开头的 token 若无 Bypass 2FA，会报
`403 Two-factor authentication ... required`。）