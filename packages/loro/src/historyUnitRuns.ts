// A history is a sequence of units, one per operation counter. Loro groups
// consecutive units into operations by the path that brought them, so the
// canonical form regroups them: each run below is the longest stretch of
// units that continue one another, whatever operations carried them.
import { idStrToId, type JsonOp, type PeerID } from "loro-crdt";

/** One operation of the canonical form: a run, or an indivisible operation. */
export interface CanonicalOperation {
  readonly container: string;
  readonly content: object;
  readonly counter: number;
}

interface RunStart {
  readonly container: string;
  /** The counter of the run's first unit. */
  readonly counter: number;
  /** Where the first unit inserts or deletes. */
  readonly pos: number;
}

/** Unit `i` inserts code point `i` of the joined parts at `pos + i`. */
interface TextRun extends RunStart {
  readonly kind: "text";
  /** Units held: the parts' length in code points. */
  length: number;
  readonly parts: string[];
}

/** Unit `i` inserts `values[i]` at `pos + i`. */
interface ListRun extends RunStart {
  readonly kind: "list";
  readonly values: unknown[];
}

/**
 * Unit `i` deletes the element with id `target + i * direction`: forward
 * (1) always at `pos`, as the delete key does, and backward (-1) at
 * `pos - i`, as backspace does. One unit has no direction (0).
 */
interface DeleteRun extends RunStart {
  readonly kind: "delete";
  direction: -1 | 0 | 1;
  length: number;
  readonly peer: PeerID;
  readonly target: number;
}

type Run = DeleteRun | ListRun | TextRun;

function sequenceKind(container: string): "List" | "Text" | null {
  if (container.endsWith(":Text")) return "Text";
  // A movable list inserts and deletes as a list does.
  if (container.endsWith(":List") || container.endsWith(":MovableList")) {
    return "List";
  }
  return null;
}

function codePointCount(text: string): number {
  let count = text.length;
  for (let index = 0; index < text.length - 1; index += 1) {
    const unit = text.charCodeAt(index);
    if (unit < 0xd800 || unit > 0xdbff) continue;
    const next = text.charCodeAt(index + 1);
    if (next < 0xdc00 || next > 0xdfff) continue;
    count -= 1;
    index += 1;
  }
  return count;
}

type SequenceContent = Extract<JsonOp["content"], { pos: number }>;

/** The run an insert of exactly `type`, `pos` and its content is on its own. */
function insertRun(
  start: RunStart,
  kind: "List" | "Text",
  content: Extract<SequenceContent, { type: "insert" }>,
): ListRun | TextRun | null {
  if ("text" in content) {
    if (kind !== "Text" || content.text === "") return null;
    const length = codePointCount(content.text);
    return { ...start, kind: "text", length, parts: [content.text] };
  }
  if (
    kind !== "List" ||
    !Array.isArray(content.value) ||
    content.value.length === 0
  ) {
    return null;
  }
  // A copy: a run grows in place, and the history's arrays are not its own.
  return { ...start, kind: "list", values: content.value.slice() };
}

/** The run a delete of exactly `type`, `pos`, `len` and `start_id` is on its own. */
function deleteRun(
  start: RunStart,
  content: Extract<SequenceContent, { type: "delete" }>,
): DeleteRun | null {
  if (
    typeof content.start_id !== "string" ||
    !Number.isInteger(content.len) ||
    content.len === 0
  ) {
    return null;
  }
  // Loro writes a backward run as a negative length from its lowest id.
  const { counter: lowest, peer } = idStrToId(content.start_id);
  const length = Math.abs(content.len);
  const direction = length === 1 ? 0 : content.len > 0 ? 1 : -1;
  const target = direction === -1 ? lowest + length - 1 : lowest;
  return { ...start, direction, kind: "delete", length, peer, target };
}

/**
 * The run `operation` is on its own, or null when it is indivisible. Only an
 * insert or delete in a text or list, with exactly the fields this module
 * reads, divides into units: one with a field it does not know stays whole,
 * so nothing is dropped.
 */
function startRun(operation: JsonOp): Run | null {
  const { container, content, counter } = operation;
  const kind = sequenceKind(container);
  if (kind === null || !("pos" in content)) return null;
  const start = { container, counter, pos: content.pos };
  const fields = Object.keys(content).length;
  if (content.type === "insert") {
    return fields === 3 ? insertRun(start, kind, content) : null;
  }
  return fields === 4 ? deleteRun(start, content) : null;
}

function runLength(run: Run): number {
  return run.kind === "list" ? run.values.length : run.length;
}

/**
 * `run` grown by the units of `next` that continue it; returns the rest of
 * `next`, or null when nothing is left. A delete unit continues the one
 * before it forward (same position, next id) or backward (previous position,
 * previous id), and a run keeps the direction its second unit took. So when
 * `next` runs against that direction only its first unit can join.
 */
function continueDelete(run: DeleteRun, next: DeleteRun): DeleteRun | null {
  const last = run.length - 1;
  const lastPos = run.direction === -1 ? run.pos - last : run.pos;
  const lastTarget = run.target + run.direction * last;
  const step =
    next.pos === lastPos && next.target === lastTarget + 1
      ? 1
      : next.pos === lastPos - 1 && next.target === lastTarget - 1
        ? -1
        : 0;
  if (next.peer !== run.peer || step === 0 || run.direction === -step) {
    return next;
  }
  run.direction = step;
  if (next.direction !== -step) {
    run.length += next.length;
    return null;
  }
  run.length += 1;
  return {
    ...next,
    counter: next.counter + 1,
    direction: next.length > 2 ? next.direction : 0,
    length: next.length - 1,
    pos: next.direction === -1 ? next.pos - 1 : next.pos,
    target: next.target + next.direction,
  };
}

/**
 * `run` grown by the units of `next` that continue it; returns the rest of
 * `next`, or null when nothing is left. Units continue a run only in its
 * container, at the counter after it.
 */
function continueRun(run: Run, next: Run): Run | null {
  const length = runLength(run);
  if (
    next.container !== run.container ||
    next.counter !== run.counter + length
  ) {
    return next;
  }
  if (run.kind === "delete" && next.kind === "delete") {
    return continueDelete(run, next);
  }
  if (next.pos !== run.pos + length) return next;
  if (run.kind === "text" && next.kind === "text") {
    run.parts.push(...next.parts);
    run.length += next.length;
    return null;
  }
  if (run.kind === "list" && next.kind === "list") {
    // Not a spread: an insert can hold more values than a call takes.
    for (const value of next.values) run.values.push(value);
    return null;
  }
  return next;
}

/** The one operation that says what `run`'s units did. */
function runOperation(run: Run): CanonicalOperation {
  const { container, counter, pos } = run;
  if (run.kind === "text") {
    const content = { pos, text: run.parts.join(""), type: "insert" };
    return { container, content, counter };
  }
  if (run.kind === "list") {
    const content = { pos, type: "insert", value: run.values };
    return { container, content, counter };
  }
  const backward = run.direction === -1;
  const lowest = backward ? run.target - (run.length - 1) : run.target;
  const content = {
    len: backward ? -run.length : run.length,
    pos,
    start_id: `${lowest}@${run.peer}`,
    type: "delete",
  };
  return { container, content, counter };
}

/**
 * Encodes the operations of one canonical change, pushed in counter order,
 * as the runs their units form. The result is what encoding one unit at a
 * time would give: a unit joins the run before it when it continues it, and
 * starts a run otherwise.
 */
export class RunEncoder {
  private readonly encoded: CanonicalOperation[] = [];
  private run: Run | null = null;

  push(operation: JsonOp): void {
    const next = startRun(operation);
    if (next === null) {
      // Indivisible: it ends the run before it and stands as it is.
      this.closeRun();
      this.encoded.push(operation);
      return;
    }
    const rest = this.run === null ? next : continueRun(this.run, next);
    if (rest === null) return;
    this.closeRun();
    this.run = rest;
  }

  finish(): CanonicalOperation[] {
    this.closeRun();
    return this.encoded;
  }

  private closeRun(): void {
    if (this.run !== null) this.encoded.push(runOperation(this.run));
    this.run = null;
  }
}
