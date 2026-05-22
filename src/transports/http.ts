import express from "express";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Logger } from "../logger.js";
import type { OAuthSupport } from "../config.js";

export async function startHttp(
  server: McpServer,
  port: number,
  logger: Logger,
  oauthSupport?: OAuthSupport,
): Promise<void> {
  const app = express();
  app.use(express.json({ limit: "4mb" }));

  // Sessions are keyed by Mcp-Session-Id header. Each session owns one transport.
  const transports = new Map<string, StreamableHTTPServerTransport>();

  // OAuth state storage with 10-minute TTL
  const pendingStates = new Map<string, { timestamp: number }>();

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "pcs-mcp-server" });
  });

  // OAuth endpoints (only mounted when oauthSupport is provided)
  if (oauthSupport) {
    const { client, storage } = oauthSupport;

    app.get("/oauth/authorize", (req, res) => {
      try {
        const state = randomUUID();

        // Store state with 10-minute TTL
        pendingStates.set(state, { timestamp: Date.now() });
        setTimeout(
          () => {
            pendingStates.delete(state);
          },
          10 * 60 * 1000,
        );

        const authUrl = client.buildAuthorizationUrl(state);
        logger.debug("redirecting to OAuth authorization", { state });

        res.redirect(302, authUrl);
      } catch (error) {
        logger.error("OAuth authorization failed", {
          error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ error: "OAuth authorization failed" });
      }
    });

    app.get("/oauth/callback", async (req, res) => {
      try {
        const { code, state } = req.query;

        if (!code || !state) {
          logger.warn("OAuth callback missing code or state");
          return res.status(400).json({ error: "Missing code or state parameter" });
        }

        if (typeof code !== "string" || typeof state !== "string") {
          logger.warn("OAuth callback invalid parameter types");
          return res.status(400).json({ error: "Invalid code or state parameter" });
        }

        // Validate state
        if (!pendingStates.has(state)) {
          logger.warn("OAuth callback invalid state", { state });
          return res.status(400).json({ error: "Invalid or expired state" });
        }

        // Clean up state
        pendingStates.delete(state);

        // Exchange code for tokens
        const tokens = await client.exchangeCode(code);
        await storage.save(tokens);

        logger.info("OAuth tokens successfully obtained and saved");

        // Return success page
        res.status(200).send(`
          <!DOCTYPE html>
          <html>
            <head>
              <title>Authorization Complete</title>
              <style>
                body { font-family: Arial, sans-serif; text-align: center; margin-top: 50px; }
                .success { color: #28a745; }
              </style>
            </head>
            <body>
              <h1 class="success">✓ Authorization Complete</h1>
              <p>You have successfully authorized the Planning Center MCP Server.</p>
              <p>You can close this tab now.</p>
            </body>
          </html>
        `);
      } catch (error) {
        logger.error("OAuth token exchange failed", {
          error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ error: "Token exchange failed" });
      }
    });
  }

  app.post("/mcp", async (req, res) => {
    const sessionId = req.header("mcp-session-id");
    let transport: StreamableHTTPServerTransport | undefined;

    if (sessionId && transports.has(sessionId)) {
      transport = transports.get(sessionId);
    } else if (!sessionId && isInitializeRequest(req.body)) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => {
          transports.set(sid, transport!);
          logger.debug("session initialized", { sessionId: sid });
        },
      });
      transport.onclose = () => {
        if (transport!.sessionId) {
          transports.delete(transport!.sessionId);
          logger.debug("session closed", { sessionId: transport!.sessionId });
        }
      };
      await server.connect(transport);
    } else {
      res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Missing or invalid session" },
        id: null,
      });
      return;
    }

    await transport!.handleRequest(req, res, req.body);
  });

  // SSE GET (server -> client streaming) and DELETE (session terminate).
  const sessionEndpoint = async (req: express.Request, res: express.Response) => {
    const sid = req.header("mcp-session-id");
    if (!sid || !transports.has(sid)) {
      res.status(400).send("Invalid session");
      return;
    }
    await transports.get(sid)!.handleRequest(req, res);
  };
  app.get("/mcp", sessionEndpoint);
  app.delete("/mcp", sessionEndpoint);

  app.listen(port, () => {
    logger.info(`pcs-mcp-server listening on http://0.0.0.0:${port}/mcp`);
  });
}
