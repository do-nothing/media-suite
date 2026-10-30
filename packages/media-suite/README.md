# media-suite · 媒体工具套装

一次安装，得到 Qwen 与 RunningHub 的全部媒体能力。

## 装一次就有什么

```text
media-suite
  ├─ media-qwen        多模态理解 / 语音合成 / 场景音频生成
  └─ media-runninghub  图片生成 / 工作流任务池（11 种任务类型）
```

装完你会得到：

**Qwen 媒体**（设置 → Qwen 媒体）
- `qwen_omni` —— 视频 / 音频 / 图片理解，返回文本
- `qwen_tts` —— 文字转语音，支持预置音色与情绪指令
- `qwen_audio` —— 按描述生成完整音频场景，支持参考音色

**RunningHub 媒体**（设置 → RunningHub 媒体）
- `runninghub_image` —— Nano Banana 2 同步出图（文生图 / 改图 / 多图融合）
- `runninghub_workflow_submit` / `_types` / `_status` —— 工作流任务池，支持文生图、改图、文生视频、数字人、语音克隆、文生音乐、人声分离
- 配套技能 `runninghub-workflow`，告诉模型该怎么用任务池

两个 provider 各有自己的设置页，各自管理自己的 Key。

## 它本身不做什么

- 不调用任何 provider API
- 不保存任何 API Key
- 不注册任何模型工具
- 没有自己的设置页

它只做一件事：**把两个 provider 挂起来**。所以它的包很小，也几乎不会有 bug。

## 输出位置

所有产物默认落在**当前会话目录**下：

```text
<会话目录>/output/media/qwen/...
<会话目录>/output/media/runninghub/...
```

需要写到别处时，在**每次调用**里指定：

- RunningHub 任务池：传 `outputDir` / `outputName`
- Qwen 音频：传 `output`
- RunningHub 同步出图：传 `output`

相对路径按当前工作目录解析，目录自动创建。这样同一个会话里不同任务可以各自落到各自的目录，不需要改插件配置。

## 安装

```bash
dsh plugin --profile <profile> add @tmmk/media-suite
```

装完重启 DSH，两个设置页都会出现。

**也可以只装其中一个**：

```bash
dsh plugin --profile <profile> add @tmmk/media-qwen
dsh plugin --profile <profile> add @tmmk/media-runninghub
```

## 关于「已安装」列表

插件管理器里会**只显示 `@tmmk/media-suite` 一个条目**，它的行里包含三个插件（suite + qwen + runninghub）。这是套装模式的正常表现——provider 不作为独立 bundle 出现在列表里，但工具和设置页都已正常工作。

## 挂载方式（给排查问题的人）

`cordis.patch.yml` **插入三行**：`media-suite` + `media-qwen` + `media-runninghub`。

为什么必须这样：`dsh plugin add` 只把**显式安装的包**（这里是 media-suite）写进 `dsh.profile.bundles`，两个 provider 作为传递依赖只进 `dependencies`。而 DSH 只应用 `bundles` 里包的 patch——所以 provider 自己的 patch 不会跑，必须由套装自己插入它们的行。

> 不要在 profile 里**另外单独**再装 provider：那会让它的 patch 和套装的 patch 插同一个 id，产生冲突。只装套装即可。

## 开源许可

Apache-2.0，详见根目录 [LICENSE](../../LICENSE)。
