import { expect, test } from "bun:test";
import type { LoroDoc } from "loro-crdt";
import {
  createDocument,
  DOCUMENT_CHANGE_MERGE_INTERVAL_SECONDS,
  derivePeerId,
  encodeVersionVector,
  exportAllUpdates,
  exportFullHistoryIdentity,
  exportFullHistorySnapshot,
  exportUpdatesSince,
  importSnapshot,
  importUpdates,
  updateMatchesDocumentHistory,
} from "./index";

interface ChangeTime {
  counter: number;
  length: number;
  timestamp: number;
}

function changeTimes(doc: LoroDoc, peerId: `${number}`): ChangeTime[] {
  return (doc.getAllChanges().get(peerId) ?? []).map((change) => ({
    counter: change.counter,
    length: change.length,
    timestamp: change.timestamp,
  }));
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function append(doc: LoroDoc, value: string, timestamp?: number): void {
  const text = doc.getText("text");
  text.insert(text.length, value);
  doc.commit(timestamp === undefined ? undefined : { timestamp });
}

test("a created document stamps each change with its commit time", async () => {
  const peerId = await derivePeerId("stamp-author");
  const doc = await createDocument("stamp-author");
  const before = nowSeconds();
  append(doc, "hello");
  const after = nowSeconds();

  const [change] = changeTimes(doc, peerId);
  expect(change?.timestamp).toBeGreaterThanOrEqual(before);
  expect(change?.timestamp).toBeLessThanOrEqual(after);
});

test("an implicit commit on export is stamped too", async () => {
  const peerId = await derivePeerId("implicit-author");
  const doc = await createDocument("implicit-author");
  const before = nowSeconds();
  // The document store never calls commit(); exporting closes the transaction.
  doc.getText("text").insert(0, "hello");
  const reader = await createDocument("implicit-reader");
  importUpdates(reader, [exportAllUpdates(doc)]);

  expect(changeTimes(reader, peerId)[0]?.timestamp).toBeGreaterThanOrEqual(
    before,
  );
});

test("a document restored from history stamps the current time, not the newest imported one", async () => {
  const author = await createDocument("restore-author");
  append(author, "old", 1_000);

  const restoredPeerId = await derivePeerId("restore-reader");
  const restored = await createDocument("restore-reader");
  importSnapshot(restored, exportFullHistorySnapshot(author));
  const before = nowSeconds();
  append(restored, " new");

  // Without the setting, Loro reuses the largest known timestamp (1000).
  expect(
    changeTimes(restored, restoredPeerId)[0]?.timestamp,
  ).toBeGreaterThanOrEqual(before);
});

test("a fork keeps stamping", async () => {
  const doc = await createDocument("fork-source");
  const fork = doc.fork();
  fork.setPeerId("7");
  const before = nowSeconds();
  append(fork, "forked");

  expect(changeTimes(fork, "7")[0]?.timestamp).toBeGreaterThanOrEqual(before);
});

test("consecutive commits share a change only inside the merge interval", async () => {
  const peerId = await derivePeerId("merge-author");
  const doc = await createDocument("merge-author");
  const start = 1_800_000_000;
  append(doc, "a", start);
  append(doc, "b", start + DOCUMENT_CHANGE_MERGE_INTERVAL_SECONDS);
  append(doc, "c", start + DOCUMENT_CHANGE_MERGE_INTERVAL_SECONDS + 1);
  append(doc, "d", start + 600);

  expect(changeTimes(doc, peerId)).toEqual([
    { counter: 0, length: 2, timestamp: start },
    {
      counter: 2,
      length: 1,
      timestamp: start + DOCUMENT_CHANGE_MERGE_INTERVAL_SECONDS + 1,
    },
    { counter: 3, length: 1, timestamp: start + 600 },
  ]);
});

test("a change never carries a time before one the document already holds", async () => {
  const peerId = await derivePeerId("monotonic-author");
  const doc = await createDocument("monotonic-author");
  append(doc, "late", 2_000_000_000);
  append(doc, "early", 1_000);

  // A clock that runs ahead drags every later change forward with it.
  expect(
    changeTimes(doc, peerId).every(
      (change) => change.timestamp === 2_000_000_000,
    ),
  ).toBe(true);
});

test("timestamps travel in updates and full-history snapshots and stay provable", async () => {
  const peerId = await derivePeerId("travel-author");
  const author = await createDocument("travel-author");
  const start = 1_800_000_000;
  let version = encodeVersionVector(author);
  const deltas: Uint8Array[] = [];
  for (const [index, word] of ["one ", "two ", "three "].entries()) {
    append(author, word, start + index * 60);
    deltas.push(exportUpdatesSince(author, version));
    version = encodeVersionVector(author);
  }

  const viaUpdates = await createDocument("travel-updates");
  importUpdates(viaUpdates, deltas);
  const viaSnapshot = await createDocument("travel-snapshot");
  importSnapshot(viaSnapshot, exportFullHistorySnapshot(author));

  const expected = [start, start + 60, start + 120];
  for (const reader of [viaUpdates, viaSnapshot]) {
    expect(
      changeTimes(reader, peerId).map((change) => change.timestamp),
    ).toEqual(expected);
    expect(exportFullHistoryIdentity(reader)).toBe(
      exportFullHistoryIdentity(author),
    );
  }
  for (const delta of deltas) {
    expect(updateMatchesDocumentHistory(author, delta)).toBe(true);
  }
});

test("the same operations under different timestamps are a different history", async () => {
  const author = await createDocument("forge-author");
  append(author, "one ", 1_800_000_000);

  // Same peer, same counters, same content: only the recorded time differs.
  const forged = await createDocument("forge-author");
  append(forged, "one ", 1_700_000_000);

  expect(encodeVersionVector(forged)).toBe(encodeVersionVector(author));
  expect(updateMatchesDocumentHistory(author, exportAllUpdates(forged))).toBe(
    false,
  );
  expect(exportFullHistoryIdentity(forged)).not.toBe(
    exportFullHistoryIdentity(author),
  );
});
