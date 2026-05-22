import { randomUUID } from "node:crypto";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { PcoClient } from "./pco/client.js";
import { registerAllTools } from "./tools/registry.js";
import { handleWorkersStreamableHttp } from "./workers-transport.js";
import { type AppConfig } from "./config.js";
import { createLogger, type Logger } from "./logger.js";
import { MemoryTokenStorage } from "./pco/token-storage.js";
import { PatAuthProvider, OAuthAuthProvider } from "./pco/auth-provider.js";
import { OAuthClient } from "./pco/oauth.js";

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
const transports = new Map<string, WebStandardStreamableHTTPServerTransport>();
let serverInstance: McpServer | null = null;

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Health check endpoint
    if (url.pathname === "/health") {
      return Response.json({
        status: "ok",
        service: "pcs-mcp-server",
        runtime: "cloudflare-workers",
      });
    }

    // MCP endpoint handling
    if (url.pathname === "/mcp") {
      return handleMcpRequest(request, env);
    }

    return new Response("Not found", { status: 404 });
  },
};

async function handleMcpRequest(request: Request, env: Env): Promise<Response> {
  try {
    // Check if we have the required credentials
    const credentialsError = validateCredentials(env);
    if (credentialsError) {
      return Response.json(
        {
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: "Configuration error",
            data: { details: credentialsError },
          },
          id: null,
        },
        { status: 503 },
      );
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
    return Response.json(
      {
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "Internal error",
          data: { details: error instanceof Error ? error.message : String(error) },
        },
        id: null,
      },
      { status: 500 },
    );
  }
}

async function handlePostRequest(request: Request, env: Env): Promise<Response> {
  try {
    const sessionId = request.headers.get("mcp-session-id");
    let transport: WebStandardStreamableHTTPServerTransport | undefined;

    const body = await request.json();

    if (sessionId && transports.has(sessionId)) {
      transport = transports.get(sessionId);
    } else if (!sessionId && isInitializeRequest(body)) {
      // Build server instance if not already created
      if (!serverInstance) {
        const config = buildConfigFromEnv(env);
        const logger = createLogger(config.logLevel);
        serverInstance = await buildWorkersServer(config, logger);
      }

      // Create new transport for this session
      transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => {
          transports.set(sid, transport!);
        },
      });

      transport.onclose = () => {
        if (transport!.sessionId) {
          transports.delete(transport!.sessionId);
        }
      };

      await serverInstance.connect(transport);
    } else {
      return Response.json(
        {
          jsonrpc: "2.0",
          error: { code: -32000, message: "Missing or invalid session" },
          id: null,
        },
        { status: 400 },
      );
    }

    if (!transport) {
      return Response.json(
        {
          jsonrpc: "2.0",
          error: { code: -32000, message: "Transport not found" },
          id: null,
        },
        { status: 400 },
      );
    }

    // Use the Workers transport adapter
    return await handleWorkersStreamableHttp({
      transport,
      request,
      body,
    });
  } catch (error) {
    console.error("POST request error:", error);
    return Response.json(
      {
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "Internal error",
          data: { details: error instanceof Error ? error.message : String(error) },
        },
        id: null,
      },
      { status: 500 },
    );
  }
}

async function handleGetRequest(request: Request): Promise<Response> {
  try {
    const sessionId = request.headers.get("mcp-session-id");
    if (!sessionId || !transports.has(sessionId)) {
      return new Response("Invalid session", { status: 400 });
    }

    const transport = transports.get(sessionId)!;
    return await handleWorkersStreamableHttp({
      transport,
      request,
    });
  } catch (error) {
    console.error("GET request error:", error);
    return new Response("Internal server error", { status: 500 });
  }
}

async function handleDeleteRequest(request: Request): Promise<Response> {
  try {
    const sessionId = request.headers.get("mcp-session-id");
    if (!sessionId) {
      return new Response("Missing session ID", { status: 400 });
    }

    if (transports.has(sessionId)) {
      const transport = transports.get(sessionId)!;
      return await handleWorkersStreamableHttp({
        transport,
        request,
      });
    } else {
      return new Response("Session not found", { status: 404 });
    }
  } catch (error) {
    console.error("DELETE request error:", error);
    return new Response("Internal server error", { status: 500 });
  }
}

function buildConfigFromEnv(env: Env): AppConfig {
  const auth = resolveAuth(env);

  return {
    transport: "http" as const,
    port: 3000, // Not used in Workers
    logLevel: (env.LOG_LEVEL as AppConfig["logLevel"]) ?? "info",
    auth,
    defaults: {
      serviceTypeId: env.PCO_DEFAULT_SERVICE_TYPE_ID,
    },
  };
}

function resolveAuth(env: Env): AppConfig["auth"] {
  if (env.PCO_PAT_APP_ID && env.PCO_PAT_SECRET) {
    return { mode: "pat", appId: env.PCO_PAT_APP_ID, secret: env.PCO_PAT_SECRET };
  }
  if (env.PCO_OAUTH_CLIENT_ID && env.PCO_OAUTH_CLIENT_SECRET) {
    return {
      mode: "oauth",
      clientId: env.PCO_OAUTH_CLIENT_ID,
      clientSecret: env.PCO_OAUTH_CLIENT_SECRET,
      redirectUri: env.PCO_OAUTH_REDIRECT_URI ?? "http://localhost:3000/callback",
    };
  }
  throw new Error(
    "Planning Center credentials missing. Set PCO_PAT_APP_ID + PCO_PAT_SECRET (PAT) or PCO_OAUTH_CLIENT_ID + PCO_OAUTH_CLIENT_SECRET (OAuth).",
  );
}

function createWorkersAuthProvider(config: AppConfig) {
  if (config.auth.mode === "pat") {
    return new PatAuthProvider(config.auth.appId, config.auth.secret);
  }

  // For OAuth in Workers, use MemoryTokenStorage instead of FileTokenStorage
  const client = new OAuthClient({
    clientId: config.auth.clientId,
    clientSecret: config.auth.clientSecret,
    redirectUri: config.auth.redirectUri,
  });

  const storage = new MemoryTokenStorage();
  return new OAuthAuthProvider(client, null, storage);
}

async function buildWorkersServer(config: AppConfig, logger: Logger): Promise<McpServer> {
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

  const authProvider = createWorkersAuthProvider(config);
  const pco = new PcoClient(authProvider, logger);
  await registerAllTools(server, { pco, logger, config });

  return server;
}

function validateCredentials(env: Env): string | null {
  try {
    resolveAuth(env);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
