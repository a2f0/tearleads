/**
 * Escapes a value for a Markdown table cell. A stray `|` would otherwise split
 * a cell into two and silently corrupt the row.
 */
function escapeTableCell(value: string): string {
  return value.replaceAll("|", "\\|").replace(/[\r\n]+/gu, " ");
}

function formatTableRow(cells: ReadonlyArray<string>): string {
  return `| ${cells.map(escapeTableCell).join(" | ")} |`;
}

export function formatTable(
  headers: ReadonlyArray<string>,
  rows: ReadonlyArray<ReadonlyArray<string>>,
): string {
  const lines = [
    formatTableRow(headers),
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map(formatTableRow),
  ];
  return lines.join("\n");
}
