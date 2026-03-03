# whatdid

[![Node.js >= 20](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org/) [![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

**Qualitative work tracker for Claude Code** — know *what* you did, not just how many tokens you used.

whatdid parses the session JSONL files that Claude Code stores in `~/.claude/projects/`, indexes them into a local SQLite database, and provides a CLI for querying your work history.

## How it differs from token counters

Tools like [ccusage](https://github.com/ryoppippi/ccusage) answer **"how much did I use?"** (tokens, costs, models).

whatdid answers **"what did I do?"**:

- Session summaries auto-generated from your prompts
- Project/branch-aware activity patterns

It also pre-indexes everything in SQLite, so repeated queries are instant — no re-parsing JSONL files on every call.

## Install

```bash
git clone https://github.com/Hskim-droid/-whatdid.git whatdid
cd whatdid
npm install
npm run build
npm link
```

This registers the `whatdid` command globally.

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

### Example output

```
whatdid — Claude Code Usage Overview
==========================================

Today (2025-03-15):
  Sessions:       3
  API calls:      47
  Input tokens:   1,245,800
  Output tokens:  38,420
  Cache created:  0
  Cache read:     892,100
  Total tokens:   2,176,320

Projects (2):
  my-app      12 sessions   4.2M tokens
  whatdid       5 sessions   1.8M tokens

Models:
  claude-sonnet-4-20250514             39 calls   5.1M tokens
  claude-haiku-4-20250506               8 calls   912K tokens
```

## How it works

1. Scans `~/.claude/projects/` for project directories
2. Reads `sessions-index.json` and `.jsonl` session files
3. Extracts API call usage from `type: "assistant"` messages (deduplicated by `requestId`)
4. Extracts session metadata (first prompt, git branch, message count) directly from JSONL
5. Auto-generates summaries from the first prompt when `sessions-index.json` doesn't provide one
6. Stores everything in SQLite with incremental sync (only re-parses changed files)
7. Parses subagent JSONL files alongside main sessions

## Data model

5 tables in a local SQLite database (`~/.whatdid/tracker.db`, auto-created):

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
```

## Dependencies

- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) — SQLite bindings
- [zod](https://github.com/colinhacks/zod) — Runtime schema validation

## License

[MIT](LICENSE)
