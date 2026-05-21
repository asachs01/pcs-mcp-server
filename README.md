# @canticle/pcs-mcp-server

A [Model Context Protocol](https://modelcontextprotocol.io) server for **Planning Center Services**. Plan worship services, manage songs, and schedule volunteers through natural-language conversations in any MCP-compatible client (Claude Desktop, Claude Code, Claude.ai connectors, MCP Inspector, etc.).

> **Status:** Phase 1 (MVP) in active development. See [`.taskmaster/docs/prd.txt`](.taskmaster/docs/prd.txt) for the full product spec.

## Highlights

- **Hierarchical tool routing** — 4 Level-0 tools (`plan_services`, `manage_songs`, `manage_team`, `pcs_info`) keep the LLM's tool list compact while exposing 20+ actions via an `action` parameter.
- **Lazy module loading** — Tool modules load on first invocation to minimize startup time.
- **Dual transport** — stdio for local clients, Streamable HTTP for remote/cloud deployments.
- **MCP elicitation** — Interactive disambiguation for service types, song keys, person assignments. Graceful degradation when the client doesn't support elicitation.
- **PAT or OAuth 2.0** — Personal Access Tokens for single-user, OAuth for multi-tenant deployments (Phase 4).

## Quick start (local, stdio)

```bash
npm install -g @canticle/pcs-mcp-server

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
      "args": ["-y", "@canticle/pcs-mcp-server"],
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
claude mcp add planning-center -- npx -y @canticle/pcs-mcp-server
```

## Configuration

| Variable | Required | Default | Description |
|---|---|---|---|
| `PCO_PAT_APP_ID` | ✓* | — | Planning Center Personal Access Token app ID |
| `PCO_PAT_SECRET` | ✓* | — | Planning Center Personal Access Token secret |
| `PCO_OAUTH_CLIENT_ID` | ✓* | — | OAuth client ID (Phase 4) |
| `PCO_OAUTH_CLIENT_SECRET` | ✓* | — | OAuth client secret (Phase 4) |
| `TRANSPORT` | — | `stdio` | `stdio` or `http` |
| `PORT` | — | `3000` | HTTP transport port |
| `LOG_LEVEL` | — | `info` | `error` \| `warn` \| `info` \| `debug` |
| `PCO_DEFAULT_SERVICE_TYPE_ID` | — | — | Skip service-type elicitation when only one is used |

*Provide **either** PAT credentials **or** OAuth credentials.

## Roadmap

- **Phase 1 (current)** — Scaffold, transports, `pcs_info`, `plan_services` (list/get).
- **Phase 2** — Song management with elicitation.
- **Phase 3** — Team scheduling.
- **Phase 4** — OAuth, Docker, DigitalOcean App Platform, Cloudflare Workers.

## License

MIT
