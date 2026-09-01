import { expect, test } from "bun:test";
import {
  createDocument,
  encodeVersionVector,
  exportAllUpdates,
  exportFullHistorySnapshot,
  exportUpdatesSince,
} from "@tearleads/loro";
import {
  createPendingUpdateFields,
  isDocumentMutationCreatedEvent,
} from "./documentSync";

test("isDocumentMutationCreatedEvent validates scoped link-set hints", () => {
  expect(
    isDocumentMutationCreatedEvent({
      type: "document_mutation_created",
      containerIds: ["root", "trash"],
      documentId: "document-1",
      eventType: "document.unlink",
    }),
  ).toBe(true);
  expect(
    isDocumentMutationCreatedEvent({
      type: "document_mutation_created",
      containerIds: ["root", "trash"],
      documentId: "document-1",
      eventType: "document.purge",
    }),
  ).toBe(true);
  expect(
    isDocumentMutationCreatedEvent({
      type: "document_mutation_created",
      containerIds: [],
      documentId: "document-1",
      eventType: "document.unlink",
    }),
  ).toBe(false);
  expect(
    isDocumentMutationCreatedEvent({
      type: "document_mutation_created",
      containerIds: ["root"],
      documentId: "document-1",
      eventType: "document.rename",
    }),
  ).toBe(false);
});

test("createPendingUpdateFields drops a no-op (zero-span) delta", async () => {
  const doc = await createDocument("documentsync-test-seed");
  doc.getText("text").update("hello");
  const version = encodeVersionVector(doc);

  // Re-applying the same text produces no ops; the exported delta is still a
  // small non-empty blob whose start/end version vectors are equal. This is the
  // case the byteLength guard misses and that would otherwise be stored as a
  // permanently-"missing" zero-span row resent to every reader forever.
  doc.getText("text").update("hello");
  const noopDelta = exportUpdatesSince(doc, version);

  expect(noopDelta.byteLength).toBeGreaterThan(0);
  expect(createPendingUpdateFields(noopDelta)).toBeNull();
});

test("createPendingUpdateFields keeps a real edit delta", async () => {
  const doc = await createDocument("documentsync-test-seed-2");
  const version = encodeVersionVector(doc);
  doc.getText("text").update("hello world");
  const delta = exportUpdatesSince(doc, version);

  const fields = createPendingUpdateFields(delta);
  expect(fields).not.toBeNull();
  expect(fields?.partialStartVersionVector).not.toBe(
    fields?.partialEndVersionVector,
  );
});

test("createPendingUpdateFields keeps a full-history baseline", async () => {
  const doc = await createDocument("documentsync-test-seed-3");
  doc.getText("text").update("baseline content");
  const baseline = exportFullHistorySnapshot(doc);

  const fields = createPendingUpdateFields(baseline, encodeVersionVector(doc));
  expect(fields).not.toBeNull();
});

test("createPendingUpdateFields rejects a non-snapshot rotation baseline", async () => {
  const doc = await createDocument("documentsync-test-seed-4");
  doc.getText("text").update("baseline content");

  // An updates-mode export is never a self-contained baseline: replaying it
  // requires history the reader may not have, so rotation must refuse it and
  // demand a full-history snapshot.
  expect(() =>
    createPendingUpdateFields(exportAllUpdates(doc), encodeVersionVector(doc)),
  ).toThrow("full-history Loro snapshot");
});
