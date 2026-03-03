import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  getDb,
  querySessionsForDate,
  queryActivitySummary,
  getSession,
  getApiCallsForSession,
  searchSessions,
} from "./db.js";
import { duration } from "./util.js";
import { ensureSynced } from "./sync.js";

/** Validate a YYYY-MM-DD date string. Returns null if valid, error message if not. */
function validateDate(s: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return `Invalid date format "${s}". Expected YYYY-MM-DD.`;
  const d = new Date(s + "T00:00:00Z");
  if (isNaN(d.getTime())) return `Invalid date "${s}".`;
  return null;
}

/** Register all MCP tools and prompts on the server. */
export function registerTools(server: McpServer): void {
  // ── Tool 1: get_work_summary ──
  server.tool(
    "get_work_summary",
    "Get a descriptive summary of work done on a specific date. Returns sessions grouped by project with summaries, prompts, branches, and token usage. Unlike pure token counters, this focuses on WHAT was done.",
    { date: z.string().optional().describe("Date in YYYY-MM-DD format. Defaults to today.") },
    async ({ date }) => {
      try {
        await ensureSynced();
        const targetDate = date || new Date().toISOString().slice(0, 10);
        const dateErr = validateDate(targetDate);
        if (dateErr) return { content: [{ type: "text" as const, text: dateErr }], isError: true };
        const sessions = querySessionsForDate(targetDate);

        if (sessions.length === 0) {
          return { content: [{ type: "text", text: JSON.stringify({ date: targetDate, message: "No sessions found for this date.", sessions: [], projects: [], token_summary: { total_input: 0, total_output: 0, total_api_calls: 0 }, models: [] }, null, 2) }] };
        }

        // Group by project
        const projectMap = new Map<string, typeof sessions>();
        for (const s of sessions) {
          const list = projectMap.get(s.project) || [];
          list.push(s);
          projectMap.set(s.project, list);
        }

        const projects = Array.from(projectMap.entries()).map(([project, pSessions]) => ({
          project,
          session_count: pSessions.length,
          sessions: pSessions.map((s) => ({
            session_id: s.session_id,
            summary: s.summary,
            first_prompt: s.first_prompt,
            git_branch: s.git_branch,
            duration: duration(s.created_at, s.modified_at),
            api_calls: s.total_api_calls,
          })),
        }));

        // Token summary
        const totalInput = sessions.reduce((sum, s) => sum + s.total_input, 0);
        const totalOutput = sessions.reduce((sum, s) => sum + s.total_output, 0);
        const totalApiCalls = sessions.reduce((sum, s) => sum + s.total_api_calls, 0);

        // Model distribution
        const modelCounts = new Map<string, number>();
        for (const s of sessions) {
          const models: string[] = JSON.parse(s.models_used);
          for (const m of models) {
            modelCounts.set(m, (modelCounts.get(m) || 0) + 1);
          }
        }

        const result = {
          date: targetDate,
          total_sessions: sessions.length,
          projects,
          token_summary: { total_input: totalInput, total_output: totalOutput, total_api_calls: totalApiCalls },
          models: Array.from(modelCounts.entries()).map(([model, count]) => ({ model, session_count: count })),
        };

        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  // ── Tool 2: get_work_activity ──
  server.tool(
    "get_work_activity",
    "Get recent work activity patterns for the last N days. Shows daily trends, active projects, git branches, and recent sessions. Useful for understanding work context and recommending next tasks.",
    { days: z.number().optional().describe("Number of days to look back. Defaults to 7.") },
    async ({ days }) => {
      try {
        await ensureSynced();
        const lookback = days || 7;
        const since = new Date();
        since.setDate(since.getDate() - lookback);
        const sinceStr = since.toISOString().slice(0, 10);

        const activity = queryActivitySummary(sinceStr);

        const result = {
          period: { since: sinceStr, days: lookback },
          daily_activity: activity.dailyActivity,
          active_projects: activity.activeProjects,
          active_branches: activity.activeBranches,
          recent_sessions: activity.recentSessions.map((s) => ({
            session_id: s.session_id,
            summary: s.summary,
            first_prompt: s.first_prompt,
            project: s.project,
            git_branch: s.git_branch,
            created_at: s.created_at,
            duration: duration(s.created_at, s.modified_at),
            api_calls: s.total_api_calls,
          })),
        };

        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  // ── Tool 3: get_session_detail ──
  server.tool(
    "get_session_detail",
    "Get detailed information about a specific session. Supports partial session ID matching. Shows summary, prompt, branch, message count, duration, and per-model token breakdown.",
    { session_id: z.string().describe("Full or partial session ID.") },
    async ({ session_id }) => {
      try {
        await ensureSynced();
        const db = getDb();

        // Try exact match first, then partial
        let session = getSession(session_id);
        if (!session) {
          const row = db
            .prepare(`SELECT * FROM sessions WHERE session_id LIKE ? LIMIT 1`)
            .get(`%${session_id}%`) as typeof session;
          session = row;
        }

        if (!session) {
          return { content: [{ type: "text", text: JSON.stringify({ error: `Session not found: ${session_id}` }) }], isError: true };
        }

        // Get project name
        const project = db
          .prepare(`SELECT COALESCE(original_path, encoded_name) as name FROM projects WHERE id = ?`)
          .get(session.project_id) as { name: string } | undefined;

        // Get API calls breakdown by model
        const apiCalls = getApiCallsForSession(session.session_id);
        const modelBreakdown = new Map<string, { calls: number; input: number; output: number }>();
        for (const call of apiCalls) {
          const entry = modelBreakdown.get(call.model) || { calls: 0, input: 0, output: 0 };
          entry.calls++;
          entry.input += call.input_tokens;
          entry.output += call.output_tokens;
          modelBreakdown.set(call.model, entry);
        }

        const result = {
          session_id: session.session_id,
          summary: session.summary,
          first_prompt: session.first_prompt,
          git_branch: session.git_branch,
          project: project?.name ?? null,
          created_at: session.created_at,
          modified_at: session.modified_at,
          duration: duration(session.created_at, session.modified_at),
          message_count: session.message_count,
          total_api_calls: apiCalls.length,
          model_breakdown: Array.from(modelBreakdown.entries()).map(([model, stats]) => ({
            model,
            ...stats,
          })),
        };

        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  // ── Tool 4: search_sessions ──
  server.tool(
    "search_sessions",
    "Search past sessions by keyword, project, or date. Searches in session summaries and first prompts. Returns matching sessions with metadata and token totals.",
    {
      query: z.string().optional().describe("Keyword to search in session summary and first prompt."),
      project: z.string().optional().describe("Filter by project name (partial match)."),
      since: z.string().optional().describe("Only show sessions since this date (YYYY-MM-DD)."),
      limit: z.number().optional().describe("Max results to return. Defaults to 20."),
    },
    async ({ query, project, since, limit }) => {
      try {
        await ensureSynced();
        if (since) {
          const dateErr = validateDate(since);
          if (dateErr) return { content: [{ type: "text" as const, text: dateErr }], isError: true };
        }
        const sessions = searchSessions(query, project, since, limit || 20);

        const totalInput = sessions.reduce((sum, s) => sum + s.total_input, 0);
        const totalOutput = sessions.reduce((sum, s) => sum + s.total_output, 0);

        const result = {
          count: sessions.length,
          filters: { query, project, since, limit: limit || 20 },
          token_totals: { total_input: totalInput, total_output: totalOutput },
          sessions: sessions.map((s) => ({
            session_id: s.session_id,
            summary: s.summary,
            first_prompt: s.first_prompt,
            project: s.project,
            git_branch: s.git_branch,
            created_at: s.created_at,
            duration: duration(s.created_at, s.modified_at),
            message_count: s.message_count,
            api_calls: s.total_api_calls,
          })),
        };

        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );
}

/** Register MCP prompts on the server. */
export function registerPrompts(server: McpServer): void {
  // ── Prompt 1: morning_briefing ──
  server.prompt(
    "morning_briefing",
    "Morning work briefing — summarizes yesterday's work and suggests today's tasks.",
    { date: z.string().optional().describe("Yesterday's date (YYYY-MM-DD). Auto-calculated if omitted.") },
    ({ date }) => {
      const yesterday = date || (() => {
        const d = new Date();
        d.setDate(d.getDate() - 1);
        return d.toISOString().slice(0, 10);
      })();

      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: `어제(${yesterday})의 작업 요약과 오늘 할일을 추천해주세요.
먼저 get_work_summary로 어제 데이터를 확인하고,
get_work_activity로 최근 활동 패턴을 파악한 뒤,
자연스러운 한국어로 브리핑해주세요.

포함할 내용:
- 어제 한 일 요약 (프로젝트별)
- 진행 중이던 작업 (중단된 세션 파악)
- 오늘 추천 작업 (최근 패턴 기반)`,
            },
          },
        ],
      };
    }
  );

  // ── Prompt 2: evening_briefing ──
  server.prompt(
    "evening_briefing",
    "Evening work review — summarizes today's work and suggests tasks for tomorrow.",
    { date: z.string().optional().describe("Today's date (YYYY-MM-DD). Auto-calculated if omitted.") },
    ({ date }) => {
      const today = date || new Date().toISOString().slice(0, 10);

      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: `오늘(${today})의 작업을 정리해주세요.
get_work_summary로 오늘 데이터를 확인하고,
get_work_activity로 이번 주 맥락을 파악한 뒤,
자연스러운 한국어로 리뷰해주세요.

포함할 내용:
- 오늘 한 일 요약 (프로젝트별)
- 작업 강도/패턴 분석
- 내일 이어갈 작업 제안`,
            },
          },
        ],
      };
    }
  );
}
