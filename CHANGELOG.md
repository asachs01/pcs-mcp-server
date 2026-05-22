# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.1] — 2026-05-22

### Changed
- **Package renamed from `@canticle/pcs-mcp-server` to `@asachs01/pcs-mcp-server`** so the GitHub Packages scope matches the repo owner (the `@canticle` namespace doesn't exist). Update your install commands and Claude Desktop config.

### Added
- **Cloudflare Workers transport is now functional.** The SDK's `WebStandardStreamableHTTPServerTransport` handles Web Standards Request/Response natively; the worker now serves MCP tool calls end-to-end. OAuth in Workers uses `MemoryTokenStorage` (per-isolate), so token refreshes don't persist across cold starts — for production OAuth on Workers, plan an external token store (KV / D1).
- **`pcs-mcp-server authorize` CLI subcommand** — one-time browser-loopback OAuth flow for stdio deployments (Claude Desktop, Claude Code). Spins up an ephemeral localhost callback on a random port, opens the browser, validates CSRF state, persists tokens to `~/.pcs-mcp/tokens.json`. 5-minute timeout.
- **`plan_services` action `find_plan`** — locate a single plan from a date hint (`"this Sunday"`, ISO, etc.). 0 matches → helpful error; 1 → return; 2+ → `elicitChoice` with structured-error fallback. Closes the discovery gap for the "add song to Sunday's service" UX.
- **ESLint v9 flat config + Prettier 3** — `npm run lint` and `npm run format` are wired and clean (0 errors).

## [0.1.0] — 2026-05-21

First public release. Single-user PAT deployments via stdio or Node HTTP are production-ready. OAuth, multi-user remote deployments, and Cloudflare Workers are functional but pre-1.0; expect rough edges.

### Added
- **Architecture**: hierarchical Level-0 tool routing with `action` enums, lazy-loading tool registry, dual transport (stdio + Node HTTP via Express), Cloudflare Workers entry adapter (partial — see Known limitations).
- **Tools** (22 actions across 4 Level-0 tools):
  - `pcs_info` — `list_service_types`, `list_teams`, `list_tag_groups`, `whoami`.
  - `plan_services` — `list_plans`, `get_plan`, `get_plan_items`, `create_plan`, `update_plan`, `reorder_items`. Accepts natural-language dates (`"this Sunday"`, `"next week"`).
  - `manage_songs` — `search_songs`, `get_song_details`, `list_arrangements`, `add_song_to_plan`, `set_song_key`, `remove_song`. Elicits arrangement and key when missing.
  - `manage_team` — `list_team_members`, `list_plan_people`, `assign_person`, `check_availability`, `send_scheduling_request`, `accept_decline`.
- **Elicitation**: `elicitChoice` and `elicitServiceType` helpers with graceful degradation when the client doesn't advertise the capability. Service-type disambiguation is wired across all `plan_services` actions; arrangement and key disambiguation are wired into `manage_songs add_song_to_plan`.
- **Authentication**: pluggable `AuthProvider` interface. `PatAuthProvider` for Personal Access Tokens (Basic auth). `OAuthAuthProvider` with auto-refresh inside a 60-second expiry window. `OAuthClient` supplies authorize-URL construction, code exchange, and refresh.
- **Token storage**: `FileTokenStorage` (`~/.pcs-mcp/tokens.json`, atomic write, mode 0600), `EnvTokenStorage` (reads `PCO_OAUTH_TOKENS`), `MemoryTokenStorage` (tests).
- **OAuth HTTP flow**: `GET /oauth/authorize` and `GET /oauth/callback` mounted automatically when the server runs in HTTP transport with OAuth credentials. CSRF state with a 10-minute TTL.
- **Rate limiting**: sliding-window limiter capped at 95 req/20 s (below PCO's 100/20 s ceiling).
- **Utilities**: relative-date parser (`"today"`, `"tomorrow"`, `"this <weekday>"`, `"next <weekday>"`, `"this week"`, `"next week"`).
- **Distribution**: multi-stage `Dockerfile` (Node 22 alpine, non-root, HEALTHCHECK). `.do/app.yaml` for DigitalOcean App Platform. `wrangler.toml` placeholder for Cloudflare Workers. GitHub Actions workflows for CI (typecheck + build), release (publish to GitHub Packages on `v*` tags), and Docker (multi-platform GHCR images).
- **Tooling**: `npm run smoke` (real-credentials sanity check), `npm run inspect` (in-process MCP client integration check, no creds required).
- **Tests**: 71 passing — sliding-window limiter, config resolution, OAuth provider, token storage backends, date parser, and integration tests with mocked PCO responses.
