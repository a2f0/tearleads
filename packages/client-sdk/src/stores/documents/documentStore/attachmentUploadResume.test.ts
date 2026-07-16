import { expect, test } from "bun:test";
import type { PendingAttachmentRecord } from "../../../workflows/documents";
import { resolveAttachmentUploadResume } from "./attachmentUploadResume";
import type { DocumentStoreState } from "./state";

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
    persistence: {
      savePendingAttachment: async (
        _execSql: unknown,
        record: PendingAttachmentRecord,
      ) => onSave(record),
    },
    runtime: { infra: { execSql: async () => [] } },
  } as unknown as DocumentStoreState;
}

test("attachment upload resume rotates crypto material when plaintext changes", async () => {
  const saved: PendingAttachmentRecord[] = [];
  const state = createState((record) => saved.push(structuredClone(record)));
  const pending = createPendingAttachment();

  const first = await resolveAttachmentUploadResume(
    state,
    pending,
    "a".repeat(64),
  );
  await first.onStageResolved({
    partSize: 5 * 1024 * 1024,
    stageId: "stage-1",
  });
  const resumed = await resolveAttachmentUploadResume(
    state,
    pending,
    "a".repeat(64),
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
