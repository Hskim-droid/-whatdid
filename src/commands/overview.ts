import { ensureSynced } from "../sync.js";
import { queryTodayOverview, queryAllProjectsReport, queryModelsReport } from "../db.js";
import { formatTokens, formatTokensCompact, todayDate } from "../util.js";

export async function showOverview(): Promise<void> {
  const syncResult = await ensureSynced();

  const today = queryTodayOverview();
  const projects = queryAllProjectsReport();
  const models = queryModelsReport();
  const date = todayDate();

  console.log(`\nqm-tracker — Claude Code Usage Overview`);
  console.log(`${"=".repeat(42)}`);

  // Today's usage
  console.log(`\nToday (${date}):`);
  if (today.total_api_calls === 0) {
    console.log(`  No API calls today.`);
  } else {
    console.log(`  Sessions:       ${today.total_sessions}`);
    console.log(`  API calls:      ${formatTokens(today.total_api_calls)}`);
    console.log(`  Input tokens:   ${formatTokens(today.total_input)}`);
    console.log(`  Output tokens:  ${formatTokens(today.total_output)}`);
    console.log(`  Cache created:  ${formatTokens(today.total_cache_creation)}`);
    console.log(`  Cache read:     ${formatTokens(today.total_cache_read)}`);
    const total = today.total_input + today.total_output + today.total_cache_creation + today.total_cache_read;
    console.log(`  Total tokens:   ${formatTokens(total)}`);
  }

  // Projects summary
  if (projects.length > 0) {
    console.log(`\nProjects (${projects.length}):`);
    const maxName = Math.min(Math.max(...projects.map((p) => (p.project ?? "").length)), 40);
    for (const p of projects.slice(0, 10)) {
      const name = (p.project ?? "unknown").padEnd(maxName);
      const sessions = String(p.session_count ?? 0).padStart(4);
      const tokens = formatTokensCompact(p.total_tokens).padStart(8);
      console.log(`  ${name}  ${sessions} sessions  ${tokens} tokens`);
    }
    if (projects.length > 10) {
      console.log(`  ... and ${projects.length - 10} more`);
    }
  }

  // Models summary
  if (models.length > 0) {
    console.log(`\nModels:`);
    for (const m of models) {
      const name = (m.model ?? "unknown").padEnd(35);
      const calls = String(m.api_calls).padStart(8);
      const tokens = formatTokensCompact(m.total_tokens).padStart(8);
      console.log(`  ${name}  ${calls} calls  ${tokens} tokens`);
    }
  }

  // Sync info
  if (syncResult.sessionsUpdated > 0) {
    console.log(`\n  (synced ${syncResult.sessionsUpdated} sessions in ${syncResult.elapsed}ms)`);
  }
}
