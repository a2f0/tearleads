import { expect, test } from "bun:test";
import {
  blobWireHeaderKeys,
  challengeOperation,
  documentAttributionWireHeaderKeys,
  getBlobBytesOperation,
  getDocumentAttributionOperation,
  getHealthOperation,
  getOrganizationReadModelOperation,
  type listDocumentAttributionRangesOperation,
  protocolOperations,
} from "@tearleads/validators/operation";
import type { BinaryOperationResponseEnvelope } from "./binaryResponseOperationTransport";
import type {
  JsonOperationRequestInput,
  JsonOperationResponseEnvelope,
} from "./operationTransport";
import {
  createJsonOperationTransport,
  deriveJsonOperationRequest,
  supportsJsonOperationTransport,
} from "./operationTransport";
import {
  createOperationTransport,
  supportsOperationTransport,
} from "./operationTransportFactory";
import type {
  RequestFailure,
  ResponseRequestFn,
  ResponseRequestValidationFailureInput,
} from "./types";

const organizationId = "11111111-1111-4111-8111-111111111111";
const documentId = "22222222-2222-4222-8222-222222222222";
const attributionBody = {
  attributionRevision: 4,
  documentId,
  segments: [],
};
const attributionHeaders = {
  "Cache-Control": "private, no-cache",
  "Content-Type": "application/json",
  ETag: 'W/"attribution-4"',
  Vary: "Accept-Encoding",
  "X-Unrelated": "ignored",
};

type ChallengeTransportBody = JsonOperationRequestInput<
  typeof challengeOperation
>["body"];
type AcceptsChallengeBody<Value> = Value extends ChallengeTransportBody
  ? true
  : false;
type AttributionRangesTransportQuery = JsonOperationRequestInput<
  typeof listDocumentAttributionRangesOperation
>["query"];
type AcceptsAttributionRangesQuery<Value> =
  Value extends AttributionRangesTransportQuery ? true : false;
type AttributionResponseEnvelope = JsonOperationResponseEnvelope<
  typeof getDocumentAttributionOperation
>;
type NotModifiedAttributionResponse = Extract<
  AttributionResponseEnvelope,
  { readonly status: 304 }
>;
type BlobResponseEnvelope = BinaryOperationResponseEnvelope<
  typeof getBlobBytesOperation
>;

function assertType<Condition extends true>(_condition?: Condition): void {}

assertType<AcceptsChallengeBody<{ fingerprint: string }>>();
assertType<AcceptsChallengeBody<number> extends false ? true : false>();
assertType<AcceptsAttributionRangesQuery<{ limit: "10" }>>();
assertType<
  AttributionResponseEnvelope["status"] extends 200 | 304 ? true : false
>();
assertType<
  NotModifiedAttributionResponse["data"] extends undefined ? true : false
>();
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

test("derives JSON body, path, query, and headers from source schemas", () => {
  const fingerprint = "a".repeat(64);
  expect(
    deriveJsonOperationRequest(challengeOperation, {
      body: { fingerprint },
      params: {},
    }),
  ).toEqual({
    body: JSON.stringify({ fingerprint }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
    path: "/auth/challenge",
  });

  expect(
    deriveJsonOperationRequest(getOrganizationReadModelOperation, {
      params: { organizationId },
      query: { cursor: "opaque+/=cursor" },
    }),
  ).toEqual({
    method: "GET",
    path: `/organizations/${organizationId}/read-model?cursor=opaque%2B%2F%3Dcursor`,
  });

  expect(
    deriveJsonOperationRequest(getDocumentAttributionOperation, {
      headers: {
        [documentAttributionWireHeaderKeys.ifNoneMatch]: '"revision-4"',
      },
      params: { documentId },
    }),
  ).toEqual({
    headers: {
      [documentAttributionWireHeaderKeys.ifNoneMatch]: '"revision-4"',
    },
    method: "GET",
    path: `/documents/${documentId}/attribution`,
  });
  expect(
    deriveJsonOperationRequest(getDocumentAttributionOperation, {
      headers: {},
      params: { documentId: "document/1" },
    }).path,
  ).toBe("/documents/document%2F1/attribution");
});

test("fails before fetch when request values violate source schemas", () => {
  expect(() =>
    deriveJsonOperationRequest(challengeOperation, {
      body: { fingerprint: "not-a-fingerprint" },
      params: {},
    }),
  ).toThrow("Invalid request body for auth.challenge");
  expect(() =>
    deriveJsonOperationRequest(getOrganizationReadModelOperation, {
      params: { organizationId: "invalid" },
      query: { cursor: undefined },
    }),
  ).toThrow("Invalid path parameters for organizations.readModel.get");
});

test("decodes success bodies with the operation response schema", async () => {
  const calls: unknown[][] = [];
  const request = Object.assign(
    async (...args: unknown[]) => {
      calls.push(args);
      return {
        data: Response.json({ message: "ok" }),
        ok: true as const,
      };
    },
    { reportFailure: requestFailure },
  ) as ResponseRequestFn;
  const transport = createJsonOperationTransport(request);

  await expect(
    transport.request(getHealthOperation, { params: {} }),
  ).resolves.toEqual({ message: "ok" });
  expect(calls).toEqual([["/", "GET", undefined, {}, []]]);
});

test("returns transformed response schema output", async () => {
  const transformedHealthOperation = {
    ...getHealthOperation,
    responses: {
      200: getHealthOperation.responses[200].transform(({ message }) => ({
        message: message.toUpperCase(),
      })),
    },
  };
  const request = Object.assign(
    async () => ({
      data: Response.json({ message: "ok" }),
      ok: true as const,
    }),
    { reportFailure: requestFailure },
  ) as ResponseRequestFn;
  const transport = createJsonOperationTransport(request);

  await expect(
    transport.request(transformedHealthOperation, { params: {} }),
  ).resolves.toEqual({ message: "OK" });
});

test("caller headers override derived headers case-insensitively", async () => {
  const calls: unknown[][] = [];
  const request = Object.assign(
    async (...args: unknown[]) => {
      calls.push(args);
      return requestFailure({
        kind: "network",
        message: "offline",
        method: "POST",
        path: "/auth/challenge",
        status: null,
        statusText: "",
      });
    },
    { reportFailure: requestFailure },
  ) as ResponseRequestFn;
  const transport = createJsonOperationTransport(request);

  await transport.requestResult(
    challengeOperation,
    { body: { fingerprint: "a".repeat(64) }, params: {} },
    { headers: { "content-type": "application/problem+json" } },
  );

  expect(calls[0]?.[3]).toEqual({
    headers: { "content-type": "application/problem+json" },
  });
});

test("reports malformed JSON and shapes through ApiClient policy", async () => {
  const reported: ResponseRequestValidationFailureInput[] = [];
  const responses = [
    new Response("not-json", { status: 200, statusText: "OK" }),
    Response.json({ unexpected: true }),
  ];
  const request = Object.assign(
    async () => ({ data: responses.shift() as Response, ok: true as const }),
    {
      reportFailure(input: ResponseRequestValidationFailureInput) {
        reported.push(input);
        return requestFailure(input);
      },
    },
  ) as ResponseRequestFn;
  const transport = createJsonOperationTransport(request);

  expect(
    await transport.requestResult(getHealthOperation, { params: {} }),
  ).toMatchObject({ kind: "json", ok: false, path: "/", status: 200 });
  expect(
    await transport.requestResult(getHealthOperation, { params: {} }),
  ).toMatchObject({ kind: "shape", ok: false, path: "/", status: 200 });
  expect(reported.map((failure) => failure.kind)).toEqual(["json", "shape"]);
});

test("returns status-specific parsed response bodies and headers", async () => {
  const request = Object.assign(
    async () => ({
      data: Response.json(attributionBody, { headers: attributionHeaders }),
      ok: true as const,
    }),
    { reportFailure: requestFailure },
  ) as ResponseRequestFn;
  const transport = createJsonOperationTransport(request);

  await expect(
    transport.requestResponse(getDocumentAttributionOperation, {
      headers: {},
      params: { documentId },
    }),
  ).resolves.toEqual({
    data: attributionBody,
    headers: {
      "cache-control": "private, no-cache",
      "content-type": "application/json",
      etag: 'W/"attribution-4"',
      vary: "Accept-Encoding",
    },
    status: 200,
  });
});

test("accepts declared empty statuses without parsing a body", async () => {
  const request = Object.assign(
    async () => ({
      data: new Response(null, {
        headers: {
          "Cache-Control": "private, no-cache",
          ETag: 'W/"attribution-4"',
          Vary: "Accept-Encoding",
        },
        status: 304,
      }),
      ok: true as const,
    }),
    { reportFailure: requestFailure },
  ) as ResponseRequestFn;
  const transport = createJsonOperationTransport(request);

  await expect(
    transport.requestResponse(getDocumentAttributionOperation, {
      headers: {},
      params: { documentId },
    }),
  ).resolves.toEqual({
    data: undefined,
    headers: {
      "cache-control": "private, no-cache",
      etag: 'W/"attribution-4"',
      vary: "Accept-Encoding",
    },
    status: 304,
  });
});

test("reports malformed declared response headers", async () => {
  const request = Object.assign(
    async () => ({
      data: Response.json(attributionBody, {
        headers: {
          "Cache-Control": "private, no-cache",
          "Content-Type": "application/json",
          Vary: "Accept-Encoding",
        },
      }),
      ok: true as const,
    }),
    { reportFailure: requestFailure },
  ) as ResponseRequestFn;
  const transport = createJsonOperationTransport(request);

  await expect(
    transport.requestResponseResult(getDocumentAttributionOperation, {
      headers: {},
      params: { documentId },
    }),
  ).resolves.toMatchObject({
    kind: "shape",
    message: `Invalid response headers for /documents/${documentId}/attribution`,
    ok: false,
    status: 200,
  });
});

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
        "X-Tearleads-Blob-Id": documentId,
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
    params: { blobId: documentId },
  });

  expect(result).toEqual({
    headers: {
      [blobWireHeaderKeys.blobId]: documentId,
      [blobWireHeaderKeys.blobSha256]: "sha256-1",
      [blobWireHeaderKeys.contentLength]: String(bytes.byteLength),
    },
    response,
    status: 200,
  });
  expect(calls).toEqual([
    [`/blobs/${documentId}/bytes`, "GET", undefined, {}, []],
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
      params: { blobId: documentId },
    }),
  ).resolves.toMatchObject({
    kind: "shape",
    message: `Invalid response headers for /blobs/${documentId}/bytes`,
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
          "X-Tearleads-Blob-Id": documentId,
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
      params: { blobId: documentId },
    }),
  ).resolves.toMatchObject({
    kind: "shape",
    message: `Invalid binary response status 201 for /blobs/${documentId}/bytes`,
    ok: false,
    status: 201,
  });
});

test("does not claim binary operations with empty success statuses", () => {
  expect(
    supportsOperationTransport({
      ...getBlobBytesOperation,
      emptyResponseStatuses: [204],
    }),
  ).toBe(false);
});

test("registry coverage makes special response transports explicit", () => {
  const unsupported = protocolOperations
    .filter((operation) => !supportsJsonOperationTransport(operation))
    .map((operation) => operation.id);

  expect(unsupported).toEqual([
    "blobs.bytes.get",
    "blobs.multipartStages.parts.upload",
  ]);

  expect(
    protocolOperations
      .filter((operation) => !supportsOperationTransport(operation))
      .map((operation) => operation.id),
  ).toEqual(["blobs.multipartStages.parts.upload"]);
});
