# @asachs01/pcs-mcp-server

[![CI](https://github.com/asachs01/pcs-mcp-server/actions/workflows/ci.yml/badge.svg)](https://github.com/asachs01/pcs-mcp-server/actions/workflows/ci.yml)
[![Deploy to DigitalOcean](https://www.deploytodo.com/do-btn-blue.svg)](https://cloud.digitalocean.com/apps/new?repo=https://github.com/asachs01/pcs-mcp-server/tree/main)

## Docker

```bash
docker pull ghcr.io/asachs01/pcs-mcp-server:latest
```

**Deploy to Cloudflare Workers:** (Phase 4 — placeholder)

A [Model Context Protocol](https://modelcontextprotocol.io) server for **Planning Center Services**. Plan worship services, manage songs, and schedule volunteers through natural-language conversations in any MCP-compatible client (Claude Desktop, Claude Code, Claude.ai connectors, MCP Inspector, etc.).

## Highlights

- Hierarchical tool routing — 4 Level-0 tools expose 20+ actions via an `action` parameter.
- Lazy module loading — tool modules load on first invocation.
- Dual transport — stdio for local clients, Streamable HTTP for remote/cloud deployments.
- MCP elicitation — interactive disambiguation for service types, arrangements, keys; graceful degradation when the client lacks elicitation support.

## What it does

Lets church staff drive Planning Center Services from natural language. Say "Add 'Amazing Grace' in D to this Sunday's 10:30 service" and the server resolves the service type, picks the right plan, searches the song library, and (if the arrangement or key is missing) prompts you interactively before posting to PCO.

## Quick start (local, stdio)

```bash
npm install -g @asachs01/pcs-mcp-server

export PCO_PAT_APP_ID=...
export PCO_PAT_SECRET=...

pcs-mcp-server --transport stdio
```

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
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
```

### Claude Code

```bash
claude mcp add planning-center -- npx -y @asachs01/pcs-mcp-server
```

## Tool reference

Each Level-0 tool takes an `action` enum plus action-specific parameters.

### `pcs_info`

Read-only discovery.

| Action | Description |
|---|---|
| `list_service_types` | All service types in the organization. |
| `list_teams` | Teams for a `serviceTypeId`. |
| `list_tag_groups` | Song tag groups. |
| `whoami` | Authenticated user info. |

### `plan_services`

Service plan CRUD.

| Action | Description |
|---|---|
| `list_plans` | Plans for a service type, optionally filtered by `startDate` / `endDate`. |
| `get_plan` | A specific plan by `planId`. |
| `get_plan_items` | Items (songs, headers, media) in a plan. |
| `create_plan` | Create a plan (`title`, `date`). |
| `update_plan` | Update `title` and/or `date`. |
| `reorder_items` | Reorder plan items via `itemIds`. |

### `manage_songs`

Song library and plan-item management.

| Action | Description |
|---|---|
| `search_songs` | Search by `query`, `author`, or `ccliNumber`. |
| `get_song_details` | Full metadata for a `songId`. |
| `list_arrangements` | Arrangements for a `songId`. |
| `add_song_to_plan` | Add a song to a plan; elicits arrangement and key if omitted. |
| `set_song_key` | Update `key_name` on an existing plan item. |
| `remove_song` | Delete a plan item. |

### `manage_team`

Volunteer scheduling.

| Action | Description |
|---|---|
| `list_team_members` | Members of a `teamId`. |
| `list_plan_people` | People scheduled to a `planId`. |
| `assign_person` | Schedule `personId` to `planId` on `teamId` (optional `positionName`). |
| `check_availability` | Check `personId` against blockouts for `date`. |
| `send_scheduling_request` | Send the request for a `planPersonId` (sets status to `U`). |
| `accept_decline` | Set `status` to `accepted` or `declined` for a `planPersonId`. |

## Usage examples

### 1. "What service types do we have?"

```json
{
  "tool": "pcs_info",
  "arguments": { "action": "list_service_types" }
}
```

Result:

```json
[
  { "id": "424242", "name": "10:30 AM Rite II", "sequence": 1 },
  { "id": "424243", "name": "8:00 AM Rite I",  "sequence": 2 }
]
```

### 2. "What's on the schedule for the next 4 Sundays?"

```json
{
  "tool": "plan_services",
  "arguments": {
    "action": "list_plans",
    "serviceTypeId": "424242",
    "startDate": "2026-05-24",
    "endDate": "2026-06-14",
    "limit": 10
  }
}
```

Result:

```json
[
  { "id": "8811", "title": "Easter VI", "dates": "May 24, 2026", "sortDate": "2026-05-24", "url": "https://services.planningcenteronline.com/plans/8811" },
  { "id": "8812", "title": "Easter VII", "dates": "May 31, 2026", "sortDate": "2026-05-31", "url": "https://services.planningcenteronline.com/plans/8812" }
]
```

If `serviceTypeId` is omitted and `PCO_DEFAULT_SERVICE_TYPE_ID` is unset, the server elicits a choice from the available service types.

### 3. "Add 'Amazing Grace' to Sunday's service in the key of D"

First, find the song:

```json
{
  "tool": "manage_songs",
  "arguments": { "action": "search_songs", "query": "Amazing Grace" }
}
```

Then add it to the plan:

```json
{
  "tool": "manage_songs",
  "arguments": {
    "action": "add_song_to_plan",
    "planId": "8811",
    "songId": "9921",
    "serviceTypeId": "424242",
    "key": "D"
  }
}
```

`arrangementId` was omitted — if the song has more than one arrangement, the server elicits a choice before posting. If `key` were also omitted, a second elicitation prompts for the key (defaulting to the arrangement's `chord_chart_key` when available). Clients without elicitation support get a descriptive error telling them to specify `arrangementId` and `key` explicitly.

### 4. "Schedule John Smith as guitarist on Sunday"

Look up the team to find his ID:

```json
{
  "tool": "manage_team",
  "arguments": {
    "action": "list_team_members",
    "serviceTypeId": "424242",
    "teamId": "771"
  }
}
```

Check availability before scheduling:

```json
{
  "tool": "manage_team",
  "arguments": {
    "action": "check_availability",
    "personId": "55501",
    "date": "2026-05-24"
  }
}
```

Then assign:

```json
{
  "tool": "manage_team",
  "arguments": {
    "action": "assign_person",
    "serviceTypeId": "424242",
    "planId": "8811",
    "teamId": "771",
    "personId": "55501",
    "positionName": "Guitar"
  }
}
```

Follow with `send_scheduling_request` against the returned `planPersonId` to notify John.

## Configuration

All configuration via environment variables:

| Variable | Required | Default | Description |
|---|---|---|---|
| `PCO_PAT_APP_ID` | yes* | — | Planning Center Personal Access Token app ID |
| `PCO_PAT_SECRET` | yes* | — | Planning Center Personal Access Token secret |
| `PCO_OAUTH_CLIENT_ID` | yes* | — | OAuth 2.0 client ID (Phase 4) |
| `PCO_OAUTH_CLIENT_SECRET` | yes* | — | OAuth 2.0 client secret (Phase 4) |
| `PCO_OAUTH_REDIRECT_URI` | no | `http://localhost:3000/callback` | OAuth redirect URI |
| `TRANSPORT` | no | `stdio` | `stdio` or `http` |
| `PORT` | no | `3000` | HTTP transport port |
| `LOG_LEVEL` | no | `info` | `error` \| `warn` \| `info` \| `debug` |
| `PCO_DEFAULT_SERVICE_TYPE_ID` | no | — | Skip service-type elicitation when only one is used |

*Provide **either** PAT credentials **or** OAuth credentials.

## Authentication modes

- **Personal Access Token (PAT)** — single-user. Generate a token at [api.planningcenteronline.com/oauth/applications](https://api.planningcenteronline.com/oauth/applications) and set `PCO_PAT_APP_ID` + `PCO_PAT_SECRET`. The server uses HTTP Basic auth. This is the recommended mode for local Claude Desktop / Claude Code use.
- **OAuth 2.0** — multi-tenant deployments. Set `PCO_OAUTH_CLIENT_ID` + `PCO_OAUTH_CLIENT_SECRET` and run `pcs-mcp-server authorize` to complete the browser-based authorization flow. Tokens are saved to `~/.pcs-mcp/tokens.json` and automatically refreshed. After the one-time setup, the server works normally in stdio mode with any MCP client. See [Planning Center authentication docs](https://developer.planning.center/docs/#/overview/authentication).

## Development

```bash
git clone https://github.com/asachs01/pcs-mcp-server.git
cd pcs-mcp-server
npm install

# Smoke test against the live PCO API (requires .env with PAT credentials)
npm run smoke

# Unit tests
npm test

# Build
npm run build
```

`npm run dev` runs the server under `tsx watch` for iterative development. `npm run typecheck` and `npm run lint` are wired into CI.

## Roadmap

- **Phase 1** (done) — Scaffold, dual transports, `pcs_info`, `plan_services`.
- **Phase 2** (done) — `manage_songs` with arrangement/key elicitation.
- **Phase 3** (done) — `manage_team` scheduling.
- **Phase 4** — OAuth 2.0 flow, Docker image polish, DigitalOcean App Platform, Cloudflare Workers.

## License

MIT
