type Level = "error" | "warn" | "info" | "debug";

const LEVELS: Record<Level, number> = { error: 0, warn: 1, info: 2, debug: 3 };

export interface Logger {
  error(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  debug(msg: string, meta?: Record<string, unknown>): void;
}

// stderr-only logger. In stdio transport, stdout is reserved for MCP framing —
// any stdout write corrupts the wire protocol.
export function createLogger(level: Level): Logger {
  const threshold = LEVELS[level];
  const write = (lvl: Level, msg: string, meta?: Record<string, unknown>) => {
    if (LEVELS[lvl] > threshold) return;
    const line = meta ? `[${lvl}] ${msg} ${JSON.stringify(meta)}` : `[${lvl}] ${msg}`;
    process.stderr.write(line + "\n");
  };
  return {
    error: (m, x) => write("error", m, x),
    warn: (m, x) => write("warn", m, x),
    info: (m, x) => write("info", m, x),
    debug: (m, x) => write("debug", m, x),
  };
}
