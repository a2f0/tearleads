import { expect, mock, spyOn, test } from "bun:test";
import type { BlobAttachmentBindResponse } from "@tearleads/validators/response";
import {
  createAttachmentBindDocumentEvent,
  createAttachmentDetachDocumentEvent,
  publishAttachmentDocumentEvent,
} from "./blobMutations";

const ORIGIN = { sessionId: "session-1", userId: "user-1" };

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
    createAttachmentBindDocumentEvent(
      {
        blobKekTargets,
        documentId: "document-1",
      },
      ORIGIN,
    ),
  ).toEqual({
    type: "document_update_created",
    containerIds: ["container-a", "container-b"],
    documentId: "document-1",
    origin: { sessionId: "session-1", userId: "user-1" },
  });
});

test("attachment bind document events ignore malformed target lists", () => {
  expect(
    createAttachmentBindDocumentEvent(
      {
        blobKekTargets: {} as BlobAttachmentBindResponse["blobKekTargets"],
        documentId: "document-1",
      },
      ORIGIN,
    ),
  ).toEqual({
    type: "document_update_created",
    containerIds: [],
    documentId: "document-1",
    origin: { sessionId: "session-1", userId: "user-1" },
  });
});

test("attachment detach events carry all linked containers and origin", () => {
  expect(
    createAttachmentDetachDocumentEvent({
      containerIds: ["container-b", "container-a", "container-b"],
      origin: ORIGIN,
      response: {
        documentId: "document-1",
      },
    }),
  ).toEqual({
    type: "document_update_created",
    containerIds: ["container-a", "container-b"],
    documentId: "document-1",
    origin: ORIGIN,
  });
});

test("committed attachment mutations survive publication failure", async () => {
  const publish = mock(async () => {
    throw new Error("broker unavailable");
  });
  const errorSpy = spyOn(console, "error").mockImplementation(() => undefined);

  try {
    await expect(
      publishAttachmentDocumentEvent({
        event: createAttachmentDetachDocumentEvent({
          containerIds: ["container-a"],
          origin: ORIGIN,
          response: { documentId: "document-1" },
        }),
        publish,
      }),
    ).resolves.toBeUndefined();
    expect(publish).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(
      "Failed to publish attachment document event:",
      expect.any(Error),
    );
  } finally {
    errorSpy.mockRestore();
  }
});
