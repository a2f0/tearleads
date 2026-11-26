// Generated edits for history tests: the kinds of operation the application
// writes (text, lists, maps and their nested containers), and on request the
// kinds it does not (marks, movable lists, trees and counters).
import {
  type LoroDoc,
  type LoroList,
  LoroMap,
  type LoroMovableList,
  LoroText,
} from "loro-crdt";

export type Next = (bound: number) => number;

/** `app`: what documents hold today. `all`: every kind Loro has. */
export type EditKinds = "all" | "app";

export interface EditOptions {
  readonly kinds: EditKinds;
  /** Insert sizes to draw from, in code points. */
  readonly sizes: readonly number[];
}

/** Text past the basic plane, with joiners and a regional indicator pair. */
const ASTRAL = "a😀b𠜎c🧑‍🚀d𝄞e🇯🇵f";

function isLowSurrogate(unit: number): boolean {
  return unit >= 0xdc00 && unit <= 0xdfff;
}

/** The UTF-16 index at or before `index` that starts a code point. */
function boundary(text: string, index: number): number {
  const clamped = Math.max(0, Math.min(index, text.length));
  return clamped < text.length && isLowSurrogate(text.charCodeAt(clamped))
    ? clamped - 1
    : clamped;
}

/** The UTF-16 index after the code point that starts at `index`. */
function after(text: string, index: number): number {
  return index + 1 < text.length && isLowSurrogate(text.charCodeAt(index + 1))
    ? index + 2
    : index + 1;
}

function runLength(next: Next): number {
  return 1 + next(next(3) === 0 ? 700 : 12);
}

function insertText(text: LoroText, next: Next, sizes: readonly number[]) {
  const held = text.toString();
  const size = (sizes[next(sizes.length)] ?? 1) + next(7);
  const body =
    next(4) === 0
      ? ASTRAL.repeat(Math.ceil(size / 14))
      : String.fromCharCode(97 + next(26)).repeat(size);
  const at = [0, held.length, boundary(held, next(held.length + 1))][next(3)];
  text.insert(at ?? 0, body);
}

type TextEdit = (text: LoroText, held: string, next: Next) => void;

/** One delete of a span. */
const deleteSpan: TextEdit = (text, held, next) => {
  const from = boundary(held, next(held.length));
  const to = boundary(held, from + 1 + next(next(3) === 0 ? 3000 : 30));
  if (to > from) text.delete(from, to - from);
};

/** A backspace run: one code point at a time, moving left. */
const backspaceText: TextEdit = (text, held, next) => {
  let at = boundary(held, 1 + next(held.length));
  for (let count = runLength(next); count > 0 && at > 0; count -= 1) {
    const start = boundary(held, at - 1);
    text.delete(start, at - start);
    at = start;
  }
};

/** A delete key run: one code point at a time, in place. */
const deleteKeyText: TextEdit = (text, held, next) => {
  const at = boundary(held, next(held.length));
  let cursor = at;
  for (let count = runLength(next); count > 0; count -= 1) {
    if (cursor >= held.length) return;
    const end = after(held, cursor);
    text.delete(at, end - cursor);
    cursor = end;
  }
};

/** A replaced span: a delete and an insert at one place. */
const replaceSpan: TextEdit = (text, held, next) => {
  const from = boundary(held, next(held.length));
  const to = boundary(held, from + 1 + next(20));
  if (to > from) text.delete(from, to - from);
  text.insert(from, "r".repeat(1 + next(30)));
};

const TEXT_EDITS = [deleteSpan, backspaceText, deleteKeyText, replaceSpan];

function editText(text: LoroText, next: Next, sizes: readonly number[]): void {
  const held = text.toString();
  const kind = next(8);
  const edit = TEXT_EDITS[kind - 4];
  if (!edit || held.length < 40) insertText(text, next, sizes);
  else edit(text, held, next);
}

function listValue(next: Next): unknown {
  return [
    next(100),
    `value-${next(50)}`,
    null,
    next(2) === 0,
    { nested: next(9) },
    [next(9), "x"],
    new Uint8Array([next(256), next(256)]),
    next(100) / 8,
  ][next(8)];
}

type Sequence = LoroList | LoroMovableList;
type ListEdit = (list: Sequence, next: Next) => void;

const insertValues: ListEdit = (list, next) => {
  const at = next(2) === 0 ? list.length : next(list.length + 1);
  const count = 1 + next(next(3) === 0 ? 1500 : 40);
  for (let index = 0; index < count; index += 1) {
    list.insert(at + index, listValue(next));
  }
};

const deleteValues: ListEdit = (list, next) => {
  const from = next(list.length);
  list.delete(from, 1 + next(Math.min(list.length - from, 900)));
};

const backspaceValues: ListEdit = (list, next) => {
  let at = next(list.length);
  for (let count = runLength(next); count > 0 && at >= 0; count -= 1) {
    list.delete(at, 1);
    at -= 1;
  }
};

const deleteKeyValues: ListEdit = (list, next) => {
  const at = next(list.length);
  for (let count = runLength(next); count > 0; count -= 1) {
    if (at >= list.length) return;
    list.delete(at, 1);
  }
};

const insertChild: ListEdit = (list, next) => {
  list
    .insertContainer(next(list.length + 1), new LoroMap())
    .set("n", next(100));
};

const LIST_EDITS = [
  deleteValues,
  backspaceValues,
  deleteKeyValues,
  insertChild,
  insertChild,
];

function editList(list: Sequence, next: Next): void {
  const edit = LIST_EDITS[next(7) - 2];
  if (!edit || list.length < 12) insertValues(list, next);
  else edit(list, next);
}

function editMap(doc: LoroDoc, next: Next, sizes: readonly number[]): void {
  const map = doc.getMap("fields");
  const kind = next(6);
  if (kind < 3) {
    map.set(`key-${next(6)}`, "v".repeat(next(3) === 0 ? 5000 : next(80)));
  } else if (kind === 3) {
    map.delete(`key-${next(6)}`);
  } else {
    const held = map.get("body");
    const body =
      held instanceof LoroText && next(4) !== 0
        ? held
        : map.setContainer("body", new LoroText());
    editText(body, next, sizes);
  }
}

function editMovableList(doc: LoroDoc, next: Next): void {
  const list = doc.getMovableList("movable");
  const kind = next(4);
  if (kind === 0 && list.length > 2) {
    list.move(next(list.length), next(list.length));
  } else if (kind === 1 && list.length > 0) {
    list.set(next(list.length), `set-${next(50)}`);
  } else {
    editList(list, next);
  }
}

function editTree(doc: LoroDoc, next: Next): void {
  const tree = doc.getTree("tree");
  const nodes = tree.getNodes();
  const node = nodes[next(nodes.length + 1)];
  const parent = nodes[next(nodes.length + 1)];
  const kind = next(4);
  if (!node || kind === 0) {
    tree.createNode(parent?.id);
  } else if (kind === 1) {
    node.data.set("title", `node-${next(20)}`);
  } else if (kind === 2 && nodes.length > 3) {
    tree.delete(node.id);
  } else if (parent && parent.id !== node.id) {
    try {
      node.move(parent);
    } catch {
      // A move under the node's own descendant is refused.
    }
  }
}

function markText(doc: LoroDoc, next: Next): void {
  const text = doc.getText("text");
  const held = text.toString();
  const start = boundary(held, next(held.length + 1));
  const end = boundary(held, start + 1 + next(40));
  if (end <= start) return;
  if (next(4) === 0) text.unmark({ end, start }, "bold");
  else text.mark({ end, start }, next(2) === 0 ? "bold" : "link", next(9));
}

/** One edit by one writer. */
export function editDocument(
  doc: LoroDoc,
  next: Next,
  options: EditOptions,
): void {
  const kind = next(options.kinds === "all" ? 16 : 10);
  if (kind < 5) editText(doc.getText("text"), next, options.sizes);
  else if (kind < 8) editList(doc.getList("items"), next);
  else if (kind < 10) editMap(doc, next, options.sizes);
  else if (kind < 12) editMovableList(doc, next);
  else if (kind < 14) markText(doc, next);
  else if (kind === 14) editTree(doc, next);
  else doc.getCounter("count").increment(next(9) - 4);
}
