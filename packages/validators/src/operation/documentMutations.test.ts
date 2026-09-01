import { expect, test } from "bun:test";
import {
  documentLinkSetPathRefinement,
  documentSyncRequestRotationRefinement,
} from "../documentSyncRefinements";
import {
  DocumentCreateRequestSchema,
  DocumentLinkSetMutationRequestSchema,
  DocumentPurgeRequestSchema,
} from "../request";
import {
  DocumentCreateResponseSchema,
  DocumentLinkSetMutationResponseSchema,
  DocumentPurgeProofResponseSchema,
  DocumentPurgeResponseSchema,
  ErrorResponseSchema,
  PaymentRequiredErrorResponseSchema,
} from "../response";
import {
  createDocumentOperation,
  DocumentMutationPathParamsSchema,
  getDocumentPurgeProofOperation,
  isCreateDocumentOperationRequest,
  isCreateDocumentOperationResponse,
  isDocumentLinkSetMutationOperationRequest,
  isDocumentLinkSetMutationOperationResponse,
  isGetDocumentPurgeProofOperationResponse,
  isPurgeDocumentOperationRequest,
  isPurgeDocumentOperationResponse,
  linkDocumentOperation,
  purgeDocumentOperation,
  unlinkDocumentOperation,
} from "./documentMutations";
import { DocumentSyncPathParamsSchema } from "./documentSync";
import { openApiDocument } from "./openApi";
import {
  createDocumentCreateRequest,
  createDocumentCreateResponse,
  createDocumentLinkSetMutationRequest,
  createDocumentLinkSetMutationResponse,
  createDocumentPurgeProofResponse,
  createDocumentPurgeRequest,
  createDocumentPurgeResponse,
} from "./openApiTestFixtures";

const failureStatuses = [400, 401, 402, 403, 404, 409, 500, 503];
const failureResponses = {
  400: ErrorResponseSchema,
  401: ErrorResponseSchema,
  402: PaymentRequiredErrorResponseSchema,
  403: ErrorResponseSchema,
  404: ErrorResponseSchema,
  409: ErrorResponseSchema,
  500: ErrorResponseSchema,
  503: ErrorResponseSchema,
};

test("document mutation operations own their complete wire metadata", () => {
  expect(createDocumentOperation).toMatchObject({
    auth: "session",
    failureResponses,
    failureStatuses,
    id: "documents.create",
    method: "POST",
    path: "/documents",
  });
  for (const operation of [linkDocumentOperation, unlinkDocumentOperation]) {
    expect(operation).toMatchObject({
      auth: "session",
      failureResponses,
      failureStatuses,
      method: "POST",
      runtimeRefinements: [
        documentLinkSetPathRefinement,
        documentSyncRequestRotationRefinement,
      ],
    });
  }
  expect(purgeDocumentOperation).toMatchObject({
    auth: "session",
    failureResponses,
    failureStatuses,
    id: "documents.purge",
    method: "POST",
    path: "/documents/{documentId}/purge",
  });
  expect(getDocumentPurgeProofOperation).toMatchObject({
    auth: "session",
    failureResponses,
    failureStatuses,
    id: "documents.purgeProof",
    method: "GET",
    path: "/documents/{documentId}/purge",
  });
});

test("document mutation guards derive from canonical schemas", () => {
  const createRequest = createDocumentCreateRequest();
  const parsedCreateRequest =
    DocumentCreateRequestSchema.safeParse(createRequest);
  expect(parsedCreateRequest.success).toBe(true);
  if (parsedCreateRequest.success) {
    expect(parsedCreateRequest.data).toBe(createRequest);
  }
  expect(isCreateDocumentOperationRequest(createRequest)).toBe(true);
  const createResponse = createDocumentCreateResponse();
  expect(DocumentCreateResponseSchema.safeParse(createResponse).success).toBe(
    true,
  );
  expect(isCreateDocumentOperationResponse(createResponse)).toBe(true);

  const linkRequest = createDocumentLinkSetMutationRequest();
  const parsedLinkRequest =
    DocumentLinkSetMutationRequestSchema.safeParse(linkRequest);
  expect(parsedLinkRequest.success).toBe(true);
  if (parsedLinkRequest.success) {
    expect(parsedLinkRequest.data).toBe(linkRequest);
  }
  expect(isDocumentLinkSetMutationOperationRequest(linkRequest)).toBe(true);
  const linkResponse = createDocumentLinkSetMutationResponse();
  expect(
    DocumentLinkSetMutationResponseSchema.safeParse(linkResponse).success,
  ).toBe(true);
  expect(isDocumentLinkSetMutationOperationResponse(linkResponse)).toBe(true);

  const purgeResponse = createDocumentPurgeResponse();
  expect(DocumentPurgeResponseSchema.safeParse(purgeResponse).success).toBe(
    true,
  );
  const purgeRequest = createDocumentPurgeRequest();
  expect(DocumentPurgeRequestSchema.safeParse(purgeRequest).success).toBe(true);
  expect(isPurgeDocumentOperationRequest(purgeRequest)).toBe(true);
  expect(isPurgeDocumentOperationResponse(purgeResponse)).toBe(true);
  const purgeProof = createDocumentPurgeProofResponse();
  expect(DocumentPurgeProofResponseSchema.safeParse(purgeProof).success).toBe(
    true,
  );
  expect(isGetDocumentPurgeProofOperationResponse(purgeProof)).toBe(true);
});

test("document mutation path parameters preserve string compatibility", () => {
  expect(DocumentMutationPathParamsSchema).toBe(DocumentSyncPathParamsSchema);
  expect(
    DocumentMutationPathParamsSchema.safeParse({
      documentId: "legacy-document-id",
    }).success,
  ).toBe(true);
  expect(
    DocumentMutationPathParamsSchema.safeParse({ documentId: 1 }).success,
  ).toBe(false);
});

test("OpenAPI declares the link-set runtime-only invariant", () => {
  for (const operation of [
    openApiDocument.paths["/documents/{documentId}/link"]?.post,
    openApiDocument.paths["/documents/{documentId}/unlink"]?.post,
  ]) {
    expect(operation?.["x-tearleads-runtime-refinements"]).toEqual([
      documentLinkSetPathRefinement,
      documentSyncRequestRotationRefinement,
    ]);
  }
});
