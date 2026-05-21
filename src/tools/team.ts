import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext, ToolModule } from "./registry.js";

const InputSchema = {
  action: z
    .enum([
      "list_team_members",
      "list_plan_people",
      "assign_person",
      "check_availability",
      "send_scheduling_request",
      "accept_decline",
    ])
    .describe("Which team action to perform."),
  serviceTypeId: z.string().optional(),
  teamId: z.string().optional(),
  planId: z.string().optional(),
  personId: z.string().optional(),
  positionName: z.string().optional(),
  date: z.string().optional(),
  status: z.enum(["accepted", "declined"]).optional(),
};

// Placeholder — Phase 3.
const tool: ToolModule = {
  register(server: McpServer, ctx: ToolContext) {
    server.registerTool(
      "manage_team",
      {
        title: "Planning Center team scheduling",
        description:
          "Assign people to plans, check availability, and manage scheduling notifications. (Phase 3 — not yet implemented.)",
        inputSchema: InputSchema,
      },
      async ({ action }) => {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `manage_team action '${action}' is not yet implemented (Phase 3). Track progress in .taskmaster/tasks/.`,
            },
          ],
        };
      },
    );
  },
};

export default tool;
