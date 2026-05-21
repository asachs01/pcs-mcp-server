import express from "express";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Logger } from "../logger.js";

export async function startHttp(
  server: McpServer,
  port: number,
  logger: Logger,
): Promise<void> {
  const app = express();
  app.use(express.json({ limit: "4mb" }));

  // Sessions are keyed by Mcp-Session-Id header. Each session owns one transport.
  const transports = new Map<string, StreamableHTTPServerTransport>();

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "pcs-mcp-server" });
  });

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
