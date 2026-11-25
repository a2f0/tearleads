// Single forgeries of a history, each changing one fact that matters and
// nothing else. They work on a history taken apart into units, so the
// canonical form has to put the units back together and still tell the
// forgery from the original.
import type { JsonChange, JsonOp, JsonSchema, PeerID } from "loro-crdt";
import type { Next } from "./historyEdits.testFixtures";
import { opId, parseOpId } from "./historyUnits.testFixtures";

/** One change holding one operation of one counter. */
type Unit = JsonChange;
type Mutation = (units: Unit[], next: Next) => Unit[] | null;

function operationOf(unit: Unit): JsonOp {
  const [operation] = unit.ops;
  if (!operation) throw new Error("A unit holds one operation");
  return operation;
}

/** `units` with the one at `index` replaced. */
function replaced(units: Unit[], index: number, unit: Unit): Unit[] {
  return units.map((held, at) => (at === index ? unit : held));
}

function withContent(unit: Unit, content: JsonOp["content"]): Unit {
  return { ...unit, ops: [{ ...operationOf(unit), content }] };
}

/** A unit chosen among those `accepts` takes, or null when there is none. */
function pick(
  units: Unit[],
  next: Next,
  accepts: (unit: Unit, index: number) => boolean,
): number | null {
  const indexes = units.flatMap((unit, index) =>
    accepts(unit, index) ? [index] : [],
  );
  return indexes[next(Math.max(indexes.length, 1))] ?? null;
}

/** Mutates the content of one unit `change` knows how to forge. */
function contentMutation(
  change: (content: JsonOp["content"]) => JsonOp["content"] | null,
): Mutation {
  return (units, next) => {
    const index = pick(
      units,
      next,
      (unit) => change(operationOf(unit).content) !== null,
    );
    const unit = index === null ? undefined : units[index];
    const content = unit && change(operationOf(unit).content);
    return index === null || !unit || !content
      ? null
      : replaced(units, index, withContent(unit, content));
  };
}

/** The same deletes of the same ids, run the other way. */
const reversedDeletes: Mutation = (units, next) => {
  const step = (index: number): -1 | 0 | 1 => {
    const [left, right] = [units[index], units[index + 1]];
    if (!left || !right) return 0;
    const [first, second] = [operationOf(left), operationOf(right)];
    const [from, to] = [first.content, second.content];
    if (
      parseOpId(left.id).peer !== parseOpId(right.id).peer ||
      first.container !== second.container ||
      !("start_id" in from) ||
      !("start_id" in to)
    ) {
      return 0;
    }
    const [a, b] = [parseOpId(from.start_id), parseOpId(to.start_id)];
    if (a.peer !== b.peer) return 0;
    if (to.pos === from.pos && b.counter === a.counter + 1) return 1;
    return to.pos === from.pos - 1 && b.counter === a.counter - 1 ? -1 : 0;
  };
  const index = pick(units, next, (_unit, at) => step(at) !== 0);
  if (index === null) return null;
  const [left, right] = [units[index], units[index + 1]];
  if (!left || !right) return null;
  const [from, to] = [operationOf(left).content, operationOf(right).content];
  if (!("start_id" in from) || !("start_id" in to)) return null;
  // Forward (p, a), (p, a + 1) is backward (p + 1, a + 1), (p, a).
  const forward = step(index) === 1;
  const first = forward
    ? { ...from, pos: from.pos + 1, start_id: to.start_id }
    : { ...from, pos: to.pos, start_id: to.start_id };
  const second = forward
    ? { ...to, pos: from.pos, start_id: from.start_id }
    : { ...to, pos: to.pos, start_id: from.start_id };
  return replaced(
    replaced(units, index, withContent(left, first)),
    index + 1,
    withContent(right, second),
  );
};

/** Two neighbouring units of one peer trade what they did. */
const swappedCounters: Mutation = (units, next) => {
  const differs = (index: number) => {
    const [left, right] = [units[index], units[index + 1]];
    if (!left || !right) return false;
    const [first, second] = [operationOf(left), operationOf(right)];
    return (
      parseOpId(left.id).peer === parseOpId(right.id).peer &&
      Bun.inspect([first.container, first.content]) !==
        Bun.inspect([second.container, second.content])
    );
  };
  const index = pick(units, next, (_unit, at) => differs(at));
  if (index === null) return null;
  const [left, right] = [units[index], units[index + 1]];
  if (!left || !right) return null;
  const [first, second] = [operationOf(left), operationOf(right)];
  return replaced(
    replaced(units, index, {
      ...left,
      ops: [{ ...second, counter: first.counter }],
    }),
    index + 1,
    { ...right, ops: [{ ...first, counter: second.counter }] },
  );
};

/** The last unit of one peer, written by another peer instead. */
const movedPeer: Mutation = (units) => {
  const ends = new Map<PeerID, number>();
  for (const unit of units) {
    const { counter, peer } = parseOpId(unit.id);
    ends.set(peer, Math.max(ends.get(peer) ?? 0, counter + 1));
  }
  const [from, to] = [...ends.keys()];
  if (from === undefined || to === undefined) return null;
  const moved = opId((ends.get(from) ?? 0) - 1, from);
  const counter = ends.get(to) ?? 0;
  return units.map((unit) =>
    unit.id === moved
      ? {
          ...unit,
          id: opId(counter, to),
          ops: [{ ...operationOf(unit), counter }],
        }
      : unit,
  );
};

function unitMutation(change: (unit: Unit) => Unit): Mutation {
  return (units, next) => {
    const index = next(units.length);
    const unit = units[index];
    return unit ? replaced(units, index, change(unit)) : null;
  };
}

function otherContainer(container: JsonOp["container"]): JsonOp["container"] {
  const parts = container.split(":");
  const kind = parts.pop();
  return `${parts.join(":")}-elsewhere:${kind}` as JsonOp["container"];
}

/** Each forgery, named by the fact it changes. */
export const HISTORY_MUTATIONS: Readonly<Record<string, Mutation>> = {
  "a change's commit time": unitMutation((unit) => ({
    ...unit,
    timestamp: unit.timestamp + 1,
  })),
  "a change's dependencies": unitMutation((unit) => ({
    ...unit,
    deps: [...unit.deps, "0@7"],
  })),
  "a change's Lamport time": unitMutation((unit) => ({
    ...unit,
    lamport: unit.lamport + 1,
  })),
  "a change's message": unitMutation((unit) => ({
    ...unit,
    msg: `${unit.msg ?? ""}!`,
  })),
  "a delete's direction": reversedDeletes,
  "a delete's target": contentMutation((content) => {
    if (!("start_id" in content)) return null;
    const { counter, peer } = parseOpId(content.start_id);
    return { ...content, start_id: opId(counter + 1, peer) };
  }),
  "a list insert's value": contentMutation((content) =>
    content.type === "insert" && "pos" in content && "value" in content
      ? { ...content, value: [{ forged: true }] }
      : null,
  ),
  "a text insert's text": contentMutation((content) =>
    content.type === "insert" && "text" in content
      ? { ...content, text: content.text === "x" ? "y" : "x" }
      : null,
  ),
  "an operation's container": unitMutation((unit) => {
    const operation = operationOf(unit);
    const container = otherContainer(operation.container);
    return { ...unit, ops: [{ ...operation, container }] };
  }),
  "an operation's position": contentMutation((content) =>
    "pos" in content ? { ...content, pos: content.pos + 1 } : null,
  ),
  "which counter did what": swappedCounters,
  "which peer wrote a unit": movedPeer,
};

/**
 * `units`, a history `explodeHistory` took apart, with one forgery applied,
 * or null when the history has nothing that forgery can change.
 */
export function forgeUnits(
  units: JsonSchema,
  mutation: Mutation,
  next: Next,
): JsonSchema | null {
  const changes = mutation(units.changes, next);
  return changes === null ? null : { ...units, changes };
}
