import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const agentLaunchSettings = defineSettings({
  id: "agent-launch",
  scope: "host",
  version: 1,
  schema: z.object({
    agent: z.string().nullable().default(null),
    target: z.enum(["worktree", "workspace"]).nullable().default(null),
  }),
});
