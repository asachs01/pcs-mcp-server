import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export function printHelp(): void {
  console.log(`Usage: pcs-mcp-server [options] [command]

A Model Context Protocol server for Planning Center Services.

Commands:
  authorize               Complete OAuth 2.0 authorization flow
  help                    Show this help message

Options:
  -h, --help             Show this help message
  -v, --version          Show version number

Transport:
  --transport <type>     Transport mode (stdio, http) [default: stdio]
  --port <port>          HTTP server port [default: 3000]

Authentication (Personal Access Token):
  PCO_PAT_APP_ID         Planning Center PAT application ID
  PCO_PAT_SECRET         Planning Center PAT secret

Authentication (OAuth 2.0):
  PCO_OAUTH_CLIENT_ID    OAuth 2.0 client ID
  PCO_OAUTH_CLIENT_SECRET OAuth 2.0 client secret
  PCO_OAUTH_REDIRECT_URI OAuth redirect URI [default: http://localhost:3000/callback]

Configuration:
  LOG_LEVEL              Log level (error, warn, info, debug) [default: info]
  PCO_DEFAULT_SERVICE_TYPE_ID Skip service type elicitation

Claude Desktop config:
  {
    "mcpServers": {
      "planning-center": {
        "command": "npx",
        "args": ["-y", "@asachs01/pcs-mcp-server"],
        "env": {
          "PCO_PAT_APP_ID": "your-app-id",
          "PCO_PAT_SECRET": "your-secret"
        }
      }
    }
  }

Examples:
  pcs-mcp-server                    Start with stdio transport
  pcs-mcp-server --transport http   Start HTTP server on port 3000
  pcs-mcp-server authorize          Complete OAuth authorization`);
}

export async function printVersion(): Promise<void> {
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const packageJsonPath = join(__dirname, "..", "..", "package.json");
    const packageJson = await readFile(packageJsonPath, "utf-8");
    const pkg = JSON.parse(packageJson) as { version: string; name: string };
    console.log(`pcs-mcp-server ${pkg.version}`);
  } catch (error) {
    console.error("Error reading version:", error);
    process.exit(1);
  }
}