import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

/**
 * Wraps a single WebStandardStreamableHTTPServerTransport request so it
 * works inside a Cloudflare Workers fetch handler.
 *
 * The Web Standard transport expects a Request and returns a Response,
 * which is exactly what Workers provides. This is just a thin wrapper
 * to handle the parsed request body parameter.
 *
 * SSE streaming is fully supported since the Web Standard transport
 * uses ReadableStream internally.
 */
export async function handleWorkersStreamableHttp(args: {
  transport: WebStandardStreamableHTTPServerTransport;
  request: Request;
  body?: unknown;
}): Promise<Response> {
  const { transport, request, body } = args;

  // For POST requests with pre-parsed body, pass it via options
  if (request.method === "POST" && body !== undefined) {
    return await transport.handleRequest(request, { parsedBody: body });
  }

  // For GET/DELETE requests, let the transport handle everything
  return await transport.handleRequest(request);
}
