import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext, ToolModule } from "./registry.js";
import type { JsonApiCollection, JsonApiSingle, PlanAttrs, ServiceTypeAttrs } from "../pco/types.js";
import { elicitServiceType, unsupportedElicitationError } from "../elicitation/helpers.js";

const InputSchema = {
  action: z
    .enum(["list_plans", "get_plan", "get_plan_items", "create_plan", "update_plan", "reorder_items"])
    .describe("Which plan action to perform."),
  serviceTypeId: z.string().optional().describe("Service type whose plans to list."),
  planId: z.string().optional().describe("Plan ID for get_plan / get_plan_items / update_plan / reorder_items."),
  startDate: z.string().optional().describe("ISO date — filter plans on/after."),
  endDate: z.string().optional().describe("ISO date — filter plans on/before."),
  limit: z.number().int().positive().max(100).optional().describe("Page size, default 25."),
  title: z.string().optional().describe("Title for create_plan / update_plan."),
  date: z.string().optional().describe("ISO date for create_plan / update_plan."),
  itemIds: z.array(z.string()).optional().describe("Ordered item IDs for reorder_items."),
};

/**
 * Helper to resolve service type ID with elicitation fallback
 */
async function resolveServiceType(
  server: McpServer,
  ctx: ToolContext,
  providedId: string | undefined
) {
  const effectiveId = providedId ?? ctx.config.defaults.serviceTypeId;
  if (effectiveId) {
    return { serviceTypeId: effectiveId };
  }

  // No service type provided and no default - attempt elicitation
  const res = await ctx.pco.get<JsonApiCollection<ServiceTypeAttrs>>(
    "/services/v2/service_types",
    { per_page: 20 }
  );

  if (res.data.length === 1) {
    // Single service type - use it silently
    return { serviceTypeId: res.data[0]!.id };
  }

  if (res.data.length > 1) {
    // Multiple service types - elicit choice
    const serviceTypes = res.data.map(st => ({ id: st.id, name: st.attributes.name }));
    const elicitResult = await elicitServiceType(server, serviceTypes);

    if (elicitResult.status === "accepted") {
      return { serviceTypeId: elicitResult.value };
    }
    if (elicitResult.status === "declined" || elicitResult.status === "cancelled") {
      return { error: errorResult("Operation cancelled.") };
    }
    if (elicitResult.status === "unsupported") {
      return { error: unsupportedElicitationError("serviceTypeId", "Call pcs_info action=list_service_types to discover IDs.") };
    }
  }

  // No service types found
  return { error: errorResult("No service types found.") };
}

const tool: ToolModule = {
  register(server: McpServer, ctx: ToolContext) {
    server.registerTool(
      "plan_services",
      {
        title: "Planning Center plans",
        description:
          "Work with service plans — list upcoming plans, fetch a specific plan, get its line items, create/update plans, or reorder items.",
        inputSchema: InputSchema,
      },
      async ({ action, serviceTypeId, planId, startDate, endDate, limit, title, date, itemIds }) => {
        switch (action) {
          case "list_plans": {
            const resolved = await resolveServiceType(server, ctx, serviceTypeId);
            if (resolved.error) return resolved.error;
            const effectiveServiceType = resolved.serviceTypeId;

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
            const resolved = await resolveServiceType(server, ctx, serviceTypeId);
            if (resolved.error) return resolved.error;
            const effectiveServiceType = resolved.serviceTypeId;

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
            const resolved = await resolveServiceType(server, ctx, serviceTypeId);
            if (resolved.error) return resolved.error;
            const effectiveServiceType = resolved.serviceTypeId;

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
          case "create_plan": {
            const resolved = await resolveServiceType(server, ctx, serviceTypeId);
            if (resolved.error) return resolved.error;
            const effectiveServiceType = resolved.serviceTypeId;

            const body: any = {
              data: {
                type: "Plan",
                attributes: {}
              }
            };

            if (title) body.data.attributes.title = title;
            if (date) body.data.attributes.dates = date;

            const res = await ctx.pco.post<JsonApiSingle<PlanAttrs>>(
              `/services/v2/service_types/${effectiveServiceType}/plans`,
              body
            );

            return textResult({
              id: res.data.id,
              title: res.data.attributes.title,
              dates: res.data.attributes.dates,
              sortDate: res.data.attributes.sort_date,
              url: res.data.attributes.planning_center_url,
            });
          }
          case "update_plan": {
            if (!planId) return errorResult("planId is required for update_plan.");
            const resolved = await resolveServiceType(server, ctx, serviceTypeId);
            if (resolved.error) return resolved.error;
            const effectiveServiceType = resolved.serviceTypeId;

            const body: any = {
              data: {
                type: "Plan",
                attributes: {}
              }
            };

            if (title !== undefined) body.data.attributes.title = title;
            if (date !== undefined) body.data.attributes.dates = date;

            const res = await ctx.pco.patch<JsonApiSingle<PlanAttrs>>(
              `/services/v2/service_types/${effectiveServiceType}/plans/${planId}`,
              body
            );

            return textResult({
              id: res.data.id,
              title: res.data.attributes.title,
              dates: res.data.attributes.dates,
              sortDate: res.data.attributes.sort_date,
              url: res.data.attributes.planning_center_url,
            });
          }
          case "reorder_items": {
            if (!planId) return errorResult("planId is required for reorder_items.");
            if (!itemIds || itemIds.length === 0) return errorResult("itemIds array is required for reorder_items.");
            const resolved = await resolveServiceType(server, ctx, serviceTypeId);
            if (resolved.error) return resolved.error;
            const effectiveServiceType = resolved.serviceTypeId;

            // Use PCO's dedicated sort endpoint
            const body = {
              data: {
                type: "PlanItemSortAction",
                attributes: {
                  sequence: itemIds
                }
              }
            };

            await ctx.pco.post(
              `/services/v2/service_types/${effectiveServiceType}/plans/${planId}/items/sort_items`,
              body
            );

            return textResult({
              success: true,
              message: `Reordered ${itemIds.length} items`,
              sequence: itemIds
            });
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
