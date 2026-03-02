import type { ReportRow } from "../types.js";

export function formatJson(data: ReportRow[], title: string): string {
  return JSON.stringify(
    {
      title,
      generated_at: new Date().toISOString(),
      rows: data,
    },
    null,
    2
  );
}
