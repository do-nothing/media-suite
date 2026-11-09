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

`digital-human-singing` 让照片里的人开口唱给定音频。prompt 用 `@图片N` / `@音频N` 引用素材。

**参考素材**：最多 4 张图（`image` / `image2` / `image3` / `image4`）+ 1 段音频（`audio`），只有 `image` 和 `audio` 必填。多图时，每张图**是什么用途必须用文字写进 prompt**——控件保存时 `@图片1` `@图片2` `@图片3` 会塌成同一个占位符，编号不保留。

**示例**（工作流自带的原文）：

```text
subject_definitions:
<Subject 1> 是 @图片1 中的年轻男性，黑色短发、发丝微湿，穿黑色西装外套与黑色衬衫，佩戴银色项链、手链与戒指，坐在钢琴前弹奏。
@图片1 是 [Shot 1] 的构图与人物外观参考，确立男性侧身坐于钢琴前的姿态、暖色台灯侧上方打光与背景的"Jazz"海报。
@音频1 是目标视频的演唱音轨，包含中文歌词"消磨了很多力气，但我的青春已不值一提，我只想在你欠我的账本上再狠狠的记上一笔。"，作为 <Subject 1> (S1) 的演唱声音来源。

summary:
[reference generation + audio reuse] 目标视频约 8 秒，以 <Subject 1> 在夜晚室内弹奏钢琴并演唱为主线，@图片1 提供人物外观与场景布局参考，@音频1 被完整复制为演唱音轨，镜头在人物特写、窗外夜景与侧前方中景之间切换。

retention_analysis:
<Subject 1> (appears in [Shot 1], [Shot 3]): fully_preserved - 黑色短发、黑色西装外套与衬衫、银色项链手链戒指、弹琴姿态与内敛神情均保留。
@图片1 ([Shot 1] 构图参考): fully_preserved - 侧身坐姿、台灯暖光方向、钢琴与背景"Jazz"海报的空间关系保留。
@音频1: fully_copy - @音频1 被 1:1 复用为目标视频的完整演唱音轨。

detailed_description:
整支视频采用电影感风格，画面以深沉的黑色与暖黄色为主调，曝光偏低，台灯暖光从侧上方打在人物与钢琴上，形成柔和明暗对比，背景隐没在深阴影中，银色饰品与白色琴键成为视觉点缀。
[Shot 1] 特写镜头，构图聚焦 <Subject 1> 的面部与肩部，他微微低头，目光垂向琴键，嘴唇随演唱自然小幅开合，眉头微蹙，表情专注内敛。镜头固定，景深极浅，背景台灯光晕与模糊的"Jazz"海报化为柔和光斑。他唱道：[中文] 消磨了很多力气，但我的青春已不值一提，
[Shot 2] At 00:02.000，镜头切换为窗外夜景特写，透过玻璃窗可见远处城市建筑灯光在夜色中闪烁成模糊光点，镜头固定，画面静止，作为情绪的呼吸空间，演唱音频<cutoff>。
[Shot 3] At 00:04.000，镜头切换为中景，从侧前方拍摄 <Subject 1> 坐在钢琴前，双手在琴键上移动，身体随音乐轻微律动，镜头以小幅度慢速向右环绕，从侧面逐渐转向更正面的角度。他继续唱道：[中文] 我只想在你欠我的账本上再狠狠的记上一笔。 唱到最后一句时嘴角微微上扬，露出一丝复杂的笑意，整体表情依然克制。

overall_soundscape:
持续的钢琴弹奏声贯穿整个视频，琴键敲击声清晰可闻，演唱人声与钢琴声融合，无其他明显环境音或动作声。

non_diegetic_music:
N/A
```

**多图用法**：`image` 放主参考（人物/场景），`image2`～`image4` 放服装、场景、面部特写等，然后在 `subject_definitions` 与 `retention_analysis` 里逐条写明每张图的用途。示例：

```text
<Subject 2> 是主唱。她的舞台站位与构图见 @图片1，面部、眉眼与发际线的细节见 @图片2。
@图片1 是 [Shot 1] 的起始画面。
@图片2 是 <Subject 2> 的面部参考，镜头推近时使用。
```

**提交前先测音频**：用 `qwen_omni` 问清「人声从第几秒开始」「每句歌词的起止时间」。`[Shot]` 的切点必须落在实测时间之后，不要凭感觉写。