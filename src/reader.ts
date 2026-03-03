import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { claudeProjectsDir } from "./util.js";
import { SessionsIndexSchema, type SessionIndexEntry, type ApiCall } from "./types.js";

/** Discovered project from ~/.claude/projects/ */
export interface DiscoveredProject {
  encodedName: string;
  dirPath: string;
  originalPath: string | null;
}

/** Discovered session from a project */
export interface DiscoveredSession {
  sessionId: string;
  jsonlPath: string;
  indexEntry: SessionIndexEntry | null;
  subagentPaths: string[];
}

/** Discover all projects under ~/.claude/projects/ */
export function discoverProjects(): DiscoveredProject[] {
  const projectsDir = claudeProjectsDir();
  if (!fs.existsSync(projectsDir)) return [];

  const entries = fs.readdirSync(projectsDir, { withFileTypes: true });
  const projects: DiscoveredProject[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dirPath = path.join(projectsDir, entry.name);
    // originalPath is resolved later from session JSONL cwd fields
    projects.push({
      encodedName: entry.name,
      dirPath,
      originalPath: null,
    });
  }

  return projects;
}

/** Extract the original cwd path from the first few lines of a JSONL file. */
export function extractCwdFromJSONL(filePath: string): string | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    // Read a small chunk instead of the entire file
    const fd = fs.openSync(filePath, "r");
    const buf = Buffer.alloc(8192);
    const bytesRead = fs.readSync(fd, buf, 0, 8192, 0);
    fs.closeSync(fd);
    const lines = buf.toString("utf-8", 0, bytesRead).split("\n", 20);
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        if (entry.cwd) return entry.cwd;
      } catch {
        continue;
      }
    }
  } catch {
    // ignore
  }
  return null;
}

/** Discover all sessions within a project directory. */
export function discoverSessions(projectDir: string): DiscoveredSession[] {
  // Read sessions-index.json if it exists
  const indexPath = path.join(projectDir, "sessions-index.json");
  const indexEntries = new Map<string, SessionIndexEntry>();

  if (fs.existsSync(indexPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(indexPath, "utf-8"));
      const parsed = SessionsIndexSchema.parse(raw);
      for (const entry of parsed.entries) {
        indexEntries.set(entry.sessionId, entry);
      }
    } catch {
      // Ignore parse errors, fall back to scanning
    }
  }

  // Scan for .jsonl files
  const sessions: DiscoveredSession[] = [];
  const dirEntries = fs.readdirSync(projectDir, { withFileTypes: true });

  for (const entry of dirEntries) {
    if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      const sessionId = entry.name.replace(".jsonl", "");
      const jsonlPath = path.join(projectDir, entry.name);
      const indexEntry = indexEntries.get(sessionId) ?? null;

      // Check for subagent directory
      const subagentDir = path.join(projectDir, sessionId, "subagents");
      const subagentPaths: string[] = [];
      if (fs.existsSync(subagentDir)) {
        const subEntries = fs.readdirSync(subagentDir);
        for (const sub of subEntries) {
          if (sub.endsWith(".jsonl")) {
            subagentPaths.push(path.join(subagentDir, sub));
          }
        }
      }

      sessions.push({ sessionId, jsonlPath, indexEntry, subagentPaths });
    }
  }

  return sessions;
}

/** Metadata extracted directly from JSONL when sessions-index.json is unavailable. */
export interface JsonlMeta {
  firstPrompt: string | null;
  bestPrompt: string | null;
  gitBranch: string | null;
  messageCount: number;
}

/** Patterns that indicate a "meta" prompt with no real work context. */
const NOISE_PATTERNS = /^(이전\s*작업|이전작업|컴퓨터가 작업하다|●|빌드\s*확인)/;

/**
 * Extract session metadata (first_prompt, git_branch, message_count)
 * directly from a JSONL file. This is the fallback when sessions-index.json
 * doesn't cover a session.
 */
export async function extractSessionMeta(filePath: string): Promise<JsonlMeta> {
  if (!fs.existsSync(filePath)) return { firstPrompt: null, bestPrompt: null, gitBranch: null, messageCount: 0 };

  let firstPrompt: string | null = null;
  let bestPrompt: string | null = null;
  let gitBranch: string | null = null;
  let messageCount = 0;

  const stream = fs.createReadStream(filePath, { encoding: "utf-8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line.trim()) continue;

    let entry: any;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    // Extract git branch from the first line that has it
    if (gitBranch === null && entry.gitBranch != null) {
      const b = entry.gitBranch as string;
      // Treat empty string and "HEAD" as no meaningful branch
      if (b && b !== "HEAD") {
        gitBranch = b;
      }
    }

    // Only look at user messages
    if (entry.type !== "user") continue;

    const content = entry.message?.content;
    // Human-typed messages have string content;
    // tool results have array content
    if (typeof content !== "string") continue;

    messageCount++;

    const trimmed = content.trim().replace(/^[❯$>]\s*/, "");

    // Always capture the first human prompt
    if (firstPrompt === null) {
      firstPrompt = content.length > 200 ? content.slice(0, 200) : content;
    }

    // Track the first non-noise prompt with substance (>15 chars)
    if (bestPrompt === null && trimmed.length > 15 && !NOISE_PATTERNS.test(trimmed)) {
      bestPrompt = content.length > 200 ? content.slice(0, 200) : content;
    }
  }

  return { firstPrompt, bestPrompt, gitBranch, messageCount };
}

/**
 * Parse a session JSONL file and extract deduplicated API calls.
 * For streaming chunks with the same requestId, only keep the one with stop_reason !== null.
 * Uses readline for streaming to handle large files.
 */
export async function parseSessionJSONL(
  filePath: string,
  isSubagent = false
): Promise<ApiCall[]> {
  if (!fs.existsSync(filePath)) return [];

  const callMap = new Map<string, ApiCall>();

  const stream = fs.createReadStream(filePath, { encoding: "utf-8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line.trim()) continue;

    let entry: any;
    try {
      entry = JSON.parse(line);
    } catch {
      continue; // Skip malformed lines
    }

    // Only process assistant messages
    if (entry.type !== "assistant") continue;
    if (!entry.requestId) continue;
    if (!entry.message?.usage) continue;

    const msg = entry.message;
    const usage = msg.usage;
    const requestId = entry.requestId as string;

    const call: ApiCall = {
      requestId,
      timestamp: entry.timestamp || new Date().toISOString(),
      model: msg.model || "unknown",
      input_tokens: usage.input_tokens ?? 0,
      output_tokens: usage.output_tokens ?? 0,
      cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,
      cache_read_input_tokens: usage.cache_read_input_tokens ?? 0,
      stop_reason: msg.stop_reason ?? null,
      is_subagent: isSubagent,
    };

    const existing = callMap.get(requestId);
    if (!existing) {
      callMap.set(requestId, call);
    } else {
      // Prefer the entry with a non-null stop_reason (final chunk)
      if (call.stop_reason !== null) {
        callMap.set(requestId, call);
      }
    }
  }

  return Array.from(callMap.values());
}

