// The unit model of a document's history, stated apart from the production
// encoder: a history taken apart into one operation and one change per
// counter, and put back together in any other grouping. Every grouping of one
// unit sequence must have one canonical form.
import { base64ToBytes } from "@tearleads/encoding";
import type { JsonChange, JsonOp, JsonSchema, PeerID } from "loro-crdt";

type JsonOpId = JsonChange["id"];

export function parseOpId(id: string): { counter: number; peer: PeerID } {
  const at = id.indexOf("@");
  return {
    counter: Number(id.slice(0, at)),
    peer: id.slice(at + 1) as PeerID,
  };
}

export function opId(counter: number, peer: PeerID): JsonOpId {
  return `${counter}@${peer}`;
}

function containerKind(container: string): string {
  return container.slice(container.lastIndexOf(":") + 1);
}

/** One operation per counter of `operation`, or `[operation]` when it is indivisible. */
function explodeOperation(operation: JsonOp): JsonOp[] {
  const { container, content, counter } = operation;
  const kind = containerKind(container);
  if (content.type === "insert" && kind === "Text" && "text" in content) {
    return [...content.text].map((text, index) => ({
      container,
      content: { ...content, pos: content.pos + index, text },
      counter: counter + index,
    }));
  }
  if (
    content.type === "insert" &&
    (kind === "List" || kind === "MovableList") &&
    "pos" in content &&
    "value" in content &&
    Array.isArray(content.value)
  ) {
    return content.value.map((value, index) => ({
      container,
      content: { ...content, pos: content.pos + index, value: [value] },
      counter: counter + index,
    }));
  }
  if (content.type === "delete" && "start_id" in content) {
    const start = parseOpId(content.start_id);
    const count = Math.abs(content.len);
    return Array.from({ length: count }, (_, index) => ({
      container,
      content:
        content.len > 0
          ? {
              ...content,
              len: 1,
              start_id: opId(start.counter + index, start.peer),
            }
          : {
              ...content,
              len: 1,
              pos: content.pos - index,
              start_id: opId(start.counter + count - 1 - index, start.peer),
            },
      counter: counter + index,
    }));
  }
  return [operation];
}

/**
 * `history` with one change per operation, each after the first of its
 * change depending on the counter before it, and (unless `operations` is
 * false) one operation per counter.
 */
export function explodeHistory(
  history: JsonSchema,
  options: { operations?: boolean } = {},
): JsonSchema {
  const changes = history.changes.flatMap((change) => {
    const { counter: first, peer } = parseOpId(change.id);
    const operations =
      options.operations === false
        ? change.ops
        : change.ops.flatMap(explodeOperation);
    return operations.map((operation) => ({
      ...change,
      deps:
        operation.counter === first
          ? change.deps
          : [opId(operation.counter - 1, peer)],
      id: opId(operation.counter, peer),
      lamport: change.lamport + (operation.counter - first),
      ops: [operation],
    }));
  });
  return { ...history, changes };
}

type Content = JsonOp["content"];
type SequenceDelete = Extract<Content, { start_id: JsonOpId }>;

function sequenceDelete(content: Content): SequenceDelete | null {
  return content.type === "delete" && "start_id" in content ? content : null;
}

/** `content` with the insert `added` after its `length` units, if it continues. */
function joinInsert(
  content: Content,
  added: Content,
  length: number,
): Content | null {
  if (
    content.type !== "insert" ||
    added.type !== "insert" ||
    !("pos" in content) ||
    !("pos" in added) ||
    added.pos !== content.pos + length
  ) {
    return null;
  }
  if ("text" in content) {
    return "text" in added
      ? { ...content, text: content.text + added.text }
      : null;
  }
  return "value" in added &&
    Array.isArray(content.value) &&
    Array.isArray(added.value)
    ? { ...content, value: [...content.value, ...added.value] }
    : null;
}

/**
 * `deleted` with the one-unit delete `added` after its `length` units, if it
 * continues: forward at the same position on the next id, or backward at
 * the previous position on the previous id, and only the way a longer run
 * already goes.
 */
function joinDelete(
  deleted: SequenceDelete,
  added: SequenceDelete,
  length: number,
): Content | null {
  const start = parseOpId(deleted.start_id);
  const target = parseOpId(added.start_id);
  if (start.peer !== target.peer) return null;
  const forward =
    (length === 1 || deleted.len > 0) &&
    added.pos === deleted.pos &&
    target.counter === start.counter + length;
  const backward =
    (length === 1 || deleted.len < 0) &&
    added.pos === deleted.pos - length &&
    target.counter === start.counter - 1;
  if (forward) return { ...deleted, len: length + 1 };
  return backward
    ? { ...deleted, len: -(length + 1), start_id: added.start_id }
    : null;
}

/**
 * `left` and the one-counter `unit` as one operation, or null when the unit
 * does not continue it. The unit's counter follows `left` in one change.
 */
function joinUnit(left: JsonOp, unit: JsonOp): JsonOp | null {
  if (left.container !== unit.container) return null;
  const length = unit.counter - left.counter;
  const deleted = sequenceDelete(left.content);
  const added = sequenceDelete(unit.content);
  const content =
    deleted && added
      ? joinDelete(deleted, added, length)
      : joinInsert(left.content, unit.content, length);
  return content ? { ...left, content } : null;
}

function continuesChange(previous: JsonChange, next: JsonChange): boolean {
  const { counter, peer } = parseOpId(next.id);
  const first = parseOpId(previous.id);
  return (
    first.peer === peer &&
    next.deps.length === 1 &&
    next.deps[0] === opId(counter - 1, peer) &&
    next.lamport === previous.lamport + (counter - first.counter) &&
    next.timestamp === previous.timestamp &&
    next.msg === previous.msg
  );
}

/** One peer's units, in counter order, grouped as `next` says. */
function regroupPeer(
  units: readonly JsonChange[],
  next: (bound: number) => number,
): JsonChange[] {
  const changes: JsonChange[] = [];
  let change: JsonChange | null = null;
  for (const unit of units) {
    const [operation] = unit.ops;
    if (!operation) throw new Error("A unit holds one operation");
    if (change === null || !continuesChange(change, unit) || next(3) === 0) {
      change = { ...unit, ops: [operation] };
      changes.push(change);
      continue;
    }
    const last = change.ops[change.ops.length - 1];
    const joined = last && next(4) !== 0 ? joinUnit(last, operation) : null;
    if (joined) change.ops[change.ops.length - 1] = joined;
    else change.ops.push(operation);
  }
  return changes;
}

/**
 * The units of `history` grouped another way: each unit joins the change
 * and the operation before it when it may and `next` says so. A change comes
 * where its first unit did.
 */
export function regroupHistory(
  history: JsonSchema,
  next: (bound: number) => number,
): JsonSchema {
  const units = explodeHistory(history).changes;
  const order = new Map(units.map((unit, index) => [unit.id, index]));
  const byPeer = new Map<string, JsonChange[]>();
  for (const unit of units) {
    const { peer } = parseOpId(unit.id);
    const held = byPeer.get(peer);
    if (held) held.push(unit);
    else byPeer.set(peer, [unit]);
  }
  const changes = [...byPeer.values()].flatMap((peerUnits) =>
    regroupPeer(
      peerUnits.sort(
        (left, right) =>
          parseOpId(left.id).counter - parseOpId(right.id).counter,
      ),
      next,
    ),
  );
  changes.sort(
    (left, right) => (order.get(left.id) ?? 0) - (order.get(right.id) ?? 0),
  );
  return { ...history, changes };
}

/** The value a canonical form's tagged JSON stands for. */
function untagged(tagged: unknown): unknown {
  if (!Array.isArray(tagged)) throw new Error("Not a canonical value");
  const [tag, body] = tagged;
  if (tag === "null") return null;
  if (tag === "undefined") return undefined;
  if (tag === "boolean" || tag === "string") return body;
  if (tag === "number") return Number(body);
  if (tag === "bytes") return base64ToBytes(body);
  if (tag === "array") return body.map(untagged);
  if (tag === "object") {
    return Object.fromEntries(
      body.map(([key, value]: [string, unknown]) => [key, untagged(value)]),
    );
  }
  throw new Error(`Unexpected canonical tag ${String(tag)}`);
}

/** A peer's units in counter order, peers in order, dependencies sorted. */
function sortedUnits(history: JsonSchema): JsonChange[] {
  const key = (change: JsonChange) => {
    const { counter, peer } = parseOpId(change.id);
    return `${peer.padStart(24, "0")}:${String(counter).padStart(12, "0")}`;
  };
  return explodeHistory(history)
    .changes.map((change) => ({ ...change, deps: [...change.deps].sort() }))
    .sort((left, right) => (key(left) < key(right) ? -1 : 1));
}

/** The units of `history`, in one order whatever its grouping. */
export function unitsOf(history: JsonSchema): JsonChange[] {
  return sortedUnits(history);
}

/** The units a serialized canonical form says its history holds. */
export function unitsOfCanonicalForm(serialized: string): JsonChange[] {
  return sortedUnits(untagged(JSON.parse(serialized)) as JsonSchema);
}
