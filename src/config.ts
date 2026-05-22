import { z } from "zod";
import { PatAuthProvider, OAuthAuthProvider, type AuthProvider } from "./pco/auth-provider.js";
import { OAuthClient } from "./pco/oauth.js";
import { FileTokenStorage, EnvTokenStorage, type TokenStorage } from "./pco/token-storage.js";

const RawConfig = z.object({
  PCO_PAT_APP_ID: z.string().optional(),
  PCO_PAT_SECRET: z.string().optional(),
  PCO_OAUTH_CLIENT_ID: z.string().optional(),
  PCO_OAUTH_CLIENT_SECRET: z.string().optional(),
  PCO_OAUTH_REDIRECT_URI: z.string().default("http://localhost:3000/callback"),
  TRANSPORT: z.enum(["stdio", "http"]).default("stdio"),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(["error", "warn", "info", "debug"]).default("info"),
  PCO_DEFAULT_SERVICE_TYPE_ID: z.string().optional(),
});

export type AppConfig = {
  transport: "stdio" | "http";
  port: number;
  logLevel: "error" | "warn" | "info" | "debug";
  auth:
    | { mode: "pat"; appId: string; secret: string }
    | { mode: "oauth"; clientId: string; clientSecret: string; redirectUri: string };
  defaults: {
    serviceTypeId?: string;
  };
};

export function loadConfig(argv: string[] = process.argv.slice(2)): AppConfig {
  const env = RawConfig.parse(process.env);

  // CLI flags override env. Tiny parser — no need to pull a dep for two flags.
  const cliTransport = readFlag(argv, "--transport");
  const cliPort = readFlag(argv, "--port");

  const transport = (cliTransport ?? env.TRANSPORT) as "stdio" | "http";
  const port = cliPort ? Number(cliPort) : env.PORT;

  const auth = resolveAuth(env);

  return {
    transport,
    port,
    logLevel: env.LOG_LEVEL,
    auth,
    defaults: {
      serviceTypeId: env.PCO_DEFAULT_SERVICE_TYPE_ID,
    },
  };
}

function readFlag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  if (i === -1) return undefined;
  return argv[i + 1];
}

function resolveAuth(env: z.infer<typeof RawConfig>): AppConfig["auth"] {
  if (env.PCO_PAT_APP_ID && env.PCO_PAT_SECRET) {
    return { mode: "pat", appId: env.PCO_PAT_APP_ID, secret: env.PCO_PAT_SECRET };
  }
  if (env.PCO_OAUTH_CLIENT_ID && env.PCO_OAUTH_CLIENT_SECRET) {
    return {
      mode: "oauth",
      clientId: env.PCO_OAUTH_CLIENT_ID,
      clientSecret: env.PCO_OAUTH_CLIENT_SECRET,
      redirectUri: env.PCO_OAUTH_REDIRECT_URI,
    };
  }
  throw new Error(
    "Planning Center credentials missing. Set PCO_PAT_APP_ID + PCO_PAT_SECRET (PAT) or PCO_OAUTH_CLIENT_ID + PCO_OAUTH_CLIENT_SECRET (OAuth).",
  );
}

export interface OAuthSupport {
  client: OAuthClient;
  storage: TokenStorage;
}

export function createOAuthSupport(config: AppConfig): OAuthSupport {
  if (config.auth.mode !== "oauth") {
    throw new Error("createOAuthSupport called with non-OAuth config");
  }

  // OAuth mode - construct client and storage
  const client = new OAuthClient({
    clientId: config.auth.clientId,
    clientSecret: config.auth.clientSecret,
    redirectUri: config.auth.redirectUri,
  });

  // Pick storage based on env: if PCO_OAUTH_TOKENS is set, use EnvTokenStorage; otherwise FileTokenStorage
  const storage = process.env.PCO_OAUTH_TOKENS ? new EnvTokenStorage() : new FileTokenStorage();

  return { client, storage };
}

export function createAuthProvider(config: AppConfig): AuthProvider {
  if (config.auth.mode === "pat") {
    return new PatAuthProvider(config.auth.appId, config.auth.secret);
  }

  // Use the shared OAuth support logic
  const { client, storage } = createOAuthSupport(config);
  return new OAuthAuthProvider(client, null, storage);
}
