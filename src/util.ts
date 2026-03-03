import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

/** Project root (two levels up from src/util.ts). */
export function projectRoot(): string {
  const thisFile = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(thisFile), "..");
}

/** Data directory at ~/.whatdid/ (stable across installs). */
export function dataDir(): string {
  const dir = path.join(os.homedir(), ".whatdid");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Return path to tracker.db, migrating from old location if needed. */
export function dbPath(): string {
  const newPath = path.join(dataDir(), "tracker.db");

  // Migrate from old project-local location
  if (!fs.existsSync(newPath)) {
    const oldPath = path.join(projectRoot(), "data", "tracker.db");
    if (fs.existsSync(oldPath)) {
      fs.copyFileSync(oldPath, newPath);
    }
  }

  return newPath;
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
  if (ms < 0) return "0s";
  const secs = Math.floor(ms / 1000);
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (d === 0 && m > 0) parts.push(`${m}m`);
  if (d === 0 && h === 0) parts.push(`${s}s`);
  return parts.join(" ") || "0s";
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

/** Format a Date as local YYYY-MM-DD. */
function fmtLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Today's date as YYYY-MM-DD in local timezone. */
export function todayDate(): string {
  return fmtLocalDate(new Date());
}

/** Get start of ISO week (Monday) in local timezone. */
export function weekStart(): string {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((dayOfWeek + 6) % 7));
  return fmtLocalDate(monday);
}

/** Convert a YYYY-MM-DD local date to UTC ISO range [start, end). */
export function localDateRange(date: string): { start: string; end: string } {
  const start = new Date(date + "T00:00:00"); // local midnight
  const end = new Date(date + "T00:00:00");
  end.setDate(end.getDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

/** N days ago as local YYYY-MM-DD. */
export function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return fmtLocalDate(d);
}
