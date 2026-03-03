import { z } from "zod";

/** Parsed API call extracted from JSONL */
export interface ApiCall {
  requestId: string;
  timestamp: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  stop_reason: string | null;
  is_subagent: boolean;
}

/** Session index entry from sessions-index.json */
export const SessionIndexEntrySchema = z.object({
  sessionId: z.string(),
  fullPath: z.string().optional(),
  fileMtime: z.number().optional(),
  firstPrompt: z.string().optional(),
  summary: z.string().optional(),
  messageCount: z.number().int().nonnegative().default(0),
  created: z.string(),
  modified: z.string(),
  gitBranch: z.string().optional(),
  projectPath: z.string().optional(),
  isSidechain: z.boolean().optional(),
});

export type SessionIndexEntry = z.infer<typeof SessionIndexEntrySchema>;

/** sessions-index.json root structure */
export const SessionsIndexSchema = z.object({
  version: z.number(),
  entries: z.array(SessionIndexEntrySchema),
});

export type SessionsIndex = z.infer<typeof SessionsIndexSchema>;

// ── DB row types ──

export interface DbProject {
  id: number;
  encoded_name: string;
  original_path: string | null;
  first_seen_at: string;
  last_seen_at: string;
}

export interface DbSession {
  id: number;
  session_id: string;
  project_id: number;
  created_at: string;
  modified_at: string;
  summary: string | null;
  first_prompt: string | null;
  git_branch: string | null;
  message_count: number;
  is_sidechain: number;
  jsonl_path: string;
}

export interface DbApiCall {
  id: number;
  session_id: string;
  request_id: string;
  timestamp: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  stop_reason: string | null;
  is_subagent: number;
}

export interface DbSessionTotals {
  session_id: string;
  total_input: number;
  total_output: number;
  total_cache_creation: number;
  total_cache_read: number;
  total_api_calls: number;
  models_used: string; // JSON array
}

export interface DbSyncState {
  jsonl_path: string;
  file_size: number;
  file_mtime: number;
  last_synced_at: string;
  lines_parsed: number;
}

// ── Report types ──

export interface ReportRow {
  date?: string;
  project?: string;
  model?: string;
  session_count?: number;
  api_calls: number;
  input_tokens: number;
  output_tokens: number;
  cache_creation: number;
  cache_read: number;
  total_tokens: number;
}

export type ReportFormat = "table" | "csv" | "json" | "html";
