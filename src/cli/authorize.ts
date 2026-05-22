import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { platform } from "node:os";
import type { AppConfig } from "../config.js";
import type { Logger } from "../logger.js";
import { createOAuthSupport } from "../config.js";
import { OAuthClient } from "../pco/oauth.js";

export async function runAuthorizeFlow(config: AppConfig, logger: Logger): Promise<number> {
  // Only works in OAuth mode
  if (config.auth.mode !== "oauth") {
    process.stderr.write(
      "authorize is only for OAuth mode; you're already authenticated with PAT\n",
    );
    return 0;
  }

  const { client, storage } = createOAuthSupport(config);

  // Generate a random state for CSRF protection
  const state = randomBytes(32).toString("hex");

  // Create temporary HTTP server on a free port
  const server = createServer();

  return new Promise<number>((resolve) => {
    let resolved = false;
    let timeoutHandle: NodeJS.Timeout;

    const cleanup = () => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeoutHandle);
      server.close();
    };

    // 5 minute timeout
    timeoutHandle = setTimeout(
      () => {
        cleanup();
        process.stderr.write("Authorization timeout after 5 minutes. Please try again.\n");
        resolve(2);
      },
      5 * 60 * 1000,
    );

    server.on("request", async (req, res) => {
      if (!req.url?.startsWith("/callback")) {
        res.writeHead(404);
        res.end("Not Found");
        return;
      }

      try {
        const address = server.address();
        if (!address || typeof address === "string") {
          throw new Error("Invalid server address");
        }

        const url = new URL(req.url, `http://127.0.0.1:${address.port}`);
        const code = url.searchParams.get("code");
        const returnedState = url.searchParams.get("state");

        if (!code) {
          throw new Error("Missing authorization code");
        }

        if (returnedState !== state) {
          throw new Error("State mismatch - possible CSRF attack");
        }

        // Exchange code for tokens
        const tokens = await client.exchangeCode(code);

        // Persist tokens
        await storage.save(tokens);

        // Send success response to browser
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`
          <html>
            <body>
              <h1>Authorization Complete</h1>
              <p>You have successfully authorized the Planning Center MCP server. You can close this tab now.</p>
            </body>
          </html>
        `);

        cleanup();

        // Determine storage path for success message
        const storagePath = process.env.PCO_OAUTH_TOKENS
          ? "environment variable PCO_OAUTH_TOKENS"
          : "~/.pcs-mcp/tokens.json";

        process.stderr.write(`✓ Authorization successful! Tokens saved to ${storagePath}\n`);
        resolve(0);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        res.writeHead(400, { "Content-Type": "text/html" });
        res.end(`
          <html>
            <body>
              <h1>Authorization Failed</h1>
              <p>Error: ${errorMessage}</p>
              <p>Please close this tab and try again.</p>
            </body>
          </html>
        `);

        cleanup();
        process.stderr.write(`Authorization failed: ${errorMessage}\n`);
        resolve(1);
      }
    });

    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        cleanup();
        process.stderr.write("Failed to start authorization server\n");
        resolve(1);
        return;
      }

      const port = address.port;
      const redirectUri = `http://127.0.0.1:${port}/callback`;

      // Create a new client with the temporary redirect URI for this authorization flow
      // We already checked config.auth.mode === "oauth" at the start of the function
      const oauthConfig = config.auth as Extract<typeof config.auth, { mode: "oauth" }>;
      const tempClient = new OAuthClient({
        clientId: oauthConfig.clientId,
        clientSecret: oauthConfig.clientSecret,
        redirectUri,
      });

      const authUrl = tempClient.buildAuthorizationUrl(state);

      process.stderr.write(`Opening authorization URL in your browser...\n`);
      process.stderr.write(`If it doesn't open automatically, please visit:\n${authUrl}\n\n`);

      // Try to open browser automatically
      openBrowser(authUrl);
    });

    server.on("error", (error) => {
      cleanup();
      process.stderr.write(`Server error: ${error.message}\n`);
      resolve(1);
    });
  });
}

function openBrowser(url: string): void {
  const osType = platform();
  let command: string;
  let args: string[];

  switch (osType) {
    case "darwin":
      command = "open";
      args = [url];
      break;
    case "win32":
      command = "start";
      args = ["", url];
      break;
    default: // Linux and others
      command = "xdg-open";
      args = [url];
      break;
  }

  const child = spawn(command, args, {
    stdio: "ignore",
    detached: true,
  });

  child.unref();

  child.on("error", () => {
    // Silently ignore spawn errors - user can open the URL manually
  });
}
