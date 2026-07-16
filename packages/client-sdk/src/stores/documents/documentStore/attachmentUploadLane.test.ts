import { expect, test } from "bun:test";
import { createDomainScope } from "../../../data/domainScope";
import type { PendingAttachmentRecord } from "../../../workflows/documents";
import { getDomainSyncCoordinatorSnapshot } from "../../../workflows/sync";
import { createAttachmentUploadLaneReporter } from "./attachmentUploadLane";

function createPendingAttachment(
  storageKey: string,
  slotId = "attachment",
): PendingAttachmentRecord {
  return {
    byteLength: 80,
    localId: "document-local-id",
    mimeType: "application/pdf",
    name: "report.pdf",
    slotId,
    storageKey,
  };
}

test("a completed retry replaces the failed lane for the same persisted blob", () => {
  const domainScope = createDomainScope();
  const pendingAttachment = createPendingAttachment("document-report");
  const failedAttempt = createAttachmentUploadLaneReporter({
    blobId: "blob-report",
    domainScope,
    pendingAttachment,
  });
  failedAttempt.onMultipartProgress({
    bytesTotal: 80,
    bytesUploaded: 56,
    partsCompleted: 7,
    partsTotal: 10,
  });
  failedAttempt.fail(new Error("network request failed"));

  const retry = createAttachmentUploadLaneReporter({
    blobId: "blob-report",
    domainScope,
    pendingAttachment,
  });
  retry.complete();

  expect(getDomainSyncCoordinatorSnapshot(domainScope).lanes).toEqual([
    expect.objectContaining({
      blobStorageKey: "document-report",
      key: "blob-upload:blob-report",
      lastError: null,
      progress: null,
      runCount: 2,
      status: "complete",
    }),
  ]);
});

test("blob upload lane identities do not collide when documents reuse a slot", () => {
  const domainScope = createDomainScope();
  createAttachmentUploadLaneReporter({
    blobId: "blob-a",
    domainScope,
    pendingAttachment: createPendingAttachment("document-a-passport", "front"),
  }).complete();
  createAttachmentUploadLaneReporter({
    blobId: "blob-b",
    domainScope,
    pendingAttachment: createPendingAttachment("document-b-passport", "front"),
  }).complete();

  expect(
    getDomainSyncCoordinatorSnapshot(domainScope).lanes.map((lane) => lane.key),
  ).toEqual(["blob-upload:blob-a", "blob-upload:blob-b"]);
});

test("a preflight billing pause does not create an upload lane", () => {
  const domainScope = createDomainScope();
  const reporter = createAttachmentUploadLaneReporter({
    blobId: "blob-blocked",
    domainScope,
    pendingAttachment: createPendingAttachment("document-blocked"),
  });

  reporter.failIfStarted(new Error("remote sync is blocked"));

  expect(getDomainSyncCoordinatorSnapshot(domainScope).lanes).toHaveLength(0);
});

test("a billing pause after multipart progress terminalizes the upload lane", () => {
  const domainScope = createDomainScope();
  const reporter = createAttachmentUploadLaneReporter({
    blobId: "blob-paused",
    domainScope,
    pendingAttachment: createPendingAttachment("document-paused"),
  });
  reporter.onMultipartProgress({
    bytesTotal: 80,
    bytesUploaded: 8,
    partsCompleted: 1,
    partsTotal: 10,
  });

  reporter.failIfStarted(new Error("remote sync is blocked"));

  expect(getDomainSyncCoordinatorSnapshot(domainScope).lanes[0]).toMatchObject({
    lastError: "remote sync is blocked",
    running: false,
    status: "error",
  });
});
