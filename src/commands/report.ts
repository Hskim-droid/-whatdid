import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { ensureSynced } from "../sync.js";
import {
  queryDailyReport,
  queryDailyBreakdown,
  queryWeeklyReport,
  queryProjectReport,
  queryModelsReport,
  findProjectId,
} from "../db.js";
import { formatCsv } from "../format/csv.js";
import { formatJson } from "../format/json.js";
import { formatHtml } from "../format/html.js";
import { projectRoot, formatTokens, formatTokensCompact, todayDate, weekStart } from "../util.js";
import type { ReportFormat, ReportRow } from "../types.js";

function output(
  data: ReportRow[],
  title: string,
  format: ReportFormat,
  outputPath?: string
): void {
  let content: string;
  switch (format) {
    case "csv":
      content = formatCsv(data);
      break;
    case "json":
      content = formatJson(data, title);
      break;
    case "html":
      content = formatHtml(data, title);
      break;
    default:
      printTable(data, title);
      return;
  }

  if (outputPath) {
    writeFileSync(outputPath, content);
    console.log(`Report saved to ${outputPath}`);
  } else if (format === "html") {
    const dir = join(projectRoot(), "data", "reports");
    mkdirSync(dir, { recursive: true });
    const filename = `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}.html`;
    const filePath = join(dir, filename);
    writeFileSync(filePath, content);
    console.log(`HTML report saved to ${filePath}`);
  } else {
    console.log(content);
  }
}

function printTable(data: ReportRow[], title: string): void {
  console.log(`\n${title}`);
  console.log("=".repeat(title.length));
  if (data.length === 0) {
    console.log("  No data.");
    return;
  }

  // Determine which columns to show based on the data
  const hasDate = data.some((r) => r.date);
  const hasProject = data.some((r) => r.project);
  const hasModel = data.some((r) => r.model);

  const header: string[] = [];
  if (hasDate) header.push("Date".padEnd(12));
  if (hasProject) header.push("Project".padEnd(35));
  if (hasModel) header.push("Model".padEnd(30));
  header.push("Sessions".padStart(8));
  header.push("Calls".padStart(8));
  header.push("Input".padStart(10));
  header.push("Output".padStart(10));
  header.push("Cache+".padStart(10));
  header.push("CacheR".padStart(10));
  header.push("Total".padStart(10));

  console.log(header.join("  "));
  console.log("-".repeat(header.join("  ").length));

  for (const r of data) {
    const cols: string[] = [];
    if (hasDate) cols.push((r.date ?? "").padEnd(12));
    if (hasProject) cols.push((r.project ?? "").slice(0, 35).padEnd(35));
    if (hasModel) cols.push((r.model ?? "").slice(0, 30).padEnd(30));
    cols.push(String(r.session_count ?? 0).padStart(8));
    cols.push(String(r.api_calls).padStart(8));
    cols.push(formatTokensCompact(r.input_tokens).padStart(10));
    cols.push(formatTokensCompact(r.output_tokens).padStart(10));
    cols.push(formatTokensCompact(r.cache_creation).padStart(10));
    cols.push(formatTokensCompact(r.cache_read).padStart(10));
    cols.push(formatTokensCompact(r.total_tokens).padStart(10));
    console.log(cols.join("  "));
  }

  // Print totals if multiple rows
  if (data.length > 1) {
    const totals = data.reduce(
      (acc, r) => ({
        api_calls: acc.api_calls + r.api_calls,
        input_tokens: acc.input_tokens + r.input_tokens,
        output_tokens: acc.output_tokens + r.output_tokens,
        cache_creation: acc.cache_creation + r.cache_creation,
        cache_read: acc.cache_read + r.cache_read,
        total_tokens: acc.total_tokens + r.total_tokens,
        session_count: (acc.session_count ?? 0) + (r.session_count ?? 0),
      }),
      { api_calls: 0, input_tokens: 0, output_tokens: 0, cache_creation: 0, cache_read: 0, total_tokens: 0, session_count: 0 }
    );

    console.log("-".repeat(header.join("  ").length));
    const totalCols: string[] = [];
    if (hasDate) totalCols.push("TOTAL".padEnd(12));
    if (hasProject) totalCols.push("".padEnd(35));
    if (hasModel) totalCols.push("".padEnd(30));
    totalCols.push(String(totals.session_count).padStart(8));
    totalCols.push(String(totals.api_calls).padStart(8));
    totalCols.push(formatTokensCompact(totals.input_tokens).padStart(10));
    totalCols.push(formatTokensCompact(totals.output_tokens).padStart(10));
    totalCols.push(formatTokensCompact(totals.cache_creation).padStart(10));
    totalCols.push(formatTokensCompact(totals.cache_read).padStart(10));
    totalCols.push(formatTokensCompact(totals.total_tokens).padStart(10));
    console.log(totalCols.join("  "));
  }
}

export async function dailyReport(
  date: string | undefined,
  format: ReportFormat,
  outputPath?: string
): Promise<void> {
  await ensureSynced();
  const d = date || todayDate();
  const data = queryDailyBreakdown(d);
  output(data, `Daily Report: ${d}`, format, outputPath);
}

export async function weeklyReport(
  format: ReportFormat,
  outputPath?: string
): Promise<void> {
  await ensureSynced();
  const start = weekStart();
  const data = queryWeeklyReport(start);
  output(data, `Weekly Report (from ${start})`, format, outputPath);
}

export async function projectReport(
  projectName: string,
  format: ReportFormat,
  outputPath?: string
): Promise<void> {
  await ensureSynced();
  const projectId = findProjectId(projectName);
  if (projectId === null) {
    console.log(`No project matching "${projectName}" found.`);
    return;
  }
  const data = queryProjectReport(projectId);
  output(data, `Project Report: ${projectName}`, format, outputPath);
}

export async function modelsReport(
  format: ReportFormat,
  outputPath?: string
): Promise<void> {
  await ensureSynced();
  const data = queryModelsReport();
  output(data, `Models Report`, format, outputPath);
}
