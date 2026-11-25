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

type InsertContent = Extract<JsonOp["content"], { type: "insert" }>;
type TextInsert = Extract<InsertContent, { text: string }>;
type ListInsert = Extract<InsertContent, { pos: number; value: unknown }>;
type ListValues = Extract<ListInsert["value"], readonly unknown[]>;

/**
 * A run of continuing inserts into a text or a list, the two kinds Loro
 * groups by path: its first operation's content and every part.
 */
type InsertRun =
  | {
      readonly kind: "text";
      readonly content: TextInsert;
      readonly first: JsonOp;
      readonly texts: string[];
    }
  | {
      readonly kind: "list";
      readonly content: ListInsert;
      readonly first: JsonOp;
      readonly values: ListValues;
    };

/** The run `operation` starts, or null when it is no text or list insert. */
function startRun(operation: JsonOp): InsertRun | null {
  const { container, content } = operation;
  if (content.type !== "insert" || !("pos" in content)) return null;
  if (container.endsWith(":Text") && "text" in content) {
    return { content, first: operation, kind: "text", texts: [content.text] };
  }
  if (
    container.endsWith(":List") &&
    "value" in content &&
    Array.isArray(content.value)
  ) {
    return {
      content,
      first: operation,
      kind: "list",
      values: [...content.value],
    };
  }
  return null;
}

/**
 * Whether `next` continues `run`, extending it when it does: an insert of the
 * same kind into the same container that starts where the run ends. A run's
 * length is the distance from its first counter to the next operation's, in
 * the unit its position counts in.
 */
function extendRun(run: InsertRun, next: JsonOp): boolean {
  const part = startRun(next);
  if (
    part === null ||
    next.container !== run.first.container ||
    part.content.pos !== run.content.pos + (next.counter - run.first.counter)
  ) {
    return false;
  }
  if (run.kind === "text" && part.kind === "text") {
    run.texts.push(...part.texts);
    return true;
  }
  if (run.kind === "list" && part.kind === "list") {
    // Not a spread: an insert can hold more values than a call takes.
    for (const value of part.values) run.values.push(value);
    return true;
  }
  return false;
}

/**
 * The one operation a run's inserts join into. Only the inserted content
 * changes: the container, first counter and position are the first
 * operation's.
 */
function runOperation(run: InsertRun): JsonOp {
  const { container, counter } = run.first;
  return run.kind === "text"
    ? {
        container,
        content: { ...run.content, text: run.texts.join("") },
        counter,
      }
    : { container, content: { ...run.content, value: run.values }, counter };
}

/**
 * A change's operations with every run of continuing inserts joined into
 * one. Loro groups consecutive inserts by the path that brought them: a
 * writer holds what it typed across two uploads as one operation, a reader
 * of those uploads holds two, and an export regroups either. Joined, every
 * holder of the same inserts serializes them alike. Loro groups deletes the
 * same way for every holder.
 */
function joinContinuingInserts(operations: readonly JsonOp[]): JsonOp[] {
  const joined: JsonOp[] = [];
  let run: InsertRun | null = null;
  for (const operation of operations) {
    if (run !== null && extendRun(run, operation)) continue;
    if (run !== null) joined.push(runOperation(run));
    run = startRun(operation);
    if (run === null) joined.push(operation);
  }
  if (run !== null) joined.push(runOperation(run));
  return joined;
}

export function serializeCanonicalHistory(history: JsonSchema): string {
  const canonicalChanges = history.changes
    .map((sourceChange) => {
      const change = {
        ...sourceChange,
        ops: joinContinuingInserts(
          sourceChange.ops.map(canonicalHistoryOperation),
        ),
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
