import { useMemo } from "react";
import { View, Text, Pressable } from "react-native";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import type { TaskAgentLink } from "../shared/kanban";
import { useLinkedAgentStatus } from "./use-linked-agent-status";
import { useI18n } from "./i18n";

type PluginTheme = PluginSurfaceProps["theme"];

export interface CardAgentBadgeProps {
  link: TaskAgentLink;
  theme: PluginTheme;
  onOpenAgent?: (agentId: string) => void;
  styles: {
    agentBadge: object;
    agentBadgeDot: object;
    agentBadgeText: object;
  };
}

// Live status badge for a linked agent. Rendered only for cards that carry a
// link, so the tracking hook never runs for ordinary cards. A loading or
// missing agent degrades to the closed state instead of hiding the badge,
// keeping the link discoverable.
export function CardAgentBadge({
  link,
  theme,
  onOpenAgent,
  styles,
}: CardAgentBadgeProps) {
  const { t } = useI18n();
  const state = useLinkedAgentStatus(link.agentId);

  const badge = useMemo(() => {
    const muted = theme.colors.foregroundMuted;
    if (state.kind === "gone" || state.kind === "loading") {
      return { key: "closed", color: muted } as const;
    }
    if (state.status === "closed") {
      return { key: "closed", color: muted } as const;
    }
    if (state.status === "error") {
      return { key: "error", color: theme.colors.statusDanger } as const;
    }
    if (state.requiresAttention) {
      return {
        key: "attention",
        color: theme.colors.statusWarning ?? theme.colors.accent,
      } as const;
    }
    if (state.status === "running" || state.status === "initializing") {
      return { key: "running", color: theme.colors.accent } as const;
    }
    return {
      key: "finished",
      color: theme.colors.statusSuccess ?? theme.colors.accent,
    } as const;
  }, [state, theme]);

  const label = {
    running: t("agent.statusRunning"),
    attention: t("agent.statusAttention"),
    error: t("agent.statusError"),
    finished: t("agent.statusFinished"),
    closed: t("agent.statusClosed"),
  }[badge.key];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("agent.openLinked")}
      hitSlop={6}
      onTouchStart={(event) => event.stopPropagation()}
      onPress={() => onOpenAgent?.(link.agentId)}
      style={[styles.agentBadge, { borderColor: badge.color }]}
    >
      <View style={[styles.agentBadgeDot, { backgroundColor: badge.color }]} />
      <Text style={[styles.agentBadgeText, { color: badge.color }]}>
        {label}
      </Text>
    </Pressable>
  );
}
