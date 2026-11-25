import { bytesToBase64 } from "@tearleads/encoding";

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

export function compareCanonicalIdentity(left: string, right: string): number {
  return left < right ? -1 : Number(left > right);
}

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
      return compareCanonicalIdentity(leftIdentity, rightIdentity);
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

/**
 * `value` as a string that tells apart every type and content a Loro history
 * holds: binary data from its base64 text, -0 from 0, and a map from an
 * object, with keys in one order.
 */
export function serializeCanonicalHistoryValue(value: unknown): string {
  return JSON.stringify(canonicalHistoryValue(value));
}
