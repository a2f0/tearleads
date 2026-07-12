import { expect, mock, spyOn, test } from "bun:test";
import type { DocumentLinkSetMutationRequest } from "@tearleads/validators/request";
import type { DocumentLinkSetMutationResponse } from "@tearleads/validators/response";
import {
  createDocumentMutationCreatedEvent,
  publishDocumentMutationCreatedEvent,
} from "./mutations";

const ORIGIN = { sessionId: "session-1", userId: "user-1" };

function mutationRequest(
  targetContainerId: string,
): DocumentLinkSetMutationRequest {
  return {
    targetContainerPathRefs: [
      { containerId: targetContainerId, manifestHash: "manifest-hash" },
    ],
  } as unknown as DocumentLinkSetMutationRequest;
}

function mutationResponse(
  currentContainerIds: readonly string[],
): DocumentLinkSetMutationResponse {
  return {
    documentKekTargets: {
      targets: currentContainerIds.map((containerId) => ({ containerId })),
    },
  } as unknown as DocumentLinkSetMutationResponse;
}

test("document mutation events scope link and unlink to the prior/current union", () => {
  expect(
    createDocumentMutationCreatedEvent({
      documentId: "document-1",
      eventType: "document.link",
      origin: ORIGIN,
      request: mutationRequest("trash"),
      response: mutationResponse(["root", "trash", "trash"]),
    }),
  ).toEqual({
    type: "document_mutation_created",
    containerIds: ["root", "trash"],
    documentId: "document-1",
    eventType: "document.link",
    origin: ORIGIN,
  });

  expect(
    createDocumentMutationCreatedEvent({
      documentId: "document-1",
      eventType: "document.unlink",
      origin: ORIGIN,
      request: mutationRequest("root"),
      response: mutationResponse(["trash"]),
    }),
  ).toEqual({
    type: "document_mutation_created",
    containerIds: ["root", "trash"],
    documentId: "document-1",
    eventType: "document.unlink",
    origin: ORIGIN,
  });
});

test("document mutations remain successful when realtime publication fails", async () => {
  const publish = mock(async () => {
    throw new Error("broker unavailable");
  });
  const errorSpy = spyOn(console, "error").mockImplementation(() => undefined);

  try {
    await expect(
      publishDocumentMutationCreatedEvent({
        documentId: "document-1",
        eventType: "document.unlink",
        origin: ORIGIN,
        publish,
        request: mutationRequest("root"),
        response: mutationResponse(["trash"]),
      }),
    ).resolves.toBeUndefined();
    expect(publish).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(
      "Failed to publish document mutation event:",
      expect.any(Error),
    );
  } finally {
    errorSpy.mockRestore();
  }
});
