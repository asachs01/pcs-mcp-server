import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext, ToolModule } from "./registry.js";
import type { JsonApiCollection, JsonApiSingle, PlanAttrs } from "../pco/types.js";

const InputSchema = {
  action: z
    .enum(["list_plans", "get_plan", "get_plan_items"])
    .describe("Which plan action to perform."),
  serviceTypeId: z.string().optional().describe("Service type whose plans to list."),
  planId: z.string().optional().describe("Plan ID for get_plan / get_plan_items."),
  startDate: z.string().optional().describe("ISO date — filter plans on/after."),
  endDate: z.string().optional().describe("ISO date — filter plans on/before."),
  limit: z.number().int().positive().max(100).optional().describe("Page size, default 25."),
};

const tool: ToolModule = {
  register(server: McpServer, ctx: ToolContext) {
    server.registerTool(
      "plan_services",
      {
        title: "Planning Center plans",
        description:
          "Work with service plans — list upcoming plans, fetch a specific plan, or get its line items (songs, headers, media).",
        inputSchema: InputSchema,
      },
      async ({ action, serviceTypeId, planId, startDate, endDate, limit }) => {
        const effectiveServiceType = serviceTypeId ?? ctx.config.defaults.serviceTypeId;

        switch (action) {
          case "list_plans": {
            if (!effectiveServiceType) {
              return errorResult(
                "serviceTypeId is required (or set PCO_DEFAULT_SERVICE_TYPE_ID). Call pcs_info action='list_service_types' to discover IDs.",
              );
            }
            const res = await ctx.pco.get<JsonApiCollection<PlanAttrs>>(
              `/services/v2/service_types/${effectiveServiceType}/plans`,
              {
                "filter[after]": startDate,
                "filter[before]": endDate,
                per_page: limit ?? 25,
                order: "sort_date",
              },
            );
            return textResult(
              res.data.map((p) => ({
                id: p.id,
                title: p.attributes.title,
                dates: p.attributes.dates,
                sortDate: p.attributes.sort_date,
                url: p.attributes.planning_center_url,
              })),
            );
          }
          case "get_plan": {
            if (!planId) return errorResult("planId is required for get_plan.");
            if (!effectiveServiceType) {
              return errorResult("serviceTypeId is required for get_plan.");
            }
            const res = await ctx.pco.get<JsonApiSingle<PlanAttrs>>(
              `/services/v2/service_types/${effectiveServiceType}/plans/${planId}`,
            );
            return textResult({
              id: res.data.id,
              title: res.data.attributes.title,
              dates: res.data.attributes.dates,
              url: res.data.attributes.planning_center_url,
              totalLength: res.data.attributes.total_length,
            });
          }
          case "get_plan_items": {
            if (!planId) return errorResult("planId is required for get_plan_items.");
            if (!effectiveServiceType) {
              return errorResult("serviceTypeId is required for get_plan_items.");
            }
            const res = await ctx.pco.get<
              JsonApiCollection<{
                title: string | null;
                item_type: string;
                sequence: number;
                length: number;
                key_name?: string | null;
              }>
            >(`/services/v2/service_types/${effectiveServiceType}/plans/${planId}/items`, {
              per_page: 100,
            });
            return textResult(
              res.data.map((item) => ({
                id: item.id,
                type: item.attributes.item_type,
                title: item.attributes.title,
                sequence: item.attributes.sequence,
                length: item.attributes.length,
                key: item.attributes.key_name ?? null,
              })),
            );
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
