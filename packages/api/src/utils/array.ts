export function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function uniqueSortedStrings(values: string[]): string[] {
  return Array.from(new Set(values)).sort((left, right) =>
    left.localeCompare(right),
  );
}

export function firstPerKey<Row, Key, Out>(
  rows: readonly Row[],
  keyFn: (row: Row) => Key,
  mapFn: (row: Row) => Out,
): Map<Key, Out> {
  const result = new Map<Key, Out>();
  for (const row of rows) {
    const key = keyFn(row);
    if (result.has(key)) {
      continue;
    }
    result.set(key, mapFn(row));
  }
  return result;
}
