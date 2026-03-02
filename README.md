# whatdid

**Qualitative work tracker for Claude Code** — know *what* you did, not just how many tokens you used.

whatdid parses the session JSONL files that Claude Code stores in `~/.claude/projects/`, indexes them into a local SQLite database, and exposes both a CLI and an MCP server for querying your work history.

## How it differs from token counters

Tools like [ccusage](https://github.com/ryoppippi/ccusage) answer **"how much did I use?"** (tokens, costs, models).

whatdid answers **"what did I do?"**:

- Session summaries auto-generated from your prompts
- Keyword search across all past sessions
- Project/branch-aware activity patterns
- "Morning briefing" and "evening review" MCP prompts

It also pre-indexes everything in SQLite, so repeated queries are instant — no re-parsing JSONL files on every call.

## Install

```bash
git clone https://github.com/Hskim-droid/whatdid.git
cd whatdid
npm install
npm run build
```

Requires Node.js >= 20 and a C++ toolchain for [better-sqlite3](https://github.com/WiseLibs/better-sqlite3#requirements).

## CLI Usage

Data syncs automatically on every command. Use `whatdid sync` to sync manually.

```bash
# Today's overview (default command)
whatdid

# Session list with filters
whatdid sessions
whatdid sessions --project my-project --since 2025-01-01

# Single session detail
whatdid session <session-id>

# Project list
whatdid projects

# Reports (daily / weekly / project / models)
whatdid report daily --date 2025-03-15
whatdid report weekly --format csv
whatdid report project my-project --format html --output report.html
whatdid report models

# Force full re-sync
whatdid sync --force
```

Output formats: `table` (default), `csv`, `json`, `html`.

## MCP Server

whatdid ships an MCP server that lets Claude Code query your work history in conversation.

### Setup

Add to `~/.claude/.mcp.json`:

```json
{
  "mcpServers": {
    "whatdid": {
      "command": "node",
      "args": ["/absolute/path/to/whatdid/dist/mcp.js"]
    }
  }
}
```

Restart Claude Code. The following tools and prompts become available.

### Tools

| Tool | Description |
|------|-------------|
| `get_work_summary` | What you worked on for a given date — sessions grouped by project with summaries, branches, duration |
| `get_work_activity` | Activity patterns over the last N days — daily trends, active projects/branches, recent sessions |
| `get_session_detail` | Deep dive into a single session (supports partial ID matching) |
| `search_sessions` | Keyword search across session summaries and first prompts, with project/date filters |

### Prompts

| Prompt | Description |
|--------|-------------|
| `morning_briefing` | Yesterday's recap + today's task suggestions |
| `evening_briefing` | Today's recap + tomorrow's suggestions |

### Example

After setup, you can ask Claude Code things like:

- "What did I work on yesterday?"
- "Find all sessions related to ChatService"
- "Give me a morning briefing"
- "Show me recent activity on the whatdid project"

## How it works

1. Scans `~/.claude/projects/` for project directories
2. Reads `sessions-index.json` and `.jsonl` session files
3. Extracts API call usage from `type: "assistant"` messages (deduplicated by `requestId`)
4. Extracts session metadata (first prompt, git branch, message count) directly from JSONL
5. Auto-generates summaries from the first prompt when `sessions-index.json` doesn't provide one
6. Stores everything in SQLite with incremental sync (only re-parses changed files)
7. Subagent JSONL files are also parsed

## Data model

5 tables in a local SQLite database (`data/tracker.db`, auto-created):

| Table | Purpose |
|-------|---------|
| `sync_state` | Per-file sync tracking (mtime, size) |
| `projects` | Project metadata (encoded name, original path) |
| `sessions` | Session metadata (summary, first prompt, git branch, message count) |
| `api_calls` | Per-API-call token usage |
| `session_totals` | Denormalized session aggregates for fast queries |

Uses WAL mode for safe concurrent access.

## Project structure

```
src/
├── cli.ts              # CLI entry point
├── mcp.ts              # MCP server entry point
├── mcp-tools.ts        # MCP tool/prompt definitions
├── db.ts               # SQLite schema + queries
├── reader.ts           # JSONL parsing + metadata extraction
├── sync.ts             # Incremental sync engine
├── types.ts            # Zod schemas + TypeScript types
├── util.ts             # Time/path utilities
├── commands/           # CLI command handlers
│   ├── overview.ts
│   ├── sessions.ts
│   ├── session.ts
│   ├── projects.ts
│   ├── report.ts
│   └── sync.ts
└── format/             # Output formatters
    ├── csv.ts
    ├── json.ts
    └── html.ts
```

## Development

```bash
# Run directly with tsx
npx tsx src/cli.ts
npx tsx src/cli.ts sessions

# Build
npm run build

# Test MCP server manually
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}}}' | node dist/mcp.js
```

## Dependencies

- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) — SQLite bindings
- [zod](https://github.com/colinhacks/zod) — Runtime schema validation
- [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/typescript-sdk) — MCP server framework

## License

[MIT](LICENSE)
