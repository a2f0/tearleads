export function createCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) {
    return '';
  }

  const headers = Object.keys(rows[0] ?? {});
  const escapeCell = (value: unknown): string => {
    const text = value == null ? '' : String(value);
    const escaped = text.replaceAll('"', '""');
    return /[",\n]/.test(escaped) ? `"${escaped}"` : escaped;
  };

  const lines = [
    headers.map((header) => escapeCell(header)).join(','),
    ...rows.map((row) =>
      headers.map((header) => escapeCell(row[header])).join(',')
    )
  ];

  return `${lines.join('\n')}\n`;
}
