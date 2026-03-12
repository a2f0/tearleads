export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function asRecord(
  value: unknown,
  fieldName: string
): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`invalid protobuf payload field: ${fieldName}`);
  }
  return value;
}

export function normalizeRequiredString(
  value: unknown,
  fieldName: string
): string {
  if (typeof value !== 'string') {
    throw new Error(`invalid protobuf payload field: ${fieldName}`);
  }
  return value;
}
