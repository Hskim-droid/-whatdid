import { ensureSynced } from "../sync.js";
import { querySessions, findProjectId } from "../db.js";
import { fmtTime, duration, formatTokensCompact } from "../util.js";

export async function listSessions(
  projectFilter?: string,
  since?: string
): Promise<void> {
  await ensureSynced();

  let projectId: number | undefined;
  if (projectFilter) {
    const id = findProjectId(projectFilter);
    if (id === null) {
      console.log(`No project matching "${projectFilter}" found.`);
      return;
    }
    projectId = id;
  }

  const sessions = querySessions(projectId, since);
  if (sessions.length === 0) {
    console.log("No sessions found.");
    return;
  }

  console.log(
    `${"Session ID".padEnd(38)}  ${"Created".padEnd(20)}  ${"Duration".padEnd(10)}  ${"Calls".padStart(5)}  ${"Output".padStart(8)}  ${"Total".padStart(8)}  Summary`
  );
  console.log("-".repeat(120));

  for (const s of sessions) {
    const id = s.session_id.slice(0, 8) + "...";
    const created = fmtTime(s.created_at).padEnd(20);
    const dur = duration(s.created_at, s.modified_at).padEnd(10);
    const calls = String(s.total_api_calls).padStart(5);
    const output = formatTokensCompact(s.total_output).padStart(8);
    const total = formatTokensCompact(
      s.total_input + s.total_output + s.total_cache_creation + s.total_cache_read
    ).padStart(8);
    const summary = (s.summary || s.first_prompt || "").slice(0, 40);
    console.log(`${id.padEnd(38)}  ${created}  ${dur}  ${calls}  ${output}  ${total}  ${summary}`);
  }

  console.log(`\n${sessions.length} session(s) total.`);
}
