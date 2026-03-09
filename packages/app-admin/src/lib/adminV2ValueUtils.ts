export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function toSafeNumber(value: unknown, fallback = 0): number {
  const toNumber = (candidate: number) =>
    Number.isFinite(candidate) ? candidate : fallback;

  if (typeof value === 'number') {
    return toNumber(value);
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    return toNumber(Number(value));
  }

  if (typeof value === 'bigint') {
    return toNumber(Number(value));
  }

  return fallback;
}

export function toNullableNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  if (typeof value === 'bigint') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}
