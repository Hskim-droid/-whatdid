import type { ReportRow } from "../types.js";

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

export function formatHtml(data: ReportRow[], title: string): string {
  const hasDate = data.some((r) => r.date);
  const hasProject = data.some((r) => r.project);
  const hasModel = data.some((r) => r.model);

  const headerCells: string[] = [];
  if (hasDate) headerCells.push("<th>Date</th>");
  if (hasProject) headerCells.push("<th>Project</th>");
  if (hasModel) headerCells.push("<th>Model</th>");
  headerCells.push(
    "<th>Sessions</th>",
    "<th>API Calls</th>",
    "<th>Input</th>",
    "<th>Output</th>",
    "<th>Cache Created</th>",
    "<th>Cache Read</th>",
    "<th>Total</th>"
  );

  const rows = data
    .map((r) => {
      const cells: string[] = [];
      if (hasDate) cells.push(`<td>${r.date ?? "-"}</td>`);
      if (hasProject) cells.push(`<td>${r.project ?? "-"}</td>`);
      if (hasModel) cells.push(`<td>${r.model ?? "-"}</td>`);
      cells.push(
        `<td class="num">${r.session_count ?? 0}</td>`,
        `<td class="num">${fmt(r.api_calls)}</td>`,
        `<td class="num">${fmt(r.input_tokens)}</td>`,
        `<td class="num">${fmt(r.output_tokens)}</td>`,
        `<td class="num">${fmt(r.cache_creation)}</td>`,
        `<td class="num">${fmt(r.cache_read)}</td>`,
        `<td class="num">${fmt(r.total_tokens)}</td>`
      );
      return `      <tr>${cells.join("")}</tr>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${title}</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 2rem; background: #f5f5f5; }
  h1 { color: #333; }
  table { border-collapse: collapse; width: 100%; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
  th, td { padding: 0.5rem 0.75rem; text-align: left; border-bottom: 1px solid #eee; }
  th { background: #333; color: #fff; position: sticky; top: 0; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  tr:hover { background: #f0f7ff; }
  .meta { color: #666; margin-bottom: 1rem; }
  .empty { color: #999; font-style: italic; padding: 2rem; text-align: center; }
</style>
</head>
<body>
<h1>${title}</h1>
<p class="meta">Generated: ${new Date().toISOString()}</p>
${
  data.length === 0
    ? '<p class="empty">No data available.</p>'
    : `<table>
<thead>
  <tr>${headerCells.join("")}</tr>
</thead>
<tbody>
${rows}
</tbody>
</table>`
}
</body>
</html>`;
}
