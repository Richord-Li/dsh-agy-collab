# DSH ↔ Antigravity Collab Suite

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

一套面向 **Antigravity**、**VS Code** 与 **DeepSeek Harness (`dsh`)** 的对等双向协同插件套件：支持双向代码审查、任务委派、跨端记忆检索、DSH 插件代理调用，以及三端原生可视化控制台。

---

## 核心特性

- **双向对等协同**：
  - **Antigravity → DeepSeek**：提交改动与审查要点给 DeepSeek 复核，或代理调用 DSH 运行时插件。
  - **DeepSeek → Antigravity**：DeepSeek 通过原生工具（`agy_request_review` / `agy_list_tasks` / `agy_submit_review`）主动发起审查任务，支持 **默认面板一键接手** 与 **可选自动唤醒** 双模式。
- **三端可视化体验**：
  - **Antigravity MCP App**：支持对话内嵌、侧边栏与全页展示。
  - **VS Code 原生扩展**：左侧活动栏专属图标 + 原生 Sidebar Webview + 底部状态栏待审提醒 + 编辑器右键一键送审。
  - **DeepSeek Harness 插件**：输入框底部状态徽标 + 毛玻璃悬浮协同抽屉（自动适配宿主主题与壁纸引擎）。
- **记忆互通**：支持检索 `~/.dsh/memory` 与 `.dsh-memory/data/mdcg`（即使 DSH 离线也可直读）。
- **本机优先与隐私安全**：协同中枢仅监听 `127.0.0.1:47891`，使用本机随机 Token 鉴权（`hub-token` 仅保存在本地且已被 `.gitignore` 忽略），不上传任何代码或凭据。

---

## 架构概览

```text
  Antigravity / VS Code                           DeepSeek Harness (dsh)
┌───────────────────────────┐                   ┌───────────────────────────┐
│ • Antigravity MCP Plugin  │                   │ • Cordis Host Plugin      │
│ • MCP App 可视化卡片      │◄──► Local Hub ◄──►│   (原生工具 + 插件代理)   │
│ • VS Code 左侧活动栏扩展  │  127.0.0.1:47891  │ • Client Dock 悬浮抽屉    │
└───────────────────────────┘  (Token + SSE)    └───────────────────────────┘
```

---

## 快速安装

### 环境要求
- Node.js `>= 20`（推荐 `22+` / `24+`）
- Python `>= 3.10`（仅打包 VS Code `.vsix` 需要）
- Antigravity / VS Code / DeepSeek Harness (`dsh`)

### 1. 克隆并安装依赖
```bash
git clone https://github.com/Richord-Li/dsh-agy-collab.git
cd dsh-agy-collab
npm install
npm run build:ui
```

### 2. 安装 Antigravity 插件
```bash
npm run install:agy
```
该脚本会自动把插件清单同步到 `~/.gemini/config/plugins/dsh-collab` 并写入当前仓库对应的 MCP Server 路径。

### 3. 安装 DeepSeek Harness (`dsh`) 插件
- **方式 A（命令行一键注册）**：
  ```bash
  npm run install:dsh
  ```
- **方式 B（在 DSH 内安装）**：在 DSH 插件管理中使用 `install_bundle` 指向本仓库的 `dsh-plugin` 目录。

安装后重启 DeepSeek Harness 桌面端，输入框下方会出现 `AGY 协同` 徽标，同时 DeepSeek 自动获得 4 个原生工具：`agy_request_review`、`agy_list_tasks`、`agy_submit_review`、`agy_collab_status`。

### 4. （可选）安装 VS Code 原生侧边栏扩展
```bash
npm run build:vsix
code --install-extension dist/dsh-agy-collab-vscode-0.1.0.vsix --force
```
在 VS Code 中执行 `Developer: Reload Window` 后，左侧活动栏即出现专属图标，底部状态栏会实时显示连接态与待审数量。

---

## 本地测试

```bash
npm run test:smoke
```

## 目录结构

```text
dsh-agy-collab/
├── hub/            # 本地协同中枢（HTTP/SSE、状态存储、DSH 记忆检索、插件目录扫描）
├── agy-plugin/     # Antigravity 插件（MCP Server、MCP App 源码、Skills、Rules）
├── dsh-plugin/     # DeepSeek Harness Cordis 插件（Host 桥接 + Client 悬浮面板）
├── vscode-ext/     # VS Code 原生侧边栏与状态栏扩展
└── scripts/        # 构建、跨平台安装与冒烟测试脚本
```

## 开源许可

[MIT](LICENSE)
