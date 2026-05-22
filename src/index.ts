#!/usr/bin/env node
import { loadConfig, createOAuthSupport } from "./config.js";
import { createLogger } from "./logger.js";
import { buildServer } from "./server.js";
import { startStdio } from "./transports/stdio.js";
import { startHttp } from "./transports/http.js";
import { runAuthorizeFlow } from "./cli/authorize.js";

async function main() {
  // Check for subcommands before loading config
  const subcommand = process.argv[2];

  if (subcommand === "authorize") {
    try {
      const config = loadConfig();
      const logger = createLogger(config.logLevel);
      const exitCode = await runAuthorizeFlow(config, logger);
      process.exit(exitCode);
    } catch (err) {
      if (err instanceof Error && err.message.includes("Planning Center credentials missing")) {
        process.stderr.write(
          "OAuth credentials not configured — set PCO_OAUTH_CLIENT_ID and PCO_OAUTH_CLIENT_SECRET\n",
        );
        process.exit(1);
      }
      throw err;
    }
  }

  const config = loadConfig();
  const logger = createLogger(config.logLevel);

  logger.info("starting pcs-mcp-server", {
    transport: config.transport,
    auth: config.auth.mode,
  });

  const server = await buildServer(config, logger);

  if (config.transport === "stdio") {
    await startStdio(server, logger);
  } else {
    // For HTTP transport with OAuth, provide OAuth support
    const oauthSupport = config.auth.mode === "oauth" ? createOAuthSupport(config) : undefined;

    await startHttp(server, config.port, logger, oauthSupport);
  }
}

main().catch((err) => {
  process.stderr.write(`fatal: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
