import fs from "node:fs";
import { discoverProjects, discoverSessions, parseSessionJSONL, extractCwdFromJSONL, extractSessionMeta } from "./reader.js";
import {
  getDb,
  getSyncState,
  upsertSyncState,
  upsertProject,
  upsertSession,
  upsertApiCalls,
  recomputeSessionTotals,
} from "./db.js";
import { nowISO } from "./util.js";

export interface SyncResult {
  projectsScanned: number;
  sessionsScanned: number;
  sessionsUpdated: number;
  apiCallsInserted: number;
  elapsed: number;
}

export interface SyncOptions {
  force?: boolean;
  silent?: boolean;
}

/**
 * Sync all Claude Code data into the local SQLite database.
 * Compares file mtime/size with sync_state to only re-parse changed files.
 */
export async function syncAll(opts: SyncOptions = {}): Promise<SyncResult> {
  const start = Date.now();
  const { force = false, silent = false } = opts;

  const projects = discoverProjects();
  let sessionsScanned = 0;
  let sessionsUpdated = 0;
  let apiCallsInserted = 0;

  for (const project of projects) {
    const now = nowISO();
    // Try to extract the real path from the first session JSONL
    let originalPath = project.originalPath;
    if (!originalPath) {
      const sessions = discoverSessions(project.dirPath);
      for (const s of sessions) {
        const cwd = extractCwdFromJSONL(s.jsonlPath);
        if (cwd) { originalPath = cwd; break; }
      }
    }
    const dbProject = upsertProject(project.encodedName, originalPath, now);

    const sessions = discoverSessions(project.dirPath);

    for (const session of sessions) {
      sessionsScanned++;

      // Check if we need to re-parse this file
      const stat = safeStatSync(session.jsonlPath);
      if (!stat) continue;

      const syncState = getSyncState(session.jsonlPath);
      const needsParse =
        force ||
        !syncState ||
        syncState.file_size !== stat.size ||
        syncState.file_mtime !== Math.floor(stat.mtimeMs);

      if (!needsParse) continue;

      // Upsert session metadata: prefer index, fallback to JSONL extraction
      const idx = session.indexEntry;
      let summary = idx?.summary ?? null;
      let firstPrompt = idx?.firstPrompt ?? null;
      let gitBranch = idx?.gitBranch ?? null;
      let messageCount = idx?.messageCount ?? 0;

      // If index is missing key fields, extract directly from JSONL
      if (!firstPrompt) {
        const meta = await extractSessionMeta(session.jsonlPath);
        firstPrompt = meta.firstPrompt;
        if (!gitBranch) gitBranch = meta.gitBranch;
        if (messageCount === 0) messageCount = meta.messageCount;
      }

      // Auto-generate summary from first_prompt when not available
      if (!summary && firstPrompt) {
        summary = summarizePrompt(firstPrompt);
      }

      upsertSession(
        session.sessionId,
        dbProject.id,
        idx?.created || stat.birthtime.toISOString(),
        idx?.modified || stat.mtime.toISOString(),
        summary,
        firstPrompt,
        gitBranch,
        messageCount,
        idx?.isSidechain ?? false,
        session.jsonlPath
      );

      // Parse the main JSONL file
      const calls = await parseSessionJSONL(session.jsonlPath, false);

      // Parse subagent JSONL files
      for (const subPath of session.subagentPaths) {
        const subCalls = await parseSessionJSONL(subPath, true);
        calls.push(...subCalls);
      }

      if (calls.length > 0) {
        upsertApiCalls(session.sessionId, calls);
        apiCallsInserted += calls.length;
      }

      // Recompute totals for this session
      recomputeSessionTotals(session.sessionId);

      // Update sync state
      upsertSyncState({
        jsonl_path: session.jsonlPath,
        file_size: stat.size,
        file_mtime: Math.floor(stat.mtimeMs),
        last_synced_at: nowISO(),
        lines_parsed: calls.length,
      });

      sessionsUpdated++;

      if (!silent && sessionsUpdated % 10 === 0) {
        process.stdout.write(`\r  Synced ${sessionsUpdated} sessions...`);
      }
    }
  }

  if (!silent && sessionsUpdated >= 10) {
    process.stdout.write("\r" + " ".repeat(40) + "\r");
  }

  return {
    projectsScanned: projects.length,
    sessionsScanned,
    sessionsUpdated,
    apiCallsInserted,
    elapsed: Date.now() - start,
  };
}

/** Ensure data is synced before running a report. No-op if nothing changed. */
export async function ensureSynced(opts?: SyncOptions): Promise<SyncResult> {
  return syncAll({ silent: true, ...opts });
}

/**
 * Generate a concise summary from first_prompt when sessions-index.json
 * doesn't provide one.
 */
function summarizePrompt(prompt: string): string {
  let text = prompt.trim();

  // "Implement the following plan:\n\n# Title here" → extract title
  const planMatch = text.match(
    /^Implement the following plan:\s*[\r\n]+#\s+(.+)/
  );
  if (planMatch) return planMatch[1].trim().slice(0, 100);

  // Strip shell prompt prefix (❯, $, >)
  text = text.replace(/^[❯$>]\s*/, "");

  // First line only
  text = text.split(/[\r\n]/)[0].trim();

  // URL-only prompt: shorten
  if (/^https?:\/\/\S+$/.test(text)) {
    try {
      const u = new URL(text);
      return u.hostname + u.pathname.slice(0, 60);
    } catch {
      // fall through
    }
  }

  if (text.length <= 100) return text;
  return text.slice(0, 97) + "...";
}

function safeStatSync(filePath: string): fs.Stats | null {
  try {
    return fs.statSync(filePath);
  } catch {
    return null;
  }
}
