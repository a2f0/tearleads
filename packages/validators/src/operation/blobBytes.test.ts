import { expect, test } from "bun:test";
import type { AnySchema } from "ajv";
import Ajv2020 from "ajv/dist/2020";
import {
  ErrorResponseSchema,
  SessionFailureResponseSchema,
  UploadMultipartBlobPartResponseSchema,
} from "../response";
import { MAX_MULTIPART_BLOB_PART_BYTES } from "../util";
import {
  BlobBytesResponseHeadersSchema,
  blobWireHeaderKeys,
  getBlobBytesOperation,
  MultipartBlobPartHeadersSchema,
  uploadMultipartBlobPartBytesOperation,
} from "./blobBytes";
import { operationRequestPath, operationRoutePath } from "./definition";
import { openApiDocument } from "./openApi";

const blobId = "11111111-1111-4111-8111-111111111111";
const stageId = "123E4567-E89B-12D3-A456-426614174000";
const sha256 = "a".repeat(64);

test("blob byte operations own their HTTP contracts", () => {
  expect(getBlobBytesOperation).toMatchObject({
    auth: "session",
    failureStatuses: [400, 401, 403, 404, 409, 500],
    id: "blobs.bytes.get",
    method: "GET",
    responseMediaTypes: { 200: "application/octet-stream" },
  });
  expect(uploadMultipartBlobPartBytesOperation).toMatchObject({
    auth: "session",
    failureStatuses: [400, 401, 403, 404, 409, 500],
    id: "blobs.multipartStages.parts.upload",
    method: "PUT",
    requestMediaType: "application/octet-stream",
    responses: { 200: UploadMultipartBlobPartResponseSchema },
  });
  for (const operation of [
    getBlobBytesOperation,
    uploadMultipartBlobPartBytesOperation,
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

test("blob byte paths derive from shared parameter schemas", () => {
  expect(operationRoutePath(getBlobBytesOperation)).toBe(
    "/blobs/:blobId/bytes",
  );
  expect(operationRequestPath(getBlobBytesOperation, { blobId })).toBe(
    `/blobs/${blobId}/bytes`,
  );
  expect(operationRoutePath(uploadMultipartBlobPartBytesOperation)).toBe(
    "/blobs/stages/multipart/:stageId/parts/:partNumber/bytes",
  );
  expect(
    operationRequestPath(uploadMultipartBlobPartBytesOperation, {
      partNumber: 2,
      stageId,
    }),
  ).toBe(`/blobs/stages/multipart/${stageId}/parts/2/bytes`);
  expect(() =>
    operationRequestPath(uploadMultipartBlobPartBytesOperation, {
      partNumber: Number.MAX_SAFE_INTEGER + 1,
      stageId,
    }),
  ).toThrow("Invalid path parameters for blobs.multipartStages.parts.upload");
});

test("blob byte header schemas preserve boundary validation", () => {
  expect(
    MultipartBlobPartHeadersSchema.safeParse({
      "content-type": "application/octet-stream",
      [blobWireHeaderKeys.partByteLength]: String(
        MAX_MULTIPART_BLOB_PART_BYTES,
      ),
      [blobWireHeaderKeys.partSha256]: sha256,
      [blobWireHeaderKeys.partUploadId]: "upload-1",
    }).success,
  ).toBe(true);
  expect(
    MultipartBlobPartHeadersSchema.safeParse({
      [blobWireHeaderKeys.partByteLength]: String(
        MAX_MULTIPART_BLOB_PART_BYTES + 1,
      ),
      [blobWireHeaderKeys.partSha256]: sha256,
      [blobWireHeaderKeys.partUploadId]: "upload-1",
    }).success,
  ).toBe(false);
  expect(
    BlobBytesResponseHeadersSchema.safeParse({
      [blobWireHeaderKeys.blobId]: blobId,
      [blobWireHeaderKeys.blobSha256]: sha256,
      [blobWireHeaderKeys.contentLength]: "12",
    }).success,
  ).toBe(true);
  expect(
    BlobBytesResponseHeadersSchema.safeParse({
      [blobWireHeaderKeys.blobByteLength]: "12",
      [blobWireHeaderKeys.blobId]: blobId,
      [blobWireHeaderKeys.blobSha256]: sha256,
      [blobWireHeaderKeys.contentLength]: "unusable",
    }).success,
  ).toBe(true);
  expect(
    BlobBytesResponseHeadersSchema.safeParse({
      [blobWireHeaderKeys.blobId]: blobId,
      [blobWireHeaderKeys.blobSha256]: sha256,
      [blobWireHeaderKeys.contentLength]: "unusable",
    }).success,
  ).toBe(false);
  expect(
    BlobBytesResponseHeadersSchema.safeParse({
      [blobWireHeaderKeys.blobId]: blobId,
      [blobWireHeaderKeys.blobSha256]: sha256,
    }).success,
  ).toBe(false);
});

test("blob byte fallback validation remains an explicit OpenAPI gap", () => {
  const get = openApiDocument.paths["/blobs/{blobId}/bytes"]?.get;
  const contentLength =
    get?.responses["200"]?.headers?.[blobWireHeaderKeys.contentLength];
  if (contentLength === undefined || !("schema" in contentLength)) {
    throw new Error("Blob byte Content-Length OpenAPI header is missing");
  }
  const validate = new Ajv2020({ strict: true }).compile(
    contentLength.schema as AnySchema,
  );

  expect(validate("unusable")).toBe(true);
  expect(
    BlobBytesResponseHeadersSchema.safeParse({
      [blobWireHeaderKeys.blobId]: blobId,
      [blobWireHeaderKeys.blobSha256]: sha256,
      [blobWireHeaderKeys.contentLength]: "unusable",
    }).success,
  ).toBe(false);
});

test("blob byte OpenAPI documents binary media, headers, and errors", () => {
  const get = openApiDocument.paths["/blobs/{blobId}/bytes"]?.get;
  const upload =
    openApiDocument.paths[
      "/blobs/stages/multipart/{stageId}/parts/{partNumber}/bytes"
    ]?.put;
  if (get === undefined || upload?.requestBody === undefined) {
    throw new Error("Blob byte OpenAPI operations are missing");
  }

  expect(
    get.responses["200"]?.content?.["application/octet-stream"]?.schema,
  ).toEqual({ format: "binary", type: "string" });
  expect(Object.keys(get.responses["200"]?.headers ?? {})).toEqual([
    blobWireHeaderKeys.blobByteLength,
    blobWireHeaderKeys.blobId,
    blobWireHeaderKeys.blobSha256,
    blobWireHeaderKeys.contentLength,
  ]);
  expect(
    upload.requestBody.content["application/octet-stream"]?.schema,
  ).toEqual({ format: "binary", type: "string" });
  expect(
    upload.parameters.filter(
      (parameter) => Reflect.get(parameter, "in") === "header",
    ),
  ).toHaveLength(3);
  for (const operation of [get, upload]) {
    expect(Object.keys(operation.responses)).toEqual([
      "200",
      "400",
      "401",
      "403",
      "404",
      "409",
      "500",
    ]);
  }
});
