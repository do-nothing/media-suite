---
name: runninghub-workflow
description: "RunningHub 工作流任务池的完整流程：13 种任务类型的选择规则、提交后禁止轮询、自动批次语义、唤醒后取产物与费用报告。当用户提到工作流、任务池、批量、异步、语音克隆、数字人、唱歌对口型、文生音乐、H3 视频时使用。"
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
2. **枚举值必须原样照抄**——`enum` 类型的参数（如 `aspectRatio`）合法值带括号后缀，必须写 `"16:9 (Widescreen)"`，不能简写成 `"16:9"`。写错不会报错：任务照样被接受、照样扣费，但 25 秒后返回 SUCCESS 而 `results` 为空，**钱花了没有图**。types 工具的「合法值（必须原样传）」一行就是要照抄的清单。
3. **提交后立即结束本轮**——不要轮询状态、不要 sleep、不要等待。任务完成后会话会被自动唤醒。
4. **唤醒后直接交付**——唤醒消息里带产物路径和费用；如果需要更多细节再调 `runninghub_workflow_status`。
5. **费用必须报**——非零的费用项都要自然地报给用户（如"花了 20.92 积分，另第三方 ¥0.19"）。任务按积分或现金结算其一，不并存：`points` 是积分，`money` / `thirdParty` 是现金。RH 币已废弃。
6. **偶发"空转"不重试**——同一个任务偶尔会 SUCCESS 但无 `results`/无产物。先按第 2 条自查是否传了非法枚举值；确认参数无误后再把问题报给用户（附带任务 ID、批次号、已计费项），不要自行重试。

## 批次语义

- 没有显式的"建批次"动作：**台账里有未完成任务时，新任务自动并入当前批次**。
- 上一批次全部结束后，再提交的任务会**新建批次**。
- 批次号在提交时由台账分配。

## 类型选择规则

1. **生图默认 `image-gen-qwen`**（只花 RH 币）；`image-edit-banana2` 另收约 ¥0.19/张第三方现金，仅在需要 7～10 图融合或 Qwen 效果不达标时用。
2. **图片编辑按参考图数量**：0 张→`image-gen-qwen`；1 张→`image-edit-qwen`；2～6 张→`image-edit-qwen-multi`；7～10 张→`image-edit-banana2`。
3. **H3 视频按复杂度**："让一张图动起来"→`i2v-minimax-h3-first-frame`；给定首尾帧→`i2v-minimax-h3-first-last-frame`；多角色一致/动作迁移/续写/配音→`i2v-minimax-h3-multi-ref`（prompt 必须按六段式写，见下）。
4. **配音路径**："用某人的声音念文案"→`voice-clone-emo`；"照片人物开口口播"→`digital-human`；**"让照片里的人唱一段歌"→`digital-human-singing`**（音频被完整复用为音轨，口型跟着唱）；视频旁白→H3 multi-ref 音频槽。
5. **唱歌 vs 口播**：`digital-human-singing` 是**唱歌**（音频整轨复用、有旋律、有歌词分句）；`digital-human` 是**念稿**（先用参考音色合成语音，再驱动口型）。要唱歌就别用 `digital-human`。

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

## MiniMax H3 唱歌对口型数字人 prompt 格式

`digital-human-singing` 让照片里的人开口唱一段给定音频。它的 prompt 也是六段式，但用 **`@图片N` / `@音频N`** 引用参考素材，**不是** `<Picture 1>`。

```text
subject_definitions:
<Subject 1> 是 @图片1 中的<人物描述：年龄、发型、衣着、姿态>。
@图片1 是<这张图提供什么：长相、体型、场景>，<哪些细节以它为准>。
@图片2 是<服装/道具参考>，<哪些细节以它为准>，忽略图中的<无关部分>。
@图片3 是<场景参考>，<哪些细节以它为准>，忽略图中的人物。
@音频1 是目标视频的演唱音轨，包含中文歌词"<歌词原文>"，作为 <Subject 1> (S1) 的演唱声音来源。

summary:
[reference generation + audio reuse] 目标视频约 <N> 秒，以 <Subject 1> <做什么>为主线，@图片1 提供<…>，@音频1 被完整复制为演唱音轨，镜头在<…>之间切换。

retention_analysis:
<Subject 1> (appears in [Shot 1], [Shot N]): fully_preserved - <保留什么>。
@图片1 (<用途>): fully_preserved - <保留什么>。
@图片2 (<用途>): fully_preserved - <保留什么>。
@音频1: fully_copy - @音频1 被 1:1 复用为目标视频的完整演唱音轨。

detailed_description:
<整体风格、色调、光线、镜头语言>。
[Shot 1] <景别>，<画面内容>，<口型/表情/动作>，<镜头运动>。他/她唱道：[中文] <第 1 句歌词>，
[Shot 2] At 00:0X.000，<转场到什么画面>，<镜头运动>，作为情绪的呼吸空间，演唱音频<cutoff>。
[Shot 3] At 00:0X.000，<景别>，<画面内容>。他/她继续唱道：[中文] <第 2 句歌词>。<收尾表情>。

overall_soundscape:
<环境声/伴奏>，演唱人声与<…>融合，<有没有其他声音>。

non_diegetic_music:
N/A
```

**三条关键约束**：

1. **`@图片N` 的编号不会传下去。** 控件保存工作流时，`@图片1` `@图片2` `@图片3` 全部被替换成同一个占位符 `__MINIMAX_H3_UNRESOLVED_REF_image__`，编号信息丢失；`@音频1` 同理。**所以每张图分别是什么用途，必须在 `subject_definitions` 和 `retention_analysis` 里用文字讲清楚**，不能只靠编号。
2. **`<Picture N>` 写不进去。** 在控件里粘贴 `<Picture 2>` 会被自动转成 `@图片2`，绕不过去。
3. **歌词要逐句进 `[Shot]`**，并用 `[中文]` 标语言；音频比 `seconds` 长时按 `seconds` 截断，所以 `seconds` 要覆盖整段演唱。

**参考素材上限**：4 张图（`image` / `image2` / `image3` / `image4`）+ 1 段音频（`audio`）。只有 `image` 和 `audio` 必填。