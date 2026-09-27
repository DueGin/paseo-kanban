import { useEffect, useRef } from "react";
import type { KanbanTask } from "../shared/kanban";
import { useLinkedAgentStatus } from "./use-linked-agent-status";

export interface AgentAdvanceWatcherProps {
  task: KanbanTask;
  onFinished: (taskId: string) => void;
}

// Watches one linked agent and reports its first cleanly finished turn. The
// same condition drives live transitions and board-open reconciliation, so a
// turn completed while no client watched still fires on the next open. The
// agent link's `advanced` flag in the board document makes the advance
// idempotent across watchers and clients.
export function AgentAdvanceWatcher({
  task,
  onFinished,
}: AgentAdvanceWatcherProps) {
  const link = task.agent;
  const state = useLinkedAgentStatus(link?.agentId ?? "");
  const firedRef = useRef(false);

  const finished =
    link !== null &&
    state.kind === "live" &&
    state.status === "idle" &&
    !Number.isNaN(Date.parse(state.updatedAt)) &&
    Date.parse(state.updatedAt) > Date.parse(link.startedAt);

  useEffect(() => {
    if (finished && !firedRef.current) {
      firedRef.current = true;
      onFinished(task.id);
    }
  }, [finished, onFinished, task.id]);

  return null;
}
