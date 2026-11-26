---
name: auto-review-publish
description: 全自动开源整理、隐私审计、DeepSeek 互审闭环与 GitHub 一键发布工作流。当用户要求“审查并发布到 GitHub”、“整理成开源仓库并推送”、“让 DeepSeek 审完自动发布”时使用。
---

# 全自动互审与 GitHub 发布工作流

当用户要求把某个项目整理、让 DeepSeek 审查合格并自动发布到 GitHub 时，按以下 5 步全自动执行（无需用户手动操作网页）：

## 1. 开源整理与去敏
- 消除代码与脚本中的本机绝对路径和个人用户名，改为相对路径、环境变量或跨平台安装脚本。
- 补齐开源规范文件：`.gitignore`（屏蔽 `node_modules/`、`data/`、`.env*`、`*token*`、`*.bak*`、`*.log`、`dist/`）、`LICENSE`（MIT，版权人使用项目集体名或公开 GitHub 用户名）、`README.md`、`package.json`（含 `engines`、`repository`、`homepage`、`bugs`、`license`）。

## 2. 强制隐私正则审计
在任何 `git commit` 或推送之前，对所有 `git ls-files` 追踪文件执行扫描，必须确认 **0 命中**：
- 个人真实姓名与系统用户名
- 本机盘符与用户目录路径（`C:\Users\...`、`E:\gemini\...` 等）
- 凭据与令牌（`sk-*`、`tk_*`、`mdcg1.*`、Bearer Token、Cookie、密码）
- 个人私有邮箱（非 `*.noreply.github.com`）

## 3. DeepSeek 全自动互审闭环
1. 调用 `dsh_collab_create_task`（`to: "deepseek"`, `kind: "code_review"`），附上关键文件清单和明确审查要求。
2. 等待 DeepSeek 自动审稿回写（可通过短定时器后调 `dsh_collab_list_tasks` 检查）。
3. 若返回 `changes_requested`：逐条修复 DeepSeek 指出的问题、重跑本地测试，再次提交复审，直到拿到 `approved`。

## 4. 一键建仓并推送 GitHub
- 优先使用本机已登录的 GitHub CLI (`gh`)：
  - 若远程仓库尚未存在：`gh repo create <owner>/<repo> --public --source=. --remote=origin --push`
  - 若远程仓库已存在：`git push -u origin main`
- 确认提交身份使用公开用户名与 GitHub 匿名邮箱（`<username>@users.noreply.github.com`）。

## 5. 交付汇报
向用户提供：GitHub 仓库链接、最新 Commit Hash、隐私扫描结果（0 命中）与 DeepSeek 复审结论。
