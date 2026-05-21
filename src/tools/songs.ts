import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext, ToolModule } from "./registry.js";
import type { JsonApiCollection, JsonApiSingle } from "../pco/types.js";
import type { SongAttrs, ArrangementAttrs } from "../pco/songs.types.js";

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
  query: z.string().optional().describe("Search query for song title."),
  author: z.string().optional().describe("Filter songs by author."),
  ccliNumber: z.string().optional().describe("Filter songs by CCLI number."),
  songId: z.string().optional().describe("Song ID for get_song_details, list_arrangements, add_song_to_plan."),
  serviceTypeId: z.string().optional().describe("Service type ID (uses default if not provided)."),
  planId: z.string().optional().describe("Plan ID for add_song_to_plan, set_song_key, remove_song."),
  planItemId: z.string().optional().describe("Plan item ID for set_song_key, remove_song."),
  arrangementId: z.string().optional().describe("Arrangement ID for add_song_to_plan (optional)."),
  key: z.string().optional().describe("Key name (e.g., 'D', 'Bb', 'F#m') for add_song_to_plan, set_song_key."),
  position: z.number().int().positive().optional().describe("Position in plan for add_song_to_plan (optional)."),
};

const tool: ToolModule = {
  register(server: McpServer, ctx: ToolContext) {
    server.registerTool(
      "manage_songs",
      {
        title: "Planning Center songs",
        description:
          "Search the song library, inspect arrangements, and add/remove/key songs in service plans.",
        inputSchema: InputSchema,
      },
      async ({ action, query, author, ccliNumber, songId, serviceTypeId, planId, planItemId, arrangementId, key, position }) => {
        const effectiveServiceType = serviceTypeId ?? ctx.config.defaults.serviceTypeId;

        switch (action) {
          case "search_songs": {
            if (!query && !author && !ccliNumber) {
              return errorResult("At least one of query, author, or ccliNumber is required for search_songs.");
            }

            const params: Record<string, string | number | undefined> = {
              per_page: 50,
            };

            if (query) params["where[title]"] = query;
            if (author) params["where[author]"] = author;
            if (ccliNumber) params["where[ccli_number]"] = ccliNumber;

            const res = await ctx.pco.get<JsonApiCollection<SongAttrs>>(
              "/services/v2/songs",
              params,
            );

            return textResult(
              res.data.map((s) => ({
                id: s.id,
                title: s.attributes.title,
                author: s.attributes.author,
                ccli_number: s.attributes.ccli_number,
                themes: s.attributes.themes,
              })),
            );
          }

          case "get_song_details": {
            if (!songId) return errorResult("songId is required for get_song_details.");

            const res = await ctx.pco.get<JsonApiSingle<SongAttrs>>(
              `/services/v2/songs/${songId}`,
            );

            return textResult({
              id: res.data.id,
              title: res.data.attributes.title,
              author: res.data.attributes.author,
              ccli_number: res.data.attributes.ccli_number,
              themes: res.data.attributes.themes,
              admin: res.data.attributes.admin,
              created_at: res.data.attributes.created_at,
              updated_at: res.data.attributes.updated_at,
            });
          }

          case "list_arrangements": {
            if (!songId) return errorResult("songId is required for list_arrangements.");

            const res = await ctx.pco.get<JsonApiCollection<ArrangementAttrs>>(
              `/services/v2/songs/${songId}/arrangements`,
              { per_page: 100 },
            );

            return textResult(
              res.data.map((a) => ({
                id: a.id,
                name: a.attributes.name,
                bpm: a.attributes.bpm,
                length: a.attributes.length,
                chord_chart_key: a.attributes.chord_chart_key,
              })),
            );
          }

          case "add_song_to_plan": {
            if (!planId) return errorResult("planId is required for add_song_to_plan.");
            if (!songId) return errorResult("songId is required for add_song_to_plan.");
            if (!effectiveServiceType) {
              return errorResult("serviceTypeId is required (or set PCO_DEFAULT_SERVICE_TYPE_ID).");
            }

            const body: any = {
              data: {
                type: "Item",
                attributes: {
                  item_type: "song",
                },
                relationships: {
                  song: {
                    data: {
                      type: "Song",
                      id: songId,
                    },
                  },
                },
              },
            };

            if (arrangementId) {
              body.data.relationships.arrangement = {
                data: {
                  type: "Arrangement",
                  id: arrangementId,
                },
              };
            }

            if (key) {
              body.data.attributes.key_name = key;
            }

            if (position !== undefined) {
              body.data.attributes.sequence = position;
            }

            const res = await ctx.pco.post<JsonApiSingle<{ item_type: string; sequence: number }>>(
              `/services/v2/service_types/${effectiveServiceType}/plans/${planId}/items`,
              body,
            );

            return textResult({
              id: res.data.id,
              item_type: res.data.attributes.item_type,
              sequence: res.data.attributes.sequence,
            });
          }

          case "set_song_key": {
            if (!planItemId) return errorResult("planItemId is required for set_song_key.");
            if (!key) return errorResult("key is required for set_song_key.");
            if (!planId) return errorResult("planId is required for set_song_key.");
            if (!effectiveServiceType) {
              return errorResult("serviceTypeId is required (or set PCO_DEFAULT_SERVICE_TYPE_ID).");
            }

            const body = {
              data: {
                type: "Item",
                attributes: {
                  key_name: key,
                },
              },
            };

            const res = await ctx.pco.patch<JsonApiSingle<{ key_name: string | null }>>(
              `/services/v2/service_types/${effectiveServiceType}/plans/${planId}/items/${planItemId}`,
              body,
            );

            return textResult({
              id: res.data.id,
              key_name: res.data.attributes.key_name,
            });
          }

          case "remove_song": {
            if (!planItemId) return errorResult("planItemId is required for remove_song.");
            if (!planId) return errorResult("planId is required for remove_song.");
            if (!effectiveServiceType) {
              return errorResult("serviceTypeId is required (or set PCO_DEFAULT_SERVICE_TYPE_ID).");
            }

            await ctx.pco.delete(
              `/services/v2/service_types/${effectiveServiceType}/plans/${planId}/items/${planItemId}`,
            );

            return textResult({ success: true, deleted_item_id: planItemId });
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
