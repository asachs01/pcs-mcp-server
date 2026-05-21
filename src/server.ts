import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { PcoClient } from "./pco/client.js";
import { registerAllTools } from "./tools/registry.js";
import { createAuthProvider, type AppConfig } from "./config.js";
import type { Logger } from "./logger.js";

export async function buildServer(config: AppConfig, logger: Logger): Promise<McpServer> {
  const server = new McpServer(
    {
      name: "pcs-mcp-server",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
        // Elicitation is requested as a *client* capability — server-side, we
        // simply attempt it and gracefully degrade if the client didn't
        // advertise support. No declaration needed here.
      },
      instructions:
        "Planning Center Services MCP server. Use 'pcs_info' to discover service types and teams before calling other tools. All write operations support elicitation for disambiguation.",
    },
  );

  const authProvider = createAuthProvider(config);
  const pco = new PcoClient(authProvider, logger);
  await registerAllTools(server, { pco, logger, config });

  return server;
}
