import type { ReportRow } from "../types.js";

function csvField(value: string | number): string {
  const s = String(value);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

export function formatCsv(data: ReportRow[]): string {
  const header = "date,project,model,session_count,api_calls,input_tokens,output_tokens,cache_creation,cache_read,total_tokens";
  const rows = data.map((r) =>
    [
      csvField(r.date ?? ""),
      csvField(r.project ?? ""),
      csvField(r.model ?? ""),
      r.session_count ?? 0,
      r.api_calls,
      r.input_tokens,
      r.output_tokens,
      r.cache_creation,
      r.cache_read,
      r.total_tokens,
    ].join(",")
  );
  return [header, ...rows].join("\n");
}
