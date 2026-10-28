---
name: runninghub-workflow
description: "RunningHub 工作流任务池的完整流程：11 种任务类型的选择规则、提交后禁止轮询、自动批次语义、唤醒后取产物与费用报告。当用户提到工作流、任务池、批量、异步、语音克隆、数字人、文生音乐、H3 视频时使用。"
---

# RunningHub 工作流任务池

把 RunningHub 的工作流任务作为后台作业提交：排队执行、自动下载产物、完成后自动唤醒会话。

## 工具

| 工具 | 作用 |
|---|---|
| `runninghub_workflow_types` | 列出全部任务类型和参数（**提交前必查**） |
| `runninghub_workflow_submit` | 提交任务（一次一条或多条） |
| `runninghub_workflow_status` | 查批次/任务状态 |

## 提交规则

1. **提交前先调 `runninghub_workflow_types`**——拿到类型 ID 和参数表，不许凭记忆编类型或参数。
2. **提交后立即结束本轮**——不要轮询状态、不要 sleep、不要等待。任务完成后会话会被自动唤醒。
3. **唤醒后直接交付**——唤醒消息里带产物路径和费用；如果需要更多细节再调 `runninghub_workflow_status`。
4. **费用必须报**——非零的费用项都要自然地报给用户（如"花了 25 RH 币，另第三方 ¥0.19"）。
5. **不暴露 RunningHub 内部 URL**。

## 批次语义

- 没有显式的"建批次"动作：**台账里有未完成任务时，新任务自动并入当前批次**。
- 上一批次全部结束后，再提交的任务会**新建批次**。
- 批次号在提交时由台账分配。

## 类型选择规则

1. **生图默认 `image-gen-qwen`**（只花 RH 币）；`image-edit-banana2` 另收约 ¥0.19/张第三方现金，仅在需要 7～10 图融合或 Qwen 效果不达标时用。
2. **图片编辑按参考图数量**：0 张→`image-gen-qwen`；1 张→`image-edit-qwen`；2～6 张→`image-edit-qwen-multi`；7～10 张→`image-edit-banana2`。
3. **H3 视频按复杂度**："让一张图动起来"→`i2v-minimax-h3-first-frame`；给定首尾帧→`i2v-minimax-h3-first-last-frame`；多角色一致/动作迁移/续写/配音→`i2v-minimax-h3-multi-ref`（prompt 必须按六段式写，见下）。
4. **配音路径**："用某人的声音念文案"→`voice-clone-emo`；"照片人物开口口播"→`digital-human`；视频旁白→H3 multi-ref 音频槽。

## MiniMax H3 多参考 prompt 格式

`i2v-minimax-h3-multi-ref` 的 prompt 必须按六段式写：

```text
[<mode tags>]

Subject definitions:
- <Subject 1>: <Picture 1> — relationship: fully_preserved/attribute_transfer/...
- <Subject 2>: <Video 1> — relationship: fully_preserved/weak_reference/...
- <Subject 3>: <Audio 1> — relationship: fully_copy/timbre_reference/...

Summary: 一句话说清成片是什么。

Retention analysis: 每个参考素材保留什么、丢弃什么、改了什么。

Detailed description: 分镜头时间线；台词写成独立行 <d>中文台词</d>

Overall soundscape: 环境声/音效；旁白引用 <Audio 1>。

Non-diegetic music: （可选）背景音乐。
```

**关键经验**：换主体时不要挂源视频（视频槽会锚定源片主角身份）；只挂目标主体的图片，要复刻动作用动作迁移写法并整体替换场景。
