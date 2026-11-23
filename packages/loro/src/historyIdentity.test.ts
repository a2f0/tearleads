import { expect, test } from "bun:test";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  createDocument,
  encodeVersionVector,
  exportFullHistoryIdentity,
  exportFullHistorySnapshot,
  exportUpdatesSince,
  getTextValue,
  importSnapshot,
  importUpdates,
  versionVectorsEqual,
} from "./document";
import { updateMatchesDocumentHistory } from "./updateIdentity";

test("full-history identity is stable after snapshot import", async () => {
  const source = await createDocument("history-identity-source");
  source.getText("text").update("first");
  source.commit();
  source.getText("text").update("first second");
  source.commit();
  const restored = await createDocument("history-identity-restored");
  importSnapshot(restored, exportFullHistorySnapshot(source));

  expect(exportFullHistoryIdentity(restored)).toBe(
    exportFullHistoryIdentity(source),
  );
});

test("snapshot identity matches replay of separately exported commits", async () => {
  const source = await createDocument("segmented-history-source");
  const restored = await createDocument("segmented-history-restored");
  const replayed = await createDocument("segmented-history-replayed");
  try {
    source.getText("text").update("survives key");
    source.commit();
    const first = exportUpdatesSince(source);
    const firstVersion = encodeVersionVector(source);
    source.getText("text").update("survives key rotation");
    source.commit();
    const second = exportUpdatesSince(source, firstVersion);

    importSnapshot(restored, exportFullHistorySnapshot(source));
    importUpdates(replayed, [first, second]);
    const version = encodeVersionVector(restored);
    expect(versionVectorsEqual(encodeVersionVector(replayed), version)).toBe(
      true,
    );
    expect(restored.getText("text").toString()).toBe("survives key rotation");
    expect(replayed.getText("text").toString()).toBe("survives key rotation");
    // Equal text and frontier are not sufficient for rotation provenance.
    expect(exportFullHistoryIdentity(replayed, version)).toBe(
      exportFullHistoryIdentity(restored),
    );
  } finally {
    source.free();
    restored.free();
    replayed.free();
  }
});

// A reader that held the seed before a checkpoint arrived and a rotation
// rebuild that imported the checkpoint first hold the same operations, split
// at different places. Rotation proved its rebuild against the reader's
// document and failed on every attempt.
test("full-history identity ignores how imports split the same operations", async () => {
  const author = await createDocument("segmentation-author");
  const live = await createDocument("segmentation-live");
  const rebuilt = await createDocument("segmentation-rebuilt");
  try {
    author.getText("text").update("seed\n");
    author.commit();
    const seed = exportUpdatesSince(author);
    const seedVersion = encodeVersionVector(author);
    author.getText("text").update("seed\nalice\n");
    author.commit();
    const checkpoint = exportFullHistorySnapshot(author);
    const checkpointVersion = encodeVersionVector(author);
    author.getText("text").update("seed\nalice\nchild\n");
    author.commit();
    const child = exportUpdatesSince(author, checkpointVersion);
    expect(seedVersion).not.toBe(checkpointVersion);

    importUpdates(live, [seed]);
    importSnapshot(live, checkpoint);
    importUpdates(live, [child]);
    importSnapshot(rebuilt, checkpoint);
    importUpdates(rebuilt, [seed, child]);
    const split = (document: typeof live) =>
      document
        .exportJsonUpdates(undefined, undefined, false)
        .changes.flatMap((change) => change.ops.map((op) => op.content));
    expect(split(live)).not.toEqual(split(rebuilt));
    expect(exportFullHistoryIdentity(rebuilt)).toBe(
      exportFullHistoryIdentity(live),
    );
    expect(exportFullHistoryIdentity(live)).toBe(
      exportFullHistoryIdentity(author),
    );
  } finally {
    author.free();
    live.free();
    rebuilt.free();
  }
});

test("full-history identity detects forged operations at the same frontier", async () => {
  const genuine = await createDocument("history-identity-fork");
  genuine.getText("text").update("genuine first");
  genuine.commit();
  genuine.getText("text").update("genuine second");
  genuine.commit();
  const forged = await createDocument("history-identity-fork");
  forged.getText("text").update("forged! first");
  forged.commit();
  forged.getText("text").update("forged! second");
  forged.commit();

  expect(encodeVersionVector(forged)).toBe(encodeVersionVector(genuine));
  expect(exportFullHistoryIdentity(forged)).not.toBe(
    exportFullHistoryIdentity(genuine),
  );
});

test("full-history identity distinguishes binary data from the same base64 string", async () => {
  const binary = await createDocument("history-identity-binary-string");
  const bytes = new TextEncoder().encode("same visible representation");
  binary.getMap("fields").set("value", bytes);
  binary.commit();
  const text = await createDocument("history-identity-binary-string");
  text.getMap("fields").set("value", bytesToBase64(bytes));
  text.commit();

  expect(encodeVersionVector(text)).toBe(encodeVersionVector(binary));
  expect(exportFullHistoryIdentity(text)).not.toBe(
    exportFullHistoryIdentity(binary),
  );
});

test("full-history identity can compare a retained prefix", async () => {
  const source = await createDocument("history-identity-prefix-source");
  source.getText("text").update("retained prefix");
  source.commit();
  const sourceVersion = encodeVersionVector(source);
  const ahead = await createDocument("history-identity-prefix-ahead");
  importSnapshot(ahead, exportFullHistorySnapshot(source));
  ahead.getText("text").update("retained prefix plus concurrent work");
  ahead.commit();

  expect(exportFullHistoryIdentity(ahead, sourceVersion)).toBe(
    exportFullHistoryIdentity(source),
  );
});

test("full-history identity is stable across opposite multi-peer import order", async () => {
  const alice = await createDocument("history-identity-concurrent-alice");
  alice.getText("text").update("alice");
  alice.commit();
  const bob = await createDocument("history-identity-concurrent-bob");
  bob.getText("text").update("bob");
  bob.commit();
  const aliceUpdate = exportUpdatesSince(alice);
  const bobUpdate = exportUpdatesSince(bob);
  const aliceFirst = await createDocument("history-identity-alice-first");
  const bobFirst = await createDocument("history-identity-bob-first");
  importUpdates(aliceFirst, [aliceUpdate, bobUpdate]);
  importUpdates(bobFirst, [bobUpdate, aliceUpdate]);

  expect(
    versionVectorsEqual(
      encodeVersionVector(aliceFirst),
      encodeVersionVector(bobFirst),
    ),
  ).toBe(true);
  expect(exportFullHistoryIdentity(aliceFirst)).toBe(
    exportFullHistoryIdentity(bobFirst),
  );
});

test("multi-peer prefix identity ignores later concurrent operations", async () => {
  const alice = await createDocument("history-prefix-concurrent-alice");
  alice.getText("text").update("alice");
  alice.commit();
  const bob = await createDocument("history-prefix-concurrent-bob");
  bob.getText("text").update("bob");
  bob.commit();
  const merged = await createDocument("history-prefix-merged");
  importUpdates(merged, [exportUpdatesSince(bob), exportUpdatesSince(alice)]);
  const retainedVersion = encodeVersionVector(merged);
  const retainedIdentity = exportFullHistoryIdentity(merged);
  merged.getText("text").update("later concurrent edit");
  merged.commit();

  expect(exportFullHistoryIdentity(merged, retainedVersion)).toBe(
    retainedIdentity,
  );
});

test("update identity matches only the document's exact operation range", async () => {
  const genuine = await createDocument("history-update-identity");
  genuine.getText("text").update("retained prefix");
  genuine.commit();
  const startVersion = encodeVersionVector(genuine);
  genuine.getText("text").update("genuine suffix");
  genuine.commit();
  const genuineUpdate = exportUpdatesSince(genuine, startVersion);

  const forged = await createDocument("history-update-identity");
  forged.getText("text").update("retained prefix");
  forged.commit();
  forged.getText("text").update("forged! suffix");
  forged.commit();
  const forgedUpdate = exportUpdatesSince(forged, startVersion);

  expect(updateMatchesDocumentHistory(genuine, genuineUpdate)).toBe(true);
  expect(updateMatchesDocumentHistory(genuine, forgedUpdate)).toBe(false);
});

// A reader that pulled the first half of a change on its own splits it where
// a snapshot carrying the whole change does not. The sync judge voided such a
// checkpoint, and with it every update built on the operations it carried.
test("update identity accepts a snapshot that completes a change the document holds part of", async () => {
  const author = await createDocument("partial-change-author");
  const reader = await createDocument("partial-change-reader");
  try {
    author.getText("text").update("seed\n");
    author.commit();
    const seed = exportUpdatesSince(author);
    author.getText("text").update("seed\nalice\n");
    author.commit();
    const checkpoint = exportFullHistorySnapshot(author);

    importUpdates(reader, [seed]);
    importSnapshot(reader, checkpoint);
    expect(updateMatchesDocumentHistory(reader, checkpoint)).toBe(true);

    const forged = await createDocument("partial-change-author");
    forged.getText("text").update("seed\nalicE\n");
    forged.commit();
    expect(
      updateMatchesDocumentHistory(reader, exportFullHistorySnapshot(forged)),
    ).toBe(false);
    forged.free();
  } finally {
    author.free();
    reader.free();
  }
});

test("update identity rejects malformed bytes", async () => {
  const document = await createDocument("malformed-history-update");
  document.getText("text").update("retained history");
  document.commit();

  expect(
    updateMatchesDocumentHistory(document, new Uint8Array([0xff, 0x00, 0xff])),
  ).toBe(false);
});

test("update identity retains dependencies outside its declared peer range", async () => {
  const remote = await createDocument("history-update-dependency-remote");
  remote.getText("text").update("remote base");
  remote.commit();
  const local = await createDocument("history-update-dependency-local");
  importSnapshot(local, exportFullHistorySnapshot(remote));
  const baseVersion = encodeVersionVector(local);
  local.getMap("fields").set("value", "genuine");
  local.commit();
  const forged = await createDocument("history-update-dependency-local");
  importSnapshot(forged, exportFullHistorySnapshot(remote));
  forged.getMap("fields").set("value", "forged!");
  forged.commit();

  expect(
    updateMatchesDocumentHistory(local, exportUpdatesSince(local, baseVersion)),
  ).toBe(true);
  expect(encodeVersionVector(forged)).toBe(encodeVersionVector(local));
  expect(
    updateMatchesDocumentHistory(
      local,
      exportUpdatesSince(forged, baseVersion),
    ),
  ).toBe(false);
});

test("history artifact identity accepts snapshots without trusting their frontier", async () => {
  const genuine = await createDocument("history-snapshot-artifact-identity");
  genuine.getText("text").update("genuine snapshot history");
  genuine.commit();
  const genuineSnapshot = exportFullHistorySnapshot(genuine);
  const forged = await createDocument("history-snapshot-artifact-identity");
  forged.getText("text").update("forged! snapshot history");
  forged.commit();
  const forgedSnapshot = exportFullHistorySnapshot(forged);

  expect(encodeVersionVector(forged)).toBe(encodeVersionVector(genuine));
  expect(updateMatchesDocumentHistory(genuine, genuineSnapshot)).toBe(true);
  expect(updateMatchesDocumentHistory(genuine, forgedSnapshot)).toBe(false);
});

// The rotation baseline of a document whose every update was void is an
// empty snapshot. It holds exactly the operations of its empty range, none,
// so every holder's history matches it, and recovery and compaction can
// prove it like any other row.
test("update identity accepts a blob that declares and carries no operation", async () => {
  const empty = await createDocument("empty-range-author");
  const reader = await createDocument("empty-range-reader");
  try {
    const emptySnapshot = exportFullHistorySnapshot(empty);
    expect(updateMatchesDocumentHistory(empty, emptySnapshot)).toBe(true);
    reader.getText("text").update("held history");
    reader.commit();
    expect(updateMatchesDocumentHistory(reader, emptySnapshot)).toBe(true);
    importSnapshot(reader, emptySnapshot);
    expect(getTextValue(reader)).toBe("held history");
  } finally {
    empty.free();
    reader.free();
  }
});
