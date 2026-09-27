import type { PluginServerContext } from "@getpaseo/plugin/server";
import { kanbanSettings } from "./shared/kanban";
import { agentLaunchSettings } from "./shared/agent-launch";

export default function contribute(server: PluginServerContext) {
  server.registerSettings(kanbanSettings);
  server.registerSettings(agentLaunchSettings);
  return () => {};
}
