# media-runninghub · RunningHub 媒体

把 RunningHub 的图片生成与工作流任务池接进 DSH。一次安装，两套能力：

- **同步出图** —— 一句话或一张参考图，几秒到几分钟内直接拿到图片文件
- **工作流任务池** —— 11 种任务类型（文生图 / 改图 / 文生视频 / 数字人 / 语音克隆 / 文生音乐 / 人声分离）作为后台任务提交，自动排队、自动下载产物、完成后自动唤醒会话

`surface` 决定当前注册哪一套。

## 两套能力怎么选

| | `sync` | `jobs` |
|---|---|---|
| 工具 | `runninghub_image` | `runninghub_workflow_submit` / `_types` / `_status` |
| 适合 | 单张出图、改图、多图融合 | 批量生成、视频、音乐、配音等重任务 |
| 执行方式 | 同步，当场返回文件 | 后台作业，提交后即可结束对话 |
| 产物 | 立刻下载到本地 | 完成后自动下载并唤醒会话 |
| Key | `RUNNINGHUB_SYNC_API_KEY` | `RUNNINGHUB_JOBS_API_KEY` |

切换 `surface` 会重载插件：旧工具注销、新工具注册，下一次模型请求生效，桌面版不需要重启。

## 工作流任务池能做什么

内置 11 种任务类型：

| 类型 | 用途 | 说明 |
|---|---|---|
| `image-gen-qwen` | 文生图 | Qwen Image 2.1，只扣 RH 币，生图首选 |
| `image-edit-qwen` | 单图编辑 | 给 1 张图 + 指令改图 |
| `image-edit-qwen-multi` | 多图编辑 | 主图 + 最多 5 张参考图，换装/换配饰/参考姿势 |
| `image-edit-banana2` | 全能图片 | Nano Banana 2，文生图或 2–10 图融合；额外收第三方现金费 |
| `i2v-minimax-h3-first-frame` | 首帧生视频 | 一张图动起来，带原生音效 |
| `i2v-minimax-h3-first-last-frame` | 首尾帧生视频 | 首帧 → 尾帧自然过渡 |
| `i2v-minimax-h3-multi-ref` | 多参考生视频 | 最多 9 图 + 3 视频 + 3 音频，动作迁移、续写、配音 |
| `voice-clone-emo` | 音色克隆 | 用参考人声的音色朗读文字，可带情绪 |
| `digital-human` | 数字人 | 照片人物对口型播报 |
| `music-yue2` | 文生音乐 | YuE2，产出混音 / 伴奏 / 人声干声三条轨 |
| `vocal-separation-melband` | 人声分离 | 整首歌分离出人声与伴奏 |

### 任务池怎么工作

- **提交即走**：一次可提交一条或多条，工具立即返回批次号，然后本轮就可以结束，不需要等待。
- **自动批次**：台账里有未完成任务时，新提交的任务自动并入当前批次；上一批全部结束后再提交才新建批次。
- **后台轮询**：单个全局 watcher 负责轮询所有未完成任务，完成后自动下载产物。
- **自动唤醒**：批次排空时，发起该批次的会话会被自动唤醒，唤醒消息里带产物路径与费用。
- **费用可见**：每个任务记录 `consumeMoney`（现金）/ `consumeCoins`（积分）/ `thirdPartyConsumeMoney`（第三方），可直接报给用户。

## 同步出图（`runninghub_image`）

一个工具同时覆盖文生图和图生图，靠有没有传图片区分。

| 参数 | 必填 | 默认 | 说明 |
|---|---|---|---|
| `prompt` | 是 | — | 画面描述，建议用英文写详细描述 |
| `images` | 否 | — | 参考图，最多 10 张；本地路径或 URL。不传就是文生图 |
| `aspectRatio` | 否 | `16:9` | `1:1` / `16:9` / `9:16` / `4:3` / `3:4` / `3:2` / `2:3` / `21:9` / `5:4` / `4:5` |
| `resolution` | 否 | `2k` | `1k` / `2k` / `4k` |

- 本地图 ≤ 5 MB 走 base64 内联，更大或远端 URL 走 RunningHub 上传接口
- 结果里带回 `coins` / `cost` / `thirdParty`，有就报

## 两个 Key

| 凭据引用 | 用途 | 建议类型 |
|---|---|---|
| `RUNNINGHUB_SYNC_API_KEY` | 同步图片生成 | 企业级-共享 |
| `RUNNINGHUB_JOBS_API_KEY` | 工作流任务池 | 消费级-会员 |

两者相互独立，可以填相同的值，插件不做相等校验。**建议只是建议**：插件不按 Key 类型限制调用。

Key 存在 `$DSH_HOME/.credentials.yaml` 的 `refs:` 段，由 Harness 凭据服务管理，设置页不回显已保存的值。

## 站点判定

RunningHub 有两个站：中国站 `www.runninghub.cn` 和国际站 `www.runninghub.ai`。**每个 Key 只属于其中一个站**——上传接口按站点绑定，Key 只能上传到它自己那一站。

判定只看一件事：**账户余额的币种**。

| 币种 | 站点 |
|---|---|
| `USD` | 国际站 `www.runninghub.ai` |
| `CNY` | 中国站 `www.runninghub.cn` |

- 判定发生在**保存 Key 时**：查一次账户状态，读出币种，得出站点，写进 `syncSite` / `jobsSite`。
- 之后每次调用直接读配置里的结论，不再问服务商。换了 Key，重新保存一次即可重新判定。
- 账户状态接口在任一站都能查，币种属于账户本身而不是查询的那一站，所以查哪一站结论都一致。
- `apiType`（`SHARED` / `NORMAL`）不参与判定，它和站点没有对应关系。

## 设置页

**设置 → RunningHub 媒体**

- 顶部 `surface` 分段切换（`sync` / `jobs`），切换即重载插件并重注册对应工具
- 每个模式一张 Key 卡，带账户状态与站点判定结果
- `jobs` 模式下还有「任务池设置」区：`concurrency`（全局并发上限）、`pollIntervalSeconds`（轮询间隔）

## 配置项

| 配置 | 默认 | 说明 |
|---|---|---|
| `surface` | `jobs` | 注册哪套工具。改它重载插件，可在设置页切换 |
| `syncSite` | `cn` | sync Key 所属站点，保存 Key 时自动判定 |
| `jobsSite` | `cn` | jobs Key 所属站点，保存 Key 时自动判定 |
| `concurrency` | `2` | 任务池全局并发上限（1–100），仅 `jobs` 生效 |
| `pollIntervalSeconds` | `30` | 任务池轮询间隔（5–600 秒），仅 `jobs` 生效 |
| `defaultInstanceType` | `default` | 任务池默认实例类型，仅 `jobs` 生效 |

`syncSite` / `jobsSite` 是 volatile 字段：写入只更新运行中的值，不重载插件，工具列表保持稳定。

## 输出

任务池产物自动下载到：

```text
<会话目录>/output/media/runninghub/batch-<批次号>/
```

同步出图产物写到：

```text
<会话目录>/output/media/runninghub/image/
```

单个任务可用 `outputDir` / `outputName` 覆盖落点。

## 安装

```bash
dsh plugin --profile <profile> add @tmmk/media-runninghub
```

装完重启 DSH，设置里会出现 **RunningHub 媒体**。

**第一步：配置 Key。** 打开设置页，按当前需要的模式填入对应的 Key 并保存。保存时会自动查询账户状态并判定站点。

**第二步：开始使用。** 直接用自然语言让 Agent 出图或提交任务，例如：

- 「用 RunningHub 生成一张赛博朋克风格的城市夜景」
- 「把这张图换成海边背景」
- 「生成一段 10 秒的视频，让这张图动起来」

Agent 会自己选择合适的工具和参数。

如果只想一次性装齐 Qwen 与 RunningHub，可以装 `@tmmk/media-suite`。

## 费用提示

- `image-gen-qwen` / `image-edit-qwen` 系列只扣 RH 算力币，不产生第三方现金费
- `image-edit-banana2` 除 RH 币外还收第三方接口费（约 ¥0.19/张），非必要不用
- 视频类（`i2v-*`）费用明显高于生图，`multi-ref` 用的是 plus 实例，最贵

## 已知行为

- **枚举值必须原样传**。不同任务类型的「画面比例」编码方式不同（`image-gen-qwen` 用 `"16:9 (Widescreen)"`，`image-edit-banana2` 用 `"16:9"`，视频类用整数 `aspectSelect`），提交前以 `runninghub_workflow_types` 输出的「合法值」为准。传错不会报错，但会扣费且拿不到产物。
- **偶发空转**：极少数情况下 RunningHub 返回 SUCCESS 但 `results` 为空。遇到会直接告知，不自行重试。
