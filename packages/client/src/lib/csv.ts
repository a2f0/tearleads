function formatCsvValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return String(value);
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function escapeCsvValue(value: string): string {
  const shouldQuote =
    value.includes('"') ||
    value.includes(',') ||
    value.includes('\n') ||
    value.includes('\r') ||
    /^\s|\s$/.test(value);

  if (!shouldQuote) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

export function createCsv(
  headers: string[],
  rows: ReadonlyArray<ReadonlyArray<unknown>>
): string {
  if (headers.length === 0) return '';
  const lines = [
    headers.map((header) => escapeCsvValue(formatCsvValue(header))).join(',')
  ];

  for (const row of rows) {
    const values = row.map((value) => escapeCsvValue(formatCsvValue(value)));
    lines.push(values.join(','));
  }

  return lines.join('\r\n');
}
