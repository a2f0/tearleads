import { expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020";
import {
  CONTAINER_NOT_FOUND_ERROR_CODE,
  DOCUMENT_NOT_FOUND_ERROR_CODE,
  DOCUMENT_PROJECTION_ERROR_CODES,
  DOCUMENT_SYNC_ERROR_CODES,
  DocumentWriterProjectionErrorResponseSchema,
} from "../response";
import { writerProjectionResponseRuntimeRefinements } from "../writerProjectionRefinements";
import { openApiDocument } from "./openApi";
import {
  createContainerWriterProjectionResponse,
  createDocumentWriterProjectionResponse,
  jsonRoundTrip,
} from "./openApiTestFixtures";
import {
  getContainerWriterProjectionOperation,
  getDocumentWriterProjectionOperation,
  isGetContainerWriterProjectionOperationResponse,
  isGetDocumentWriterProjectionOperationResponse,
} from "./writerProjections";

test("writer projection operations own their complete wire metadata", () => {
  expect(getContainerWriterProjectionOperation).toMatchObject({
    auth: "session",
    failureStatuses: [400, 401, 403, 404, 409, 500],
    method: "GET",
    path: "/containers/{containerId}/writer-projection",
    runtimeRefinements: writerProjectionResponseRuntimeRefinements,
  });
  expect(getDocumentWriterProjectionOperation).toMatchObject({
    auth: "session",
    failureStatuses: [400, 401, 403, 404, 409, 500],
    method: "GET",
    path: "/documents/{documentId}/writer-projection",
    runtimeRefinements: writerProjectionResponseRuntimeRefinements,
  });
  expect(
    getContainerWriterProjectionOperation.failureResponses[404].safeParse({
      code: CONTAINER_NOT_FOUND_ERROR_CODE,
      error: "Container not found",
    }).success,
  ).toBe(true);
  expect(
    getDocumentWriterProjectionOperation.failureResponses[404].safeParse({
      code: DOCUMENT_NOT_FOUND_ERROR_CODE,
      error: "Document not found",
    }).success,
  ).toBe(true);
});

test("writer projection operation guards derive from the response schemas", () => {
  expect(
    isGetContainerWriterProjectionOperationResponse(
      createContainerWriterProjectionResponse(),
    ),
  ).toBe(true);
  expect(
    isGetDocumentWriterProjectionOperationResponse(
      createDocumentWriterProjectionResponse(),
    ),
  ).toBe(true);

  expect(
    isGetContainerWriterProjectionOperationResponse({
      ...createContainerWriterProjectionResponse(),
      containerKeks: [],
    }),
  ).toBe(false);
});

test("document writer projection conflict codes remain explicit", () => {
  for (const code of [
    ...Object.values(DOCUMENT_PROJECTION_ERROR_CODES),
    DOCUMENT_SYNC_ERROR_CODES.conflict,
    DOCUMENT_SYNC_ERROR_CODES.stateStale,
    DOCUMENT_SYNC_ERROR_CODES.updateIdConflict,
  ]) {
    expect(
      DocumentWriterProjectionErrorResponseSchema.safeParse({
        code,
        error: "Projection conflict",
      }).success,
    ).toBe(true);
  }
  expect(
    DocumentWriterProjectionErrorResponseSchema.safeParse({
      code: DOCUMENT_SYNC_ERROR_CODES.checkpointCoverageConflict,
      error: "Sync-only conflict",
    }).success,
  ).toBe(false);
  expect(
    DocumentWriterProjectionErrorResponseSchema.safeParse({
      code: "unknown",
      error: "Projection conflict",
    }).success,
  ).toBe(false);
});

test("OpenAPI declares the runtime-only path and KEK count invariant", () => {
  const operation =
    openApiDocument.paths["/containers/{containerId}/writer-projection"]?.get;
  const responseSchema =
    operation?.responses["200"]?.content?.["application/json"]?.schema;
  if (responseSchema === undefined) {
    throw new Error("Container writer projection response schema is missing");
  }

  expect(operation?.["x-tearleads-runtime-refinements"]).toEqual(
    writerProjectionResponseRuntimeRefinements,
  );

  const mismatched = jsonRoundTrip({
    ...createContainerWriterProjectionResponse(),
    containerKeks: [],
  });
  const validate = new Ajv2020({ strict: true }).compile(responseSchema);
  expect(validate(mismatched)).toBe(true);
  expect(
    getContainerWriterProjectionOperation.responses[200].safeParse(mismatched)
      .success,
  ).toBe(false);
});
