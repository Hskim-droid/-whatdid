import { ensureSynced } from "../sync.js";
import { queryAllProjectsReport, getAllProjects } from "../db.js";
import { formatTokens, formatTokensCompact } from "../util.js";

export async function listProjects(): Promise<void> {
  await ensureSynced();

  const projects = queryAllProjectsReport();
  if (projects.length === 0) {
    console.log("No projects found. Run `whatdid sync` first.");
    return;
  }

  console.log(`\nProjects`);
  console.log(`${"=".repeat(40)}`);

  console.log(
    `${"Project".padEnd(45)}  ${"Sessions".padStart(8)}  ${"Calls".padStart(8)}  ${"Input".padStart(10)}  ${"Output".padStart(10)}  ${"Cache+".padStart(10)}  ${"CacheR".padStart(10)}  ${"Total".padStart(10)}`
  );
  console.log("-".repeat(120));

  for (const p of projects) {
    const name = (p.project ?? "unknown").slice(0, 45).padEnd(45);
    const sessions = String(p.session_count ?? 0).padStart(8);
    const calls = String(p.api_calls).padStart(8);
    const input = formatTokensCompact(p.input_tokens).padStart(10);
    const output = formatTokensCompact(p.output_tokens).padStart(10);
    const cacheC = formatTokensCompact(p.cache_creation).padStart(10);
    const cacheR = formatTokensCompact(p.cache_read).padStart(10);
    const total = formatTokensCompact(p.total_tokens).padStart(10);
    console.log(`${name}  ${sessions}  ${calls}  ${input}  ${output}  ${cacheC}  ${cacheR}  ${total}`);
  }

  console.log(`\n${projects.length} project(s) total.`);
}
