# media-suite

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）用的媒体能力插件家族。

一次安装，把阿里云百炼的 Qwen 能力与 RunningHub 的图片 / 视频 / 音频能力接进你的 Agent。

## 一键安装

```bash
dsh plugin --profile <你的 profile> add @tmmk/media-suite
```

装完重启 DSH，设置里会出现 **Qwen 媒体** 和 **RunningHub 媒体** 两个页面。

## 你会得到什么

### Qwen 媒体（阿里云百炼 DashScope）

| 工具 | 能做什么 |
|---|---|
| `qwen_omni` | 理解视频、音频、图片，返回文字描述或转写 |
| `qwen_tts` | 把文字读成语音，可选预置音色、可描述情绪语气 |
| `qwen_audio` | 按描述生成完整音频场景（对话、环境声、短剧片段），可用参考音色 |

### RunningHub 媒体

**同步出图**

| 工具 | 能做什么 |
|---|---|
| `runninghub_image` | 一句话出图；给参考图就是改图或多图融合 |

**工作流任务池**（11 种任务类型）

| 工具 | 能做什么 |
|---|---|
| `runninghub_workflow_submit` | 提交任务，一次一条或多条，立即返回批次号 |
| `runninghub_workflow_types` | 查全部任务类型的参数与合法值 |
| `runninghub_workflow_status` | 查批次进度与费用 |

支持的任务：文生图、单图/多图改图、全能图片编辑、首帧/首尾帧/多参考生视频、语音克隆、数字人、文生音乐、人声分离。

**任务池的工作方式**：提交后就可以结束对话，不用等。任务在后台排队执行，产物自动下载，批次完成时会自动唤醒你并附上产物路径与费用。

## 需要准备什么

| 能力 | 需要的凭据 | 从哪里获取 |
|---|---|---|
| Qwen 媒体 | `DASHSCOPE_API_KEY` | [阿里云百炼](https://bailian.console.aliyun.com/) |
| RunningHub | `RUNNINGHUB_SYNC_API_KEY`（同步出图）<br>`RUNNINGHUB_JOBS_API_KEY`（任务池） | [RunningHub](https://www.runninghub.cn?inviteCode=mnsw5sb8) |

Key 统一存在 `$DSH_HOME/.credentials.yaml` 的 `refs:` 段，由 Harness 凭据服务管理。设置页只显示「已配置 / 未配置」和校验状态，**不回显已保存的密钥**。

两个 RunningHub Key 相互独立，可以填相同的值。插件会自动按账户余额币种判定 Key 属于中国站还是国际站，不需要手动选。

### RunningHub 是什么

RunningHub 是一个在线的 AI 图像与视频生成平台，提供无限画布、Agent 快捷生成，以及基于 ComfyUI 的可视化工作流，可以把 AI 应用、工作流与生成任务自由组合。平台按算力计费，单价以平台公示为准。

本插件通过 RunningHub 的开放 API 调用这些能力，因此需要一个 RunningHub 账户和 API Key。

还没有账户的话，可以用上面的邀请链接注册，新账户会获得平台赠送的 RH 币。赠币数量与规则由 RunningHub 决定，可能随时调整。

## 输出位置

所有产物默认落在当前会话目录下：

```text
<会话目录>/output/media/qwen/...
<会话目录>/output/media/runninghub/...
```

需要写到别处时，在每次调用里指定（`output` 或 `outputDir` / `outputName`），不用改插件配置。

## 包里有什么

| 包 | 说明 |
|---|---|
| `@tmmk/media-suite` | 套装入口，负责把两个 provider 挂起来。本身不含功能 |
| `@tmmk/media-qwen` | Qwen 能力（多模态理解 / TTS / 音频生成） |
| `@tmmk/media-runninghub` | RunningHub 能力（同步出图 / 工作流任务池） |

三个包都在 npm 上，也可以单独安装其中任意一个。

## 开源许可

Apache-2.0，详见 [LICENSE](LICENSE)。
