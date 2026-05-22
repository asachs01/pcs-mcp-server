import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext, ToolModule } from "./registry.js";
import type { JsonApiCollection, ServiceTypeAttrs } from "../pco/types.js";

const InputSchema = {
  action: z
    .enum(["list_service_types", "list_teams", "list_tag_groups", "whoami"])
    .describe("Which info action to perform."),
  serviceTypeId: z.string().optional().describe("Required when action='list_teams'."),
};

const tool: ToolModule = {
  register(server: McpServer, ctx: ToolContext) {
    server.registerTool(
      "pcs_info",
      {
        title: "Planning Center info",
        description:
          "Read-only discovery for Planning Center Services: list service types, teams, tag groups, or get the authenticated user.",
        inputSchema: InputSchema,
      },
      async ({ action, serviceTypeId }) => {
        switch (action) {
          case "whoami": {
            const me = await ctx.pco.get<{
              data: { id: string; attributes: { name: string; email_addresses?: unknown } };
            }>("/people/v2/me");
            return textResult({
              id: me.data.id,
              name: me.data.attributes.name,
            });
          }
          case "list_service_types": {
            const res = await ctx.pco.get<JsonApiCollection<ServiceTypeAttrs>>(
              "/services/v2/service_types",
              { per_page: 100 },
            );
            return textResult(
              res.data.map((s) => ({
                id: s.id,
                name: s.attributes.name,
                sequence: s.attributes.sequence,
              })),
            );
          }
          case "list_teams": {
            if (!serviceTypeId) {
              return errorResult("serviceTypeId is required for action='list_teams'.");
            }
            const res = await ctx.pco.get<JsonApiCollection<{ name: string }>>(
              `/services/v2/service_types/${serviceTypeId}/teams`,
              { per_page: 100 },
            );
            return textResult(res.data.map((t) => ({ id: t.id, name: t.attributes.name })));
          }
          case "list_tag_groups": {
            const res = await ctx.pco.get<JsonApiCollection<{ name: string }>>(
              "/services/v2/tag_groups",
              { per_page: 100 },
            );
            return textResult(res.data.map((g) => ({ id: g.id, name: g.attributes.name })));
          }
        }
      },
    );
  },
};

export default tool;

function textResult(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
  };
}

function errorResult(message: string) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: message }],
  };
}
