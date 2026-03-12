import { isRecord } from './syncProtobufNormalizationStrings.js';

export function normalizePositiveSafeInteger(
  value: unknown,
  fieldName: string
): number {
  const parsed = normalizePositiveSafeIntegerOrNull(value);
  if (parsed === null) {
    throw new Error(`invalid protobuf payload field: ${fieldName}`);
  }
  return parsed;
}

export function normalizePositiveSafeIntegerOrNull(value: unknown): number | null {
  if (typeof value === 'number') {
    if (
      Number.isFinite(value) &&
      Number.isInteger(value) &&
      value >= 1 &&
      value <= Number.MAX_SAFE_INTEGER
    ) {
      return value;
    }
    return null;
  }

  if (typeof value === 'string') {
    if (!/^[0-9]+$/.test(value)) {
      return null;
    }
    const parsed = Number.parseInt(value, 10);
    if (
      Number.isFinite(parsed) &&
      Number.isInteger(parsed) &&
      parsed >= 1 &&
      parsed <= Number.MAX_SAFE_INTEGER
    ) {
      return parsed;
    }
    return null;
  }

  if (
    typeof value === 'object' &&
    value !== null &&
    'toString' in value &&
    typeof value.toString === 'function'
  ) {
    return normalizePositiveSafeIntegerOrNull(value.toString());
  }

  return null;
}

export function normalizeNonNegativeSafeIntegerOrNull(value: unknown): number | null {
  if (typeof value === 'number') {
    if (
      Number.isFinite(value) &&
      Number.isInteger(value) &&
      value >= 0 &&
      value <= Number.MAX_SAFE_INTEGER
    ) {
      return value;
    }
    return null;
  }

  if (typeof value === 'string') {
    if (!/^[0-9]+$/.test(value)) {
      return null;
    }
    const parsed = Number.parseInt(value, 10);
    if (
      Number.isFinite(parsed) &&
      Number.isInteger(parsed) &&
      parsed >= 0 &&
      parsed <= Number.MAX_SAFE_INTEGER
    ) {
      return parsed;
    }
    return null;
  }

  if (
    typeof value === 'object' &&
    value !== null &&
    'toString' in value &&
    typeof value.toString === 'function'
  ) {
    return normalizeNonNegativeSafeIntegerOrNull(value.toString());
  }

  return null;
}

export function normalizeWriteIdMap(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    return {};
  }

  const output: Record<string, unknown> = {};
  for (const [replicaId, rawWriteId] of Object.entries(value)) {
    const parsedWriteId = normalizeNonNegativeSafeIntegerOrNull(rawWriteId);
    output[replicaId] = parsedWriteId === null ? rawWriteId : parsedWriteId;
  }
  return output;
}
