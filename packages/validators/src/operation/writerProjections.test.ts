import { expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020";
import { knownManifestsHeaderRefinement } from "../knownManifestsRefinements";
import {
  CONTAINER_NOT_FOUND_ERROR_CODE,
  DOCUMENT_NOT_FOUND_ERROR_CODE,
  DOCUMENT_PROJECTION_ERROR_CODES,
  DOCUMENT_SYNC_ERROR_CODES,
  DocumentWriterProjectionErrorResponseSchema,
  encodeContainerWriterProjection,
  encodeDocumentWriterProjection,
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

test("known-manifest hints accept only bounded, unique manifest hashes", () => {
  const hash = (index: number) => index.toString(16).padStart(64, "0");
  const accepts = (value: string) =>
    getContainerWriterProjectionOperation.headers.safeParse({
      "x-known-manifests": value,
    }).success;
  expect(accepts(hash(1))).toBe(true);
  expect(
    accepts(Array.from({ length: 48 }, (_, index) => hash(index)).join(",")),
  ).toBe(true);
  expect(
    accepts(Array.from({ length: 49 }, (_, index) => hash(index)).join(",")),
  ).toBe(false);
  expect(accepts(`${hash(1)},${hash(1)}`)).toBe(false);
  expect(accepts(hash(255).toUpperCase())).toBe(false);
  expect(accepts(`${hash(1)},`)).toBe(false);
  expect(accepts("")).toBe(false);
  expect(accepts("untrusted")).toBe(false);
  expect(
    getContainerWriterProjectionOperation.headers.safeParse({}).success,
  ).toBe(true);
});

test("writer projection operations own their complete wire metadata", () => {
  expect(getContainerWriterProjectionOperation).toMatchObject({
    auth: "session",
    failureStatuses: [400, 401, 403, 404, 409, 500, 503],
    method: "GET",
    path: "/containers/{containerId}/writer-projection",
    runtimeRefinements: [
      ...writerProjectionResponseRuntimeRefinements,
      knownManifestsHeaderRefinement,
    ],
  });
  expect(getDocumentWriterProjectionOperation).toMatchObject({
    auth: "session",
    failureStatuses: [400, 401, 403, 404, 409, 500, 503],
    method: "GET",
    path: "/documents/{documentId}/writer-projection",
    runtimeRefinements: [
      ...writerProjectionResponseRuntimeRefinements,
      knownManifestsHeaderRefinement,
    ],
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

test("writer projection operation guards validate the hash-cited wire", () => {
  const container = encodeContainerWriterProjection(
    createContainerWriterProjectionResponse(),
  );
  expect(isGetContainerWriterProjectionOperationResponse(container)).toBe(true);
  expect(
    isGetDocumentWriterProjectionOperationResponse(
      encodeDocumentWriterProjection(createDocumentWriterProjectionResponse()),
    ),
  ).toBe(true);
  // A decoded projection is not the wire shape.
  expect(
    isGetContainerWriterProjectionOperationResponse(
      createContainerWriterProjectionResponse(),
    ),
  ).toBe(false);
  expect(
    isGetContainerWriterProjectionOperationResponse({
      ...container,
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

test("OpenAPI declares the runtime-only path, KEK count, and bundle invariants", () => {
  const operation =
    openApiDocument.paths["/containers/{containerId}/writer-projection"]?.get;
  const responseSchema =
    operation?.responses["200"]?.content?.["application/json"]?.schema;
  if (responseSchema === undefined) {
    throw new Error("Container writer projection response schema is missing");
  }

  expect(operation?.["x-tearleads-runtime-refinements"]).toEqual([
    ...writerProjectionResponseRuntimeRefinements,
    knownManifestsHeaderRefinement,
  ]);

  const wire = encodeContainerWriterProjection(
    createContainerWriterProjectionResponse(),
  );
  const validate = new Ajv2020({ strict: true }).compile(responseSchema);
  for (const mismatched of [
    { ...wire, containerKeks: [] },
    { ...wire, bundles: {} },
    { ...wire, path: ["uncited-elsewhere"] },
  ].map(jsonRoundTrip)) {
    expect(validate(mismatched)).toBe(true);
    expect(
      getContainerWriterProjectionOperation.responses[200].safeParse(mismatched)
        .success,
    ).toBe(false);
  }
});
