# media-suite · 媒体工具

媒体插件家族的一键安装入口。

## 它做什么

```text
media-suite
  ├─ 挂载自己的一行
  ├─ 依赖 media-qwen
  └─ 依赖 media-runninghub
```

装一个 `media-suite`，得到：

- `media-qwen` 的 `qwen_omni` / `qwen_tts` / `qwen_audio`
- `media-runninghub` 的 `runninghub_image`
- 两个 provider 各自的设置页

## 它不做什么

- 不调用任何 provider API
- 不保存任何 API Key
- 不注册任何模型工具
- **没有自己的配置页**：输出位置不是 profile 设置

## 输出位置

默认固定为：

```text
<当前工作目录>/output/media/qwen/...​
<当前工作目录>/output/media/runninghub/...​
```

需要写到别处时，**在每次调用里传 `output`**：

```json
{ "prompt": "...",​ "output": "D:/projects/ep01/stills" }
```

相对路径按当前工作目录解析，目录会自动创建。这样同一个会话里不同任务可以各自落到各自的目录，不需要改插件配置。

## 挂载方式

`cordis.patch.yml` **只插入 `media-suite` 自己这一行**。

provider 是独立的 bundle，各自带 `dsh.bundle.patch`。它们在 suite 的 `dependencies` 里声明，由插件管理器一起装进 profile，再由各自的 patch 插入各自的 row。

> 不要在 suite 的 patch 里再插入 `media-qwen` / `media-runninghub`：那会和它们自己的 patch 撞同一个 id，导致两个插件都激活失败。

## 安装

```powershell
plugin_manager install_bundle E:\2026\dsh-plugins\media-suite\packages\media-suite
```
