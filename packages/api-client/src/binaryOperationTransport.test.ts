import { expect, test } from "bun:test";
import {
  blobWireHeaderKeys,
  getBlobBytesOperation,
  uploadMultipartBlobPartBytesOperation,
} from "@tearleads/validators/operation";
import type { BinaryOperationResponseEnvelope } from "./binaryResponseOperationTransport";
import { createOperationTransport } from "./operationTransportFactory";
import type {
  RequestFailure,
  ResponseRequestFn,
  ResponseRequestValidationFailureInput,
} from "./types";

const stageId = "11111111-1111-4111-8111-111111111111";
const blobId = "22222222-2222-4222-8222-222222222222";

type BlobResponseEnvelope = BinaryOperationResponseEnvelope<
  typeof getBlobBytesOperation
>;

function assertType<Condition extends true>(_condition?: Condition): void {}

assertType<BlobResponseEnvelope["status"] extends 200 ? true : false>();
assertType<
  BlobResponseEnvelope["headers"][typeof blobWireHeaderKeys.blobId] extends string
    ? true
    : false
>();

function requestFailure(
  input: ResponseRequestValidationFailureInput,
): RequestFailure {
  return {
    kind: input.kind,
    message: input.message,
    method: input.method,
    ok: false,
    path: input.path,
    report: () => {},
    status: input.status,
    statusText: input.statusText,
  };
}

test("derives binary response requests and preserves live streams", async () => {
  const calls: unknown[][] = [];
  const bytes = new TextEncoder().encode("encrypted-blob-bytes");
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    }),
    {
      headers: {
        "Content-Length": String(bytes.byteLength),
        "X-Tearleads-Blob-Id": blobId,
        "X-Tearleads-Blob-Sha256": "sha256-1",
      },
    },
  );
  const request = Object.assign(
    async (...args: unknown[]) => {
      calls.push(args);
      return { data: response, ok: true as const };
    },
    { reportFailure: requestFailure },
  ) as ResponseRequestFn;
  const transport = createOperationTransport(request);

  const result = await transport.requestBinaryResponse(getBlobBytesOperation, {
    params: { blobId },
  });

  expect(result).toEqual({
    headers: {
      [blobWireHeaderKeys.blobId]: blobId,
      [blobWireHeaderKeys.blobSha256]: "sha256-1",
      [blobWireHeaderKeys.contentLength]: String(bytes.byteLength),
    },
    response,
    status: 200,
  });
  expect(calls).toEqual([
    [`/blobs/${blobId}/bytes`, "GET", undefined, {}, [], getBlobBytesOperation],
  ]);
  await expect(new Response(result?.response.body).text()).resolves.toBe(
    "encrypted-blob-bytes",
  );
});

test("reports malformed binary response headers through policy", async () => {
  const reported: ResponseRequestValidationFailureInput[] = [];
  const request = Object.assign(
    async () => ({
      data: new Response("encrypted-blob-bytes"),
      ok: true as const,
    }),
    {
      reportFailure(input: ResponseRequestValidationFailureInput) {
        reported.push(input);
        return requestFailure(input);
      },
    },
  ) as ResponseRequestFn;
  const transport = createOperationTransport(request);

  await expect(
    transport.requestBinaryResponseResult(getBlobBytesOperation, {
      params: { blobId },
    }),
  ).resolves.toMatchObject({
    kind: "shape",
    message: `Invalid response headers for /blobs/${blobId}/bytes`,
    ok: false,
    status: 200,
  });
  expect(reported).toHaveLength(1);
});

test("rejects undeclared binary success statuses", async () => {
  const request = Object.assign(
    async () => ({
      data: new Response("encrypted-blob-bytes", {
        headers: {
          "Content-Length": "20",
          "X-Tearleads-Blob-Id": blobId,
          "X-Tearleads-Blob-Sha256": "sha256-1",
        },
        status: 201,
      }),
      ok: true as const,
    }),
    { reportFailure: requestFailure },
  ) as ResponseRequestFn;
  const transport = createOperationTransport(request);

  await expect(
    transport.requestBinaryResponseResult(getBlobBytesOperation, {
      params: { blobId },
    }),
  ).resolves.toMatchObject({
    kind: "shape",
    message: `Invalid binary response status 201 for /blobs/${blobId}/bytes`,
    ok: false,
    status: 201,
  });
});

test("derives binary request bodies and decodes JSON responses", async () => {
  const encryptedBytes = new Blob(["encrypted-part"]);
  let encodedBody: Blob | BufferSource | undefined;
  const calls: unknown[][] = [];
  const request = Object.assign(
    async (...args: unknown[]) => {
      calls.push(args);
      return {
        data: Response.json({
          part: {
            byteLength: encryptedBytes.size,
            etag: "etag-1",
            partNumber: 2,
          },
          stageId,
          uploadId: "upload-1",
        }),
        ok: true as const,
      };
    },
    { reportFailure: requestFailure },
  ) as ResponseRequestFn;
  const transport = createOperationTransport(request);

  const result = await transport.requestBinaryRequest(
    uploadMultipartBlobPartBytesOperation,
    {
      body: encryptedBytes,
      headers: {
        [blobWireHeaderKeys.partByteLength]: String(encryptedBytes.size),
        [blobWireHeaderKeys.partSha256]: "a".repeat(64),
        [blobWireHeaderKeys.partUploadId]: "upload-1",
      },
      params: { partNumber: 2, stageId },
    },
    {
      encodeBody: (body) => {
        encodedBody = body;
        return new File([body], "encrypted-blob-part", {
          type: "application/octet-stream",
        });
      },
    },
  );

  expect(result).toEqual({
    part: {
      byteLength: encryptedBytes.size,
      etag: "etag-1",
      partNumber: 2,
    },
    stageId,
    uploadId: "upload-1",
  });
  const [path, method, body, options, successStatuses, failureOperation] =
    calls[0] ?? [];
  expect(path).toBe(`/blobs/stages/multipart/${stageId}/parts/2/bytes`);
  expect(method).toBe("PUT");
  expect(encodedBody).toBe(encryptedBytes);
  expect(body).toBeInstanceOf(File);
  await expect((body as File).text()).resolves.toBe("encrypted-part");
  expect(options).toEqual({
    headers: {
      "Content-Type": "application/octet-stream",
      [blobWireHeaderKeys.partByteLength]: String(encryptedBytes.size),
      [blobWireHeaderKeys.partSha256]: "a".repeat(64),
      [blobWireHeaderKeys.partUploadId]: "upload-1",
    },
  });
  expect(successStatuses).toEqual([]);
  expect(failureOperation).toBe(uploadMultipartBlobPartBytesOperation);
});

test("rejects invalid binary request input before encoding or fetch", async () => {
  let encoded = false;
  let fetched = false;
  const request = Object.assign(
    async () => {
      fetched = true;
      return { data: Response.json({}), ok: true as const };
    },
    { reportFailure: requestFailure },
  ) as ResponseRequestFn;
  const transport = createOperationTransport(request);

  await expect(
    transport.requestBinaryRequest(
      uploadMultipartBlobPartBytesOperation,
      {
        body: "not binary" as unknown as Blob,
        headers: {
          [blobWireHeaderKeys.partByteLength]: "1",
          [blobWireHeaderKeys.partSha256]: "a".repeat(64),
          [blobWireHeaderKeys.partUploadId]: "upload-1",
        },
        params: { partNumber: 2, stageId },
      },
      {
        encodeBody: (body) => {
          encoded = true;
          return new File([body], "encrypted-blob-part");
        },
      },
    ),
  ).rejects.toThrow(
    "Invalid request body for blobs.multipartStages.parts.upload",
  );
  expect(encoded).toBe(false);
  expect(fetched).toBe(false);
});

test("reports malformed binary-request JSON responses through policy", async () => {
  const request = Object.assign(
    async () => ({
      data: Response.json({ stageId, uploadId: "upload-1" }),
      ok: true as const,
    }),
    { reportFailure: requestFailure },
  ) as ResponseRequestFn;
  const transport = createOperationTransport(request);

  await expect(
    transport.requestBinaryRequestResult(
      uploadMultipartBlobPartBytesOperation,
      {
        body: new Uint8Array([1]),
        headers: {
          [blobWireHeaderKeys.partByteLength]: "1",
          [blobWireHeaderKeys.partSha256]: "a".repeat(64),
          [blobWireHeaderKeys.partUploadId]: "upload-1",
        },
        params: { partNumber: 2, stageId },
      },
      { encodeBody: (body) => new File([body], "encrypted-blob-part") },
    ),
  ).resolves.toMatchObject({
    kind: "shape",
    message: `Invalid response shape for /blobs/stages/multipart/${stageId}/parts/2/bytes`,
    ok: false,
    status: 200,
  });
});
