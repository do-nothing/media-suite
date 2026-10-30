# 待完成项

> 只列**真正还没做**的事。已完成的设计与实现见 [`local-dev-and-marketplace.md`](./local-dev-and-marketplace.md)。
> 已明确放弃的项不在此列（如 `runninghub_workflow_outputs` 工具、`workflow/*.json` 校验）。

---

## 1. 单独装 provider 时的 patch id 冲突（边缘情况）

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

## 2. 集成器模式下 provider 无法独立重载（已知副作用）

**现象**：`dsh.profile.bundles` 里只有 `@tmmk/media-suite` 一个条目，provider 的行是壳的
patch 插进去的，所以插件管理器的「已安装」列表里没有 media-qwen / media-runninghub，
**用户无法单独停用/启用它们**，改代码后只能重启整个 DSH 才生效。

**影响**：对最终用户无感（装完就能用）；对开发调试不便。

**候选修法**：
- 让壳的 patch 额外给 provider 各建一个独立 bundle 条目（但会和现有 insert 冲突，见第 1 项）
- 接受现状，开发时靠重启

**优先级**：低。

---

## 3. `media-drama` 包尚未开始

**现状**：仅在设计阶段，未建包。

**优先级**：低（未来规划）。

---

## 附：排查加载失败的三层口诀

遇到「插件不生效」时按顺序查，不要跳层：

1. **组合层** —— entry 存不存在？`plugin_manager list_plugins` 里找不到 → 包没进 `dsh.profile.bundles`，patch 没应用。
2. **Host 层** —— `fiberPhase` 是不是 `null`？是 → `index.js` import 抛错（先查 `npm pack --dry-run` 看文件是否齐全）。
3. **Client 层** —— 浏览器 console 报错？看是 `duplicate factory registration`（两条来源）还是 `loaded without registering`（id 不是完整包名）。

---

## 附：任务提交的合法枚举值速查

不同任务类型的「画面比例」编码方式**完全不同**，写错不会报错、照样扣费、25 秒后返回
SUCCESS 但无产物。合法值一律以 `runninghub_workflow_types` 工具输出的
「合法值（必须原样传）」为准：

| 类型 | 参数 | 编码方式 |
|---|---|---|
| `image-gen-qwen` / `image-edit-qwen` / `image-edit-qwen-multi` | `aspectRatio` | 带后缀字符串，如 `"16:9 (Widescreen)"` |
| `image-edit-banana2` | `aspectRatio` | 纯数字字符串，如 `"16:9"` |
| `i2v-minimax-h3-*` | `aspectSelect` | 整数编号 1–6 |

判别信号：正常出图耗时 **80–90 秒**；非法枚举值 25–30 秒就「成功」且 `results` 为空。
