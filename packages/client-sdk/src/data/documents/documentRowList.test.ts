import { expect, test } from "bun:test";
import {
  createDocument,
  encodeVersionVector,
  exportUpdatesSince,
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
      createdBy: "user-alice",
      createdAt: "2026-07-16T08:30:00.000Z",
      updatedBy: "user-alice",
      updatedAt: "2026-07-16T08:30:00.000Z",
    },
    {
      id: "row-2",
      fields: { systolic: "118", diastolic: "76" },
      createdBy: "user-alice",
      createdAt: "2026-07-16T08:30:00.000Z",
      updatedBy: "user-alice",
      updatedAt: "2026-07-16T08:30:00.000Z",
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
      createdBy: "user-alice",
      createdAt: "2026-07-16T08:30:00.000Z",
      updatedBy: "user-bob",
      updatedAt: "2026-07-16T20:00:00.000Z",
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
