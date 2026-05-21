# Planning Center Services MCP Server — Product Requirements Document

**Version**: 2.0
**Date**: February 14, 2026
**Author**: Aaron (with Claude)
**Status**: Draft
**Supersedes**: [Original PRD (September 2025)](https://claude.ai/chat/22d23955-3d43-449c-9da2-1e7c3acc1bbb)

---

## Executive Summary

This MCP server enables church staff and clergy to manage Planning Center Services through natural language via any MCP-compatible client — Claude Code, Claude Desktop, or any standards-compliant MCP host. The server exposes worship service planning capabilities (retrieving plans, adding songs with key assignments, scheduling people) through a hierarchical decision-tree tool architecture with lazy-loaded modules, MCP elicitation for interactive disambiguation, and dual transport support (stdio + Streamable HTTP).

The server ships as both an npm package and a Docker image, published to GitHub Package Registry and GitHub Container Registry respectively, with one-click deploy options for DigitalOcean App Platform and Cloudflare Workers.

---

## Problem Statement

Church staff currently context-switch between Planning Center's web UI and their AI workflow tools. Common friction points include navigating nested menus to find a specific Sunday's plan, manually searching song libraries, and coordinating volunteer schedules across multiple service types. This MCP server eliminates that friction by letting staff say things like "add 'Amazing Grace' in the key of D to this Sunday's 10:30 service" from within their existing AI assistant.

---

## Target Users

- **Clergy and worship directors** planning weekly services
- **Music directors** managing song selections, keys, and arrangements
- **Church administrators** coordinating volunteer schedules
- **Technical staff** integrating church workflows with AI tooling

All users are assumed to have an active Planning Center Services subscription. The server authenticates via Planning Center's OAuth 2.0 flow or Personal Access Tokens.

---

## Architecture Overview

### Hierarchical Decision-Tree Tool Routing

Rather than exposing a flat list of 30+ tools (which overwhelms LLM tool selection), the server uses a hierarchical routing pattern. The LLM first selects a high-level **domain tool**, which then branches into specific **action tools** based on context.

```
┌─────────────────────────────────────────────────┐
│              MCP Tool Surface (Level 0)          │
├─────────────────────────────────────────────────┤
│  plan_services    │  manage_songs    │  manage_  │
│                   │                  │  team     │
│  "Work with       │  "Search, add,   │  "Assign, │
│   service plans"  │   or configure   │   check   │
│                   │   songs"         │   avail"  │
└───────┬───────────┴────────┬─────────┴─────┬─────┘
        │                    │               │
        ▼                    ▼               ▼
┌───────────────┐  ┌─────────────────┐ ┌──────────────┐
│  Level 1:     │  │  Level 1:       │ │  Level 1:    │
│  Plan Actions │  │  Song Actions   │ │  Team Actions│
├───────────────┤  ├─────────────────┤ ├──────────────┤
│ get_plans     │  │ search_songs    │ │ assign_person│
│ get_plan_items│  │ add_song_to_plan│ │ check_avail  │
│ create_plan   │  │ set_song_key    │ │ list_team    │
│ update_plan   │  │ list_arrangements│ │ send_request │
└───────────────┘  └─────────────────┘ └──────────────┘
```

**How it works at runtime:**

1. The LLM sees only the Level 0 tools on initial `listTools`.
2. When the LLM calls a Level 0 tool (e.g., `plan_services` with `action: "get_plans"`), the server routes to the appropriate Level 1 handler.
3. The Level 0 tool accepts an `action` parameter (enum of available sub-actions) plus action-specific parameters, keeping the tool call count to one round-trip.
4. If the action requires disambiguation (multiple matching plans, ambiguous song title, etc.), the server uses MCP **elicitation** to prompt the user before completing the action.

### Lazy Loading

Tool modules are loaded on demand to minimize startup time and memory footprint. Each domain (plans, songs, teams) is a separate module that loads only when its Level 0 tool is first invoked.

```typescript
// Tool registry with lazy loading
const toolModules = new Map<string, () => Promise<ToolModule>>();

toolModules.set('plan_services', () => import('./tools/plans.js'));
toolModules.set('manage_songs', () => import('./tools/songs.js'));
toolModules.set('manage_team', () => import('./tools/team.js'));

// Module loaded on first call, cached thereafter
async function handleToolCall(name: string, args: Record<string, unknown>) {
  const loader = toolModules.get(name);
  if (!loader) throw new Error(`Unknown tool: ${name}`);
  const module = await loader();  // Lazy load + cache
  return module.handle(args);
}
```

### Dual Transport Support

The server supports both transport modes from a single codebase:

**stdio** — For local use with Claude Desktop and Claude Code. The server runs as a child process, communicating over stdin/stdout per the MCP spec.

**Streamable HTTP** — For remote/cloud deployment. Uses the current MCP SDK's `StreamableHTTPServerTransport` with stateful session management and resumability. This is the recommended transport for production deployments per the MCP spec (2025-11-25).

The transport is selected at startup via CLI flag or environment variable:

```bash
# stdio mode (default for local)
pcs-mcp-server --transport stdio

# Streamable HTTP mode (default for Docker/cloud)
pcs-mcp-server --transport http --port 3000
```

### MCP Elicitation

The server uses MCP elicitation to interactively collect missing or ambiguous information during tool execution, rather than failing or guessing. This is critical for church planning where context matters (e.g., "this Sunday" could mean different service types).

**Elicitation scenarios:**

| Scenario | Elicitation Form |
|----------|-----------------|
| Multiple service types exist | Select which service type (e.g., "8:00 AM Rite I" vs "10:30 AM Rite II") |
| Song title matches multiple entries | Select from matching songs with arrangement info |
| No key specified for a song | Prompt for key selection with arrangement defaults |
| Person assignment conflicts with existing schedule | Confirm override or select alternative date |
| Plan date is ambiguous | Confirm the intended date |

**Example elicitation flow for adding a song:**

```typescript
// User says: "Add Amazing Grace to Sunday's service"
// → Multiple service types exist, song has multiple arrangements

const serviceTypeResult = await server.server.elicitInput({
  message: "Which service should I add the song to?",
  requestedSchema: {
    type: "object",
    properties: {
      serviceType: {
        type: "string",
        title: "Service",
        description: "Select the service",
        enum: ["rite_i_8am", "rite_ii_1030am", "evening_prayer_5pm"],
        enumNames: ["8:00 AM - Rite I", "10:30 AM - Rite II", "5:00 PM - Evening Prayer"]
      }
    },
    required: ["serviceType"]
  }
});

if (serviceTypeResult.action !== "accept") {
  return { content: [{ type: "text", text: "Song addition cancelled." }] };
}

const keyResult = await server.server.elicitInput({
  message: "What key should 'Amazing Grace' be in?",
  requestedSchema: {
    type: "object",
    properties: {
      key: {
        type: "string",
        title: "Key",
        description: "Select the key (default arrangement is in G)",
        enum: ["C", "D", "E", "F", "G", "A", "Bb", "Eb"],
        enumNames: ["C Major", "D Major", "E Major", "F Major", "G Major (default)", "A Major", "Bb Major", "Eb Major"]
      }
    },
    required: ["key"]
  }
});
```

---

## Tool Specification

### Level 0: Domain Tools

These are the tools exposed via `listTools`. Each accepts an `action` enum plus action-specific parameters.

#### `plan_services`

Work with service plans — retrieve, create, and modify weekly service plans.

| Action | Description | Key Parameters |
|--------|-------------|----------------|
| `list_plans` | Get plans for a service type within a date range | `serviceTypeId?`, `startDate?`, `endDate?` |
| `get_plan` | Get a specific plan with all items | `planId` |
| `get_plan_items` | Get items (songs, headers, media) in a plan | `planId` |
| `create_plan` | Create a new plan | `serviceTypeId`, `date`, `title?` |
| `update_plan` | Update plan metadata | `planId`, fields to update |
| `reorder_items` | Reorder items within a plan | `planId`, `itemIds` (ordered) |

**Date handling**: If the user says "this Sunday" or "next week," the server resolves relative dates before calling the PCO API. If ambiguous, it elicits the specific date.

#### `manage_songs`

Search, add, and configure songs within service plans.

| Action | Description | Key Parameters |
|--------|-------------|----------------|
| `search_songs` | Search the song library | `query`, `author?`, `ccliNumber?` |
| `add_song_to_plan` | Add a song to a plan | `planId`, `songId`, `arrangementId?`, `key?`, `position?` |
| `set_song_key` | Change the key for a song in a plan | `planItemId`, `key` |
| `list_arrangements` | Get arrangements for a song | `songId` |
| `get_song_details` | Get full song metadata | `songId` |
| `remove_song` | Remove a song from a plan | `planItemId` |

**Key handling**: Keys are specified as strings (e.g., "D", "Bb", "F#m"). The server validates against PCO's accepted key values and uses elicitation if the key is missing or invalid.

#### `manage_team`

Assign people, check availability, and manage team scheduling.

| Action | Description | Key Parameters |
|--------|-------------|----------------|
| `assign_person` | Schedule a person to a team position | `planId`, `personId`, `teamId`, `positionName?` |
| `check_availability` | Check a person's availability for a date | `personId`, `date` |
| `list_team_members` | List members of a team | `teamId` |
| `list_plan_people` | Get all people scheduled for a plan | `planId` |
| `send_scheduling_request` | Send email/notification for scheduling | `planId`, `personId` |
| `accept_decline` | Accept or decline on behalf of someone | `planId`, `personId`, `status` |

### Level 0 (Utility): `pcs_info`

Read-only informational tool for discovering available service types, teams, and server configuration.

| Action | Description | Key Parameters |
|--------|-------------|----------------|
| `list_service_types` | Get all service types in the organization | — |
| `list_teams` | Get teams for a service type | `serviceTypeId` |
| `list_tag_groups` | Get song tag groups | — |
| `whoami` | Get current authenticated user info | — |

---

## Planning Center API Integration

### Base URL and Versioning

All API calls target `https://api.planningcenteronline.com/services/v2`. The API follows JSON:API 1.0 spec, so all request/response bodies use the JSON:API envelope format.

### Key Endpoints

**Service Types & Plans:**
- `GET /service_types` — List all service types
- `GET /service_types/{id}/plans` — List plans (supports `filter[after]`, `filter[before]`)
- `GET /service_types/{id}/plans/{id}` — Get specific plan
- `GET /service_types/{id}/plans/{id}/items` — Get plan items
- `POST /service_types/{id}/plans/{id}/items` — Add item to plan
- `PATCH /service_types/{id}/plans/{id}/items/{id}` — Update plan item

**Songs:**
- `GET /songs` — List/search songs (`filter[title]`)
- `GET /songs/{id}` — Get song details
- `GET /songs/{id}/arrangements` — Get arrangements
- `GET /songs/{id}/arrangements/{id}/keys` — Get available keys

**People & Teams:**
- `GET /service_types/{id}/teams` — List teams
- `GET /service_types/{id}/teams/{id}/people` — List team members
- `GET /service_types/{id}/plans/{id}/team_members` — Get plan's team assignments
- `POST /service_types/{id}/plans/{id}/team_members` — Assign person to plan

### Authentication

Two authentication modes, configurable at server startup:

**Personal Access Token (PAT)** — For single-user/personal use. The token is passed via environment variable `PCO_PAT_APP_ID` and `PCO_PAT_SECRET`. Uses HTTP Basic Auth.

**OAuth 2.0** — For multi-user deployments. The server implements Planning Center's OAuth 2.0 flow:
- Authorization URL: `https://api.planningcenteronline.com/oauth/authorize`
- Token URL: `https://api.planningcenteronline.com/oauth/token`
- Scopes: `services` (minimum), `people` (for team member lookup)

For Streamable HTTP transport, OAuth can be integrated with MCP's built-in `ProxyOAuthServerProvider` for seamless authorization during session initialization.

### Rate Limiting

Planning Center allows 100 requests per 20-second window. The server implements:
- Request queuing with automatic throttling
- Exponential backoff on 429 responses
- Request batching where the API supports `include` parameters (e.g., `?include=items,team_members` to reduce call count)

---

## Distribution & Deployment

### npm Package

Published to GitHub Package Registry as `@canticle/pcs-mcp-server`.

```bash
# Install globally
npm install -g @canticle/pcs-mcp-server

# Run in stdio mode
pcs-mcp-server

# Run in HTTP mode
pcs-mcp-server --transport http --port 3000
```

**Claude Desktop configuration (`claude_desktop_config.json`):**

```json
{
  "mcpServers": {
    "planning-center": {
      "command": "npx",
      "args": ["-y", "@canticle/pcs-mcp-server"],
      "env": {
        "PCO_PAT_APP_ID": "your-app-id",
        "PCO_PAT_SECRET": "your-secret"
      }
    }
  }
}
```

**Claude Code configuration:**

```bash
claude mcp add planning-center -- npx -y @canticle/pcs-mcp-server
```

### Docker Image

Published to GitHub Container Registry as `ghcr.io/canticle/pcs-mcp-server`.

```dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --production=false
COPY . .
RUN npm run build
RUN npm prune --production

FROM node:22-alpine
WORKDIR /app
RUN addgroup -g 1001 -S mcp && adduser -S mcp -u 1001
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json .
USER mcp
EXPOSE 3000
ENV TRANSPORT=http
ENV PORT=3000
ENTRYPOINT ["node", "dist/index.js"]
```

The Docker image defaults to Streamable HTTP transport on port 3000, suitable for cloud deployment.

### One-Click Deploy Badges

The repository README includes deploy buttons for:

**DigitalOcean App Platform:**

```markdown
[![Deploy to DO](https://www.deploytodo.com/do-btn-blue.svg)](https://cloud.digitalocean.com/apps/new?repo=https://github.com/canticle/pcs-mcp-server/tree/main&refcode=...)
```

Includes an `.do/app.yaml` spec:

```yaml
name: pcs-mcp-server
services:
  - name: mcp
    image:
      registry_type: GHCR
      registry: canticle
      repository: pcs-mcp-server
      tag: latest
    http_port: 3000
    instance_count: 1
    instance_size_slug: apps-s-1vcpu-0.5gb
    envs:
      - key: PCO_PAT_APP_ID
        scope: RUN_TIME
        type: SECRET
      - key: PCO_PAT_SECRET
        scope: RUN_TIME
        type: SECRET
      - key: TRANSPORT
        value: http
    health_check:
      http_path: /health
```

**Cloudflare Workers:**

```markdown
[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/canticle/pcs-mcp-server)
```

Includes a `wrangler.toml` for Cloudflare Workers deployment. The Cloudflare deployment uses Cloudflare's Agents SDK with Durable Objects for session state and elicitation persistence.

---

## Project Structure

```
pcs-mcp-server/
├── src/
│   ├── index.ts                  # Entry point, transport selection
│   ├── server.ts                 # McpServer setup, tool registration
│   ├── transports/
│   │   ├── stdio.ts              # Stdio transport wiring
│   │   └── http.ts               # Streamable HTTP transport (Express)
│   ├── tools/
│   │   ├── registry.ts           # Lazy-loading tool registry
│   │   ├── plans.ts              # plan_services tool module
│   │   ├── songs.ts              # manage_songs tool module
│   │   ├── team.ts               # manage_team tool module
│   │   └── info.ts               # pcs_info tool module
│   ├── pco/
│   │   ├── client.ts             # Planning Center API client
│   │   ├── auth.ts               # OAuth 2.0 + PAT auth
│   │   ├── rate-limiter.ts       # Request throttling
│   │   └── types.ts              # PCO JSON:API type definitions
│   ├── elicitation/
│   │   └── helpers.ts            # Reusable elicitation patterns
│   └── utils/
│       ├── dates.ts              # Relative date resolution
│       └── keys.ts               # Musical key validation
├── test/
│   ├── tools/                    # Tool module tests
│   ├── pco/                      # API client tests (mocked)
│   └── integration/              # End-to-end with MCP Inspector
├── Dockerfile
├── .do/
│   └── app.yaml                  # DigitalOcean App Platform spec
├── wrangler.toml                 # Cloudflare Workers config
├── tsconfig.json
├── package.json
└── README.md
```

---

## MCP Client Compatibility

The server targets compatibility with:

| Client | Transport | Elicitation Support | Notes |
|--------|-----------|-------------------|-------|
| **Claude Desktop** | stdio | Yes (form elicitation) | Primary local client |
| **Claude Code** | stdio | Yes | CLI-based elicitation prompts |
| **Claude.ai (MCP connector)** | Streamable HTTP | Yes | Remote server connection |
| **Cursor / Windsurf** | stdio | Varies | May not support elicitation; server gracefully degrades with sensible defaults |
| **MCP Inspector** | Streamable HTTP | Yes | Used for development/testing |
| **Custom clients** | Either | Depends on implementation | JSON:API spec compliance |

**Graceful degradation**: If the client does not advertise `elicitation` capability, the server falls back to requiring all parameters upfront and returns descriptive errors when disambiguation is needed (e.g., "Multiple services found for Sunday. Please specify serviceTypeId: 123 or 456.").

---

## Configuration

All configuration via environment variables:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PCO_PAT_APP_ID` | Yes* | — | Personal Access Token app ID |
| `PCO_PAT_SECRET` | Yes* | — | Personal Access Token secret |
| `PCO_OAUTH_CLIENT_ID` | Yes* | — | OAuth 2.0 client ID |
| `PCO_OAUTH_CLIENT_SECRET` | Yes* | — | OAuth 2.0 client secret |
| `PCO_OAUTH_REDIRECT_URI` | No | `http://localhost:3000/callback` | OAuth redirect URI |
| `TRANSPORT` | No | `stdio` | Transport mode: `stdio` or `http` |
| `PORT` | No | `3000` | HTTP port (http transport only) |
| `LOG_LEVEL` | No | `info` | Logging verbosity |
| `PCO_DEFAULT_SERVICE_TYPE_ID` | No | — | Skip service type selection if only one is used |

*Either PAT credentials or OAuth credentials are required, not both.

---

## Implementation Phases

### Phase 1: Core MVP (Weeks 1–3)

- Server scaffold with dual transport (stdio + Streamable HTTP)
- Lazy-loading tool registry with hierarchical routing
- `pcs_info` tool (list service types, teams, whoami)
- `plan_services` tool: `list_plans` and `get_plan` actions
- Planning Center API client with PAT authentication and rate limiting
- Basic elicitation for service type disambiguation
- npm package structure, Dockerfile, CI/CD pipeline
- MCP Inspector testing

### Phase 2: Song Management (Weeks 4–5)

- `manage_songs` tool: all actions
- Key validation and elicitation
- Arrangement selection with elicitation
- Song search with fuzzy matching (PCO's search is exact; add client-side fuzzy fallback)
- Integration tests against PCO sandbox

### Phase 3: Team Scheduling (Weeks 5–6)

- `manage_team` tool: all actions
- Availability checking with conflict detection
- Scheduling request notifications
- Person search with elicitation for name disambiguation

### Phase 4: Polish & Distribution (Weeks 7–8)

- OAuth 2.0 flow (for multi-user/cloud deployments)
- DigitalOcean App Platform deploy spec + badge
- Cloudflare Workers adapter + deploy badge
- GitHub Container Registry publishing via CI
- README with usage examples for Claude Desktop, Claude Code, and remote configs
- Graceful degradation for clients without elicitation support

---

## Success Metrics

- **Installation**: 50+ npm installs within first 3 months
- **Active usage**: 10+ churches using regularly within 6 months
- **Tool call latency**: < 2 seconds for read operations, < 5 seconds for writes (excluding elicitation wait time)
- **PCO API efficiency**: Average < 3 API calls per tool invocation (via `include` parameters and caching)
- **Client compatibility**: Works in Claude Desktop, Claude Code, and at least one third-party MCP client

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| PCO API rate limits hit during heavy usage | Medium | High | Request queuing, caching, batched includes |
| Elicitation not supported by target clients | Medium | Medium | Graceful degradation to parameter-required mode |
| PCO API breaking changes | Low | High | Pin API version, subscribe to developer mailing list |
| MCP SDK breaking changes (still maturing) | Medium | Medium | Pin SDK version, monitor releases |
| Cloudflare Workers limitations (no Node.js APIs) | Medium | Low | Cloudflare adapter uses Agents SDK; fallback to DO |

---

## Open Questions

1. **Namespace**: Should the npm package be `@canticle/pcs-mcp-server` or something more community-facing like `@planningcenter-mcp/services`?
2. **Caching strategy**: Should we cache PCO responses (song library, team rosters) locally with TTL, or always fetch fresh? Stale data could cause scheduling conflicts.
3. **Webhook support**: Planning Center supports webhooks for plan item changes. Worth implementing a webhook receiver for proactive notifications via MCP, or save for a future phase?
4. **Multi-organization**: Should the server support switching between PCO organizations in a single session, or one org per server instance?
