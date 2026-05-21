import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// Workers environment interface
interface Env {
  PCO_PAT_APP_ID?: string;
  PCO_PAT_SECRET?: string;
  PCO_OAUTH_CLIENT_ID?: string;
  PCO_OAUTH_CLIENT_SECRET?: string;
  PCO_OAUTH_REDIRECT_URI?: string;
  PCO_DEFAULT_SERVICE_TYPE_ID?: string;
  LOG_LEVEL?: string;
}

// In-memory session storage per isolate
const transports = new Map<string, StreamableHTTPServerTransport>();

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Health check endpoint
    if (url.pathname === "/health") {
      return Response.json({
        status: "ok",
        service: "pcs-mcp-server",
        runtime: "cloudflare-workers"
      });
    }

    // MCP endpoint handling
    if (url.pathname === "/mcp") {
      return handleMcpRequest(request, env);
    }

    return new Response("Not found", { status: 404 });
  }
};

async function handleMcpRequest(request: Request, env: Env): Promise<Response> {
  try {
    // Check if we have the required credentials
    const credentialsError = validateCredentials(env);
    if (credentialsError) {
      return Response.json({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Configuration error",
          data: { details: credentialsError }
        },
        id: null,
      }, { status: 503 });
    }

    if (request.method === "POST") {
      return handlePostRequest(request, env);
    } else if (request.method === "GET") {
      return handleGetRequest(request);
    } else if (request.method === "DELETE") {
      return handleDeleteRequest(request);
    }

    return new Response("Method not allowed", { status: 405 });
  } catch (error) {
    console.error("Worker error:", error);
    return Response.json({
      jsonrpc: "2.0",
      error: {
        code: -32603,
        message: "Internal error",
        data: { details: error instanceof Error ? error.message : String(error) }
      },
      id: null,
    }, { status: 500 });
  }
}

async function handlePostRequest(request: Request, env: Env): Promise<Response> {
  const sessionId = request.headers.get("mcp-session-id");
  let transport: StreamableHTTPServerTransport | undefined;

  const body = await request.json();

  if (sessionId && transports.has(sessionId)) {
    transport = transports.get(sessionId);
  } else if (!sessionId && isInitializeRequest(body)) {
    // Return an error indicating Workers limitations
    return Response.json({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Planning Center client requires Node.js environment",
        data: {
          details: "This Cloudflare Workers deployment cannot access Planning Center APIs due to undici dependency. Use the Node.js version for full functionality.",
          workerRuntime: "cloudflare-workers",
          limitedMode: true
        }
      },
      id: (body as any).id || null,
    }, { status: 503 });
  } else {
    return Response.json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Missing or invalid session" },
      id: null,
    }, { status: 400 });
  }

  // This code path won't be reached in practice due to the undici limitation above,
  // but shows how it would work if we had a fetch-compatible client
  if (!transport) {
    return Response.json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Transport not found" },
      id: null,
    }, { status: 400 });
  }

  // Convert Request/Response to the format expected by StreamableHTTPServerTransport
  // This is a simplified adapter - full implementation would need more careful stream handling
  const mockReq = {
    header: (name: string) => request.headers.get(name),
    body
  };

  const mockRes = {
    status: (code: number) => ({ json: (data: any) => Response.json(data, { status: code }) }),
    json: (data: any) => Response.json(data),
    setHeader: () => {},
    write: () => {},
    end: () => {}
  };

  try {
    await transport.handleRequest(mockReq as any, mockRes as any, body);
    return new Response("OK");
  } catch (error) {
    console.error("Transport error:", error);
    return Response.json({
      jsonrpc: "2.0",
      error: { code: -32603, message: "Transport error" },
      id: null,
    }, { status: 500 });
  }
}

async function handleGetRequest(request: Request): Promise<Response> {
  // SSE endpoint for session streaming
  const sessionId = request.headers.get("mcp-session-id");
  if (!sessionId || !transports.has(sessionId)) {
    return new Response("Invalid session", { status: 400 });
  }

  // In a real implementation, this would handle SSE streaming
  // For now, return a placeholder
  return new Response("SSE not implemented in Workers mode", { status: 501 });
}

async function handleDeleteRequest(request: Request): Promise<Response> {
  // Session termination endpoint
  const sessionId = request.headers.get("mcp-session-id");
  if (!sessionId) {
    return new Response("Missing session ID", { status: 400 });
  }

  if (transports.has(sessionId)) {
    const transport = transports.get(sessionId);
    transport?.close?.();
    transports.delete(sessionId);
  }

  return new Response("Session terminated");
}

function validateCredentials(env: Env): string | null {
  const hasPat = env.PCO_PAT_APP_ID && env.PCO_PAT_SECRET;
  const hasOauth = env.PCO_OAUTH_CLIENT_ID && env.PCO_OAUTH_CLIENT_SECRET;

  if (!hasPat && !hasOauth) {
    return "Planning Center credentials missing. Set PCO_PAT_APP_ID + PCO_PAT_SECRET (PAT) or PCO_OAUTH_CLIENT_ID + PCO_OAUTH_CLIENT_SECRET (OAuth) as Wrangler secrets.";
  }

  return null;
}

// TODO: Phase 4.1 - Replace undici with fetch-based HTTP client to enable full Workers compatibility
// The current implementation returns 503 for all MCP tool requests due to undici dependency
// in src/pco/client.ts. Once that's migrated to use fetch(), this worker can build and serve
// the full MCP server using buildServer() from src/server.ts.