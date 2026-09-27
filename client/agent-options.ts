import type { PaseoAgentConfig, PaseoApi } from "@getpaseo/client";

export interface AgentOption {
  value: string;
  label: string;
  config: PaseoAgentConfig;
}

export interface AgentOptionsResult {
  options: AgentOption[];
  loading: boolean;
}

// Adapted from paseo-github-kanban (MIT): the user's agent profiles first
// (they carry mode and thinking level), then every model of every ready
// provider, default model first.
export async function loadAgentOptions(
  paseo: PaseoApi,
  cwd: string,
): Promise<AgentOptionsResult> {
  const [{ config }, { entries }] = await Promise.all([
    paseo.config.get(),
    paseo.providers.snapshot({ cwd }),
  ]);
  const ready = entries.filter(
    (entry) => entry.enabled !== false && entry.status === "ready",
  );
  const readyIds = new Set(ready.map((entry) => entry.provider));
  const profiles: AgentOption[] = (config.agentProfiles ?? [])
    .filter((profile) => readyIds.has(profile.provider))
    .map((profile) => ({
      value: `profile:${profile.id}`,
      label: profile.name,
      config: {
        provider: profile.model
          ? `${profile.provider}/${profile.model}`
          : profile.provider,
        modeId: profile.modeId,
        thinkingOptionId: profile.thinkingOptionId,
        featureValues: profile.featureValues,
      },
    }));
  const models: AgentOption[] = ready.flatMap((entry) =>
    (entry.models ?? [])
      .filter((model) => model.isSelectable !== false)
      .sort((a, b) => Number(!!b.isDefault) - Number(!!a.isDefault))
      .map((model) => ({
        value: `model:${entry.provider}/${model.id}`,
        label: `${entry.provider} · ${model.label}`,
        config: { provider: `${entry.provider}/${model.id}` },
      })),
  );
  return {
    options: [...profiles, ...models],
    loading: entries.some((entry) => entry.status === "loading"),
  };
}
