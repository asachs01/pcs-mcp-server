import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PcoClient } from "../pco/client.js";
import type { Logger } from "../logger.js";
import type { AppConfig } from "../config.js";

export interface ToolContext {
  pco: PcoClient;
  logger: Logger;
  config: AppConfig;
}

export interface ToolModule {
  register(server: McpServer, ctx: ToolContext): void;
}

// Lazy-load each domain module on first server boot. Modules are tiny enough
// that we currently load them all at startup, but the indirection here lets
// us defer to true lazy-import later if startup latency becomes a concern.
const loaders: Record<string, () => Promise<ToolModule>> = {
  pcs_info: async () => (await import("./info.js")).default,
  plan_services: async () => (await import("./plans.js")).default,
  manage_songs: async () => (await import("./songs.js")).default,
  manage_team: async () => (await import("./team.js")).default,
};

export async function registerAllTools(server: McpServer, ctx: ToolContext): Promise<void> {
  for (const [name, loader] of Object.entries(loaders)) {
    const mod = await loader();
    ctx.logger.debug("registering tool", { name });
    mod.register(server, ctx);
  }
}
