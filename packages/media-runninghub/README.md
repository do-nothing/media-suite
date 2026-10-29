# media-runninghub · RunningHub 媒体

RunningHub 的两类媒体能力。`surface` 决定这个插件注册哪一套工具。

## surface

```yaml
surface: sync | jobs
```

| surface | 内容 | 使用的 Key |
|---|---|---|
| `sync` | `runninghub_image`：Nano Banana 2 同步图片生成 | `RUNNINGHUB_SYNC_API_KEY` |
| `jobs` | 工作流任务池（未实现） | `RUNNINGHUB_JOBS_API_KEY` |

切换 `surface` 会重载插件：旧工具注销、新工具注册，下一次模型请求生效。桌面版不需要重启。`jobs` 模式额外注入 `runninghub-workflow` 技能与任务池 watcher，切回 `sync` 时一并卸载。

## `runninghub_image`

一个工具同时覆盖文生图和图生图，靠有没有传图片区分。

| 参数 | 必填 | 默认 | 说明 |
|---|---|---|---|
| `prompt` | 是 | — | 画面描述，建议英文详细描述 |
| `images` | 否 | — | 参考图，最多 10 张；本地路径或 URL。不传就是文生图 |
| `aspectRatio` | 否 | `16:9` | `1:1` / `16:9` / `9:16` / `4:3` / `3:4` / `3:2` / `2:3` / `21:9` / `5:4` / `4:5` |
| `resolution` | 否 | `2k` | `1k` / `2k` / `4k` |

### 端点

由 `channel` 配置选择：

| channel | 文生图 | 图生图 |
|---|---|---|
| `lowprice`（默认） | `rhart-image-n-g31-flash/text-to-image` | `rhart-image-n-g31-flash/image-to-image` |
| `official` | `rhart-image-n-g31-flash-official/text-to-image` | `rhart-image-n-g31-flash-official/image-to-image` |

### 执行流程

```text
提交（POST <站点>/openapi/v2/<endpoint>）
  → taskId
  → 轮询（POST <站点>/openapi/v2/query，每 5 秒，最长 15 分钟）
  → 取 results[0].url
  → 下载到 <输出根>/media/runninghub/image/
```

- 本地图 ≤5 MB 走 base64 data URI，更大或远端 URL 走 RunningHub 上传接口
- 结果里带回 `coins` / `cost` / `thirdParty`（有就报）

### 输出

```text
<输出根>/media/runninghub/image/<时间戳>-<mode>-<hash>.<ext>
```

输出根固定为 `<会话目录>/output`；需要别的位置就在调用时传 `output` 参数。

## 两个 Key

| 凭据引用 | 用途 | 建议 |
|---|---|---|
| `RUNNINGHUB_SYNC_API_KEY` | 模型 API / 同步图片生成 | 企业级-共享 |
| `RUNNINGHUB_JOBS_API_KEY` | 工作流 API / 任务池 | 消费级-会员 |

两者相互独立，可以填相同的值，插件不做相等校验。**建议只是建议**：插件不按 Key 类型限制调用，两个 Key 都能配成任何一种。

设置页用顶部标签在 `sync` / `jobs` 之间切换，**一次只显示当前 `surface` 对应的那张卡片**（另一个整块隐藏），符合标签页惯例。当前卡可查看、编辑账户状态与站点判定；哪张没配置就显示“未配置”，不会用另一张代替。

## 站点判定

RunningHub 有两个站：中国站 `www.runninghub.cn` 和国际站 `www.runninghub.ai`。**每个 Key 只属于其中一个站**，上传接口是按站点绑定的：Key 只能上传到它自己那一站。

判定只看一件事：**账户余额的币种**。

| 币种 | 站点 |
|---|---|
| `USD` | 国际站 `www.runninghub.ai` |
| `CNY` | 中国站 `www.runninghub.cn` |

- 判定发生在**配置时**：在设置页保存 Key 时，插件查一次账户状态，读出币种，得出站点，写进 Config 的 `syncSite` / `jobsSite`。
- 之后每次调用直接读 Config 里的结论，不再问服务商。换了 Key，重新保存一次即可重新判定。
- 账户状态接口在任一站都能查，币种属于账户本身而不是查询的那一站，所以查哪一站都得到同一个结论。
- `apiType`（`SHARED` / `NORMAL`）不参与判定，它和站点没有对应关系。

## 设置页

**设置 → RunningHub 媒体**

- 顶部 `surface` 分段切换（`sync` / `jobs`），切换即重载插件并重注册对应工具，只显示当前模式的那张卡
- 当前模式的 Key 卡 + 账户状态 + 站点判定结果（`sync`）或 Key 卡 + 账户状态 + 「任务池设置」区（`jobs`）
- jobs 卡内「任务池设置」区（仅 `surface === jobs` 时显示并可编辑）：
  `concurrency`（全局并发上限）、`pollIntervalSeconds`（轮询间隔，秒）

## 配置项

| 配置 | 默认 | 说明 |
|---|---|---|
| `surface` | `sync` | 注册哪套工具。改它重载插件，可在设置页顶部分段切换 |
| `channel` | `lowprice` | Nano Banana 2 渠道 |
| `syncSite` | `cn` | sync Key 所属站点，保存 Key 时自动判定 |
| `jobsSite` | `cn` | jobs Key 所属站点，保存 Key 时自动判定 |
| `concurrency` | `2` | 任务池全局并发上限（1–100），仅 `jobs` 模式生效 |
| `pollIntervalSeconds` | `30` | 任务池轮询间隔（5–600 秒），仅 `jobs` 模式生效 |

`syncSite` / `jobsSite` 是 volatile 字段：写入只更新运行中的值，不会重载插件，工具列表保持稳定。

## 安装

```powershell
plugin_manager install_bundle .\packages\media-runninghub
```
