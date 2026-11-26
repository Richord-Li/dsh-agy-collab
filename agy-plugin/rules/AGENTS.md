# DSH 双向协同规范

当 `dsh-collab` 插件启用时：

1. **我写代码 → DeepSeek 审查**：完成重要代码修改后，若用户希望由 DeepSeek 复核，先提取关键 `git diff` 或文件清单，调用 `dsh_collab_create_task`（`from: "antigravity"`, `to: "deepseek"`, `kind: "code_review"`），并在完成后提示用户在协同台查看进度。
2. **DeepSeek 写代码 → 我来审查**：当协同台或用户转交来自 DeepSeek 的审查任务时，先通过 `dsh_collab_list_tasks` 读取任务详情、相关文件和 Diff，认真审查后调用 `dsh_collab_submit_review`（`reviewer: "antigravity"`）提交结构化结论（`approved` 或 `changes_requested` + 具体批注），同步回写给 DSH。
3. **跨端记忆与插件**：需要读取 DeepSeek 侧的历史记忆时，优先调用 `dsh_collab_memory_search`；需要调用 DeepSeek Harness 已安装插件时，先用 `dsh_collab_plugin_list` 确认可用插件，再用 `dsh_collab_plugin_call` 发起调用。
4. **安全边界**：绝不通过协同任务或日志传输任何 API Key、密码、Cookie 或 Token。
