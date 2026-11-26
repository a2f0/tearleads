// The runs of the canonical form, on histories written by hand: which units
// join, which stay apart, and what stays whole. Some of these no document
// writes; a forged history can hold them, and the form must still depend on
// its units alone.
import { expect, test } from "bun:test";
import { type JsonOp, type JsonSchema, LoroDoc, LoroMap } from "loro-crdt";
import { createDocument, importUpdates } from "./document";
import { serializeCanonicalHistory } from "./historyCanonicalization";

const TEXT = "cid:root-text:Text";

/** One change by peer 1 holding `ops` from counter 0, deleting peer 2's text. */
function changeOf(
  contents: Array<{ len: number; pos: number; start: number }>,
) {
  let counter = 0;
  const ops: JsonOp[] = contents.map(({ len, pos, start }) => {
    const op: JsonOp = {
      container: TEXT,
      content: { len, pos, start_id: `${start}@2`, type: "delete" },
      counter,
    };
    counter += Math.abs(len);
    return op;
  });
  return {
    changes: [
      { deps: ["99@2"], id: "0@1", lamport: 100, msg: null, ops, timestamp: 1 },
    ],
    peers: null,
    schema_version: 1,
    start_version: {},
  } as unknown as JsonSchema;
}

function canonicalOf(
  ...contents: Array<{ len: number; pos: number; start: number }>
): string {
  return serializeCanonicalHistory(changeOf(contents));
}

test("a single delete has no direction", () => {
  expect(canonicalOf({ len: -1, pos: 5, start: 40 })).toBe(
    canonicalOf({ len: 1, pos: 5, start: 40 }),
  );
});

test("single deletes join into the run their second unit starts", () => {
  // The delete key: one position, ids going up.
  expect(
    canonicalOf(
      { len: 1, pos: 5, start: 40 },
      { len: -1, pos: 5, start: 41 },
      { len: 1, pos: 5, start: 42 },
    ),
  ).toBe(canonicalOf({ len: 3, pos: 5, start: 40 }));
  // Backspace: positions and ids going down.
  expect(
    canonicalOf(
      { len: 1, pos: 5, start: 42 },
      { len: 1, pos: 4, start: 41 },
      { len: -1, pos: 3, start: 40 },
    ),
  ).toBe(canonicalOf({ len: -3, pos: 5, start: 40 }));
});

test("runs cut anywhere join, and the pieces of one run agree on its direction", () => {
  expect(
    canonicalOf(
      { len: 2, pos: 5, start: 40 },
      { len: 1, pos: 5, start: 42 },
      { len: 3, pos: 5, start: 43 },
    ),
  ).toBe(canonicalOf({ len: 6, pos: 5, start: 40 }));
  expect(
    canonicalOf(
      { len: -2, pos: 9, start: 44 },
      { len: 1, pos: 7, start: 43 },
      { len: -3, pos: 6, start: 40 },
    ),
  ).toBe(canonicalOf({ len: -6, pos: 9, start: 40 }));
});

test("a forward run and a backward run of the same ids differ", () => {
  expect(canonicalOf({ len: 3, pos: 5, start: 40 })).not.toBe(
    canonicalOf({ len: -3, pos: 7, start: 40 }),
  );
  // Two units are already a direction.
  expect(canonicalOf({ len: 2, pos: 5, start: 40 })).not.toBe(
    canonicalOf({ len: -2, pos: 6, start: 40 }),
  );
});

test("a run takes only the units that continue it in its direction", () => {
  // Forward (5, 40), (5, 41), then backward (5, 42), (4, 41): the third unit
  // continues the forward run and the fourth does not. No document writes
  // this, since it deletes id 41 twice, but a forged history can, and it
  // must read the same however its units are grouped.
  const units = [
    { len: 1, pos: 5, start: 40 },
    { len: 1, pos: 5, start: 41 },
    { len: 1, pos: 5, start: 42 },
    { len: 1, pos: 4, start: 41 },
  ];
  const canonical = canonicalOf(...units);

  expect(
    canonicalOf({ len: 2, pos: 5, start: 40 }, { len: -2, pos: 5, start: 41 }),
  ).toBe(canonical);
  expect(
    canonicalOf({ len: 3, pos: 5, start: 40 }, { len: 1, pos: 4, start: 41 }),
  ).toBe(canonical);
  // The mirror image: backward (5, 42), (4, 41), then forward (3, 40), (3, 41).
  expect(
    canonicalOf({ len: -2, pos: 5, start: 41 }, { len: 2, pos: 3, start: 40 }),
  ).toBe(
    canonicalOf({ len: -3, pos: 5, start: 40 }, { len: 1, pos: 3, start: 41 }),
  );
  // (5, 40), (5, 41), (4, 40): the second unit sets the run forward, so the
  // third does not join it, whichever operation carried the second.
  expect(
    canonicalOf({ len: 1, pos: 5, start: 40 }, { len: -2, pos: 5, start: 40 }),
  ).toBe(
    canonicalOf({ len: 2, pos: 5, start: 40 }, { len: 1, pos: 4, start: 40 }),
  );
});

test("deletes of another peer's ids, or out of step, stay apart", () => {
  const joined = canonicalOf({ len: 2, pos: 5, start: 40 });

  // Same position, but the id skips one.
  expect(
    canonicalOf({ len: 1, pos: 5, start: 40 }, { len: 1, pos: 5, start: 42 }),
  ).not.toBe(joined);
  // Next id, at another position.
  expect(
    canonicalOf({ len: 1, pos: 5, start: 40 }, { len: 1, pos: 6, start: 41 }),
  ).not.toBe(joined);
  const history = changeOf([
    { len: 1, pos: 5, start: 40 },
    { len: 1, pos: 5, start: 41 },
  ]);
  const [change] = history.changes;
  const second = change?.ops[1];
  if (!second || !("start_id" in second.content)) throw new Error("No op");
  second.content.start_id = "41@3";
  expect(serializeCanonicalHistory(history)).not.toBe(joined);
});

/** One change by peer 1 holding `ops`. */
function historyWith(ops: JsonOp[]): JsonSchema {
  return {
    changes: [
      { deps: [], id: "0@1", lamport: 0, msg: null, ops, timestamp: 1 },
    ],
    peers: null,
    schema_version: 1,
    start_version: {},
  } as unknown as JsonSchema;
}

function insertOf(counter: number, pos: number, text: string): JsonOp {
  return { container: TEXT, content: { pos, text, type: "insert" }, counter };
}

test("inserts join only at the counter and position after the run", () => {
  const joined = serializeCanonicalHistory(
    historyWith([insertOf(0, 3, "aaaaab")]),
  );

  expect(
    serializeCanonicalHistory(
      historyWith([insertOf(0, 3, "aaaaa"), insertOf(5, 8, "b")]),
    ),
  ).toBe(joined);
  // The position continues, but two counters are missing between them.
  expect(
    serializeCanonicalHistory(
      historyWith([insertOf(0, 3, "aaaaa"), insertOf(7, 8, "b")]),
    ),
  ).not.toBe(joined);
  // The counter continues, at another position.
  expect(
    serializeCanonicalHistory(
      historyWith([insertOf(0, 3, "aaaaa"), insertOf(5, 9, "b")]),
    ),
  ).not.toBe(joined);
});

test("text past the basic plane counts one unit for each code point", () => {
  // Three code points, six UTF-16 units: the next insert is at counter 3.
  expect(
    serializeCanonicalHistory(
      historyWith([insertOf(0, 0, "𝄞😀𠜎"), insertOf(3, 3, "b")]),
    ),
  ).toBe(serializeCanonicalHistory(historyWith([insertOf(0, 0, "𝄞😀𠜎b")])));
});

test("an operation with a field this package does not know stays whole", () => {
  const known = insertOf(5, 8, "b");
  const unknown = {
    ...known,
    content: { ...known.content, attributes: { bold: true } },
  } as unknown as JsonOp;
  const whole = serializeCanonicalHistory(
    historyWith([insertOf(0, 3, "aaaaa"), unknown]),
  );

  // Joined, the field would be dropped and the two histories would be one.
  expect(whole).toContain("attributes");
  expect(whole).not.toBe(
    serializeCanonicalHistory(historyWith([insertOf(0, 3, "aaaaa"), known])),
  );
});

/** A document with an operation of every kind, each followed by another. */
async function everyKind() {
  const doc = await createDocument("runs-indivisible");
  doc.configTextStyle({ bold: { expand: "after" } });
  const text = doc.getText("text");
  const map = doc.getMap("fields");
  const movable = doc.getMovableList("movable");
  const tree = doc.getTree("tree");
  text.insert(0, "abcdef");
  text.mark({ end: 4, start: 1 }, "bold", true);
  map.set("key", { large: "v".repeat(5000) });
  map.delete("key");
  map.setContainer("child", new LoroMap()).set("n", 1);
  movable.insert(0, "a");
  movable.insert(1, "b");
  movable.set(0, "c");
  movable.move(0, 1);
  const node = tree.createNode();
  const child = node.createNode();
  child.move();
  tree.delete(child.id);
  doc.getCounter("count").increment(3);
  doc.getList("items").insertContainer(0, new LoroMap());
  map.set("last", true);
  doc.commit();
  return doc;
}

test("every kind that stays whole takes one counter", async () => {
  const doc = await everyKind();
  const ops = doc
    .exportJsonUpdates(undefined, undefined, false)
    .changes.flatMap((change) => change.ops);
  const lengths = new Map<string, Set<number>>();
  for (const [index, op] of ops.entries()) {
    const next = ops[index + 1];
    if (!next) continue;
    const kind = `${op.container.split(":").pop()} ${op.content.type}`;
    lengths.set(
      kind,
      (lengths.get(kind) ?? new Set()).add(next.counter - op.counter),
    );
  }
  const whole = [...lengths.entries()]
    .filter(([kind]) => !/^(Text|List|MovableList) (insert|delete)$/.test(kind))
    .map(([kind, counted]) => ({ counted: [...counted], kind }))
    .sort((left, right) => (left.kind < right.kind ? -1 : 1));

  expect(whole).toEqual(
    [
      "Counter counter",
      "Map delete",
      "Map insert",
      "MovableList move",
      "MovableList set",
      "Text mark",
      "Text mark_end",
      "Tree create",
      "Tree delete",
      "Tree move",
    ].map((kind) => ({ counted: [1], kind })),
  );
  doc.free();
});

test("a range has one canonical form whatever else its holder holds", async () => {
  const author = await createDocument("runs-range-author");
  const other = await createDocument("runs-range-other");
  author.getText("text").insert(0, "aaaaaaaaaa");
  author.commit({ timestamp: 100 });
  other.getMap("fields").set("key", "value");
  other.commit({ timestamp: 100 });
  author.getText("text").insert(10, "bbbbbbbbbb");
  author.commit({ timestamp: 200 });
  const rangeOf = (holder: LoroDoc) => {
    const start = holder.oplogVersion();
    start.setEnd({ counter: 10, peer: author.peerIdStr });
    return holder.exportJsonUpdates(start, holder.oplogVersion(), false);
  };
  const holder = new LoroDoc();
  importUpdates(holder, [author.export({ mode: "update" })]);
  const alone = rangeOf(holder);
  // The same range once the holder has a second, unrelated peer: Loro
  // reports the range's start as that holder sees it.
  importUpdates(holder, [other.export({ mode: "update" })]);
  const among = rangeOf(holder);

  expect(among.changes).toEqual(alone.changes);
  expect(among.start_version).not.toEqual(alone.start_version);
  expect(serializeCanonicalHistory(among)).toBe(
    serializeCanonicalHistory(alone),
  );
  author.free();
  other.free();
  holder.free();
});

test("a change's dependencies are a set", () => {
  const history = (deps: string[]) => {
    const forged = historyWith([insertOf(0, 3, "a")]);
    const [change] = forged.changes;
    if (!change) throw new Error("No change");
    return { ...forged, changes: [{ ...change, deps }] } as JsonSchema;
  };
  const canonical = serializeCanonicalHistory(history(["4@2", "7@3"]));

  expect(serializeCanonicalHistory(history(["7@3", "4@2"]))).toBe(canonical);
  expect(serializeCanonicalHistory(history(["7@3"]))).not.toBe(canonical);
  expect(serializeCanonicalHistory(history(["4@2", "8@3"]))).not.toBe(
    canonical,
  );
});
