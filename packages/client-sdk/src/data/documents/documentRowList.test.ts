import { expect, test } from "bun:test";
import {
  createDocument,
  encodeVersionVector,
  exportFullHistorySnapshot,
  exportUpdatesSince,
  importSnapshot,
  importUpdates,
} from "@tearleads/loro";
import {
  addDocumentRow,
  type DocumentRowAttribution,
  listDocumentRows,
  removeDocumentRow,
  sameDocumentRows,
  setDocumentRowFields,
} from "./documentRowList";

const AUTHOR: DocumentRowAttribution = {
  at: "2026-07-16T08:30:00.000Z",
  userId: "user-alice",
};

test("rows round-trip through a first-class Loro list of maps", async () => {
  const doc = await createDocument("rows-basic");

  addDocumentRow(doc, "row-1", { systolic: "120", diastolic: "80" }, AUTHOR);
  addDocumentRow(doc, "row-2", { systolic: "118", diastolic: "76" }, AUTHOR);

  expect(listDocumentRows(doc)).toEqual([
    {
      id: "row-1",
      fields: { systolic: "120", diastolic: "80" },
      fieldEditors: { systolic: doc.peerIdStr, diastolic: doc.peerIdStr },
      createdBy: "user-alice",
      createdAt: "2026-07-16T08:30:00.000Z",
      createdByPeer: doc.peerIdStr,
      updatedBy: "user-alice",
      updatedAt: "2026-07-16T08:30:00.000Z",
      updatedByPeer: doc.peerIdStr,
    },
    {
      id: "row-2",
      fields: { systolic: "118", diastolic: "76" },
      fieldEditors: { systolic: doc.peerIdStr, diastolic: doc.peerIdStr },
      createdBy: "user-alice",
      createdAt: "2026-07-16T08:30:00.000Z",
      createdByPeer: doc.peerIdStr,
      updatedBy: "user-alice",
      updatedAt: "2026-07-16T08:30:00.000Z",
      updatedByPeer: doc.peerIdStr,
    },
  ]);
});

test("updating a cell restamps only the updated attribution", async () => {
  const doc = await createDocument("rows-update");
  addDocumentRow(doc, "row-1", { systolic: "120", diastolic: "80" }, AUTHOR);

  const updated = setDocumentRowFields(
    doc,
    "row-1",
    { systolic: "130" },
    { at: "2026-07-16T20:00:00.000Z", userId: "user-bob" },
  );

  expect(updated).toBe(true);
  expect(listDocumentRows(doc)).toEqual([
    {
      id: "row-1",
      fields: { systolic: "130", diastolic: "80" },
      fieldEditors: { systolic: doc.peerIdStr, diastolic: doc.peerIdStr },
      createdBy: "user-alice",
      createdAt: "2026-07-16T08:30:00.000Z",
      createdByPeer: doc.peerIdStr,
      updatedBy: "user-bob",
      updatedAt: "2026-07-16T20:00:00.000Z",
      updatedByPeer: doc.peerIdStr,
    },
  ]);
});

test("removing a row deletes only that entry", async () => {
  const doc = await createDocument("rows-remove");
  addDocumentRow(doc, "row-1", { key: "A" }, AUTHOR);
  addDocumentRow(doc, "row-2", { key: "B" }, AUTHOR);

  expect(removeDocumentRow(doc, "row-1")).toBe(true);
  expect(listDocumentRows(doc).map((row) => row.id)).toEqual(["row-2"]);
  expect(removeDocumentRow(doc, "missing")).toBe(false);
});

test("reserved field names cannot overwrite row metadata", async () => {
  const doc = await createDocument("rows-reserved");
  addDocumentRow(
    doc,
    "row-1",
    { "@id": "hacked", systolic: "120" } as Record<string, string>,
    AUTHOR,
  );

  const [row] = listDocumentRows(doc);
  expect(row?.id).toBe("row-1");
  expect(row?.fields).toEqual({ systolic: "120" });
});

test("concurrent edits to different rows merge without clobbering", async () => {
  const alice = await createDocument("rows-alice");
  addDocumentRow(alice, "row-1", { value: "a1" }, AUTHOR);
  addDocumentRow(alice, "row-2", { value: "b1" }, AUTHOR);

  // Fork bob from alice's current state.
  const baseVersion = encodeVersionVector(alice);
  const bob = await createDocument("rows-bob");
  importUpdates(bob, [exportUpdatesSince(alice, null)]);

  // Alice edits row-1; Bob edits row-2 concurrently.
  setDocumentRowFields(alice, "row-1", { value: "a2" }, AUTHOR);
  setDocumentRowFields(bob, "row-2", { value: "b2" }, AUTHOR);

  // Exchange deltas both directions.
  const aliceDelta = exportUpdatesSince(alice, baseVersion);
  const bobDelta = exportUpdatesSince(bob, baseVersion);
  importUpdates(alice, [bobDelta]);
  importUpdates(bob, [aliceDelta]);

  // Both edits survive the merge on both peers.
  const aliceRows = listDocumentRows(alice);
  const bobRows = listDocumentRows(bob);
  expect(aliceRows.find((row) => row.id === "row-1")).toMatchObject({
    fields: { value: "a2" },
  });
  expect(aliceRows.find((row) => row.id === "row-2")).toMatchObject({
    fields: { value: "b2" },
  });
  expect(sameDocumentRows(aliceRows, bobRows)).toBe(true);
});

test("updatedByPeer records the writer's peer and survives snapshot reload", async () => {
  const doc = await createDocument("rows-peer");
  addDocumentRow(doc, "row-1", { systolic: "120" }, AUTHOR);

  const [row] = listDocumentRows(doc);
  expect(row?.updatedByPeer).toBe(doc.peerIdStr);

  // The last-editor register must survive the store's persist cycle, since
  // rows always reload from the durable-history checkpoint snapshot.
  const reloaded = await createDocument("rows-peer-reload");
  importSnapshot(reloaded, exportFullHistorySnapshot(doc));
  const [reloadedRow] = listDocumentRows(reloaded);
  expect(reloadedRow?.updatedByPeer).toBe(doc.peerIdStr);
});

test("updatedByPeer attributes concurrent per-row edits to their writers", async () => {
  const alice = await createDocument("rows-peer-alice");
  const bob = await createDocument("rows-peer-bob");

  addDocumentRow(alice, "row-1", { value: "a" }, AUTHOR);
  const aliceVersion = encodeVersionVector(alice);
  importUpdates(bob, [exportUpdatesSince(alice, null)]);

  // Bob adds row-2 concurrently; alice merges it in.
  addDocumentRow(bob, "row-2", { value: "b" }, AUTHOR);
  importUpdates(alice, [exportUpdatesSince(bob, aliceVersion)]);

  const rows = listDocumentRows(alice);
  expect(rows.find((row) => row.id === "row-1")?.updatedByPeer).toBe(
    alice.peerIdStr,
  );
  expect(rows.find((row) => row.id === "row-2")?.updatedByPeer).toBe(
    bob.peerIdStr,
  );
});

test("fieldEditors attribute concurrent per-cell edits to their writers", async () => {
  const alice = await createDocument("rows-cell-alice");
  const bob = await createDocument("rows-cell-bob");

  addDocumentRow(alice, "row-1", { systolic: "120", diastolic: "80" }, AUTHOR);
  const baseVersion = encodeVersionVector(alice);
  importUpdates(bob, [exportUpdatesSince(alice, null)]);

  // Alice edits systolic while Bob edits diastolic — different cells of the same
  // row, so both survive the merge with their own last editors.
  setDocumentRowFields(alice, "row-1", { systolic: "130" }, AUTHOR);
  setDocumentRowFields(bob, "row-1", { diastolic: "70" }, AUTHOR);
  importUpdates(alice, [exportUpdatesSince(bob, baseVersion)]);

  expect(
    listDocumentRows(alice).find((row) => row.id === "row-1"),
  ).toMatchObject({
    fields: { systolic: "130", diastolic: "70" },
    fieldEditors: { systolic: alice.peerIdStr, diastolic: bob.peerIdStr },
  });
});
