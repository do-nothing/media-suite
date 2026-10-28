# media-runninghub · RunningHub 媒体

RunningHub 的两类媒体能力。`surface` 决定这个插件注册哪一套工具。

## surface

```yaml
surface: sync | jobs
```

| surface | 内容 | 使用的 Key |
|---|---|---|
| `sync` | `runninghub_image`：Nano Banana 2 同步图片生成 | `RUNNINGHUB_SHARED_API_KEY`（企业级-共享） |
| `jobs` | 工作流任务池（未实现） | `RUNNINGHUB_MEMBER_API_KEY`（消费级-会员） |

切换 `surface` 会重载插件：旧工具注销、新工具注册，下一次模型请求生效。桌面版不需要重启。

`jobs` 目前不注册任何工具，只保留配置与状态界面；任务池实现后由它接管。

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
提交（POST /openapi/v2/<endpoint>）
  → taskId
  → 轮询（POST /openapi/v2/query，每 5 秒，最长 15 分钟）
  → 取 results[0].url
  → 下载到 <输出根>/media/runninghub/image/
```

- 本地图 ≤5 MB 走 base64 data URI，更大或远端 URL 走 RunningHub 上传接口
- 结果里带回 `coins` / `cost` / `thirdParty`（有就报）

### 输出

```text
<输出根>/media/runninghub/image/<时间戳>-<mode>-<hash>.<ext>
```

输出根由 `media-suite` 的 `mediaSettings.outputRoot` 提供；没有 suite 时回退 `<会话目录>/output`。

## 两个 Key

按 RunningHub 官方分类：

| 凭据引用 | 官方分类 | 用途 |
|---|---|---|
| `RUNNINGHUB_SHARED_API_KEY` | 企业级-共享 | 模型 API / 同步任务 |
| `RUNNINGHUB_MEMBER_API_KEY` | 消费级-会员 | 工作流 API / 任务池 |

两者可以填相同的值，插件不做相等校验，只按用途读取各自的 ref。

设置页有两张独立卡片和两张独立账户状态面板；哪张没配置就显示“未配置”，不会用另一张代替。

## 设置页

**设置 → RunningHub 媒体**

- 企业级-共享 Key 卡 + 账户状态
- 消费级-会员 Key 卡 + 账户状态

## 配置项

| 配置 | 默认 | 说明 |
|---|---|---|
| `surface` | `sync` | 注册哪套工具 |
| `channel` | `lowprice` | Nano Banana 2 渠道 |

`jobs` 实现后会补充 `concurrency`、`defaultInstanceType`、`pollIntervalSeconds`，并只在 `jobs` 模式下显示。

## 安装

```powershell
plugin_manager install_bundle E:\2026\dsh-plugins\media-suite\packages\media-runninghub
```
