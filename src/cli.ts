import { showOverview } from "./commands/overview.js";
import { listSessions } from "./commands/sessions.js";
import { showSession } from "./commands/session.js";
import { listProjects } from "./commands/projects.js";
import { dailyReport, weeklyReport, projectReport, modelsReport } from "./commands/report.js";
import { runSync } from "./commands/sync.js";
import type { ReportFormat } from "./types.js";

const args = process.argv.slice(2);
const command = args[0];

function flag(name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return undefined;
  return args[i + 1];
}

function hasFlag(name: string): boolean {
  return args.includes(`--${name}`);
}

function getFormat(): ReportFormat {
  const f = flag("format");
  if (f === "csv" || f === "json" || f === "html" || f === "table") return f;
  if (f) {
    console.warn(`Unknown format "${f}". Using table output.`);
  }
  return "table";
}

async function main(): Promise<void> {
  switch (command) {
    case undefined:
    case "overview":
      await showOverview();
      break;

    case "sessions":
      await listSessions(flag("project"), flag("since"));
      break;

    case "session": {
      const id = args[1];
      if (!id) {
        throw new Error("Usage: whatdid session <session-id>");
      }
      await showSession(id);
      break;
    }

    case "projects":
      await listProjects();
      break;

    case "report": {
      const sub = args[1];
      const fmt = getFormat();
      const out = flag("output");
      switch (sub) {
        case "daily":
          await dailyReport(flag("date"), fmt, out);
          break;
        case "weekly":
          await weeklyReport(fmt, out);
          break;
        case "project": {
          const name = args[2];
          if (!name) {
            throw new Error("Usage: whatdid report project <name> [--format csv|json|html]");
          }
          await projectReport(name, fmt, out);
          break;
        }
        case "models":
          await modelsReport(fmt, out);
          break;
        default:
          throw new Error("Usage: whatdid report <daily|weekly|project|models> [options]");
      }
      break;
    }

    case "sync":
      await runSync(hasFlag("force"));
      break;

    default:
      console.log(`whatdid — Claude Code usage tracker

Commands:
  (no args)                              Overview: today's usage, projects, models
  sessions [--project X] [--since DATE]  List sessions with token totals
  session <id>                           Single session detail (API calls)
  projects                               Per-project aggregation
  report daily [--date YYYY-MM-DD]       Daily report by model
  report weekly                          Weekly report by day
  report project <name>                  Project report
  report models                          Models breakdown
  sync [--force]                         Manual data sync

Options:
  --format table|csv|json|html           Output format (default: table)
  --output <path>                        Save report to file`);
      if (command !== "help" && command !== "--help" && command !== "-h") {
        process.exitCode = 1;
      }
  }
}

main().catch((err) => {
  if (err.message) console.error(err.message);
  process.exitCode = 1;
});
