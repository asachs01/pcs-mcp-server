#!/usr/bin/env node
import { loadConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { buildServer } from "./server.js";
import { startStdio } from "./transports/stdio.js";
import { startHttp } from "./transports/http.js";

async function main() {
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
    await startHttp(server, config.port, logger);
  }
}

main().catch((err) => {
  process.stderr.write(`fatal: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
