# 卡片一键启动 Agent 与泳道自动流转

任务卡可一键启动 Paseo agent：启动面板中选择目标（项目新开 worktree 工作区，或现有工作区新开 agent）、agent（每次显示选择器，预选上次值）与可编辑的首条消息（预填标题、描述、子步骤）。

任务记录 agent 关联（`task.agent`）：启动成功后写入 agentId、workspaceId、provider、目标方式、启动时间，并前进一个泳道；关联 agent 首个 turn 完成（`status: idle` 且 `lastActivityAt` 晚于启动时间）再前进一个泳道，`advanced` 标记保证每卡只自动流转一次。出错（`status: error`）不流转，徽章变红。泳道推进按泳道数组序的下一个，末位不动——不绑定泳道名称，自定义泳道同样适用。

自动流转由客户端订阅驱动而非 daemon：插件 server 端 settings 句柄只读（`read`/`subscribe`），无法代写看板；代价是所有 Paseo 客户端关闭时完成事件不被消费，由看板下次打开时的同一判定条件补齐（reconcile 与实时监听共用一条规则，天然幂等）。`useAgent` 等状态 hook 只在 workspace panel 有上下文，因此徽章与流转共用一条 `agents.ref + subscribe/refresh` 命令式订阅（`client/use-linked-agent-status.tsx`），侧栏与工作区面板行为一致。卡片状态徽章实时派生、不落库，点击经 `navigation.openAgent` 跳转；宿主不支持 `navigation` 时徽章退化为纯展示。

关联与看板同文档存储（host-scope），字段可空默认 `null`，旧数据免迁移；上次的 agent/目标选择独立存 `agent-launch` 设置文档，不污染看板版本。手动拖动、任务删除、解除关联均不受影响。

实现入口：`shared/kanban.ts` 的 `TaskAgentLinkSchema`、`advanceTaskToNextLane`、`buildAgentPrompt`，`client/start-agent-modal.tsx` 的启动面板，`client/kanban-board.tsx` 的 `AgentAdvanceWatcher` 与关联写回。存储与冲突规则见 [ADR-0004](./0004-host-board-storage-and-project-references.md)。
