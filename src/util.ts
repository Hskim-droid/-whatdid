import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

/** Project root (two levels up from src/util.ts). */
export function projectRoot(): string {
  const thisFile = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(thisFile), "..");
}

/** Ensure data/ directory exists and return path to tracker.db. */
export function dbPath(): string {
  const dir = path.join(projectRoot(), "data");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "tracker.db");
}

/** Claude Code data directory (~/.claude). */
export function claudeDataDir(): string {
  return path.join(os.homedir(), ".claude");
}

/** Claude Code projects directory (~/.claude/projects). */
export function claudeProjectsDir(): string {
  return path.join(claudeDataDir(), "projects");
}

/** Current time as ISO 8601 string. */
export function nowISO(): string {
  return new Date().toISOString();
}

/** Format an ISO timestamp for display. */
export function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString();
}

/** Duration between two ISO timestamps as human-readable string. */
export function duration(start: string, end: string): string {
  const ms = new Date(end).getTime() - new Date(start).getTime();
  const secs = Math.floor(ms / 1000);
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  const parts: string[] = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(" ");
}

/** Format a token count for display (e.g., 1234567 → "1,234,567"). */
export function formatTokens(n: number): string {
  return n.toLocaleString("en-US");
}

/** Format a token count compactly (e.g., 1234567 → "1.2M"). */
export function formatTokensCompact(n: number): string {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + "B";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
}

/** Today's date as YYYY-MM-DD. */
export function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Get start of ISO week (Monday). */
export function weekStart(): string {
  const now = new Date();
  const dayOfWeek = now.getUTCDay();
  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() - ((dayOfWeek + 6) % 7));
  return monday.toISOString().slice(0, 10);
}
