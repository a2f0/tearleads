import { expect, test } from "bun:test";
import {
  createDocument,
  encodeVersionVector,
  exportUpdatesInVersionRange,
  exportUpdatesSince,
  importUpdates,
  versionVectorsEqual,
} from "@tearleads/loro";
import { createPendingUpdateFields } from "../../../../data/documents/documentSync";
import type { QueuedPendingUpdateRecord } from "../../../../workflows/documents";
import type { DocumentState } from "../state";
import {
  DEFAULT_QUEUED_UPDATE_MERGE_LIMITS,
  planQueuedUpdateMerge,
  QUEUED_UPDATE_MERGE_MAX_DATA_CHARACTERS,
  QUEUED_UPDATE_MERGE_MAX_ROWS_PER_PASS,
  type QueuedUpdateMergeGroup,
} from "./syncQueueMergePlan";

function rowFromUpdate(
  id: string,
  update: Uint8Array,
): QueuedPendingUpdateRecord {
  const fields = createPendingUpdateFields(update);
  if (!fields) throw new Error("expected a non-empty update");
  return { id, origin: "local", rekeyCount: 0, ...fields };
}

function commitRow(doc: DocumentState, id: string): QueuedPendingUpdateRecord {
  const before = encodeVersionVector(doc);
  const text = doc.getText("text");
  text.insert(text.length, "x");
  doc.commit();
  return rowFromUpdate(id, exportUpdatesSince(doc, before));
}

async function queuedRows(count: number, seed: string) {
  const doc = await createDocument(seed);
  const rows = Array.from({ length: count }, (_, index) =>
    commitRow(doc, `row-${index}`),
  );
  return { doc, rows };
}

function memberIds(groups: readonly QueuedUpdateMergeGroup[]) {
  return groups.map((group) => group.members.map((member) => member.id));
}

test("merge limits are half a request and 256 rows per pass", () => {
  expect(QUEUED_UPDATE_MERGE_MAX_DATA_CHARACTERS).toBe(8 * 1024 * 1024);
  expect(QUEUED_UPDATE_MERGE_MAX_ROWS_PER_PASS).toBe(256);
  expect(DEFAULT_QUEUED_UPDATE_MERGE_LIMITS).toEqual({
    maxDataCharacters: QUEUED_UPDATE_MERGE_MAX_DATA_CHARACTERS,
    maxRows: QUEUED_UPDATE_MERGE_MAX_ROWS_PER_PASS,
  });
});

test("consecutive local rows form one group with their union and max rekey", async () => {
  const { doc, rows } = await queuedRows(3, "merge-plan-union");
  const [first, second, third] = rows;
  if (!first || !second || !third) throw new Error("expected three rows");
  second.rekeyCount = 2;

  const groups = planQueuedUpdateMerge({ doc, rows });

  expect(memberIds(groups)).toEqual([["row-0", "row-1", "row-2"]]);
  const [group] = groups;
  expect(group?.members[0]).toBe(first);
  expect(group?.rekeyCount).toBe(2);
  expect(
    versionVectorsEqual(
      group?.partialStartVersionVector,
      first.partialStartVersionVector,
    ),
  ).toBe(true);
  expect(
    versionVectorsEqual(
      group?.partialEndVersionVector,
      third.partialEndVersionVector,
    ),
  ).toBe(true);
});

test("checkpoint, outbox, unproven and oversized rows cut runs", async () => {
  const { doc, rows } = await queuedRows(6, "merge-plan-cuts");
  const [r0, r1, r2, r3, r4, r5] = rows;
  if (!r0 || !r1 || !r2 || !r3 || !r4 || !r5) {
    throw new Error("expected six rows");
  }
  const bigBefore = encodeVersionVector(doc);
  doc.getText("text").insert(0, "large paste ".repeat(400));
  doc.commit();
  const big = rowFromUpdate("big", exportUpdatesSince(doc, bigBefore));
  const r6 = commitRow(doc, "row-6");
  const r7 = commitRow(doc, "row-7");
  // Each cut row would otherwise connect: it repeats a proven local range.
  const checkpoint: QueuedPendingUpdateRecord = {
    ...r1,
    id: "checkpoint",
    sourceVersionVector: r1.partialEndVersionVector,
  };
  const outbox: QueuedPendingUpdateRecord = {
    ...r3,
    id: "outbox",
    origin: "outbox",
  };
  const stranger = await createDocument("merge-plan-stranger");
  const unproven = commitRow(stranger, "unproven");
  const maxDataCharacters =
    4 * Math.max(...[...rows, r6, r7].map((row) => row.updateData.length));
  expect(big.updateData.length).toBeGreaterThan(maxDataCharacters);
  const queue = [
    r0,
    r1,
    checkpoint,
    r2,
    r3,
    outbox,
    r4,
    r5,
    unproven,
    big,
    r6,
    r7,
  ];

  const groups = planQueuedUpdateMerge({
    doc,
    limits: { maxDataCharacters, maxRows: 256 },
    rows: queue,
  });

  expect(memberIds(groups)).toEqual([
    ["row-0", "row-1"],
    ["row-2", "row-3"],
    ["row-4", "row-5"],
    ["row-6", "row-7"],
  ]);
  // Under the default cap the large row merges with its neighbours.
  expect(memberIds(planQueuedUpdateMerge({ doc, rows: queue })).at(-1)).toEqual(
    ["big", "row-6", "row-7"],
  );
});

test("the data cap splits a run", async () => {
  const { doc, rows } = await queuedRows(4, "merge-plan-cap");
  const sizes = rows.map((row) => row.updateData.length);
  const maxDataCharacters = 2 * Math.max(...sizes);
  expect(maxDataCharacters).toBeLessThan(3 * Math.min(...sizes));

  const groups = planQueuedUpdateMerge({
    doc,
    limits: { maxDataCharacters, maxRows: 256 },
    rows,
  });

  expect(memberIds(groups)).toEqual([
    ["row-0", "row-1"],
    ["row-2", "row-3"],
  ]);
});

test("the per-pass row budget bounds merged rows", async () => {
  const { doc, rows } = await queuedRows(7, "merge-plan-budget");
  const maxDataCharacters = QUEUED_UPDATE_MERGE_MAX_DATA_CHARACTERS;

  expect(
    memberIds(
      planQueuedUpdateMerge({
        doc,
        limits: { maxDataCharacters, maxRows: 3 },
        rows,
      }),
    ),
  ).toEqual([["row-0", "row-1", "row-2"]]);
  expect(
    memberIds(
      planQueuedUpdateMerge({
        doc,
        limits: { maxDataCharacters, maxRows: 5 },
        rows,
      }),
    ),
  ).toEqual([["row-0", "row-1", "row-2", "row-3", "row-4"]]);
});

test("a per-peer gap cuts a run and an overlap merges", async () => {
  const { doc, rows } = await queuedRows(4, "merge-plan-gap");
  const [r0, r1, r2, r3] = rows;
  if (!r0 || !r1 || !r2 || !r3) throw new Error("expected four rows");

  expect(memberIds(planQueuedUpdateMerge({ doc, rows: [r0, r2, r3] }))).toEqual(
    [["row-2", "row-3"]],
  );

  const firstTwo = exportUpdatesInVersionRange(
    doc,
    r0.partialStartVersionVector,
    r1.partialEndVersionVector,
  );
  if (!firstTwo) throw new Error("expected a range export");
  const overlapping = rowFromUpdate("overlap", firstTwo);
  const groups = planQueuedUpdateMerge({ doc, rows: [overlapping, r1, r2] });
  expect(memberIds(groups)).toEqual([["overlap", "row-1", "row-2"]]);
  expect(
    versionVectorsEqual(
      groups[0]?.partialStartVersionVector,
      r0.partialStartVersionVector,
    ),
  ).toBe(true);
  expect(
    versionVectorsEqual(
      groups[0]?.partialEndVersionVector,
      r2.partialEndVersionVector,
    ),
  ).toBe(true);
});

test("local rows around an imported remote edit still merge", async () => {
  const doc = await createDocument("merge-plan-local");
  const remote = await createDocument("merge-plan-remote");
  const first = commitRow(doc, "row-0");
  importUpdates(remote, [exportUpdatesSince(doc)]);
  const remoteBefore = encodeVersionVector(remote);
  remote.getText("text").insert(0, "R");
  remote.commit();
  importUpdates(doc, [exportUpdatesSince(remote, remoteBefore)]);
  const second = commitRow(doc, "row-1");

  const groups = planQueuedUpdateMerge({ doc, rows: [first, second] });

  expect(memberIds(groups)).toEqual([["row-0", "row-1"]]);
});

test("a single mergeable row is not a group", async () => {
  const { doc, rows } = await queuedRows(1, "merge-plan-single");
  expect(planQueuedUpdateMerge({ doc, rows })).toEqual([]);
});
