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

/** An insert into a text or a list: the two kinds Loro groups by path. */
type SequenceInsert =
  | { readonly pos: number; readonly text: string }
  | { readonly pos: number; readonly values: readonly unknown[] };

function sequenceInsertOf(operation: JsonOp): SequenceInsert | null {
  const { container, content } = operation;
  if (content.type !== "insert" || !("pos" in content)) return null;
  if (container.endsWith(":Text") && "text" in content) {
    return { pos: content.pos, text: content.text };
  }
  if (
    container.endsWith(":List") &&
    "value" in content &&
    Array.isArray(content.value)
  ) {
    return { pos: content.pos, values: content.value };
  }
  return null;
}

/** A run of continuing inserts: its first operation and every part. */
interface InsertRun {
  readonly first: JsonOp;
  readonly pos: number;
  readonly texts: string[] | null;
  readonly values: unknown[] | null;
}

function startRun(first: JsonOp, insert: SequenceInsert): InsertRun {
  return "text" in insert
    ? { first, pos: insert.pos, texts: [insert.text], values: null }
    : { first, pos: insert.pos, texts: null, values: [...insert.values] };
}

/**
 * Whether `next` continues `run`, extending it when it does: an insert of the
 * same kind into the same container that starts where the run ends. A run's
 * length is the distance from its first counter to the next operation's, in
 * the unit its position counts in.
 */
function extendRun(run: InsertRun, next: JsonOp, insert: SequenceInsert) {
  if (
    next.container !== run.first.container ||
    insert.pos !== run.pos + (next.counter - run.first.counter)
  ) {
    return false;
  }
  if (run.texts !== null && "text" in insert) {
    run.texts.push(insert.text);
    return true;
  }
  if (run.values !== null && "values" in insert) {
    // Not a spread: an insert can hold more values than a call takes.
    for (const value of insert.values) run.values.push(value);
    return true;
  }
  return false;
}

/** The one operation a run's inserts join into. */
function runOperation(run: InsertRun): JsonOp {
  const { first } = run;
  if (run.texts !== null && run.texts.length === 1) return first;
  // Only the inserted content changes: the kind, container, first counter and
  // position are the first operation's.
  return {
    ...first,
    content:
      run.texts !== null
        ? { ...first.content, text: run.texts.join("") }
        : { ...first.content, value: run.values },
  } as JsonOp;
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
    const insert = sequenceInsertOf(operation);
    if (run !== null && insert !== null && extendRun(run, operation, insert)) {
      continue;
    }
    if (run !== null) joined.push(runOperation(run));
    run = insert === null ? null : startRun(operation, insert);
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
