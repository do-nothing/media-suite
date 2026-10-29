# media-suite

第三方媒体能力的插件家族。每个 provider 独立成包，`media-suite` 负责一键安装与跨 provider 的全局配置。

## 包

| 包 | 状态 | 内容 |
|---|---|---|
| `packages/media-qwen` | 已实现 | `qwen_omni` / `qwen_tts` / `qwen_audio` |
| `packages/media-runninghub` | 部分实现 | `surface: sync` 已实现（图片生成）；`surface: jobs` 设计中，见 [`packages/media-runninghub/docs/jobs-design.md`](packages/media-runninghub/docs/jobs-design.md) |
| `packages/media-suite` | 计划中 | 一键安装入口 + 全局配置 |
| `packages/media-drama` | 计划中 | 短剧工作流 |

## 设计文档

| 文档 | 内容 |
|---|---|
| [`packages/media-runninghub/docs/jobs-design.md`](packages/media-runninghub/docs/jobs-design.md) | `media-runninghub` 的 `jobs` 模式（工作流任务池）设计决策、依据与待定项 |

**设计文档是决策的唯一权威来源**——上下文压缩后以文档为准，不依赖对话记录。

## 设计约定

- **包名带 `media-`**，工具名用 provider 短前缀（`qwen_*`、`runninghub_*`）。
- **provider 只管自己的 API 和自己的 Key**，不关心业务工作流。
- **工作流层（`media-drama` 等）只暴露高层工具**，不直接点名 provider。
- **密钥统一存在全局凭据库** `$DSH_HOME/.credentials.yaml` 的 `refs:` 段，拆包不会让 Key 变多。
- **跨 provider 的配置只有一处**：输出根目录，由 `media-suite` 提供。
- **结构性开关走 Config**（改完触发插件重载），**运行时数值走 Settings**，**秘密走 Credentials**。

## 输出路径

```text
<输出根目录>/media/qwen/...​
<输出根目录>/media/runninghub/...​
```

没有 `media-suite` 时，`<会话目录>/output` 作为根目录。

## 安装单个包

```powershell
plugin_manager install_bundle E:\2026\dsh-plugins\media-suite\packages\media-qwen
```
