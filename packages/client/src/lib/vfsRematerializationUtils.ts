export const VFS_ROOT_ID = '00000000-0000-0000-0000-000000000000';

export function chunkArray<T>(values: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

export function parseTimestampMs(
  value: string | null | undefined,
  fallback: number
): number {
  if (!value) {
    return fallback;
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return parsed;
}
