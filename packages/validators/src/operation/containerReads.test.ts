import { expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020";
import {
  containerDocumentLaneRuntimeRefinements,
  containerKekLogResponseRuntimeRefinements,
  containerParentLaneRuntimeRefinements,
} from "../containerReadRefinements";
import {
  ListContainerDocumentLanesRequestSchema,
  ListContainerParentLanesRequestSchema,
} from "../request";
import {
  CONTAINER_NOT_FOUND_ERROR_CODE,
  ListContainerParentLanesResponseSchema,
} from "../response";
import { ListContainerDocumentLanesResponseSchema } from "../response/containerDocumentLanes";
import {
  ContainerKekLogQuerySchema,
  getContainerKekLogOperation,
  isGetContainerKekLogOperationResponse,
  isListContainerDocumentLanesOperationRequest,
  isListContainerDocumentLanesOperationResponse,
  isListContainerParentLanesOperationRequest,
  isListContainerParentLanesOperationResponse,
  listContainerDocumentLanesOperation,
  listContainerParentLanesOperation,
} from "./containerReads";
import { openApiDocument } from "./openApi";
import {
  createContainerKekLogKeyring,
  createContainerKekLogResponse,
  createListContainerDocumentLanesRequest,
  createListContainerDocumentLanesResponse,
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
  expect(listContainerDocumentLanesOperation).toMatchObject({
    auth: "session",
    failureStatuses: [400, 401, 500, 503],
    method: "POST",
    path: "/containers/documents/query",
    runtimeRefinements: containerDocumentLaneRuntimeRefinements,
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
});

test("container document lanes bound lanes, rows, and container ids", () => {
  const baseLane = createListContainerDocumentLanesRequest().lanes[0];
  const lanes = (count: number, limit?: number) => ({
    lanes: Array.from({ length: count }, (_, index) => ({
      ...baseLane,
      laneId: `lane-${index}`,
      ...(limit === undefined ? {} : { limit }),
    })),
  });

  expect(
    ListContainerDocumentLanesRequestSchema.safeParse(lanes(32, 15)).success,
  ).toBe(true);
  // 33 lanes exceed the per-request container bound even when rows fit.
  expect(
    ListContainerDocumentLanesRequestSchema.safeParse(lanes(33, 15)).success,
  ).toBe(false);
  // Omitted limits default to 100 rows each: six lanes exceed the 500 total.
  expect(
    ListContainerDocumentLanesRequestSchema.safeParse(lanes(5)).success,
  ).toBe(true);
  expect(
    ListContainerDocumentLanesRequestSchema.safeParse(lanes(6)).success,
  ).toBe(false);
  expect(
    ListContainerDocumentLanesRequestSchema.safeParse({
      lanes: [{ ...baseLane, containerId: "container-1" }],
    }).success,
  ).toBe(false);
  expect(
    ListContainerDocumentLanesRequestSchema.safeParse({
      lanes: [
        {
          ...baseLane,
          watermark: { id: "document-1", updatedAt: "not-a-date" },
        },
      ],
    }).success,
  ).toBe(false);
});

test("container document lane failures carry only an exact absence code", () => {
  const failure = (value: object) =>
    ListContainerDocumentLanesResponseSchema.safeParse({
      results: [{ failure: value, laneId: "container-documents-0" }],
    }).success;

  expect(
    failure({
      code: CONTAINER_NOT_FOUND_ERROR_CODE,
      error: "Container not found",
      status: 404,
    }),
  ).toBe(true);
  expect(failure({ error: "Document manifest mismatch", status: 409 })).toBe(
    true,
  );
  expect(
    failure({ code: "other", error: "Container not found", status: 404 }),
  ).toBe(false);
  expect(failure({ error: "Server error", status: 500 })).toBe(false);
  expect(
    ListContainerDocumentLanesResponseSchema.safeParse({
      results: [
        {
          failure: { error: "Forbidden", status: 403 },
          laneId: "container-documents-0",
          page: createListContainerDocumentLanesResponse().results[0]?.page,
        },
      ],
    }).success,
  ).toBe(false);
});

test("container read operation guards derive from canonical schemas", () => {
  expect(
    isGetContainerKekLogOperationResponse(createContainerKekLogResponse()),
  ).toBe(true);
  expect(
    isListContainerDocumentLanesOperationRequest(
      createListContainerDocumentLanesRequest(),
    ),
  ).toBe(true);
  expect(
    isListContainerDocumentLanesOperationResponse(
      createListContainerDocumentLanesResponse(),
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
    openApiDocument.paths["/containers/documents/query"]?.post;
  expect(documentsOperation?.["x-tearleads-runtime-refinements"]).toEqual(
    containerDocumentLaneRuntimeRefinements,
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

  const documentsRequestSchema =
    documentsOperation?.requestBody?.content["application/json"]?.schema;
  const documentsResponseSchema =
    documentsOperation?.responses["200"]?.content?.["application/json"]?.schema;
  if (
    documentsRequestSchema === undefined ||
    documentsResponseSchema === undefined
  ) {
    throw new Error("Container document lane OpenAPI schemas are missing");
  }
  const documentsRequest = createListContainerDocumentLanesRequest();
  const duplicateDocumentsRequest = jsonRoundTrip({
    lanes: [documentsRequest.lanes[0], documentsRequest.lanes[0]],
  });
  const oversizedDocumentsRequest = jsonRoundTrip({
    lanes: Array.from({ length: 6 }, (_, index) => ({
      ...documentsRequest.lanes[0],
      laneId: `lane-${index}`,
    })),
  });
  const documentsResponse = createListContainerDocumentLanesResponse();
  const duplicateDocumentsResponse = jsonRoundTrip({
    results: [documentsResponse.results[0], documentsResponse.results[0]],
  });
  const validateDocumentsRequest = ajv.compile(documentsRequestSchema);
  expect(validateDocumentsRequest(duplicateDocumentsRequest)).toBe(true);
  expect(validateDocumentsRequest(oversizedDocumentsRequest)).toBe(true);
  expect(
    ListContainerDocumentLanesRequestSchema.safeParse(duplicateDocumentsRequest)
      .success,
  ).toBe(false);
  expect(
    ListContainerDocumentLanesRequestSchema.safeParse(oversizedDocumentsRequest)
      .success,
  ).toBe(false);
  expect(ajv.compile(documentsResponseSchema)(duplicateDocumentsResponse)).toBe(
    true,
  );
  expect(
    ListContainerDocumentLanesResponseSchema.safeParse(
      duplicateDocumentsResponse,
    ).success,
  ).toBe(false);
});
