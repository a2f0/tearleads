import { expect, test } from "bun:test";
import {
  createDocument,
  encodeVersionVector,
  exportFullHistorySnapshot,
  exportUpdatesInVersionRange,
  exportUpdatesSince,
  importSnapshot,
} from "@tearleads/loro";
import { createPendingUpdateFields } from "../../../../data/documents/documentSync";
import type { QueuedPendingUpdateRecord } from "../../../../workflows/documents";
import type { DocumentState } from "../state";
import { planQueuedUpdateMerge } from "../sync/syncQueueMergePlan";
import { importProvenOrdinaryPendingHistory } from "./rotationProvenance";

function commitRow(doc: DocumentState, id: string): QueuedPendingUpdateRecord {
  const before = encodeVersionVector(doc);
  const text = doc.getText("text");
  text.insert(text.length, " edit");
  doc.commit();
  const fields = createPendingUpdateFields(exportUpdatesSince(doc, before));
  if (!fields) throw new Error("expected an update");
  return { id, origin: "local", ...fields };
}

test("raw-history recovery accepts a merged ordinary row", async () => {
  const remote = await createDocument("merged-recovery-remote");
  remote.getText("text").update("remote base");
  remote.commit();
  const rawHistory = exportFullHistorySnapshot(remote);
  const current = await createDocument("merged-recovery-current");
  importSnapshot(current, rawHistory);
  const rows = [
    commitRow(current, "row-0"),
    commitRow(current, "row-1"),
    commitRow(current, "row-2"),
  ];
  const [group] = planQueuedUpdateMerge({ doc: current, rows });
  if (!group) throw new Error("expected a merge group");
  const blob = exportUpdatesInVersionRange(
    current,
    group.partialStartVersionVector,
    group.partialEndVersionVector,
  );
  const fields = blob ? createPendingUpdateFields(blob) : null;
  if (!fields) throw new Error("expected merged fields");
  const rebuilt = await createDocument("merged-recovery-rebuilt");
  importSnapshot(rebuilt, rawHistory);

  expect(
    importProvenOrdinaryPendingHistory({
      currentDocument: current,
      pendingUpdates: [{ id: "merged", ...fields }],
      rebuiltDocument: rebuilt,
    }),
  ).toBe(encodeVersionVector(current));
  expect(rebuilt.getText("text").toString()).toBe(
    current.getText("text").toString(),
  );
});
