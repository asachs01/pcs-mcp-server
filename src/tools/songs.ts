import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext, ToolModule } from "./registry.js";

const InputSchema = {
  action: z
    .enum([
      "search_songs",
      "get_song_details",
      "list_arrangements",
      "add_song_to_plan",
      "set_song_key",
      "remove_song",
    ])
    .describe("Which song action to perform."),
  // Phase 2 will flesh these out per-action.
  query: z.string().optional(),
  songId: z.string().optional(),
  planId: z.string().optional(),
  planItemId: z.string().optional(),
  arrangementId: z.string().optional(),
  key: z.string().optional(),
};

// Placeholder — implementation lands in Phase 2 (tasks #15, #16).
const tool: ToolModule = {
  register(server: McpServer, ctx: ToolContext) {
    server.registerTool(
      "manage_songs",
      {
        title: "Planning Center songs",
        description:
          "Search the song library, inspect arrangements, and add/remove/key songs in service plans. (Phase 2 — not yet implemented.)",
        inputSchema: InputSchema,
      },
      async ({ action }) => {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `manage_songs action '${action}' is not yet implemented (Phase 2). Track progress in .taskmaster/tasks/.`,
            },
          ],
        };
      },
    );
  },
};

export default tool;
