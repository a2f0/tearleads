import { expect, test } from "bun:test";
import type { BlobAttachmentBindResponse } from "@tearleads/validators/response";
import { createAttachmentBindDocumentEvent } from "./blobMutations";

test("attachment bind document events are scoped to sorted unique containers", () => {
  const blobKekTargets = {
    targets: [
      { containerId: "container-b" },
      { containerId: "container-a" },
      { containerId: "container-b" },
      { ignored: true },
      null,
    ],
  } as unknown as BlobAttachmentBindResponse["blobKekTargets"];

  expect(
    createAttachmentBindDocumentEvent({
      blobKekTargets,
      documentId: "document-1",
    }),
  ).toEqual({
    type: "document_update_created",
    containerIds: ["container-a", "container-b"],
    documentId: "document-1",
  });
});

test("attachment bind document events ignore malformed target lists", () => {
  expect(
    createAttachmentBindDocumentEvent({
      blobKekTargets: {} as BlobAttachmentBindResponse["blobKekTargets"],
      documentId: "document-1",
    }),
  ).toEqual({
    type: "document_update_created",
    containerIds: [],
    documentId: "document-1",
  });
});
