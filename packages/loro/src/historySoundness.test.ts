// Soundness: two histories that differ in anything that matters never share
// an identity, and an update of one never matches the other. Joining units
// into runs and changes must not hide what an operation wrote, where, in
// which container, under which id, after which dependencies, at which
// Lamport and commit time, or with which message.
import { expect, test } from "bun:test";
import { type JsonSchema, LoroDoc } from "loro-crdt";
import {
  createDocument,
  encodeVersionVector,
  exportFullHistoryIdentity,
  exportFullHistorySnapshot,
  exportUpdatesSince,
  importUpdates,
  versionVectorsEqual,
} from "./document";
import { serializeCanonicalHistory } from "./historyCanonicalization";
import { generateHeldHistory, generator } from "./historyHolders.testFixtures";
import { forgeUnits, HISTORY_MUTATIONS } from "./historyMutations.testFixtures";
import { explodeHistory, regroupHistory } from "./historyUnits.testFixtures";
import { updateMatchesDocumentHistory } from "./updateIdentity";

type Document = Awaited<ReturnType<typeof createDocument>>;

const T0 = 1_700_000_000;

function historyOf(doc: LoroDoc): JsonSchema {
  return doc.exportJsonUpdates(undefined, undefined, false);
}

/** A base every writer starts from: ten characters by another peer. */
async function baseUpdate(): Promise<Uint8Array> {
  const base = await createDocument("soundness-base");
  base.getText("text").insert(0, "0123456789");
  base.commit({ timestamp: T0 - 60 });
  const update = exportUpdatesSince(base);
  base.free();
  return update;
}

/** Two documents of one writer that each wrote their own history on the base. */
async function writers(
  genuine: (doc: Document) => void,
  forged: (doc: Document) => void,
): Promise<{ base: string; forged: Document; genuine: Document }> {
  const update = await baseUpdate();
  const docs: Document[] = [];
  let base = "";
  for (const write of [genuine, forged]) {
    const doc = await createDocument("soundness-writer");
    importUpdates(doc, [update]);
    base = encodeVersionVector(doc);
    write(doc);
    doc.commit({ timestamp: T0 });
    docs.push(doc);
  }
  const [first, second] = docs;
  if (!first || !second) throw new Error("No writers");
  return { base, forged: second, genuine: first };
}

/**
 * `forged` reaches `genuine`'s version with another history: the identities
 * differ, no blob of the forgery matches the genuine document, and the
 * genuine document's own blobs still do.
 */
function expectForgery(genuine: LoroDoc, forged: LoroDoc, base: string): void {
  expect(
    versionVectorsEqual(
      encodeVersionVector(forged),
      encodeVersionVector(genuine),
    ),
  ).toBe(true);
  expect(exportFullHistoryIdentity(forged)).not.toBe(
    exportFullHistoryIdentity(genuine),
  );
  for (const [doc, matches] of [
    [forged, false],
    [genuine, true],
  ] as const) {
    for (const update of [
      exportUpdatesSince(doc, base),
      exportUpdatesSince(doc),
      exportFullHistorySnapshot(doc),
    ]) {
      expect(updateMatchesDocumentHistory(genuine, update)).toBe(matches);
    }
  }
}

const FORGERIES: Record<
  string,
  { forged: (doc: Document) => void; genuine: (doc: Document) => void }
> = {
  "a delete of a different id range of the same length": {
    forged: (doc) => doc.getText("text").delete(3, 3),
    genuine: (doc) => doc.getText("text").delete(2, 3),
  },
  "a delete of the same ids, backward instead of forward": {
    forged: (doc) => {
      for (const position of [4, 3, 2]) doc.getText("text").delete(position, 1);
    },
    genuine: (doc) => doc.getText("text").delete(2, 3),
  },
  "an insert split so its halves are not contiguous": {
    forged: (doc) => {
      doc.getText("text").insert(3, "aa");
      doc.getText("text").insert(3, "aa");
    },
    genuine: (doc) => doc.getText("text").insert(3, "aaaa"),
  },
  "the same content in a different container": {
    forged: (doc) => doc.getText("other").insert(0, "written"),
    genuine: (doc) => doc.getText("text").insert(0, "written"),
  },
  "the same ids with different text": {
    forged: (doc) => doc.getText("text").insert(3, "wrotten"),
    genuine: (doc) => doc.getText("text").insert(3, "written"),
  },
  "the same list values at a different position": {
    forged: (doc) => {
      for (const value of [1, 2, 3]) doc.getList("items").insert(0, value);
    },
    genuine: (doc) => {
      for (const value of [3, 2, 1]) doc.getList("items").push(value);
    },
  },
  "the same text at a different position": {
    forged: (doc) => doc.getText("text").insert(4, "written"),
    genuine: (doc) => doc.getText("text").insert(3, "written"),
  },
};

test.each(Object.entries(FORGERIES))(
  "%s is a different history",
  async (_name, { forged: forge, genuine: write }) => {
    const { base, forged, genuine } = await writers(write, forge);

    expectForgery(genuine, forged, base);
    genuine.free();
    forged.free();
  },
);

test("the forgeries that leave the same document are still told apart", async () => {
  for (const name of [
    "a delete of the same ids, backward instead of forward",
    "an insert split so its halves are not contiguous",
    "the same list values at a different position",
  ]) {
    const forgery = FORGERIES[name];
    if (!forgery) throw new Error("No forgery");
    const { forged, genuine } = await writers(forgery.genuine, forgery.forged);

    expect(forged.toJSON()).toEqual(genuine.toJSON());
    expect(exportFullHistoryIdentity(forged)).not.toBe(
      exportFullHistoryIdentity(genuine),
    );
    genuine.free();
    forged.free();
  }
});

/** A writer's two commits that continue each other: one canonical change. */
async function twoCommits(second: { message?: string; timestamp: number }) {
  const doc = await createDocument("soundness-continued");
  importUpdates(doc, [await baseUpdate()]);
  const base = encodeVersionVector(doc);
  doc.getText("text").insert(10, "aaaaa");
  doc.commit({ timestamp: T0 });
  doc.getText("text").insert(15, "bbbbb");
  doc.commit(second);
  return { base, doc };
}

test.each([
  ["a later commit time", { timestamp: T0 + 5 }],
  ["a message", { message: "second", timestamp: T0 }],
])(
  "a commit with %s is not joined to the one before it",
  async (_name, second) => {
    const { base, doc: genuine } = await twoCommits({ timestamp: T0 });
    const { doc: forged } = await twoCommits(second);

    expect(historyOf(forged).changes.length).toBeGreaterThan(
      historyOf(genuine).changes.length,
    );
    expectForgery(genuine, forged, base);
    genuine.free();
    forged.free();
  },
);

test("a change that depends on more than the counter before it is not joined to it", async () => {
  const other = await createDocument("soundness-other");
  other.getMap("fields").set("key", "value");
  other.commit({ timestamp: T0 - 30 });
  const seen = exportUpdatesSince(other);
  const write = async (importBetween: boolean) => {
    const doc = await createDocument("soundness-dependencies");
    doc.getText("text").insert(0, "aaaaa");
    doc.commit({ timestamp: T0 });
    if (importBetween) importUpdates(doc, [seen]);
    doc.getText("text").insert(5, "bbbbb");
    doc.commit({ timestamp: T0 });
    if (!importBetween) importUpdates(doc, [seen]);
    return doc;
  };
  const genuine = await write(true);
  const forged = await write(false);
  const changes = (doc: LoroDoc) =>
    historyOf(doc).changes.filter((change) =>
      change.id.endsWith(`@${doc.peerIdStr}`),
    );

  // Same operations, Lamport times and commit times: only the second
  // commit's dependencies differ.
  expect(changes(genuine).map((change) => change.lamport)).toEqual([0, 5]);
  expect(changes(genuine)[1]?.deps).toHaveLength(2);
  expect(changes(forged)).toHaveLength(1);
  expect(forged.toJSON()).toEqual(genuine.toJSON());
  expectForgery(genuine, forged, "");
  other.free();
  genuine.free();
  forged.free();
});

test("a change with another Lamport time is a different history", async () => {
  const { doc: genuine } = await twoCommits({ timestamp: T0 });
  const history = historyOf(genuine);
  const forged = historyOf(genuine);
  const change = forged.changes.find((held) =>
    held.id.endsWith(`@${genuine.peerIdStr}`),
  );
  if (!change) throw new Error("No change");
  change.lamport += 7;

  expect(serializeCanonicalHistory(forged)).not.toBe(
    serializeCanonicalHistory(history),
  );
  // No document holds that forgery: Loro derives a change's Lamport time
  // from its dependencies and ignores the one an import states.
  const imported = new LoroDoc();
  imported.importJsonUpdates(forged);
  expect(exportFullHistoryIdentity(imported)).toBe(
    exportFullHistoryIdentity(genuine),
  );
  genuine.free();
  imported.free();
});

test("a unit written by another peer is a different history", async () => {
  const write = async (text: string) => {
    const doc = await createDocument("soundness-peer-one");
    doc.getText("text").insert(0, text);
    doc.commit({ timestamp: T0 });
    const second = await createDocument("soundness-peer-two");
    importUpdates(second, [exportUpdatesSince(doc)]);
    second.getText("text").insert(text.length, "abcd".slice(text.length));
    second.commit({ timestamp: T0 });
    importUpdates(doc, [exportUpdatesSince(second)]);
    second.free();
    return doc;
  };
  const genuine = await write("abc");
  const forged = await write("ab");

  expect(forged.toJSON()).toEqual(genuine.toJSON());
  expect(exportFullHistoryIdentity(forged)).not.toBe(
    exportFullHistoryIdentity(genuine),
  );
  expect(
    updateMatchesDocumentHistory(genuine, exportFullHistorySnapshot(forged)),
  ).toBe(false);
  genuine.free();
  forged.free();
});

/** Forges `history` every way, `rounds` times each; names what applied. */
function expectForgeriesDiffer(
  history: JsonSchema,
  next: (bound: number) => number,
  rounds: number,
): string[] {
  const canonical = serializeCanonicalHistory(history);
  const units = explodeHistory(history);
  const applied: string[] = [];
  for (const [name, mutation] of Object.entries(HISTORY_MUTATIONS)) {
    for (let round = 0; round < rounds; round += 1) {
      const forged = forgeUnits(units, mutation, next);
      if (forged === null) continue;
      applied.push(name);
      const identity = serializeCanonicalHistory(forged);
      expect([name, identity === canonical]).toEqual([name, false]);
      // However the forgery is grouped, it is the same forgery.
      expect([
        name,
        serializeCanonicalHistory(regroupHistory(forged, next)) === identity,
      ]).toEqual([name, true]);
    }
  }
  return applied;
}

test("every single forgery of a generated history changes its identity", async () => {
  const applied = new Set<string>();
  for (const seed of [31, 32, 33, 34]) {
    const held = await generateHeldHistory(seed, {
      kinds: "all",
      rounds: 12,
      sizes: [1, 5, 17, 60, 300],
      writers: 2,
    });
    const next = generator(seed);
    const holders = [...held.holders.values()];
    // Two holders' groupings of the history.
    for (const holder of [holders[0], holders[holders.length - 1]]) {
      if (!holder) throw new Error("No holder");
      for (const name of expectForgeriesDiffer(historyOf(holder), next, 3)) {
        applied.add(name);
      }
    }
    held.free();
  }
  expect([...applied].sort()).toEqual(Object.keys(HISTORY_MUTATIONS).sort());
});
