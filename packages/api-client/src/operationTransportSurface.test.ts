import { expect, test } from "bun:test";
import {
  getBlobBytesOperation,
  type HttpOperation,
  type JsonOperation,
  protocolOperations,
  uploadMultipartBlobPartBytesOperation,
  webSocketTicketOperation,
} from "@tearleads/validators/operation";
import { ErrorResponseSchema } from "@tearleads/validators/response";
import type { BinaryRequestOperation } from "./binaryRequestOperationTransport";
import type { BinaryResponseOperation } from "./binaryResponseOperationTransport";
import { createOperationTransport } from "./operationTransportFactory";
import {
  matchedOperationTransportSurfaces,
  type OperationTransportSurface,
  operationTransportSurface,
} from "./operationTransportSurface";
import type {
  RequestFailure,
  ResponseRequestFn,
  ResponseRequestValidationFailureInput,
} from "./types";

function assertType<Condition extends true>(_condition?: Condition): void {}

// Compile-time half of the drift guard: registering an operation whose type
// no transport surface serves must fail the TypeScript gate, not only the
// runtime partition test below.
type RegisteredOperation = (typeof protocolOperations)[number];
type ServedOperation =
  | BinaryRequestOperation
  | BinaryResponseOperation
  | JsonOperation;
assertType<
  Exclude<RegisteredOperation, ServedOperation> extends never ? true : false
>();

function registeredOperationIds(
  surface: OperationTransportSurface,
): readonly string[] {
  return protocolOperations
    .filter((operation) => operationTransportSurface(operation) === surface)
    .map((operation) => operation.id);
}

test("every registered operation resolves to exactly one transport surface", () => {
  expect(
    protocolOperations
      .map((operation) => ({
        id: operation.id,
        surfaces: matchedOperationTransportSurfaces(operation),
      }))
      .filter(({ surfaces }) => surfaces.length !== 1),
  ).toEqual([]);

  expect(registeredOperationIds("binaryRequest")).toEqual([
    "blobs.multipartStages.parts.upload",
  ]);
  expect(registeredOperationIds("binaryResponse")).toEqual(["blobs.bytes.get"]);
  expect(registeredOperationIds("json")).toHaveLength(
    protocolOperations.length - 2,
  );
});

test("every registered failure status declares a failure response schema", () => {
  expect(
    protocolOperations.flatMap((registeredOperation) => {
      const operation: HttpOperation = registeredOperation;
      return operation.failureStatuses
        .filter((status) => !operation.failureResponses?.[status])
        .map((status) => `${operation.id}:${status}`);
    }),
  ).toEqual([]);
});

test("does not claim binary operations with empty success statuses", () => {
  expect(
    operationTransportSurface({
      ...getBlobBytesOperation,
      emptyResponseStatuses: [204],
    }),
  ).toBeNull();
});

test("does not claim octet-stream operations with non-binary body schemas", () => {
  expect(
    operationTransportSurface({
      ...uploadMultipartBlobPartBytesOperation,
      body: uploadMultipartBlobPartBytesOperation.params,
    }),
  ).toBeNull();
});

test("does not claim operations with mixed response media types", () => {
  expect(
    operationTransportSurface({
      ...getBlobBytesOperation,
      responses: {
        ...getBlobBytesOperation.responses,
        404: ErrorResponseSchema,
      },
    }),
  ).toBeNull();
});

test("does not claim octet-stream requests with octet-stream responses", () => {
  expect(
    operationTransportSurface({
      ...uploadMultipartBlobPartBytesOperation,
      responseMediaTypes: { 200: "application/octet-stream" },
    }),
  ).toBeNull();
});

test("each transport surface refuses operations it does not own before fetch", async () => {
  let fetched = false;
  const request = Object.assign(
    async () => {
      fetched = true;
      return { data: new Response(), ok: true as const };
    },
    {
      reportFailure(
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
      },
    },
  ) as ResponseRequestFn;
  const transport = createOperationTransport(request);
  const blobId = "22222222-2222-4222-8222-222222222222";

  await expect(
    transport.request(getBlobBytesOperation as unknown as JsonOperation, {
      params: { blobId },
    }),
  ).rejects.toThrow("Unsupported JSON transport operation: blobs.bytes.get");
  await expect(
    transport.requestBinaryResponse(
      webSocketTicketOperation as unknown as BinaryResponseOperation,
      { params: {} },
    ),
  ).rejects.toThrow(
    "Unsupported binary response transport operation: auth.webSocketTicket",
  );
  await expect(
    transport.requestBinaryRequest(
      getBlobBytesOperation as unknown as BinaryRequestOperation,
      { body: new Blob(), params: { blobId } },
      { encodeBody: () => new Blob() },
    ),
  ).rejects.toThrow(
    "Unsupported binary request transport operation: blobs.bytes.get",
  );
  expect(fetched).toBe(false);
});
