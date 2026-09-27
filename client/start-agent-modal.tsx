import { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import {
  Modal,
  TextInput,
  ScrollView,
} from "@getpaseo/plugin/client/react-native";
import { SettingsCard, SettingsSelect } from "@getpaseo/plugin/client/ui";
import {
  usePaseo,
  useSettings,
  type PluginSurfaceProps,
} from "@getpaseo/plugin/client";
import type { PaseoWorkspace } from "@getpaseo/client";
import {
  buildAgentPrompt,
  type KanbanTask,
  type TaskAgentLink,
} from "../shared/kanban";
import { agentLaunchSettings } from "../shared/agent-launch";
import { loadAgentOptions, type AgentOption } from "./agent-options";
import type { ProjectItem } from "./use-projects";
import { useI18n } from "./i18n";

type PluginTheme = PluginSurfaceProps["theme"];

type LaunchTarget = "worktree" | "workspace";

export interface StartAgentModalProps {
  open: boolean;
  onClose: () => void;
  task: KanbanTask;
  projects: ProjectItem[];
  defaultWorkspaceId?: string | null;
  theme: PluginTheme;
  layout: { compact: boolean; platform: "ios" | "android" | "web" };
  onStarted: (link: TaskAgentLink) => void;
}

export function StartAgentModal({
  open,
  onClose,
  task,
  projects,
  defaultWorkspaceId,
  theme,
  layout,
  onStarted,
}: StartAgentModalProps) {
  const { t } = useI18n();
  const paseo = usePaseo();
  const remembered = useSettings(agentLaunchSettings);

  const [target, setTarget] = useState<LaunchTarget | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    task.projectId,
  );
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(
    defaultWorkspaceId ?? null,
  );
  const [pickedAgent, setPickedAgent] = useState<string | null>(null);
  const [prompt, setPrompt] = useState(() => buildAgentPrompt(task));
  const [workspaces, setWorkspaces] = useState<PaseoWorkspace[]>([]);
  const [workspacesError, setWorkspacesError] = useState<string | null>(null);
  const [agentOptions, setAgentOptions] = useState<AgentOption[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [agentsError, setAgentsError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const [isStarting, setIsStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  // Seed defaults from the remembered launch settings once they load. Guarded
  // by null-coalescing so a user's in-modal choice is never overwritten.
  useEffect(() => {
    if (remembered.status !== "ready") return;
    const saved = remembered.values;
    setTarget(
      (current) =>
        current ?? saved.target ?? (task.projectId ? "worktree" : "workspace"),
    );
    setPickedAgent((current) => current ?? saved.agent);
  }, [remembered, task.projectId]);

  // Load active workspaces for the workspace target picker.
  useEffect(() => {
    let cancelled = false;
    paseo.workspaces
      .list()
      .then((result) => {
        if (cancelled) return;
        setWorkspaces(result.entries.filter((entry) => !entry.archivingAt));
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setWorkspacesError(
          error instanceof Error ? error.message : String(error),
        );
      });
    return () => {
      cancelled = true;
    };
  }, [paseo]);

  const selectedProject =
    projects.find((p) => p.projectId === selectedProjectId) ?? null;
  const selectedWorkspace =
    workspaces.find((w) => w.id === selectedWorkspaceId) ?? null;

  // Fallback selections once data is in.
  useEffect(() => {
    if (
      selectedProjectId &&
      projects.some((p) => p.projectId === selectedProjectId)
    ) {
      return;
    }
    const fallback = task.projectId ?? projects[0]?.projectId ?? null;
    if (fallback) setSelectedProjectId(fallback);
  }, [projects, selectedProjectId, task.projectId]);

  useEffect(() => {
    if (
      selectedWorkspaceId &&
      workspaces.some((w) => w.id === selectedWorkspaceId)
    ) {
      return;
    }
    const fallback =
      (defaultWorkspaceId && workspaces.some((w) => w.id === defaultWorkspaceId)
        ? defaultWorkspaceId
        : null) ??
      workspaces[0]?.id ??
      null;
    if (fallback) setSelectedWorkspaceId(fallback);
  }, [workspaces, selectedWorkspaceId, defaultWorkspaceId]);

  const targetCwd =
    target === "worktree"
      ? (selectedProject?.projectRootPath ?? null)
      : (selectedWorkspace?.workspaceDirectory ??
        selectedWorkspace?.projectRootPath ??
        null);

  // Load agent options for the selected target directory. Providers that are
  // still loading trigger a single-shot repoll while the modal stays open.
  useEffect(() => {
    if (!targetCwd) {
      setAgentOptions([]);
      setAgentsLoading(false);
      return;
    }
    let cancelled = false;
    setAgentsLoading(true);
    setAgentsError(null);
    loadAgentOptions(paseo, targetCwd)
      .then((result) => {
        if (cancelled) return;
        setAgentOptions(result.options);
        setAgentsLoading(false);
        if (result.loading) {
          setTimeout(() => {
            if (!cancelled) setReloadTick((tick) => tick + 1);
          }, 2000);
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setAgentOptions([]);
        setAgentsLoading(false);
        setAgentsError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [paseo, targetCwd, reloadTick]);

  const agent =
    agentOptions.find((option) => option.value === pickedAgent) ??
    agentOptions[0] ??
    null;

  const canStart =
    !isStarting &&
    target !== null &&
    agent !== null &&
    prompt.trim().length > 0 &&
    (target === "worktree"
      ? selectedProject?.projectRootPath != null
      : selectedWorkspace !== null);

  const handleStart = async () => {
    if (!agent || target === null || isStarting) return;
    setIsStarting(true);
    setStartError(null);
    try {
      let workspaceId: string;
      let workspaceTitle: string;
      let agentId: string;
      if (target === "worktree") {
        if (!selectedProject?.projectRootPath) {
          throw new Error(t("agent.noProjects"));
        }
        // A fresh worktree per task, so several agents can work the board at once.
        const workspace = await paseo.workspaces.create({
          title: task.title,
          source: {
            kind: "worktree",
            cwd: selectedProject.projectRootPath,
            projectId: selectedProject.projectId,
            action: "branch-off",
          },
          firstAgentContext: { prompt },
        });
        const created = await workspace.agents.create({
          config: agent.config,
          prompt,
        });
        workspaceId = workspace.id;
        workspaceTitle = task.title;
        agentId = created.id;
      } else {
        if (!selectedWorkspace) {
          throw new Error(t("agent.noWorkspaces"));
        }
        const created = await paseo.workspaces
          .ref(selectedWorkspace.id)
          .agents.create({ config: agent.config, prompt });
        workspaceId = selectedWorkspace.id;
        workspaceTitle = selectedWorkspace.title ?? selectedWorkspace.name;
        agentId = created.id;
      }
      if (remembered.status === "ready") {
        void remembered.save(
          { agent: agent.value, target },
          remembered.revision,
        );
      }
      onStarted({
        agentId,
        workspaceId,
        workspaceTitle,
        provider: agent.config.provider,
        target,
        startedAt: new Date().toISOString(),
        advanced: false,
      });
    } catch (error) {
      setStartError(error instanceof Error ? error.message : String(error));
      setIsStarting(false);
    }
  };

  const styles = useMemo(
    () =>
      StyleSheet.create({
        modalBody: {
          flex: 1,
          minHeight: 0,
        },
        scrollBody: {
          flex: 1,
          minHeight: 0,
        },
        container: {
          gap: layout.compact ? 12 : 16,
        },
        fieldGroup: {
          gap: 6,
        },
        label: {
          fontSize: 13,
          fontWeight: "600",
          color: theme.colors.foreground,
        },
        selectorRow: {
          flexDirection: "row",
          flexWrap: "wrap",
          gap: 8,
        },
        optionChip: {
          paddingHorizontal: 10,
          paddingVertical: 6,
          borderRadius: 6,
          borderWidth: 1,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surface1,
        },
        optionChipSelected: {
          borderColor: theme.colors.accent,
          backgroundColor: theme.colors.accent,
        },
        optionChipText: {
          fontSize: 13,
          color: theme.colors.foreground,
        },
        optionChipTextSelected: {
          color: theme.colors.accentForeground,
          fontWeight: "600",
        },
        hintText: {
          fontSize: 12,
          color: theme.colors.foregroundMuted,
        },
        multilineInput: {
          backgroundColor: theme.colors.surface2,
          color: theme.colors.foreground,
          borderColor: theme.colors.border,
          borderWidth: 1,
          borderRadius: 8,
          paddingHorizontal: 12,
          paddingVertical: 8,
          fontSize: 14,
          minHeight: 100,
          textAlignVertical: "top",
        },
        loadingRow: {
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
        },
        errorBanner: {
          backgroundColor: theme.colors.surface2,
          borderColor: theme.colors.statusDanger,
          borderWidth: 1,
          borderRadius: 8,
          padding: 10,
        },
        errorText: {
          color: theme.colors.statusDanger,
          fontSize: 13,
        },
        buttonRow: {
          flexDirection: "row",
          justifyContent: "flex-end",
          gap: 10,
          marginTop: 10,
        },
        cancelButton: {
          paddingHorizontal: 16,
          paddingVertical: 10,
          borderRadius: 8,
          borderWidth: 1,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surface1,
        },
        cancelButtonText: {
          color: theme.colors.foreground,
          fontSize: 14,
        },
        startButton: {
          paddingHorizontal: 18,
          paddingVertical: 10,
          borderRadius: 8,
          backgroundColor: theme.colors.accent,
        },
        startButtonDisabled: {
          opacity: 0.6,
        },
        startButtonText: {
          color: theme.colors.accentForeground,
          fontSize: 14,
          fontWeight: "600",
        },
      }),
    [theme, layout.compact],
  );

  const targetOptions: { id: LaunchTarget; label: string }[] = [
    { id: "worktree", label: t("agent.targetWorktree") },
    { id: "workspace", label: t("agent.targetWorkspace") },
  ];

  return (
    <Modal
      title={t("agent.startModalTitle")}
      open={open}
      onOpenChange={(next) => {
        if (!next && !isStarting) {
          onClose();
        }
      }}
    >
      <Modal.Content
        scrollable={false}
        style={{ backgroundColor: theme.colors.surface0 }}
        contentContainerStyle={styles.modalBody}
      >
        <ScrollView
          style={styles.scrollBody}
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
        >
          {(startError || workspacesError || agentsError) && (
            <View style={styles.errorBanner}>
              <Text style={styles.errorText}>
                {startError
                  ? t("agent.startFailed", { error: startError })
                  : workspacesError
                    ? t("agent.workspacesLoadFailed", {
                        error: workspacesError,
                      })
                    : t("agent.loadingAgents")}
              </Text>
            </View>
          )}

          <View style={styles.fieldGroup}>
            <Text style={styles.label}>{t("agent.targetLabel")}</Text>
            <View style={styles.selectorRow}>
              {targetOptions.map((option) => {
                const isSelected = target === option.id;
                return (
                  <Pressable
                    key={option.id}
                    onPress={() => setTarget(option.id)}
                    style={[
                      styles.optionChip,
                      isSelected && styles.optionChipSelected,
                    ]}
                  >
                    <Text
                      style={[
                        styles.optionChipText,
                        isSelected && styles.optionChipTextSelected,
                      ]}
                    >
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {target === "worktree" && (
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>{t("agent.projectLabel")}</Text>
              {projects.length === 0 ? (
                <Text style={styles.hintText}>{t("agent.noProjects")}</Text>
              ) : (
                <View style={styles.selectorRow}>
                  {projects.map((proj) => {
                    const isSelected = proj.projectId === selectedProjectId;
                    return (
                      <Pressable
                        key={proj.projectId}
                        onPress={() => setSelectedProjectId(proj.projectId)}
                        style={[
                          styles.optionChip,
                          isSelected && styles.optionChipSelected,
                        ]}
                      >
                        <Text
                          style={[
                            styles.optionChipText,
                            isSelected && styles.optionChipTextSelected,
                          ]}
                        >
                          {proj.projectDisplayName}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </View>
          )}

          {target === "workspace" && (
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>{t("agent.workspaceLabel")}</Text>
              {workspaces.length === 0 ? (
                <Text style={styles.hintText}>{t("agent.noWorkspaces")}</Text>
              ) : (
                <View style={styles.selectorRow}>
                  {workspaces.map((workspace) => {
                    const isSelected = workspace.id === selectedWorkspaceId;
                    return (
                      <Pressable
                        key={workspace.id}
                        onPress={() => setSelectedWorkspaceId(workspace.id)}
                        style={[
                          styles.optionChip,
                          isSelected && styles.optionChipSelected,
                        ]}
                      >
                        <Text
                          style={[
                            styles.optionChipText,
                            isSelected && styles.optionChipTextSelected,
                          ]}
                        >
                          {workspace.title ?? workspace.name}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </View>
          )}

          {agentsLoading && agentOptions.length === 0 ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color={theme.colors.accent} />
              <Text style={styles.hintText}>{t("agent.loadingAgents")}</Text>
            </View>
          ) : agent ? (
            <SettingsCard>
              <SettingsSelect
                label={t("agent.agentLabel")}
                hint={t("agent.agentHint")}
                value={agent.value}
                options={agentOptions}
                onValueChange={setPickedAgent}
              />
            </SettingsCard>
          ) : (
            <Text style={styles.hintText}>{t("agent.noReadyAgents")}</Text>
          )}

          <View style={styles.fieldGroup}>
            <Text style={styles.label}>{t("agent.promptLabel")}</Text>
            <TextInput
              style={styles.multilineInput}
              multiline
              value={prompt}
              onChangeText={setPrompt}
              placeholderTextColor={theme.colors.foregroundMuted}
            />
          </View>

          <View style={styles.buttonRow}>
            <Pressable
              onPress={onClose}
              style={styles.cancelButton}
              disabled={isStarting}
            >
              <Text style={styles.cancelButtonText}>
                {t("taskModal.cancel")}
              </Text>
            </Pressable>

            <Pressable
              onPress={() => void handleStart()}
              style={[
                styles.startButton,
                !canStart && styles.startButtonDisabled,
              ]}
              disabled={!canStart}
            >
              <Text style={styles.startButtonText}>
                {isStarting ? t("agent.starting") : t("agent.start")}
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </Modal.Content>
    </Modal>
  );
}
