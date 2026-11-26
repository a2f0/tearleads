// Loro stores a peer's changes in blocks of about 4 KiB and joins an imported
// change to the one before it only while the block has room. So a reader
// that received a history in pieces can hold the same operations in
// different changes than the writer, and cut where the writer has none. The
// history identity must be the same for all of them, and every piece must
// match every holder.
import { expect, test } from "bun:test";
import { LoroDoc, LoroMap } from "loro-crdt";
import {
  createDocument,
  exportFullHistoryIdentity,
  exportFullHistorySnapshot,
  importSnapshot,
  importUpdates,
} from "./document";
import { updateMatchesDocumentHistory } from "./updateIdentity";

type Document = Awaited<ReturnType<typeof createDocument>>;

const T0 = 1_700_000_000;

/** How `doc` splits its history into changes and operations. */
function grouping(doc: LoroDoc): string[] {
  return doc
    .exportJsonUpdates(undefined, undefined, false)
    .changes.map(
      (change) =>
        `${change.id}: ${change.ops.map((op) => op.counter).join(",")}`,
    );
}

/** The writer's own operations in `[start, end)` as one update. */
function piece(doc: LoroDoc, start: number, end: number): Uint8Array {
  return doc.export({
    mode: "updates-in-range",
    spans: [{ id: { counter: start, peer: doc.peerIdStr }, len: end - start }],
  });
}

interface Cut {
  readonly cold: LoroDoc;
  readonly pieces: Uint8Array[];
}

/** A reader that received `source`'s history cut at each of `counters`. */
function cutAt(source: LoroDoc, counters: readonly number[]): Cut {
  const bounds = [0, ...counters, source.opCount()];
  const pieces = bounds
    .slice(1)
    .map((end, index) => piece(source, bounds[index] ?? 0, end));
  const cold = new LoroDoc();
  for (const update of pieces) importUpdates(cold, [update]);
  return { cold, pieces };
}

/**
 * Every holder of `source`'s history cut at `counters` has its identity,
 * and every piece matches every holder.
 */
function expectOneIdentity(source: LoroDoc, counters: readonly number[]): Cut {
  const cut = cutAt(source, counters);
  const restored = new LoroDoc();
  importSnapshot(restored, exportFullHistorySnapshot(source));
  const identity = exportFullHistoryIdentity(source);
  expect(exportFullHistoryIdentity(cut.cold)).toBe(identity);
  expect(exportFullHistoryIdentity(restored)).toBe(identity);
  for (const holder of [source, cut.cold, restored]) {
    for (const update of cut.pieces) {
      expect(updateMatchesDocumentHistory(holder, update)).toBe(true);
    }
  }
  restored.free();
  return cut;
}

async function written(seed: string, write: (doc: Document) => void) {
  const doc = await createDocument(seed);
  write(doc);
  return doc;
}

test("a 4,200 character insert cut at 2,000 keeps its identity", async () => {
  const source = await written("split-4200", (doc) => {
    doc.getText("text").insert(0, "x".repeat(4200));
    doc.commit({ timestamp: T0 });
  });

  const { cold } = expectOneIdentity(source, [2000]);

  // The reader holds two changes cut where the writer has no cut.
  expect(grouping(cold)).not.toEqual(grouping(source));
  expect(cold.getAllChanges().get(source.peerIdStr)).toHaveLength(2);
  source.free();
  cold.free();
});

test("text past the basic plane cut inside a storage block keeps its identity", async () => {
  const source = await written("split-astral", (doc) => {
    doc.getText("text").insert(0, "𝄞😀漢é".repeat(1200));
    doc.commit({ timestamp: T0 });
  });

  expectOneIdentity(source, [1001, 2999]).cold.free();
  source.free();
});

/** A change that starts in a nearly full block and holds three operations. */
function afterFullBlock(doc: Document): void {
  const text = doc.getText("text");
  text.insert(0, "p".repeat(3500));
  doc.commit({ timestamp: T0 });
  text.insert(0, "q".repeat(400));
  doc.getMap("fields").set("key", "value");
  text.insert(0, "r".repeat(500));
  doc.commit({ timestamp: T0 + 60 });
}

test.each([
  ["between two operations", 3900],
  ["after the map operation", 3901],
  ["inside the first insert", 3700],
  ["inside the last insert", 4100],
  ["at the change's start", 3500],
])("a change cut %s keeps its identity", async (_name, counter) => {
  const source = await written("split-between", afterFullBlock);

  expectOneIdentity(source, [counter]).cold.free();
  source.free();
});

test("map operations cut across a storage block keep their identity", async () => {
  const source = await written("split-map", (doc) => {
    doc.getText("text").insert(0, "p".repeat(4000));
    doc.commit({ timestamp: T0 });
    for (let key = 0; key < 200; key += 1) {
      doc.getMap("fields").set(`key-${key}`, "v".repeat(50));
    }
    doc.commit({ timestamp: T0 + 60 });
  });

  for (const counter of [4030, 4100]) {
    expectOneIdentity(source, [counter]).cold.free();
  }
  source.free();
});

type Sequence = "list" | "movable list" | "text";

type Remove = (position: number, count: number) => void;

/** A sequence's insert at its start, and its delete. */
function sequenceOf(doc: LoroDoc, kind: Sequence) {
  if (kind === "text") {
    const text = doc.getText("sequence");
    return {
      insert: (count: number) => text.insert(0, "y".repeat(count)),
      remove: (position: number, count: number) => text.delete(position, count),
    };
  }
  const list =
    kind === "list" ? doc.getList("sequence") : doc.getMovableList("sequence");
  return {
    insert: (count: number) => {
      for (let index = 0; index < count; index += 1) list.insert(index, index);
    },
    remove: (position: number, count: number) => list.delete(position, count),
  };
}

/**
 * How many elements to write before the deletes, and after them. With these
 * Loro stores the second commit apart from the first, and gives a reader the
 * head of a cut delete run in the first change and its rest in the second.
 */
const FILL = {
  list: { before: 1000, tail: 100 },
  "movable list": { before: 1000, tail: 100 },
  text: { before: 3000, tail: 3000 },
};

/** A writer's two commits of one second: a fill, then `deletes` and a tail. */
async function withDeletes(kind: Sequence, deletes: (remove: Remove) => void) {
  return written(`split-delete-${kind}`, (doc) => {
    const { insert, remove } = sequenceOf(doc, kind);
    insert(FILL[kind].before);
    doc.commit({ timestamp: T0 });
    deletes(remove);
    insert(FILL[kind].tail);
    doc.commit({ timestamp: T0 });
  });
}

function deleteOperations(doc: LoroDoc): number {
  return doc
    .exportJsonUpdates(undefined, undefined, false)
    .changes.flatMap((change) => change.ops)
    .filter((op) => op.content.type === "delete").length;
}

/** Each deletes 300 elements, from the counter after the fill. */
const DELETE_RUNS: Record<string, (remove: Remove) => void> = {
  "a backspace run": (remove) => {
    for (let position = 400; position > 100; position -= 1) remove(position, 1);
  },
  "a delete key run": (remove) => {
    for (let count = 0; count < 300; count += 1) remove(100, 1);
  },
  "a forward delete": (remove) => remove(100, 300),
  "runs both ways": (remove) => {
    remove(100, 100);
    for (let position = 400; position > 300; position -= 1) remove(position, 1);
    for (let count = 0; count < 100; count += 1) remove(150, 1);
  },
};

for (const kind of ["text", "list", "movable list"] as const) {
  test.each(Object.entries(DELETE_RUNS))(
    `${kind}: %s cut in two keeps its identity`,
    async (_name, deletes) => {
      const source = await withDeletes(kind, deletes);
      const first = FILL[kind].before;
      let apart = 0;

      for (const offset of [1, 2, 50, 150, 250, 298, 299]) {
        const { cold } = expectOneIdentity(source, [first + offset]);
        if (deleteOperations(cold) > deleteOperations(source)) apart += 1;
        cold.free();
      }
      // The reader holds the two parts of a run as two operations.
      expect(apart).toBeGreaterThan(0);
      expectOneIdentity(source, [
        first - 7,
        first + 100,
        first + 101,
      ]).cold.free();
      source.free();
    },
  );
}

test("mixed kinds across a storage block keep their identity at every cut", async () => {
  const source = await written("split-mixed", (doc) => {
    const text = doc.getText("text");
    const list = doc.getList("items");
    text.insert(0, "a".repeat(4070));
    doc.commit({ timestamp: T0 });
    text.insert(4070, "b".repeat(12));
    for (let index = 0; index < 6; index += 1) list.insert(index, index);
    text.delete(4000, 6);
    doc.getMap("fields").set("key", "value");
    for (let position = 3990; position > 3984; position -= 1) {
      text.delete(position, 1);
    }
    list.delete(1, 3);
    list.insertContainer(0, new LoroMap()).set("n", 1);
    text.insert(10, "𝄞😀");
    doc.commit({ timestamp: T0 });
  });
  const end = source.opCount();

  for (let counter = 4060; counter < end; counter += 1) {
    expectOneIdentity(source, [counter]).cold.free();
  }
  source.free();
});
