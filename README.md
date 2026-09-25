# mcp-us-gov-contracts

US Government Contracts MCP — awarded state & local government contracts,

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1679+ live data sources.

## Tools

| Tool | Description |
|------|-------------|
| `gov_contracts_search` | Search AWARDED US state & local government contracts, normalized across jurisdictions (keyless open data). Filter by vendor (winning supplier), keyword (contract title/description), awarding agency, and minimum dollar amount. Covers state and county contract registries — pass a `jurisdiction` key (see gov_contracts_jurisdictions) to target one, or omit it to search all covered jurisdictions at once. Returns each contract with its ID, vendor, title, agency, amount, and dates. This is STATE/LOCAL award data (for federal contracts use USAspending/SAM tools). |
| `gov_spending_search` | Search US STATE government spending / vendor payments — the 'checkbook' data of what an agency actually PAID a vendor (distinct from an awarded contract's value). Keyless. Filter by vendor, awarding agency, spending category keyword, and minimum amount. Pass a `jurisdiction` key (see gov_contracts_jurisdictions) to target one state, or omit it to search all covered states. Returns vendor, agency, amount, category, and fiscal year. Use gov_contracts_search for awarded contracts; use this for actual payments/expenditures. |
| `gov_contracts_jurisdictions` | List the US state & local jurisdictions covered by this pack, split into contract-award jurisdictions (gov_contracts_search) and spending/checkbook jurisdictions (gov_spending_search), with each one's key, level (state/county/city), data platform, source dataset URL, and live record count. |

## Quick Start

Add to your MCP client (Claude Desktop, Cursor, Windsurf, etc.):

```json
{
  "mcpServers": {
    "us-gov-contracts": {
      "url": "https://gateway.pipeworx.io/us-gov-contracts/mcp"
    }
  }
}
```

### What this endpoint actually serves

`tools/list` at `https://gateway.pipeworx.io/us-gov-contracts/mcp` returns the tools in the table
above **plus the shared Pipeworx meta-tools** — `ask_pipeworx`,
`discover_tools`, `search_within`, `remember`/`recall` and the rest of the
gateway-wide set. So the tool count you see is larger than this table: a
single-pack endpoint currently lists roughly 30 shared tools alongside the
pack's own. The connection's `initialize` response states its exact scope, and
is the authoritative answer for a given day.

This is deliberate, not multiplexing by accident. The meta-tools are what let a
scoped connection answer a question this pack does not cover — via
`ask_pipeworx`, which routes across the whole catalog — without you adding a
second MCP server. There is currently no way to mount a pack endpoint without
them; if the extra schemas cost you more context than the routing is worth,
connect to the full gateway once rather than to several pack endpoints.

Or connect to the full Pipeworx gateway to get every pack's tools listed
directly, instead of just this one's:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

Both URLs reach the same gateway and the same 1679+ data sources. The
only difference is which pack's tools are listed **directly**; `ask_pipeworx`
reaches all of them from either one.

## No MCP client? Call it over HTTP

```bash
curl -X POST https://gateway.pipeworx.io/v1/tools/gov_contracts_search \
  -H 'Content-Type: application/json' \
  -d '{"jurisdiction":"tx","vendor":"Microsoft","keyword":"software","min_amount":50000,"limit":20}'
```

No account needed for the first calls. Inspect any tool: `GET https://gateway.pipeworx.io/v1/tools/gov_contracts_search`. Find one: `POST https://gateway.pipeworx.io/v1/tools/search_packs` with `{"query":"..."}`.

## Standalone (no gateway account)

This package also runs as a local stdio MCP server — no Pipeworx account, no
gateway round-trip:

```json
{
  "mcpServers": {
    "us-gov-contracts": {
      "command": "npx",
      "args": ["-y", "@pipeworx/mcp-us-gov-contracts"]
    }
  }
}
```

Or run it directly to confirm it starts:

```bash
npx -y @pipeworx/mcp-us-gov-contracts
```

It speaks MCP over stdin/stdout and answers `initialize`/`tools/list`/`tools/call`
for **only** this pack's tools — none of the shared meta-tools the gateway
connection above adds. Same source, same tools, no ask_pipeworx routing.

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English —
this works on the pack endpoint above as well as on the full gateway:

```
ask_pipeworx({ question: "your question about Us Gov Contracts data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
