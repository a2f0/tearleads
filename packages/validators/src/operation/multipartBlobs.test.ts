import { expect, test } from "bun:test";
import { InitiateMultipartBlobStageRequestSchema } from "../request";
import {
  ErrorResponseSchema,
  InitiateMultipartBlobStageResponseSchema,
  MULTIPART_BLOB_STAGE_ERROR_CODES,
  MultipartBlobStageConflictErrorResponseSchema,
  MultipartBlobStageNotFoundErrorResponseSchema,
  MultipartBlobStageStatusResponseSchema,
  SessionFailureResponseSchema,
} from "../response";
import { operationRequestPath, operationRoutePath } from "./definition";
import {
  getMultipartBlobStageOperation,
  initiateMultipartBlobStageOperation,
  MultipartBlobStagePathParamsSchema,
} from "./multipartBlobs";
import { openApiDocument } from "./openApi";

const stageId = "11111111-1111-4111-8111-111111111111";
const legacyStageId = "123E4567-E89B-12D3-A456-426614174000";

test("multipart control operations own their shared HTTP contracts", () => {
  expect(initiateMultipartBlobStageOperation).toMatchObject({
    auth: "session",
    body: InitiateMultipartBlobStageRequestSchema,
    failureStatuses: [400, 401, 403, 404, 409, 500, 503],
    id: "blobs.multipartStages.initiate",
    method: "POST",
    responses: { 200: InitiateMultipartBlobStageResponseSchema },
  });
  expect(getMultipartBlobStageOperation).toMatchObject({
    auth: "session",
    failureStatuses: [400, 401, 403, 404, 409, 500, 503],
    id: "blobs.multipartStages.get",
    method: "GET",
    params: MultipartBlobStagePathParamsSchema,
    responses: { 200: MultipartBlobStageStatusResponseSchema },
  });
  expect(initiateMultipartBlobStageOperation.failureResponses).toEqual({
    400: ErrorResponseSchema,
    401: SessionFailureResponseSchema,
    403: ErrorResponseSchema,
    404: ErrorResponseSchema,
    409: ErrorResponseSchema,
    500: ErrorResponseSchema,
    503: ErrorResponseSchema,
  });
  expect(getMultipartBlobStageOperation.failureResponses).toEqual({
    400: ErrorResponseSchema,
    401: SessionFailureResponseSchema,
    403: ErrorResponseSchema,
    404: MultipartBlobStageNotFoundErrorResponseSchema,
    409: MultipartBlobStageConflictErrorResponseSchema,
    500: ErrorResponseSchema,
    503: ErrorResponseSchema,
  });
});

test("multipart resume replacement requires exact status-specific codes", () => {
  const notFound = getMultipartBlobStageOperation.failureResponses[404];
  const expired = getMultipartBlobStageOperation.failureResponses[409];

  expect(
    notFound.safeParse({
      code: MULTIPART_BLOB_STAGE_ERROR_CODES.notFound,
      error: "Blob stage not found",
    }).success,
  ).toBe(true);
  expect(
    expired.safeParse({
      code: MULTIPART_BLOB_STAGE_ERROR_CODES.expired,
      error: "Blob stage has expired",
    }).success,
  ).toBe(true);
  expect(
    expired.safeParse({
      error: "Blob sha256 does not match multipart upload",
    }).success,
  ).toBe(true);
  expect(notFound.safeParse({ error: "Not Found" }).success).toBe(false);
  expect(
    notFound.safeParse({
      code: MULTIPART_BLOB_STAGE_ERROR_CODES.expired,
      error: "Wrong status",
    }).success,
  ).toBe(false);
  expect(
    expired.safeParse({
      code: MULTIPART_BLOB_STAGE_ERROR_CODES.notFound,
      error: "Wrong status",
    }).success,
  ).toBe(false);
  expect(
    expired.safeParse({ code: "unknown_code", error: "Unknown" }).success,
  ).toBe(false);
});

test("multipart control paths derive from shared operations", () => {
  expect(operationRoutePath(initiateMultipartBlobStageOperation)).toBe(
    "/blobs/stages/multipart",
  );
  expect(operationRequestPath(initiateMultipartBlobStageOperation, {})).toBe(
    "/blobs/stages/multipart",
  );
  expect(operationRoutePath(getMultipartBlobStageOperation)).toBe(
    "/blobs/stages/multipart/:stageId",
  );
  expect(
    operationRequestPath(getMultipartBlobStageOperation, { stageId }),
  ).toBe(`/blobs/stages/multipart/${stageId}`);
  expect(
    operationRequestPath(getMultipartBlobStageOperation, {
      stageId: legacyStageId,
    }),
  ).toBe(`/blobs/stages/multipart/${legacyStageId}`);
  expect(() =>
    operationRequestPath(getMultipartBlobStageOperation, {
      stageId: "invalid",
    }),
  ).toThrow("Invalid path parameters for blobs.multipartStages.get");
});

test("multipart control OpenAPI documents shared inputs and responses", () => {
  const initiate = openApiDocument.paths["/blobs/stages/multipart"]?.post;
  const status =
    openApiDocument.paths["/blobs/stages/multipart/{stageId}"]?.get;
  if (initiate?.requestBody === undefined || status === undefined) {
    throw new Error("Multipart control OpenAPI operations are missing");
  }

  expect(initiate.operationId).toBe("blobs.multipartStages.initiate");
  expect(initiate.parameters).toEqual([]);
  expect(
    initiate.requestBody.content["application/json"]?.schema.required,
  ).toEqual(["organizationId", "byteLength", "firstParts", "sha256"]);
  expect(Object.keys(initiate.responses)).toEqual([
    "200",
    "400",
    "401",
    "403",
    "404",
    "409",
    "500",
    "503",
  ]);
  expect(status.operationId).toBe("blobs.multipartStages.get");
  expect(status.parameters[0]).toMatchObject({
    name: "stageId",
    schema: { type: "string" },
  });
  const statusParameter = status.parameters[0];
  if (
    statusParameter === undefined ||
    !("schema" in statusParameter) ||
    typeof statusParameter.schema !== "object" ||
    statusParameter.schema === null
  ) {
    throw new Error("Multipart status path schema is missing");
  }
  expect(Reflect.get(statusParameter.schema, "pattern")).toBeTypeOf("string");
  // Attachment binding completes a stage; there is no completion route.
  expect(
    openApiDocument.paths["/blobs/stages/multipart/{stageId}/complete"],
  ).toBeUndefined();
  for (const operation of [initiate, status]) {
    expect(operation.security).toEqual([{ bearerAuth: [] }]);
  }
});
