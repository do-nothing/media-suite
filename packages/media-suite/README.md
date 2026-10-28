# media-suite · 媒体工具

媒体插件家族的一键安装入口，以及跨 provider 的全局设置。

## 它做什么

```text
media-suite
  ├─ 挂载自己的一行（提供 mediaSettings 服务与全局设置页）
  ├─ 依赖 media-qwen
  └─ 依赖 media-runninghub
```

装一个 `media-suite`，得到：

- `media-qwen` 的 `qwen_omni` / `qwen_tts` / `qwen_audio`
- `media-runninghub` 的 `runninghub_image`
- 三个设置页：媒体工具（全局）、Qwen 媒体、RunningHub 媒体

## 它不做什么

- 不调用任何 provider API
- 不保存任何 API Key
- 不注册任何模型工具

## 全局设置

| 设置 | 默认 | 说明 |
|---|---|---|
| `outputRoot` | 空 | 生成文件的根目录；留空表示使用当前会话目录下的 `output` |

provider 写到：

```text
<outputRoot>/media/qwen/...​
<outputRoot>/media/runninghub/...​
```

`outputRoot` 是绝对路径就直接用，是相对路径就相对会话目录解析。

## mediaSettings 服务

suite 通过 `ctx.provide('mediaSettings', ...)` 暴露：

```js
{
  outputRoot: string,               // 配置值；空字符串表示使用默认
  resolveRoot(sessionDirectory),    // 把配置值解析成绝对路径
}
```

provider 用 `ctx.get('mediaSettings')` 读取；读不到时各自回退到 `<会话目录>/output`，所以每个 provider 包都能独立安装使用。

## 挂载方式

`cordis.patch.yml` **只插入 `media-suite` 自己这一行**。

provider 是独立的 bundle，各自带 `dsh.bundle.patch`。它们在 suite 的 `dependencies` 里声明，由插件管理器一起装进 profile，再由各自的 patch 插入各自的 row。

> 不要在 suite 的 patch 里再插入 `media-qwen` / `media-runninghub`：那会和它们自己的 patch 撞同一个 id，导致两个插件都激活失败。

## 安装

```powershell
plugin_manager install_bundle E:\2026\dsh-plugins\media-suite\packages\media-suite
```

卸载 suite 时，provider 包是否一起移除由插件管理器决定；单独卸载某个 provider 不影响 suite 的全局设置页。
