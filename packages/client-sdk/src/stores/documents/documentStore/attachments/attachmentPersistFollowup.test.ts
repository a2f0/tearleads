import { expect, test } from "bun:test";
import { attachmentPersistNeedsFollowupSync } from "./attachmentPersistFollowup";

const winningRecord = {
  accessEpoch: 1,
  containerId: "container-1",
  documentId: "document-1",
  id: "local-1",
  snapshotEndVersion: "version-1",
  text: "",
};

test("attachment follow-up re-arms a same-generation refused persist", () => {
  expect(
    attachmentPersistNeedsFollowupSync({
      currentDocumentId: "document-1",
      currentLocalWriteGeneration: 4,
      expectedDocumentId: "document-1",
      expectedLocalWriteGeneration: 4,
      persisted: null,
    }),
  ).toBe(true);
});

test("attachment follow-up re-arms a superseded terminal pull", () => {
  expect(
    attachmentPersistNeedsFollowupSync({
      currentDocumentId: "document-1",
      currentLocalWriteGeneration: 4,
      expectedDocumentId: "document-1",
      expectedLocalWriteGeneration: 4,
      persisted: {
        pullContinuationSuperseded: true,
        record: winningRecord,
      },
    }),
  ).toBe(true);
});

test("attachment follow-up does not submit work into a replacement identity", () => {
  expect(
    attachmentPersistNeedsFollowupSync({
      currentDocumentId: "replacement-document",
      currentLocalWriteGeneration: 4,
      expectedDocumentId: "document-1",
      expectedLocalWriteGeneration: 4,
      persisted: {
        pullContinuationSuperseded: true,
        record: { ...winningRecord, documentId: "replacement-document" },
        syncIdentitySuperseded: true,
      },
    }),
  ).toBe(false);
});

test("attachment follow-up does not revive a torn-down write generation", () => {
  expect(
    attachmentPersistNeedsFollowupSync({
      currentDocumentId: "document-1",
      currentLocalWriteGeneration: 5,
      expectedDocumentId: "document-1",
      expectedLocalWriteGeneration: 4,
      persisted: null,
    }),
  ).toBe(false);
});
