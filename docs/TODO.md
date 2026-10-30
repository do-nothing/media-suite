# 待完成项

> 只列**真正还没做**的事。已完成的设计与实现见 [`local-dev-and-marketplace.md`](./local-dev-and-marketplace.md)。
> 已明确放弃的项不在此列（如 `runninghub_workflow_outputs` 工具、`workflow/*.json` 校验）。

---

## 1. `submit` 参数校验失败时不呈现具体原因（体验 bug）

**现象**：`runninghub_workflow_submit` 的所有任务都在解析阶段失败时，只返回
`watcher: none`，工具输出里只有「已提交：批次 #0，0 个任务，1 个被拒绝（watcher: none）」，
**看不到到底哪个参数错了**。

**实测复现**：给 `image-gen-qwen` 传它不支持的 `aspect_ratio` 参数 → 静默失败，
必须去掉参数才能提交成功。

**根因**：`lib/pool/tools.js:96` 只把 `errors.length` 拼成「N 个被拒绝」，
`errors` 数组的**内容**没有进 tool 输出：

```js
const errors = Array.isArray(value.errors) && value.errors.length > 0
  ? `，${value.errors.length} 个被拒绝`
  : ''
text: `已提交：批次 #${value.batchId}，${value.taskIds.length} 个任务${errors}（watcher: ${value.watcher}）`
```

而 `errors` 数组本身是有的（`tools.js:143` `errors.push(\`任务 ${index + 1}: ${error?.message}\`)`）。

**修法**：把 `errors` 的每条内容也拼进 tool text（或作为独立行列出）。
涉及文件：`packages/media-runninghub/lib/pool/tools.js`（submit 工具的 text 生成处）。

**优先级**：高。模型和用户都会被这个静默失败卡住，且容易误判为「插件坏了」。

---

## 2. 单独装 provider 时的 patch id 冲突（边缘情况）

**场景**：用户除了 `add @tmmk/media-suite`，又单独 `add @tmmk/media-qwen`。
后者会进 `dsh.profile.bundles`，它自己的 `cordis.patch.yml` 也会被应用 →
和壳的三行 patch **插同一个 row id `media-qwen`** → 可能报冲突或行为不确定。

**现状**：未处理，也未实测确认具体表现。

**候选修法**（择一）：
- 壳的 patch 用 `id` 定位已有行并覆盖 config，而非无条件 insert（需确认 loader 语义）
- 壳检测 provider 是否已在 bundles 里，动态决定插几行（需在 Host 侧实现）
- 文档明确要求「不要单独 add provider，只装壳」

**优先级**：低。属于用户非常规操作才会触发。

---

## 3. 文档中设置页描述与实际实现的对齐（已随重写解决）

原 `jobs-design.md` 称设置页「标签页切换、另一张整块隐藏（不显示只读卡）」，
实际是**两张卡都显示、非当前 surface 的为只读**。

重写后的 `local-dev-and-marketplace.md` §7 已按实际实现描述。
**本项无需再动**，仅记录以免有人翻到旧说法。

---

## 附：排查加载失败的三层口诀

遇到「插件不生效」时按顺序查，不要跳层：

1. **组合层** —— entry 存不存在？`plugin_manager list_plugins` 里找不到 → 包没进 `dsh.profile.bundles`，patch 没应用。
2. **Host 层** —— `fiberPhase` 是不是 `null`？是 → `index.js` import 抛错（先查 `npm pack --dry-run` 看文件是否齐全）。
3. **Client 层** —— 浏览器 console 报错？看是 `duplicate factory registration`（两条来源）还是 `loaded without registering`（id 不是完整包名）。
