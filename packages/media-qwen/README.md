# media-qwen · Qwen 媒体

阿里云百炼（DashScope）的 Qwen 媒体能力：多模态理解、语音合成、场景音频生成。

本包是 `media-suite` 家族的一员，也可以独立安装使用。

## 工具

| 工具 | 模型 | 用途 |
|---|---|---|
| `qwen_omni` | `qwen3.8-omni-flash` | 视频 / 音频 / 图片理解，返回文本 |
| `qwen_tts` | `qwen-audio-3.1-tts-plus` | 文字转语音，支持预置音色与情绪指令 |
| `qwen_audio` | `qwen-audio-3.1-tts-next` | 按描述生成完整音频场景，支持参考音色 |

### `qwen_omni`

| 参数 | 必填 | 默认 | 说明 |
|---|---|---|---|
| `media` | 是 | — | 本地路径，或 `http(s)://` / `oss://` URL |
| `prompt` | 是 | — | 完整指令；转写、时间戳、总结都写在里面 |
| `thinking` | 否 | `true` | 是否启用模型思考 |

- `model` 固定 `qwen3.8-omni-flash`，`fps` 内部固定 `2.0`，均不暴露。
- 文件处理：本地 ≤ 20 MiB 内联 base64；> 20 MiB 上传百炼临时存储（上限 1 GB）；URL 直接透传。内联被网关拒绝时自动改走上传并重试一次。
- 图片允许，但工具描述不主动推荐：普通图片理解应使用主模型自带视觉能力。
- 文本直接返回，不落盘。

### `qwen_tts`

| 参数 | 必填 | 默认 | 说明 |
|---|---|---|---|
| `text` | 是 | — | 要朗读的文字 |
| `voice` | 是 | — | 预置音色 ID，如女声 `longanhuan_v3.1`、男声 `xunanchuan_v3.1` |
| `instruction` | 否 | — | 自然语言情绪/语气指令 |
| `format` | 否 | `mp3` | `mp3` / `pcm` / `wav` / `opus` |
| `sample_rate` | 否 | `22050` | 8000 / 12000 / 16000 / 22050 / 24000 / 44100 / 48000 |

### `qwen_audio`

| 参数 | 必填 | 默认 | 说明 |
|---|---|---|---|
| `text_prompt` | 是 | — | 音频描述或台词，用 `@voice1` / `@voice2` / `@voice3` 引用参考音频 |
| `references` | 否 | — | 最多 3 段参考音频，本地路径或 URL；每段 ≤10 MB、≤30 秒 |
| `format` | 否 | `wav` | `wav` / `mp3` / `pcm` |
| `sample_rate` | 否 | `48000` | 8000 / 16000 / 24000 / 44100 / 48000 |
| `channels` | 否 | `2` | 1 或 2 |

### 输出

音频写到：

```text
<输出根目录>/media/qwen/TTS-Plus/...​
<输出根目录>/media/qwen/TTS-Next/...​
```

输出根目录由 `media-suite` 的 `mediaSettings.outputRoot` 提供；没有 suite 时回退到 `<会话目录>/output`。

### Endpoint

默认共享域名：

```text
https://dashscope.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer
```

设置 `DASHSCOPE_WORKSPACE_ID` 后切换到 workspace 专属域名：

```text
https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api/v1
```

## 设置页

**设置 → Qwen 媒体**：配置 `DASHSCOPE_API_KEY`，并查看 Key 校验状态（模型列表接口，免费请求）。

Key 写入 `$DSH_HOME/.credentials.yaml` 的 `refs:` 段，由 Harness 凭据服务管理，页面不回显已保存的值。

## 不做

- 不做批量、异步、长时间任务
- 不做时间戳参数与 SRT 生成
- 不做专用 ASR 模型
- 不查询阿里云账户余额（DashScope Key 无法查询）

## 安装

```powershell
plugin_manager install_bundle .\packages\media-qwen
```

或安装 `media-suite` 一次得到整套媒体能力。
