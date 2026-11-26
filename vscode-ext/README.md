# DSH ↔ Antigravity 双向协同台（VS Code 扩展）

在 VS Code 左侧活动栏提供专属图标与原生 Sidebar Webview，并在底部状态栏实时提示 DeepSeek Harness 的在线状态与待审任务数量。

## 主要功能

- 左侧活动栏专属图标 + 自动适配 VS Code 主题的原生侧边栏面板（任务 / 记忆 / 插件 / 设置）
- 底部状态栏实时提示在线态与待审红点，收到 DeepSeek 新任务时弹出桌面通知
- 编辑器右键菜单支持一键「发送当前文件给 DeepSeek 审查」
- 点击任务中的文件路径或 DSH 记忆条目，直接在 VS Code 编辑器中打开

## 配置项

- `dshCollab.collabRoot`：`dsh-agy-collab` 仓库根目录（留空会自动读取 `~/.dsh-agy-collab/repo-path` 或环境变量 `DSH_AGY_COLLAB_DIR`）
- `dshCollab.hubPort`：本地协同中枢端口（默认 `47891`）
