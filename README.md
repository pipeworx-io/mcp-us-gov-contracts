# mcp-us-gov-contracts

US Government Contracts MCP — awarded state & local government contracts,

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1394+ live data sources.

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

Or connect to the full Pipeworx gateway for access to all 1394+ data sources:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English:

```
ask_pipeworx({ question: "your question about Us Gov Contracts data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
