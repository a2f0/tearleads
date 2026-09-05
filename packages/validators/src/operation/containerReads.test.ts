import { expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020";
import {
  containerDocumentRuntimeRefinements,
  containerKekLogResponseRuntimeRefinements,
  containerParentLaneRuntimeRefinements,
} from "../containerReadRefinements";
import { ListContainerParentLanesRequestSchema } from "../request";
import {
  CONTAINER_NOT_FOUND_ERROR_CODE,
  ListContainerParentLanesResponseSchema,
} from "../response";
import {
  ContainerKekLogQuerySchema,
  getContainerKekLogOperation,
  isGetContainerKekLogOperationResponse,
  isListContainerDocumentsOperationResponse,
  isListContainerParentLanesOperationRequest,
  isListContainerParentLanesOperationResponse,
  ListContainerDocumentsQuerySchema,
  listContainerDocumentsOperation,
  listContainerParentLanesOperation,
} from "./containerReads";
import { openApiDocument } from "./openApi";
import {
  createContainerKekLogKeyring,
  createContainerKekLogResponse,
  createListContainerDocumentsResponse,
  createListContainerParentLanesRequest,
  createListContainerParentLanesResponse,
  jsonRoundTrip,
} from "./openApiTestFixtures";

test("container read operations own their complete wire metadata", () => {
  expect(getContainerKekLogOperation).toMatchObject({
    auth: "session",
    failureStatuses: [400, 401, 403, 404, 409, 500, 503],
    method: "GET",
    path: "/containers/{containerId}/kek-log",
    runtimeRefinements: containerKekLogResponseRuntimeRefinements,
  });
  expect(listContainerDocumentsOperation).toMatchObject({
    auth: "session",
    failureStatuses: [400, 401, 403, 404, 409, 500, 503],
    method: "GET",
    path: "/containers/{containerId}/documents",
    runtimeRefinements: containerDocumentRuntimeRefinements,
  });
  expect(listContainerParentLanesOperation).toMatchObject({
    auth: "session",
    failureStatuses: [400, 401, 500, 503],
    method: "POST",
    path: "/containers/parent-lanes/query",
    runtimeRefinements: containerParentLaneRuntimeRefinements,
  });
});

test("container read operations validate current query contracts", () => {
  expect(ContainerKekLogQuerySchema.parse({})).toEqual({});
  expect(ContainerKekLogQuerySchema.parse({ afterKeyEpoch: "2" })).toEqual({
    afterKeyEpoch: "2",
  });
  for (const value of [
    "malformed",
    "",
    "1.5",
    "1e2",
    " 2 ",
    "0",
    "65537",
    -1,
    0,
    1.5,
    Number.MAX_SAFE_INTEGER,
    Infinity,
  ]) {
    for (const field of ["afterKeyEpoch", "keyringForEpoch"]) {
      expect(
        ContainerKekLogQuerySchema.safeParse({ [field]: value }).success,
      ).toBe(false);
    }
  }
  expect(ListContainerDocumentsQuerySchema.parse({ limit: "25" })).toEqual({
    limit: 25,
  });
  expect(ListContainerDocumentsQuerySchema.parse({ limit: 25 })).toEqual({
    limit: 25,
  });

  const invalidLimit = ListContainerDocumentsQuerySchema.safeParse({
    limit: "0",
  });
  expect(invalidLimit.success).toBe(false);
  if (!invalidLimit.success) {
    expect(invalidLimit.error.issues[0]?.message).toBe("Invalid limit");
  }

  for (const query of [
    { watermarkId: "document-1" },
    { watermarkUpdatedAt: "2026-08-06T12:00:00.000Z" },
    { watermarkId: "document-1", watermarkUpdatedAt: "not-a-date" },
  ]) {
    const invalidWatermark = ListContainerDocumentsQuerySchema.safeParse(query);
    expect(invalidWatermark.success).toBe(false);
    if (!invalidWatermark.success) {
      expect(invalidWatermark.error.issues[0]?.message).toBe(
        "Invalid watermark",
      );
    }
  }
});

test("container document absence has an exact behavior code", () => {
  const schema = listContainerDocumentsOperation.failureResponses[404];
  expect(
    schema.safeParse({
      code: CONTAINER_NOT_FOUND_ERROR_CODE,
      error: "Container not found",
    }).success,
  ).toBe(true);
  expect(schema.safeParse({ error: "Container not found" }).success).toBe(
    false,
  );
});

test("container read operation guards derive from canonical schemas", () => {
  expect(
    isGetContainerKekLogOperationResponse(createContainerKekLogResponse()),
  ).toBe(true);
  expect(
    isListContainerDocumentsOperationResponse(
      createListContainerDocumentsResponse(),
    ),
  ).toBe(true);
  expect(
    isListContainerParentLanesOperationRequest(
      createListContainerParentLanesRequest(),
    ),
  ).toBe(true);
  expect(
    isListContainerParentLanesOperationResponse(
      createListContainerParentLanesResponse(),
    ),
  ).toBe(true);
});

test("OpenAPI declares each container read runtime-only invariant", () => {
  const kekOperation =
    openApiDocument.paths["/containers/{containerId}/kek-log"]?.get;
  const kekResponseSchema =
    kekOperation?.responses["200"]?.content?.["application/json"]?.schema;
  const parentOperation =
    openApiDocument.paths["/containers/parent-lanes/query"]?.post;
  const parentRequestSchema =
    parentOperation?.requestBody?.content["application/json"]?.schema;
  const parentResponseSchema =
    parentOperation?.responses["200"]?.content?.["application/json"]?.schema;
  if (
    kekResponseSchema === undefined ||
    parentRequestSchema === undefined ||
    parentResponseSchema === undefined
  ) {
    throw new Error("Container read OpenAPI schemas are missing");
  }

  expect(kekOperation?.["x-tearleads-runtime-refinements"]).toEqual(
    containerKekLogResponseRuntimeRefinements,
  );
  const documentsOperation =
    openApiDocument.paths["/containers/{containerId}/documents"]?.get;
  expect(documentsOperation?.["x-tearleads-runtime-refinements"]).toEqual(
    containerDocumentRuntimeRefinements,
  );
  expect(parentOperation?.["x-tearleads-runtime-refinements"]).toEqual(
    containerParentLaneRuntimeRefinements,
  );

  const baseLog = createContainerKekLogResponse();
  const multipleKeyrings = jsonRoundTrip({
    ...baseLog,
    epochs: [2, 3].map((epoch) => ({
      ...baseLog.epochs[0],
      containerKeyEpoch: epoch,
      containerKeyEpochId: `container-key-epoch-${epoch}`,
      keyring: createContainerKekLogKeyring(`container-key-epoch-${epoch}`),
    })),
  });

  const baseRequest = createListContainerParentLanesRequest();
  const duplicateRequest = jsonRoundTrip({
    lanes: [baseRequest.lanes[0], baseRequest.lanes[0]],
  });
  const oversizedRequest = jsonRoundTrip({
    lanes: Array.from({ length: 4 }, (_, index) => ({
      ...baseRequest.lanes[0],
      laneId: `lane-${index}`,
      limit: 126,
    })),
  });
  const baseResponse = createListContainerParentLanesResponse();
  const duplicateResponse = jsonRoundTrip({
    results: [baseResponse.results[0], baseResponse.results[0]],
  });

  const ajv = new Ajv2020({ strict: true });
  expect(ajv.compile(kekResponseSchema)(multipleKeyrings)).toBe(true);
  expect(
    getContainerKekLogOperation.responses[200].safeParse(multipleKeyrings)
      .success,
  ).toBe(false);

  const validateParentRequest = ajv.compile(parentRequestSchema);
  expect(validateParentRequest(duplicateRequest)).toBe(true);
  expect(validateParentRequest(oversizedRequest)).toBe(true);
  expect(
    ListContainerParentLanesRequestSchema.safeParse(duplicateRequest).success,
  ).toBe(false);
  expect(
    ListContainerParentLanesRequestSchema.safeParse(oversizedRequest).success,
  ).toBe(false);

  expect(ajv.compile(parentResponseSchema)(duplicateResponse)).toBe(true);
  expect(
    ListContainerParentLanesResponseSchema.safeParse(duplicateResponse).success,
  ).toBe(false);
});
