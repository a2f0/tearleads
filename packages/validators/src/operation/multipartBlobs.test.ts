import { expect, test } from "bun:test";
import {
  CompleteMultipartBlobStageRequestSchema,
  InitiateMultipartBlobStageRequestSchema,
} from "../request";
import {
  CompleteMultipartBlobStageResponseSchema,
  ErrorResponseSchema,
  InitiateMultipartBlobStageResponseSchema,
  MultipartBlobStageStatusResponseSchema,
  SessionFailureResponseSchema,
} from "../response";
import { operationRequestPath, operationRoutePath } from "./definition";
import {
  completeMultipartBlobStageOperation,
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
    failureStatuses: [400, 401, 404, 409, 500],
    id: "blobs.multipartStages.initiate",
    method: "POST",
    responses: { 200: InitiateMultipartBlobStageResponseSchema },
  });
  expect(getMultipartBlobStageOperation).toMatchObject({
    auth: "session",
    failureStatuses: [400, 401, 403, 404, 409, 500],
    id: "blobs.multipartStages.get",
    method: "GET",
    params: MultipartBlobStagePathParamsSchema,
    responses: { 200: MultipartBlobStageStatusResponseSchema },
  });
  expect(completeMultipartBlobStageOperation).toMatchObject({
    auth: "session",
    body: CompleteMultipartBlobStageRequestSchema,
    failureStatuses: [400, 401, 403, 404, 409, 500],
    id: "blobs.multipartStages.complete",
    method: "POST",
    params: MultipartBlobStagePathParamsSchema,
    responses: { 200: CompleteMultipartBlobStageResponseSchema },
  });
  expect(initiateMultipartBlobStageOperation.failureResponses).toEqual({
    400: ErrorResponseSchema,
    401: SessionFailureResponseSchema,
    404: ErrorResponseSchema,
    409: ErrorResponseSchema,
    500: ErrorResponseSchema,
  });
  for (const operation of [
    getMultipartBlobStageOperation,
    completeMultipartBlobStageOperation,
  ]) {
    expect(operation.failureResponses).toEqual({
      400: ErrorResponseSchema,
      401: SessionFailureResponseSchema,
      403: ErrorResponseSchema,
      404: ErrorResponseSchema,
      409: ErrorResponseSchema,
      500: ErrorResponseSchema,
    });
  }
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
    operationRequestPath(completeMultipartBlobStageOperation, {
      stageId: legacyStageId,
    }),
  ).toBe(`/blobs/stages/multipart/${legacyStageId}/complete`);
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
  const complete =
    openApiDocument.paths["/blobs/stages/multipart/{stageId}/complete"]?.post;
  if (
    initiate?.requestBody === undefined ||
    status === undefined ||
    complete?.requestBody === undefined
  ) {
    throw new Error("Multipart control OpenAPI operations are missing");
  }

  expect(initiate.operationId).toBe("blobs.multipartStages.initiate");
  expect(initiate.parameters).toEqual([]);
  expect(
    initiate.requestBody.content["application/json"]?.schema.required,
  ).toEqual(["byteLength", "sha256"]);
  expect(Object.keys(initiate.responses)).toEqual([
    "200",
    "400",
    "401",
    "404",
    "409",
    "500",
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
  expect(complete.operationId).toBe("blobs.multipartStages.complete");
  expect(
    complete.requestBody.content["application/json"]?.schema.required,
  ).toEqual(["parts", "uploadId"]);
  for (const operation of [initiate, status, complete]) {
    expect(operation.security).toEqual([{ bearerAuth: [] }]);
  }
});
