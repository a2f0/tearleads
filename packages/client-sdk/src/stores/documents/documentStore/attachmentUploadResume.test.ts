import { expect, test } from "bun:test";
import type { PendingAttachmentRecord } from "../../../workflows/documents";
import { resolveAttachmentUploadResume } from "./attachmentUploadResume";
import type { DocumentStoreState } from "./state";
import { captureDocumentStoreSyncGeneration } from "./syncGeneration";

function createPendingAttachment(): PendingAttachmentRecord {
  return {
    byteLength: 12,
    localId: "local-document",
    mimeType: "application/octet-stream",
    name: "attachment.bin",
    slotId: "slot-1",
    storageKey: "storage-1",
  };
}

function createState(onSave: (record: PendingAttachmentRecord) => void) {
  return {
    doc: null,
    persistence: {
      savePendingAttachment: async (
        _execSql: unknown,
        record: PendingAttachmentRecord,
      ) => onSave(record),
    },
    resolveProjectionUserKey: async () => null,
    runtime: {
      infra: { execSql: async () => [] },
      state: { domainScope: {} },
    },
  } as unknown as DocumentStoreState;
}

function captureGeneration(state: DocumentStoreState) {
  const generation = captureDocumentStoreSyncGeneration(state, state.doc);
  if (!generation) throw new Error("Expected a live generation");
  return generation;
}

test("attachment upload resume rotates crypto material when plaintext changes", async () => {
  const saved: PendingAttachmentRecord[] = [];
  const state = createState((record) => saved.push(structuredClone(record)));
  const generation = captureGeneration(state);
  const pending = createPendingAttachment();

  const first = await resolveAttachmentUploadResume(
    state,
    pending,
    "a".repeat(64),
    generation,
  );
  await first.onStageResolved({
    partSize: 5 * 1024 * 1024,
    stageId: "stage-1",
  });
  const resumed = await resolveAttachmentUploadResume(
    state,
    pending,
    "a".repeat(64),
    generation,
  );

  expect(resumed.blobId).toBe(first.blobId);
  expect(resumed.contentKey).toEqual(first.contentKey);
  expect(resumed.nonceSeed).toEqual(first.nonceSeed);
  expect(resumed.multipart).toEqual({
    partSize: 5 * 1024 * 1024,
    resumeStageId: "stage-1",
  });

  const rotated = await resolveAttachmentUploadResume(
    state,
    pending,
    "b".repeat(64),
    generation,
  );
  expect(rotated.blobId).not.toBe(first.blobId);
  expect(rotated.contentKey).not.toEqual(first.contentKey);
  expect(rotated.nonceSeed).not.toEqual(first.nonceSeed);
  expect(rotated.multipart).toBeUndefined();
  expect(pending.upload).toEqual(
    expect.objectContaining({
      plaintextSha256: "b".repeat(64),
    }),
  );
  expect(saved).toHaveLength(3);
});

test("a stale generation never persists resume state", async () => {
  const saved: PendingAttachmentRecord[] = [];
  const state = createState((record) => saved.push(structuredClone(record)));
  const generation = captureGeneration(state);
  const pending = createPendingAttachment();

  // The persist is an upsert of the pending-attachment row; a teardown
  // (reset/discard) that deleted the row must not see it re-inserted by a
  // stale resume racing the teardown.
  state.doc = {} as DocumentStoreState["doc"];
  const resume = await resolveAttachmentUploadResume(
    state,
    pending,
    "a".repeat(64),
    generation,
  );
  await resume.onStageResolved({
    partSize: 5 * 1024 * 1024,
    stageId: "stage-1",
  });

  expect(resume.blobId).toBeTruthy();
  expect(saved).toHaveLength(0);
});
