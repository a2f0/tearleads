import { bytesToBase64 } from "@symcrypt/encoding";

type CanonicalHistoryValue =
  | readonly ["array", CanonicalHistoryValue[]]
  | readonly ["bigint", string]
  | readonly ["boolean", boolean]
  | readonly ["bytes", string]
  | readonly [
      "map",
      Array<readonly [CanonicalHistoryValue, CanonicalHistoryValue]>,
    ]
  | readonly ["null"]
  | readonly ["number", string]
  | readonly ["object", Array<readonly [string, CanonicalHistoryValue]>]
  | readonly ["string", string]
  | readonly ["undefined"];

function canonicalHistoryValue(value: unknown): CanonicalHistoryValue {
  if (value === null) return ["null"];
  if (value === undefined) return ["undefined"];
  if (typeof value === "boolean") return ["boolean", value];
  if (typeof value === "bigint") return ["bigint", value.toString()];
  if (typeof value === "number") {
    return ["number", Object.is(value, -0) ? "-0" : String(value)];
  }
  if (typeof value === "string") return ["string", value];
  if (value instanceof Uint8Array) {
    return ["bytes", bytesToBase64(value)];
  }
  if (Array.isArray(value)) {
    return ["array", value.map(canonicalHistoryValue)];
  }
  if (value instanceof Map) {
    const entries = [...value.entries()].map(
      ([key, item]) =>
        [canonicalHistoryValue(key), canonicalHistoryValue(item)] as const,
    );
    entries.sort((left, right) => {
      const leftIdentity = JSON.stringify(left);
      const rightIdentity = JSON.stringify(right);
      return leftIdentity < rightIdentity
        ? -1
        : Number(leftIdentity > rightIdentity);
    });
    return ["map", entries];
  }
  if (typeof value === "object") {
    return [
      "object",
      Object.keys(value)
        .sort()
        .map(
          (key) =>
            [key, canonicalHistoryValue(Reflect.get(value, key))] as const,
        ),
    ];
  }
  throw new Error(`Unsupported Loro history value type: ${typeof value}`);
}

export function serializeCanonicalHistoryValue(value: unknown): string {
  return JSON.stringify(canonicalHistoryValue(value));
}
