// A document's history identity must not depend on how Loro grouped its
// inserts: a writer holds what it wrote across two uploads as one operation,
// a reader of those uploads holds two, and an export regroups either.
import { expect, test } from "bun:test";
import { type JsonSchema, LoroDoc } from "loro-crdt";
import {
  createDocument,
  encodeVersionVector,
  exportFullHistoryIdentity,
  exportFullHistorySnapshot,
  exportUpdatesSince,
  importSnapshot,
  importUpdates,
  versionVectorsEqual,
} from "./document";
import { serializeCanonicalHistory } from "./historyCanonicalization";
import { updateMatchesDocumentHistory } from "./updateIdentity";

type Document = Awaited<ReturnType<typeof createDocument>>;

function historyOf(doc: LoroDoc): JsonSchema {
  return doc.exportJsonUpdates(undefined, undefined, false);
}

/**
 * `history` with the insert at `operationIndex` of its first change cut in
 * two after `units` of its content, as a reader of two uploads holds it.
 */
function withInsertCut(
  history: JsonSchema,
  operationIndex: number,
  units: number,
): JsonSchema {
  const [change, ...rest] = history.changes;
  const operation = change?.ops[operationIndex];
  if (!change || !operation) throw new Error("No such operation");
  const { content } = operation;
  if (content.type !== "insert" || !("pos" in content)) {
    throw new Error("Not a sequence insert");
  }
  const cut = <Content>(head: Content, tail: Content) => [
    { ...operation, content: { ...content, ...head } },
    {
      ...operation,
      content: { ...content, pos: content.pos + units, ...tail },
      counter: operation.counter + units,
    },
  ];
  const halves =
    "text" in content
      ? cut(
          { text: [...content.text].slice(0, units).join("") },
          { text: [...content.text].slice(units).join("") },
        )
      : "value" in content && Array.isArray(content.value)
        ? cut(
            { value: content.value.slice(0, units) },
            { value: content.value.slice(units) },
          )
        : null;
  if (!halves) throw new Error("Not a text or list insert");
  const ops = [
    ...change.ops.slice(0, operationIndex),
    ...halves,
    ...change.ops.slice(operationIndex + 1),
  ];
  return { ...history, changes: [{ ...change, ops }, ...rest] } as JsonSchema;
}

async function documentWith(seed: string, write: (doc: Document) => void) {
  const doc = await createDocument(seed);
  write(doc);
  doc.commit();
  return doc;
}

test.each([
  ["plain text", "a".repeat(5) + "b".repeat(30), 5],
  ["text past the basic plane", "𝄞😀漢é".repeat(10), 7],
])(
  "%s cut in two serializes as the one insert it is",
  async (_name, text, units) => {
    const doc = await documentWith("grouping-text", (written) =>
      written.getText("text").insert(0, text),
    );
    const whole = historyOf(doc);
    const cut = withInsertCut(whole, 0, units);

    expect(cut.changes[0]?.ops).toHaveLength(2);
    expect(serializeCanonicalHistory(cut)).toBe(
      serializeCanonicalHistory(whole),
    );
    doc.free();
  },
);

test("a list insert cut in two serializes as the one insert it is", async () => {
  const doc = await documentWith("grouping-list", (written) => {
    const list = written.getList("list");
    for (let index = 0; index < 40; index += 1) list.insert(index, index);
  });
  const whole = historyOf(doc);

  expect(serializeCanonicalHistory(withInsertCut(whole, 0, 2))).toBe(
    serializeCanonicalHistory(whole),
  );
  doc.free();
});

test("inserts that do not continue each other stay apart", async () => {
  const apart = await documentWith("grouping-apart", (written) => {
    written.getText("text").insert(0, "aaaaa");
    written.getText("text").insert(0, "bbbbb");
    written.getText("other").insert(0, "ccccc");
    written.getText("other").insert(5, "ddddd");
  });
  const together = await documentWith("grouping-apart", (written) => {
    written.getText("text").insert(0, "bbbbbaaaaa");
    written.getText("other").insert(0, "cccccddddd");
  });

  expect(apart.getText("text").toString()).toBe(
    together.getText("text").toString(),
  );
  expect(serializeCanonicalHistory(historyOf(apart))).not.toBe(
    serializeCanonicalHistory(historyOf(together)),
  );
  // The second pair continues, but across two containers nothing joins.
  const serialized = serializeCanonicalHistory(historyOf(apart));
  expect(serialized).toContain("aaaaa");
  expect(serialized).toContain("cccccddddd");
  expect(serialized).not.toContain("bbbbbaaaaa");
  apart.free();
  together.free();
});

test("a holder of a cut insert has the identity of the holder of the whole one", async () => {
  const writer = await documentWith("grouping-identity", (written) =>
    written.getText("text").insert(0, "a".repeat(5) + "b".repeat(30)),
  );
  const whole = historyOf(writer);
  const holder = new LoroDoc();
  holder.importJsonUpdates(withInsertCut(whole, 0, 5));

  expect(historyOf(holder).changes[0]?.ops).toHaveLength(2);
  expect(exportFullHistoryIdentity(holder)).toBe(
    exportFullHistoryIdentity(writer),
  );
  writer.free();
  holder.free();
});

/** A small deterministic generator, so a failing round can be replayed. */
function generator(seed: number) {
  let state = seed;
  return (bound: number) => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return (state >>> 8) % bound;
  };
}

const ALPHABET = ["a", "b", "é", "𝄞", "\n", "漢", "😀"];

/** One writer's edits to its text, list and map, at code point boundaries. */
function edit(doc: Document, next: (bound: number) => number): void {
  const text = doc.getText("text");
  const points = [...text.toString()];
  const utf16 = (index: number) => points.slice(0, index).join("").length;
  const kind = next(10);
  if (kind < 5) {
    const at = next(3) === 0 ? next(points.length + 1) : points.length;
    const written = Array.from(
      { length: 1 + next(40) },
      () => ALPHABET[next(ALPHABET.length)],
    ).join("");
    text.insert(utf16(at), written);
  } else if (kind < 7 && points.length > 2) {
    const at = next(points.length - 1);
    const count = 1 + next(Math.min(6, points.length - at));
    text.delete(utf16(at), points.slice(at, at + count).join("").length);
  } else if (kind < 9) {
    const list = doc.getList("list");
    for (let count = 1 + next(30); count > 0; count -= 1) {
      list.insert(list.length, next(100));
    }
  } else {
    doc.getMap("map").set(`key${next(3)}`, `value${next(50)}`);
  }
}

test.each([1, 7, 13])(
  "every holder of one history has one identity, however its inserts reached it (seed %d)",
  async (seed) => {
    const next = generator(seed);
    for (let round = 0; round < 8; round += 1) {
      const writers = [
        await createDocument(`grouping-${seed}-${round}-a`),
        await createDocument(`grouping-${seed}-${round}-b`),
      ];
      const reader = new LoroDoc();
      const updates: Uint8Array[] = [];
      for (let step = 0; step < 25; step += 1) {
        const writer = writers[next(2)];
        if (!writer) throw new Error("No writer");
        if (next(4) === 0) importUpdates(writer, updates);
        const held = encodeVersionVector(writer);
        for (let edits = 1 + next(3); edits > 0; edits -= 1) {
          edit(writer, next);
          if (next(3) === 0) writer.commit();
        }
        writer.commit();
        const update = exportUpdatesSince(writer, held);
        updates.push(update);
        importUpdates(reader, [update]);
        // A checkpoint regroups the writer's own operations.
        if (next(5) === 0) exportFullHistorySnapshot(writer);
      }
      for (const writer of writers) importUpdates(writer, updates);
      const batched = new LoroDoc();
      importUpdates(batched, updates);
      const restored = new LoroDoc();
      const [first] = writers;
      if (!first) throw new Error("No writer");
      importSnapshot(restored, exportFullHistorySnapshot(first));
      const holders = [...writers, reader, batched, restored];

      const identities = holders.map((holder) =>
        exportFullHistoryIdentity(holder),
      );
      for (const holder of holders) {
        expect(
          versionVectorsEqual(
            encodeVersionVector(holder),
            encodeVersionVector(first),
          ),
        ).toBe(true);
      }
      expect(new Set(identities).size).toBe(1);
      for (const holder of holders) {
        for (const update of updates) {
          expect(updateMatchesDocumentHistory(holder, update)).toBe(true);
        }
        holder.free();
      }
    }
  },
);
