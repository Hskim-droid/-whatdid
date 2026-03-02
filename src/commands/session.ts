import { ensureSynced } from "../sync.js";
import { getDb, getSession, getApiCallsForSession } from "../db.js";
import { fmtTime, formatTokens, duration } from "../util.js";
import type { DbSession } from "../types.js";

export async function showSession(sessionId: string): Promise<void> {
  await ensureSynced();

  const session = findSession(sessionId);
  if (!session) {
    console.log(`Session "${sessionId}" not found.`);
    return;
  }

  const calls = getApiCallsForSession(session.session_id);

  console.log(`\nSession: ${session.session_id}`);
  console.log(`${"=".repeat(50)}`);
  console.log(`  Created:      ${fmtTime(session.created_at)}`);
  console.log(`  Modified:     ${fmtTime(session.modified_at)}`);
  console.log(`  Duration:     ${duration(session.created_at, session.modified_at)}`);
  if (session.summary) console.log(`  Summary:      ${session.summary}`);
  if (session.first_prompt) console.log(`  First prompt: ${session.first_prompt.slice(0, 80)}`);
  if (session.git_branch) console.log(`  Git branch:   ${session.git_branch}`);
  console.log(`  Messages:     ${session.message_count}`);
  console.log(`  API calls:    ${calls.length}`);

  if (calls.length === 0) {
    console.log(`\n  No API calls found.`);
    return;
  }

  // Aggregate totals
  let totalInput = 0;
  let totalOutput = 0;
  let totalCacheCreate = 0;
  let totalCacheRead = 0;
  const modelCounts = new Map<string, number>();

  for (const c of calls) {
    totalInput += c.input_tokens;
    totalOutput += c.output_tokens;
    totalCacheCreate += c.cache_creation_input_tokens;
    totalCacheRead += c.cache_read_input_tokens;
    modelCounts.set(c.model, (modelCounts.get(c.model) ?? 0) + 1);
  }

  const total = totalInput + totalOutput + totalCacheCreate + totalCacheRead;

  console.log(`\n  Token totals:`);
  console.log(`    Input:          ${formatTokens(totalInput)}`);
  console.log(`    Output:         ${formatTokens(totalOutput)}`);
  console.log(`    Cache created:  ${formatTokens(totalCacheCreate)}`);
  console.log(`    Cache read:     ${formatTokens(totalCacheRead)}`);
  console.log(`    Total:          ${formatTokens(total)}`);

  console.log(`\n  Models used:`);
  for (const [model, count] of modelCounts) {
    console.log(`    ${model}: ${count} calls`);
  }

  // API call details
  console.log(`\n  API calls:`);
  console.log(
    `  ${"#".padStart(4)}  ${"Time".padEnd(24)}  ${"Model".padEnd(30)}  ${"In".padStart(8)}  ${"Out".padStart(8)}  ${"Cache+".padStart(8)}  ${"CacheR".padStart(8)}  ${"Stop".padEnd(10)}  Sub`
  );
  console.log(`  ${"-".repeat(120)}`);

  for (let i = 0; i < calls.length; i++) {
    const c = calls[i];
    const num = String(i + 1).padStart(4);
    const time = fmtTime(c.timestamp).padEnd(24);
    const model = c.model.padEnd(30);
    const input = formatTokens(c.input_tokens).padStart(8);
    const output = formatTokens(c.output_tokens).padStart(8);
    const cacheC = formatTokens(c.cache_creation_input_tokens).padStart(8);
    const cacheR = formatTokens(c.cache_read_input_tokens).padStart(8);
    const stop = (c.stop_reason || "-").padEnd(10);
    const sub = c.is_subagent ? "Y" : "";
    console.log(`  ${num}  ${time}  ${model}  ${input}  ${output}  ${cacheC}  ${cacheR}  ${stop}  ${sub}`);
  }
}

function findSession(partialId: string): DbSession | null {
  const db = getDb();

  // Try exact match
  let session = db
    .prepare(`SELECT * FROM sessions WHERE session_id = ?`)
    .get(partialId) as DbSession | undefined;
  if (session) return session;

  // Try prefix match
  session = db
    .prepare(`SELECT * FROM sessions WHERE session_id LIKE ?`)
    .get(partialId + "%") as DbSession | undefined;
  return session ?? null;
}
