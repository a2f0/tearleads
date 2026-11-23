import { bytesToBase64 } from "@tearleads/encoding";
import { type JsonOp, type JsonSchema, LoroDoc } from "loro-crdt";
import { recordChangeTimestamps } from "./changeTimestamps";

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

function compareCanonicalIdentity(left: string, right: string): number {
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

function serializeCanonicalHistoryValue(value: unknown): string {
  return JSON.stringify(canonicalHistoryValue(value));
}

function canonicalHistoryOperation(operation: JsonOp): JsonOp {
  const { content } = operation;
  // Coalesced backspaces use negative lengths. Slicing that run to one
  // deletion can produce -1 where the original update used +1: both delete
  // the same element at the same position. Direction still matters for
  // longer runs, and application values must retain their literal contents.
  if (content.type === "delete" && "len" in content && content.len === -1) {
    return { ...operation, content: { ...content, len: 1 } };
  }
  return operation;
}

export function serializeCanonicalHistory(history: JsonSchema): string {
  const canonicalChanges = history.changes
    .map((sourceChange) => {
      const change = {
        ...sourceChange,
        ops: sourceChange.ops.map(canonicalHistoryOperation),
      };
      return { change, identity: serializeCanonicalHistoryValue(change) };
    })
    .sort((left, right) =>
      compareCanonicalIdentity(left.identity, right.identity),
    )
    .map(({ change }) => change);
  return serializeCanonicalHistoryValue({
    ...history,
    changes: canonicalChanges,
  });
}

/**
 * The canonical identity of `history` as an empty document segments it.
 * Documents holding the same operations can split them differently by the
 * path that imported them: a snapshot imported into a populated document, or
 * a batch repeating operations already held, keeps adjacent operations apart
 * that other imports merge. Replaying the history segments it the same way
 * for every holder, and keeps every operation's content.
 */
export function serializeReplayedHistory(history: JsonSchema): string {
  const replay = new LoroDoc();
  try {
    recordChangeTimestamps(replay);
    replay.importJsonUpdates(history);
    return serializeCanonicalHistory(
      replay.exportJsonUpdates(undefined, undefined, false),
    );
  } finally {
    replay.free();
  }
}
