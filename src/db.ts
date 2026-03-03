import Database from "better-sqlite3";
import { dbPath, localDateRange, todayDate } from "./util.js";
import type {
  DbProject,
  DbSession,
  DbApiCall,
  DbSyncState,
  ApiCall,
  ReportRow,
} from "./types.js";

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;
  _db = new Database(dbPath());
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");
  initSchema(_db);
  return _db;
}

function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sync_state (
      jsonl_path TEXT PRIMARY KEY,
      file_size INTEGER NOT NULL,
      file_mtime INTEGER NOT NULL,
      last_synced_at TEXT NOT NULL,
      lines_parsed INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      encoded_name TEXT NOT NULL UNIQUE,
      original_path TEXT,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL UNIQUE,
      project_id INTEGER NOT NULL REFERENCES projects(id),
      created_at TEXT NOT NULL,
      modified_at TEXT NOT NULL,
      summary TEXT,
      first_prompt TEXT,
      git_branch TEXT,
      message_count INTEGER NOT NULL DEFAULT 0,
      is_sidechain INTEGER NOT NULL DEFAULT 0,
      jsonl_path TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS api_calls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES sessions(session_id),
      request_id TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      model TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cache_creation_input_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_input_tokens INTEGER NOT NULL DEFAULT 0,
      stop_reason TEXT,
      is_subagent INTEGER NOT NULL DEFAULT 0,
      UNIQUE(session_id, request_id)
    );

    CREATE TABLE IF NOT EXISTS session_totals (
      session_id TEXT PRIMARY KEY REFERENCES sessions(session_id),
      total_input INTEGER NOT NULL DEFAULT 0,
      total_output INTEGER NOT NULL DEFAULT 0,
      total_cache_creation INTEGER NOT NULL DEFAULT 0,
      total_cache_read INTEGER NOT NULL DEFAULT 0,
      total_api_calls INTEGER NOT NULL DEFAULT 0,
      models_used TEXT NOT NULL DEFAULT '[]'
    );

    CREATE INDEX IF NOT EXISTS idx_api_calls_session ON api_calls(session_id);
    CREATE INDEX IF NOT EXISTS idx_api_calls_timestamp ON api_calls(timestamp);
    CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_created ON sessions(created_at);
  `);
}

// ── Sync state ──

export function getSyncState(jsonlPath: string): DbSyncState | undefined {
  return getDb()
    .prepare(`SELECT * FROM sync_state WHERE jsonl_path = ?`)
    .get(jsonlPath) as DbSyncState | undefined;
}

export function upsertSyncState(state: DbSyncState): void {
  getDb()
    .prepare(
      `INSERT INTO sync_state (jsonl_path, file_size, file_mtime, last_synced_at, lines_parsed)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(jsonl_path) DO UPDATE SET
         file_size = excluded.file_size,
         file_mtime = excluded.file_mtime,
         last_synced_at = excluded.last_synced_at,
         lines_parsed = excluded.lines_parsed`
    )
    .run(state.jsonl_path, state.file_size, state.file_mtime, state.last_synced_at, state.lines_parsed);
}

// ── Projects ──

export function upsertProject(
  encodedName: string,
  originalPath: string | null,
  now: string
): DbProject {
  const db = getDb();
  db.prepare(
    `INSERT INTO projects (encoded_name, original_path, first_seen_at, last_seen_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(encoded_name) DO UPDATE SET
       original_path = COALESCE(excluded.original_path, projects.original_path),
       last_seen_at = excluded.last_seen_at`
  ).run(encodedName, originalPath, now, now);
  return db
    .prepare(`SELECT * FROM projects WHERE encoded_name = ?`)
    .get(encodedName) as DbProject;
}

export function getAllProjects(): DbProject[] {
  return getDb()
    .prepare(`SELECT * FROM projects ORDER BY last_seen_at DESC`)
    .all() as DbProject[];
}

// ── Sessions ──

export function upsertSession(
  sessionId: string,
  projectId: number,
  createdAt: string,
  modifiedAt: string,
  summary: string | null,
  firstPrompt: string | null,
  gitBranch: string | null,
  messageCount: number,
  isSidechain: boolean,
  jsonlPath: string
): void {
  getDb()
    .prepare(
      `INSERT INTO sessions (session_id, project_id, created_at, modified_at, summary, first_prompt, git_branch, message_count, is_sidechain, jsonl_path)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET
         modified_at = excluded.modified_at,
         summary = COALESCE(excluded.summary, sessions.summary),
         first_prompt = COALESCE(excluded.first_prompt, sessions.first_prompt),
         git_branch = COALESCE(excluded.git_branch, sessions.git_branch),
         message_count = excluded.message_count,
         jsonl_path = excluded.jsonl_path`
    )
    .run(sessionId, projectId, createdAt, modifiedAt, summary, firstPrompt, gitBranch, messageCount, isSidechain ? 1 : 0, jsonlPath);
}

export function getSession(sessionId: string): DbSession | undefined {
  return getDb()
    .prepare(`SELECT * FROM sessions WHERE session_id = ?`)
    .get(sessionId) as DbSession | undefined;
}

export function querySessions(
  projectId?: number,
  since?: string
): (DbSession & { total_input: number; total_output: number; total_cache_creation: number; total_cache_read: number; total_api_calls: number; models_used: string })[] {
  const db = getDb();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (projectId != null) {
    conditions.push(`s.project_id = ?`);
    params.push(projectId);
  }
  if (since) {
    conditions.push(`s.created_at >= ?`);
    params.push(since);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  return db
    .prepare(
      `SELECT s.*, COALESCE(t.total_input, 0) as total_input, COALESCE(t.total_output, 0) as total_output,
              COALESCE(t.total_cache_creation, 0) as total_cache_creation, COALESCE(t.total_cache_read, 0) as total_cache_read,
              COALESCE(t.total_api_calls, 0) as total_api_calls, COALESCE(t.models_used, '[]') as models_used
       FROM sessions s
       LEFT JOIN session_totals t ON t.session_id = s.session_id
       ${where}
       ORDER BY s.created_at DESC`
    )
    .all(...params) as any[];
}

// ── API calls ──

export function upsertApiCalls(sessionId: string, calls: ApiCall[]): void {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO api_calls (session_id, request_id, timestamp, model, input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens, stop_reason, is_subagent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(session_id, request_id) DO UPDATE SET
       timestamp = excluded.timestamp,
       model = excluded.model,
       input_tokens = excluded.input_tokens,
       output_tokens = excluded.output_tokens,
       cache_creation_input_tokens = excluded.cache_creation_input_tokens,
       cache_read_input_tokens = excluded.cache_read_input_tokens,
       stop_reason = excluded.stop_reason,
       is_subagent = excluded.is_subagent`
  );

  const run = db.transaction(() => {
    for (const call of calls) {
      stmt.run(
        sessionId,
        call.requestId,
        call.timestamp,
        call.model,
        call.input_tokens,
        call.output_tokens,
        call.cache_creation_input_tokens,
        call.cache_read_input_tokens,
        call.stop_reason,
        call.is_subagent ? 1 : 0
      );
    }
  });

  run();
}

export function getApiCallsForSession(sessionId: string): DbApiCall[] {
  return getDb()
    .prepare(`SELECT * FROM api_calls WHERE session_id = ? ORDER BY timestamp ASC`)
    .all(sessionId) as DbApiCall[];
}

// ── Session totals ──

export function recomputeSessionTotals(sessionId: string): void {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT
         COALESCE(SUM(input_tokens), 0) as total_input,
         COALESCE(SUM(output_tokens), 0) as total_output,
         COALESCE(SUM(cache_creation_input_tokens), 0) as total_cache_creation,
         COALESCE(SUM(cache_read_input_tokens), 0) as total_cache_read,
         COUNT(*) as total_api_calls
       FROM api_calls WHERE session_id = ?`
    )
    .get(sessionId) as any;

  const models = db
    .prepare(`SELECT DISTINCT model FROM api_calls WHERE session_id = ? ORDER BY model`)
    .all(sessionId) as { model: string }[];

  db.prepare(
    `INSERT INTO session_totals (session_id, total_input, total_output, total_cache_creation, total_cache_read, total_api_calls, models_used)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(session_id) DO UPDATE SET
       total_input = excluded.total_input,
       total_output = excluded.total_output,
       total_cache_creation = excluded.total_cache_creation,
       total_cache_read = excluded.total_cache_read,
       total_api_calls = excluded.total_api_calls,
       models_used = excluded.models_used`
  ).run(
    sessionId,
    row.total_input,
    row.total_output,
    row.total_cache_creation,
    row.total_cache_read,
    row.total_api_calls,
    JSON.stringify(models.map((m) => m.model))
  );
}

// ── Report queries ──

export function queryDailyReport(date: string): ReportRow[] {
  const db = getDb();
  const { start, end } = localDateRange(date);

  return db
    .prepare(
      `SELECT
         ? as date,
         COUNT(DISTINCT a.session_id) as session_count,
         COUNT(*) as api_calls,
         SUM(a.input_tokens) as input_tokens,
         SUM(a.output_tokens) as output_tokens,
         SUM(a.cache_creation_input_tokens) as cache_creation,
         SUM(a.cache_read_input_tokens) as cache_read,
         SUM(a.input_tokens + a.output_tokens + a.cache_creation_input_tokens + a.cache_read_input_tokens) as total_tokens
       FROM api_calls a
       WHERE a.timestamp >= ? AND a.timestamp < ?`
    )
    .all(date, start, end) as ReportRow[];
}

export function queryDailyBreakdown(date: string): ReportRow[] {
  const db = getDb();
  const { start, end } = localDateRange(date);

  return db
    .prepare(
      `SELECT
         a.model as model,
         COUNT(DISTINCT a.session_id) as session_count,
         COUNT(*) as api_calls,
         SUM(a.input_tokens) as input_tokens,
         SUM(a.output_tokens) as output_tokens,
         SUM(a.cache_creation_input_tokens) as cache_creation,
         SUM(a.cache_read_input_tokens) as cache_read,
         SUM(a.input_tokens + a.output_tokens + a.cache_creation_input_tokens + a.cache_read_input_tokens) as total_tokens
       FROM api_calls a
       WHERE a.timestamp >= ? AND a.timestamp < ?
       GROUP BY a.model
       ORDER BY total_tokens DESC`
    )
    .all(start, end) as ReportRow[];
}

export function queryWeeklyReport(weekStart: string): ReportRow[] {
  const db = getDb();
  const { start } = localDateRange(weekStart);
  return db
    .prepare(
      `SELECT
         date(a.timestamp, 'localtime') as date,
         COUNT(DISTINCT a.session_id) as session_count,
         COUNT(*) as api_calls,
         SUM(a.input_tokens) as input_tokens,
         SUM(a.output_tokens) as output_tokens,
         SUM(a.cache_creation_input_tokens) as cache_creation,
         SUM(a.cache_read_input_tokens) as cache_read,
         SUM(a.input_tokens + a.output_tokens + a.cache_creation_input_tokens + a.cache_read_input_tokens) as total_tokens
       FROM api_calls a
       WHERE a.timestamp >= ?
       GROUP BY date
       ORDER BY date ASC`
    )
    .all(start) as ReportRow[];
}

export function queryProjectReport(projectId: number): ReportRow[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT
         COALESCE(p.original_path, p.encoded_name) as project,
         COUNT(DISTINCT a.session_id) as session_count,
         COUNT(*) as api_calls,
         SUM(a.input_tokens) as input_tokens,
         SUM(a.output_tokens) as output_tokens,
         SUM(a.cache_creation_input_tokens) as cache_creation,
         SUM(a.cache_read_input_tokens) as cache_read,
         SUM(a.input_tokens + a.output_tokens + a.cache_creation_input_tokens + a.cache_read_input_tokens) as total_tokens
       FROM api_calls a
       JOIN sessions s ON s.session_id = a.session_id
       JOIN projects p ON p.id = s.project_id
       WHERE s.project_id = ?
       GROUP BY p.id`
    )
    .all(projectId) as ReportRow[];
}

export function queryAllProjectsReport(): ReportRow[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT
         COALESCE(p.original_path, p.encoded_name) as project,
         COUNT(DISTINCT s.session_id) as session_count,
         COUNT(a.id) as api_calls,
         COALESCE(SUM(a.input_tokens), 0) as input_tokens,
         COALESCE(SUM(a.output_tokens), 0) as output_tokens,
         COALESCE(SUM(a.cache_creation_input_tokens), 0) as cache_creation,
         COALESCE(SUM(a.cache_read_input_tokens), 0) as cache_read,
         COALESCE(SUM(a.input_tokens + a.output_tokens + a.cache_creation_input_tokens + a.cache_read_input_tokens), 0) as total_tokens
       FROM projects p
       LEFT JOIN sessions s ON s.project_id = p.id
       LEFT JOIN api_calls a ON a.session_id = s.session_id
       GROUP BY p.id
       ORDER BY total_tokens DESC`
    )
    .all() as ReportRow[];
}

export function queryModelsReport(): ReportRow[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT
         a.model as model,
         COUNT(DISTINCT a.session_id) as session_count,
         COUNT(*) as api_calls,
         SUM(a.input_tokens) as input_tokens,
         SUM(a.output_tokens) as output_tokens,
         SUM(a.cache_creation_input_tokens) as cache_creation,
         SUM(a.cache_read_input_tokens) as cache_read,
         SUM(a.input_tokens + a.output_tokens + a.cache_creation_input_tokens + a.cache_read_input_tokens) as total_tokens
       FROM api_calls a
       GROUP BY a.model
       ORDER BY total_tokens DESC`
    )
    .all() as ReportRow[];
}

export function queryTodayOverview(): {
  total_input: number;
  total_output: number;
  total_cache_creation: number;
  total_cache_read: number;
  total_api_calls: number;
  total_sessions: number;
} {
  const db = getDb();
  const { start, end } = localDateRange(todayDate());

  const row = db
    .prepare(
      `SELECT
         COALESCE(SUM(a.input_tokens), 0) as total_input,
         COALESCE(SUM(a.output_tokens), 0) as total_output,
         COALESCE(SUM(a.cache_creation_input_tokens), 0) as total_cache_creation,
         COALESCE(SUM(a.cache_read_input_tokens), 0) as total_cache_read,
         COUNT(*) as total_api_calls,
         COUNT(DISTINCT a.session_id) as total_sessions
       FROM api_calls a
       WHERE a.timestamp >= ? AND a.timestamp < ?`
    )
    .get(start, end) as any;

  return row;
}

// ── MCP queries ──

/** Sessions active on a given date with project info and token totals. */
export function querySessionsForDate(date: string) {
  const db = getDb();
  const { start, end } = localDateRange(date);

  return db
    .prepare(
      `SELECT s.session_id, s.summary, s.first_prompt, s.git_branch,
              s.created_at, s.modified_at, s.message_count,
              COALESCE(p.original_path, p.encoded_name) as project,
              COALESCE(t.total_input, 0) as total_input,
              COALESCE(t.total_output, 0) as total_output,
              COALESCE(t.total_api_calls, 0) as total_api_calls,
              COALESCE(t.models_used, '[]') as models_used
       FROM sessions s
       JOIN projects p ON p.id = s.project_id
       LEFT JOIN session_totals t ON t.session_id = s.session_id
       WHERE EXISTS (
         SELECT 1 FROM api_calls a
         WHERE a.session_id = s.session_id
           AND a.timestamp >= ? AND a.timestamp < ?
       )
       ORDER BY s.created_at ASC`
    )
    .all(start, end) as {
      session_id: string;
      summary: string | null;
      first_prompt: string | null;
      git_branch: string | null;
      created_at: string;
      modified_at: string;
      message_count: number;
      project: string;
      total_input: number;
      total_output: number;
      total_api_calls: number;
      models_used: string;
    }[];
}

/** Activity summary for the last N days: daily trends, active projects, branches, recent sessions. */
export function queryActivitySummary(since: string) {
  const db = getDb();

  const dailyActivity = db
    .prepare(
      `SELECT date(a.timestamp, 'localtime') as date,
              COUNT(DISTINCT a.session_id) as session_count,
              COUNT(*) as api_calls
       FROM api_calls a
       WHERE a.timestamp >= ?
       GROUP BY date
       ORDER BY date ASC`
    )
    .all(since) as { date: string; session_count: number; api_calls: number }[];

  const activeProjects = db
    .prepare(
      `SELECT COALESCE(p.original_path, p.encoded_name) as project,
              COUNT(DISTINCT s.session_id) as session_count,
              MAX(s.modified_at) as last_active
       FROM sessions s
       JOIN projects p ON p.id = s.project_id
       WHERE s.created_at >= ?
       GROUP BY p.id
       ORDER BY last_active DESC`
    )
    .all(since) as { project: string; session_count: number; last_active: string }[];

  const activeBranches = db
    .prepare(
      `SELECT s.git_branch,
              COALESCE(p.original_path, p.encoded_name) as project,
              MAX(s.modified_at) as last_active
       FROM sessions s
       JOIN projects p ON p.id = s.project_id
       WHERE s.git_branch IS NOT NULL AND s.created_at >= ?
       GROUP BY s.git_branch, p.id
       ORDER BY last_active DESC
       LIMIT 20`
    )
    .all(since) as { git_branch: string; project: string; last_active: string }[];

  const recentSessions = db
    .prepare(
      `SELECT s.session_id, s.summary, s.first_prompt, s.created_at, s.modified_at,
              s.git_branch,
              COALESCE(p.original_path, p.encoded_name) as project,
              COALESCE(t.total_api_calls, 0) as total_api_calls
       FROM sessions s
       JOIN projects p ON p.id = s.project_id
       LEFT JOIN session_totals t ON t.session_id = s.session_id
       WHERE s.created_at >= ?
       ORDER BY s.created_at DESC
       LIMIT 10`
    )
    .all(since) as {
      session_id: string;
      summary: string | null;
      first_prompt: string | null;
      created_at: string;
      modified_at: string;
      git_branch: string | null;
      project: string;
      total_api_calls: number;
    }[];

  return { dailyActivity, activeProjects, activeBranches, recentSessions };
}

/** Escape SQL LIKE metacharacters so they match literally. */
function escapeLike(s: string): string {
  return s.replace(/[%_\\]/g, "\\$&");
}

/** Search sessions by keyword in summary/first_prompt, with optional project and date filters. */
export function searchSessions(
  query?: string,
  project?: string,
  since?: string,
  limit: number = 20
) {
  const db = getDb();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (query) {
    const q = `%${escapeLike(query)}%`;
    conditions.push(`(s.summary LIKE ? ESCAPE '\\' OR s.first_prompt LIKE ? ESCAPE '\\')`);
    params.push(q, q);
  }
  if (project) {
    const p = `%${escapeLike(project)}%`;
    conditions.push(`(p.original_path LIKE ? ESCAPE '\\' OR p.encoded_name LIKE ? ESCAPE '\\')`);
    params.push(p, p);
  }
  if (since) {
    conditions.push(`s.created_at >= ?`);
    params.push(since);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const sessions = db
    .prepare(
      `SELECT s.session_id, s.summary, s.first_prompt, s.created_at, s.modified_at,
              s.git_branch, s.message_count,
              COALESCE(p.original_path, p.encoded_name) as project,
              COALESCE(t.total_input, 0) as total_input,
              COALESCE(t.total_output, 0) as total_output,
              COALESCE(t.total_api_calls, 0) as total_api_calls
       FROM sessions s
       JOIN projects p ON p.id = s.project_id
       LEFT JOIN session_totals t ON t.session_id = s.session_id
       ${where}
       ORDER BY s.created_at DESC
       LIMIT ?`
    )
    .all(...params, limit) as {
      session_id: string;
      summary: string | null;
      first_prompt: string | null;
      created_at: string;
      modified_at: string;
      git_branch: string | null;
      message_count: number;
      project: string;
      total_input: number;
      total_output: number;
      total_api_calls: number;
    }[];

  return sessions;
}

/** Find project ID by encoded name (case-insensitive partial match). */
export function findProjectId(name: string): number | null {
  const db = getDb();
  // Try exact match first
  let row = db
    .prepare(`SELECT id FROM projects WHERE encoded_name = ?`)
    .get(name) as { id: number } | undefined;
  if (row) return row.id;

  // Try original_path match
  const likePattern = `%${escapeLike(name)}%`;
  row = db
    .prepare(`SELECT id FROM projects WHERE original_path LIKE ? ESCAPE '\\'`)
    .get(likePattern) as { id: number } | undefined;
  if (row) return row.id;

  // Try partial match on encoded_name
  row = db
    .prepare(`SELECT id FROM projects WHERE encoded_name LIKE ? ESCAPE '\\'`)
    .get(likePattern) as { id: number } | undefined;
  return row?.id ?? null;
}
