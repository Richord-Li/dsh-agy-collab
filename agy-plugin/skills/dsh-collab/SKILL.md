---
name: dsh-collab
description: 与 DeepSeek Harness (dsh) 进行双向协同工作：双向代码审查、任务委派、读取 dsh 记忆、调用已安装的 dsh 插件，以及打开可视化协同控制台。
---

# DSH 双向协同工作流

本技能用于协调 **Antigravity** 与本地 **DeepSeek Harness (dsh)** 的对等协作。

## 可用工具

- `dsh_collab_open`：在侧边栏打开/刷新「DSH 双向协同台」可视化面板。
- `dsh_collab_status`：检查协同中枢、DeepSeek Harness 在线状态、待办任务数与已装插件。
- `dsh_collab_create_task`：向 DeepSeek 发起代码审查、实现委派或架构讨论任务。
- `dsh_collab_list_tasks`：列出双向任务队列（可按 `to` / `status` 过滤）。
- `dsh_collab_submit_review`：对 DeepSeek 提交的代码任务发表结构化审查意见（`approved` / `changes_requested` / `commented`），结果会实时同步到 DSH 侧面板与工具。
- `dsh_collab_memory_search`：检索 `~/.dsh/memory` 与 `.dsh-memory/data/mdcg` 中的记忆内容（DSH 离线时也可用）。
- `dsh_collab_plugin_list` / `dsh_collab_plugin_call`：查询并调用 DSH 宿主中已安装的插件能力。

## 常见协同场景

### 场景 A：我写代码，交给 DeepSeek 审查
1. 整理本次改动的 `workspace`、`files`、`diff` 和审查关注点 `prompt`。
2. 调用 `dsh_collab_create_task(title, kind="code_review", from="antigravity", to="deepseek", ...)`。
3. 告知用户任务 ID；DeepSeek 审查完成后会通过 DSH 侧工具回写结论，可在侧边栏协同台查看。

### 场景 B：DeepSeek 写代码，交给我审查
1. 用户在侧边栏协同台点击「交给当前对话审查」，或直接让你查看待审任务。
2. 调用 `dsh_collab_list_tasks(to="antigravity", status="pending")` 获取任务详情与涉及文件。
3. 读取对应代码文件，检查逻辑、边界条件、安全性和可维护性。
4. 调用 `dsh_collab_submit_review(taskId, reviewer="antigravity", verdict, summary, comments)` 回写审查结论，并向用户简洁汇报要点。

### 场景 C：读取 DSH 记忆或调用 DSH 插件
- 查记忆：调用 `dsh_collab_memory_search(query, scope="all")`。
- 调插件：先调 `dsh_collab_plugin_list()`，再调 `dsh_collab_plugin_call(plugin, action, params)`（需 DSH 运行中且已启用 `dsh-plugin-agy-collab`）。
