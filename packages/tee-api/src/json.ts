export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return true;
  }

  if (Array.isArray(value)) {
    return value.every((item) => isJsonValue(item));
  }

  if (!isRecord(value)) {
    return false;
  }

  return Object.values(value).every((item) => isJsonValue(item));
}

export function stableStringify(value: JsonValue): string {
  if (value === null) {
    return 'null';
  }

  if (typeof value === 'string') {
    return JSON.stringify(value);
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('Non-finite numbers are not valid JSON values');
    }
    return Number.isInteger(value) ? value.toString(10) : String(value);
  }

  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  const keys = Object.keys(value).sort((left, right) =>
    left.localeCompare(right)
  );
  const fields = keys.map((key) => {
    const item = value[key];
    if (item === undefined) {
      throw new Error('Undefined object values are not valid JSON');
    }
    return `${JSON.stringify(key)}:${stableStringify(item)}`;
  });
  return `{${fields.join(',')}}`;
}
