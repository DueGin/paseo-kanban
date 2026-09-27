import { useEffect, useState } from "react";
import { usePaseo } from "@getpaseo/plugin/client";

export type LinkedAgentState =
  | { kind: "loading" }
  | { kind: "gone" }
  | {
      kind: "live";
      status: "initializing" | "idle" | "running" | "error" | "closed";
      requiresAttention: boolean;
      updatedAt: string;
    };

// Imperative agent tracking that works on any surface. The useAgent state hook
// only exists inside workspace panels, so the badge and the auto-advance
// watcher share this ref+subscribe engine instead.
export function useLinkedAgentStatus(agentId: string): LinkedAgentState {
  const paseo = usePaseo();
  const [state, setState] = useState<LinkedAgentState>({ kind: "loading" });

  useEffect(() => {
    const handle = paseo.agents.ref(agentId);
    let alive = true;
    const readCurrent = () => {
      const agent = handle.current();
      if (agent == null) {
        setState({ kind: "gone" });
      } else {
        setState({
          kind: "live",
          status: agent.archivedAt ? "closed" : agent.status,
          requiresAttention: agent.requiresAttention === true,
          updatedAt: agent.updatedAt,
        });
      }
    };
    handle
      .refresh()
      .then(() => {
        if (alive) readCurrent();
      })
      .catch(() => {
        if (alive) setState({ kind: "gone" });
      });
    const unsubscribe = handle.subscribe(() => {
      if (alive) readCurrent();
    });
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [paseo, agentId]);

  return state;
}
