import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export type ElicitResult<T> =
  | { status: "accepted"; value: T }
  | { status: "declined" }
  | { status: "cancelled" }
  | { status: "unsupported"; reason: string };

/**
 * Elicit a choice from the user with graceful degradation.
 * Falls back to error message if client doesn't support elicitation.
 */
export async function elicitChoice<T extends string>(
  server: McpServer,
  args: {
    message: string;
    title: string;
    options: Array<{ value: T; label: string; description?: string }>
  }
): Promise<ElicitResult<T>> {
  // Check if client supports elicitation - graceful degradation for Cursor/Windsurf
  const capabilities = server.server.getClientCapabilities();
  if (!capabilities?.elicitation) {
    return {
      status: "unsupported",
      reason: "Client does not support interactive prompts"
    };
  }

  try {
    const schema = z.object({
      choice: z.enum(args.options.map(opt => opt.value) as [T, ...T[]]).describe("Selected option")
    });

    const result = await server.server.elicitInput({
      message: args.message,
      requestedSchema: {
        type: "object",
        properties: {
          choice: {
            type: "string",
            title: args.title,
            description: "Choose an option",
            enum: args.options.map(opt => opt.value),
            enumNames: args.options.map(opt => opt.label)
          }
        },
        required: ["choice"]
      }
    });

    if (result.action === "accept") {
      const parsed = schema.parse(result.parameters);
      // Safe assertion since we validate with zod enum constraint
      return { status: "accepted", value: parsed.choice as T };
    } else if (result.action === "decline") {
      return { status: "declined" };
    } else {
      return { status: "cancelled" };
    }
  } catch (error) {
    // Handle any elicitation errors as cancelled
    return { status: "cancelled" };
  }
}

/**
 * Convenience helper for service type selection - the most common elicitation case.
 */
export async function elicitServiceType(
  server: McpServer,
  serviceTypes: Array<{ id: string; name: string }>
): Promise<ElicitResult<string>> {
  return elicitChoice(server, {
    message: "Multiple service types found. Which service should I work with?",
    title: "Select Service Type",
    options: serviceTypes.map(st => ({
      value: st.id,
      label: st.name,
      description: `Service Type ID: ${st.id}`
    }))
  });
}

/**
 * Helper to create a structured error result for unsupported elicitation.
 * Returns the MCP error format that tool handlers can return directly.
 */
export function unsupportedElicitationError(field: string, hint: string) {
  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text: `This client doesn't support interactive prompts. Please pass \`${field}\` explicitly. Hint: ${hint}`
      }
    ]
  };
}