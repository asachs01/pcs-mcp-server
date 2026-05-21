import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext, ToolModule } from "./registry.js";
import type { JsonApiCollection, JsonApiSingle, PersonAttrs } from "../pco/types.js";
import type { TeamMemberAttrs, PlanPersonAttrs, BlockoutAttrs } from "../pco/team.types.js";

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
  serviceTypeId: z.string().optional().describe("Service type ID (uses default if not provided)."),
  teamId: z.string().optional().describe("Team ID for list_team_members, assign_person."),
  planId: z.string().optional().describe("Plan ID for list_plan_people, assign_person, send_scheduling_request, accept_decline."),
  personId: z.string().optional().describe("Person ID for assign_person, check_availability, send_scheduling_request, accept_decline."),
  positionName: z.string().optional().describe("Team position name for assign_person (optional)."),
  date: z.string().optional().describe("Date (ISO 8601) for check_availability."),
  status: z.enum(["accepted", "declined"]).optional().describe("Status for accept_decline action."),
  planPersonId: z.string().optional().describe("Plan person ID for send_scheduling_request, accept_decline."),
};

const tool: ToolModule = {
  register(server: McpServer, ctx: ToolContext) {
    server.registerTool(
      "manage_team",
      {
        title: "Planning Center team scheduling",
        description:
          "Assign people to plans, check availability, and manage scheduling notifications.",
        inputSchema: InputSchema,
      },
      async ({ action, serviceTypeId, teamId, planId, personId, positionName, date, status, planPersonId }) => {
        const effectiveServiceType = serviceTypeId ?? ctx.config.defaults.serviceTypeId;

        switch (action) {
          case "list_team_members": {
            if (!teamId) return errorResult("teamId is required for list_team_members.");
            if (!effectiveServiceType) {
              return errorResult("serviceTypeId is required (or set PCO_DEFAULT_SERVICE_TYPE_ID).");
            }

            const res = await ctx.pco.get<JsonApiCollection<PersonAttrs & TeamMemberAttrs>>(
              `/services/v2/service_types/${effectiveServiceType}/teams/${teamId}/people`,
              { per_page: 100 },
            );

            return textResult(
              res.data.map((p) => ({
                id: p.id,
                name: p.attributes.name,
                first_name: p.attributes.first_name,
                last_name: p.attributes.last_name,
                status: p.attributes.status,
                photo_url: p.attributes.photo_url,
                preferred_app: p.attributes.preferred_app,
              })),
            );
          }

          case "list_plan_people": {
            if (!planId) return errorResult("planId is required for list_plan_people.");
            if (!effectiveServiceType) {
              return errorResult("serviceTypeId is required (or set PCO_DEFAULT_SERVICE_TYPE_ID).");
            }

            const res = await ctx.pco.get<JsonApiCollection<PlanPersonAttrs>>(
              `/services/v2/service_types/${effectiveServiceType}/plans/${planId}/team_members`,
              {
                include: "person,team_position_name",
                per_page: 100,
              },
            );

            return textResult(
              res.data.map((pp) => ({
                id: pp.id,
                status: pp.attributes.status,
                name: pp.attributes.name,
                team_position_name: pp.attributes.team_position_name,
                can_accept_partial: pp.attributes.can_accept_partial,
                prepare_notification: pp.attributes.prepare_notification,
              })),
            );
          }

          case "assign_person": {
            if (!planId) return errorResult("planId is required for assign_person.");
            if (!personId) return errorResult("personId is required for assign_person.");
            if (!teamId) return errorResult("teamId is required for assign_person.");
            if (!effectiveServiceType) {
              return errorResult("serviceTypeId is required (or set PCO_DEFAULT_SERVICE_TYPE_ID).");
            }

            const body: any = {
              data: {
                type: "PlanPerson",
                attributes: {},
                relationships: {
                  person: {
                    data: {
                      type: "Person",
                      id: personId,
                    },
                  },
                  team: {
                    data: {
                      type: "Team",
                      id: teamId,
                    },
                  },
                },
              },
            };

            if (positionName) {
              body.data.attributes.team_position_name = positionName;
            }

            const res = await ctx.pco.post<JsonApiSingle<PlanPersonAttrs>>(
              `/services/v2/service_types/${effectiveServiceType}/plans/${planId}/team_members`,
              body,
            );

            return textResult({
              id: res.data.id,
              status: res.data.attributes.status,
              name: res.data.attributes.name,
              team_position_name: res.data.attributes.team_position_name,
            });
          }

          case "check_availability": {
            if (!personId) return errorResult("personId is required for check_availability.");
            if (!date) return errorResult("date is required for check_availability.");

            // First get person name
            const personRes = await ctx.pco.get<JsonApiSingle<PersonAttrs>>(
              `/services/v2/people/${personId}`,
            );

            // Get blockouts that are in the future and might conflict
            const blockoutsRes = await ctx.pco.get<JsonApiCollection<BlockoutAttrs>>(
              `/services/v2/people/${personId}/blockouts`,
              {
                "filter[future]": "true",
                per_page: 50,
              },
            );

            // Check for conflicts with the given date
            const targetDate = new Date(date);
            const conflictingBlockouts = blockoutsRes.data.filter((b) => {
              const startDate = new Date(b.attributes.starts_at);
              const endDate = new Date(b.attributes.ends_at);
              return targetDate >= startDate && targetDate <= endDate;
            });

            return textResult({
              personId,
              name: personRes.data.attributes.name,
              available: conflictingBlockouts.length === 0,
              conflictingBlockouts: conflictingBlockouts.map((b) => ({
                id: b.id,
                reason: b.attributes.reason,
                starts_at: b.attributes.starts_at,
                ends_at: b.attributes.ends_at,
              })),
            });
          }

          case "send_scheduling_request": {
            if (!planPersonId) return errorResult("planPersonId is required for send_scheduling_request.");
            if (!planId) return errorResult("planId is required for send_scheduling_request.");
            if (!effectiveServiceType) {
              return errorResult("serviceTypeId is required (or set PCO_DEFAULT_SERVICE_TYPE_ID).");
            }

            // PCO uses status change to send scheduling requests
            // Status "U" = unconfirmed/sent
            const body = {
              data: {
                type: "PlanPerson",
                attributes: {
                  status: "U",
                  notification_changes_to_household: false,
                },
              },
            };

            const res = await ctx.pco.patch<JsonApiSingle<PlanPersonAttrs>>(
              `/services/v2/service_types/${effectiveServiceType}/plans/${planId}/team_members/${planPersonId}`,
              body,
            );

            return textResult({
              id: res.data.id,
              status: res.data.attributes.status,
              name: res.data.attributes.name,
              notification_sent: true,
            });
          }

          case "accept_decline": {
            if (!planPersonId) return errorResult("planPersonId is required for accept_decline.");
            if (!planId) return errorResult("planId is required for accept_decline.");
            if (!status) return errorResult("status is required for accept_decline.");
            if (!effectiveServiceType) {
              return errorResult("serviceTypeId is required (or set PCO_DEFAULT_SERVICE_TYPE_ID).");
            }

            // Map human-readable status to PCO codes
            const pcoStatus = status === "accepted" ? "C" : "D"; // C=confirmed, D=declined

            const body = {
              data: {
                type: "PlanPerson",
                attributes: {
                  status: pcoStatus,
                },
              },
            };

            const res = await ctx.pco.patch<JsonApiSingle<PlanPersonAttrs>>(
              `/services/v2/service_types/${effectiveServiceType}/plans/${planId}/team_members/${planPersonId}`,
              body,
            );

            return textResult({
              id: res.data.id,
              status: res.data.attributes.status,
              name: res.data.attributes.name,
              action_result: status,
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
