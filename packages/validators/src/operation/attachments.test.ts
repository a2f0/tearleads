import { expect, test } from "bun:test";
import {
  BlobAttachmentBindRequestSchema,
  BlobAttachmentDetachRequestSchema,
} from "../request";
import {
  BlobAttachmentBindResponseSchema,
  BlobAttachmentDetachResponseSchema,
  ErrorResponseSchema,
  ListDocumentAttachmentsResponseSchema,
  PaymentRequiredErrorResponseSchema,
} from "../response";
import {
  BlobAttachmentBindingPathParamsSchema,
  BlobAttachmentPathParamsSchema,
  bindBlobAttachmentOperation,
  DocumentAttachmentsPathParamsSchema,
  detachBlobAttachmentOperation,
  listDocumentAttachmentsOperation,
} from "./attachments";
import { operationRequestPath, operationRoutePath } from "./definition";
import { openApiDocument } from "./openApi";

test("attachment operations own their shared HTTP contracts", () => {
  expect(bindBlobAttachmentOperation).toMatchObject({
    auth: "session",
    body: BlobAttachmentBindRequestSchema,
    failureStatuses: [400, 401, 402, 403, 404, 409, 500, 503],
    id: "blobs.attachmentBindings.bind",
    method: "POST",
    params: BlobAttachmentPathParamsSchema,
    responses: { 200: BlobAttachmentBindResponseSchema },
  });
  expect(detachBlobAttachmentOperation).toMatchObject({
    auth: "session",
    body: BlobAttachmentDetachRequestSchema,
    failureStatuses: [400, 401, 402, 403, 404, 409, 500, 503],
    id: "blobs.attachmentBindings.detach",
    method: "POST",
    params: BlobAttachmentBindingPathParamsSchema,
    responses: { 200: BlobAttachmentDetachResponseSchema },
  });
  expect(listDocumentAttachmentsOperation).toMatchObject({
    auth: "session",
    failureStatuses: [400, 401, 403, 404, 409, 500],
    id: "documents.attachments.list",
    method: "GET",
    params: DocumentAttachmentsPathParamsSchema,
    responses: { 200: ListDocumentAttachmentsResponseSchema },
  });

  const mutationFailures = {
    400: ErrorResponseSchema,
    401: ErrorResponseSchema,
    402: PaymentRequiredErrorResponseSchema,
    403: ErrorResponseSchema,
    404: ErrorResponseSchema,
    409: ErrorResponseSchema,
    500: ErrorResponseSchema,
    503: ErrorResponseSchema,
  };
  expect(bindBlobAttachmentOperation.failureResponses).toEqual(
    mutationFailures,
  );
  expect(detachBlobAttachmentOperation.failureResponses).toEqual(
    mutationFailures,
  );
  expect(listDocumentAttachmentsOperation.failureResponses).toEqual({
    400: ErrorResponseSchema,
    401: ErrorResponseSchema,
    403: ErrorResponseSchema,
    404: ErrorResponseSchema,
    409: ErrorResponseSchema,
    500: ErrorResponseSchema,
  });
});

test("attachment route and request paths derive from shared operations", () => {
  expect(operationRoutePath(bindBlobAttachmentOperation)).toBe(
    "/blobs/:blobId/attachment-bindings",
  );
  expect(
    operationRequestPath(bindBlobAttachmentOperation, { blobId: "blob/1" }),
  ).toBe("/blobs/blob%2F1/attachment-bindings");
  expect(operationRoutePath(detachBlobAttachmentOperation)).toBe(
    "/blobs/:blobId/attachment-bindings/:bindingId/detach",
  );
  expect(
    operationRequestPath(detachBlobAttachmentOperation, {
      bindingId: "binding/1",
      blobId: "blob/1",
    }),
  ).toBe("/blobs/blob%2F1/attachment-bindings/binding%2F1/detach");
  expect(operationRoutePath(listDocumentAttachmentsOperation)).toBe(
    "/documents/:documentId/attachments",
  );
  expect(
    operationRequestPath(listDocumentAttachmentsOperation, {
      documentId: "document/1",
    }),
  ).toBe("/documents/document%2F1/attachments");
});

test("attachment OpenAPI documents shared inputs and responses", () => {
  const bind =
    openApiDocument.paths["/blobs/{blobId}/attachment-bindings"]?.post;
  const detach =
    openApiDocument.paths[
      "/blobs/{blobId}/attachment-bindings/{bindingId}/detach"
    ]?.post;
  const list =
    openApiDocument.paths["/documents/{documentId}/attachments"]?.get;
  if (
    bind?.requestBody === undefined ||
    detach?.requestBody === undefined ||
    list === undefined
  ) {
    throw new Error("Attachment OpenAPI operations are missing");
  }

  expect(bind.operationId).toBe("blobs.attachmentBindings.bind");
  expect(bind.parameters[0]).toMatchObject({ name: "blobId" });
  expect(bind.requestBody.content["application/json"].schema.required).toEqual([
    "authorizingContainerPathRefs",
    "body",
    "contentKeyBundle",
    "event",
  ]);
  expect(Object.keys(bind.responses)).toEqual([
    "200",
    "400",
    "401",
    "402",
    "403",
    "404",
    "409",
    "500",
    "503",
  ]);
  expect(detach.operationId).toBe("blobs.attachmentBindings.detach");
  expect(
    detach.parameters.map((parameter) => Reflect.get(parameter, "name")),
  ).toEqual(["blobId", "bindingId"]);
  expect(list.operationId).toBe("documents.attachments.list");
  expect(list.parameters[0]).toMatchObject({ name: "documentId" });
  expect(list.security).toEqual([{ bearerAuth: [] }]);
});
