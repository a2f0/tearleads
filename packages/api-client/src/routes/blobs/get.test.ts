import { expect, test } from "bun:test";
import { createOperationTransport } from "../../operationTransportFactory";
import type {
  OperationResponseRequestFn,
  RequestFailure,
  ResponseRequestValidationFailureInput,
} from "../../types";
import { getBlobBytes } from "./get";

const blobId = "11111111-1111-4111-8111-111111111111";

// Builds a OperationResponseRequestFn that resolves to a single canned Response, so the
// standalone getBlobBytes can be driven without a live ApiClient/msw. reportFailure
// records nothing here; the success path under test never calls it.
function mockRequest(response: Response): OperationResponseRequestFn {
  const fn = async () => ({ ok: true as const, data: response });
  return Object.assign(fn, {
    reportFailure: (
      input: ResponseRequestValidationFailureInput,
    ): RequestFailure => ({
      kind: input.kind,
      message: input.message,
      method: input.method,
      ok: false,
      path: input.path,
      report: () => {},
      status: input.status,
      statusText: input.statusText,
    }),
  });
}

function mockTransport(response: Response) {
  return createOperationTransport(mockRequest(response));
}

const BLOB_HEADERS = (byteLength: number): Record<string, string> => ({
  "X-Tearleads-Blob-Id": "blob-1",
  "X-Tearleads-Blob-Byte-Length": String(byteLength),
  "X-Tearleads-Blob-Sha256": "sha256-1",
});

test("uses the streaming response body when present (web / WKWebView fetch)", async () => {
  const bytes = new TextEncoder().encode("streamed-blob-bytes");
  const streamed = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    }),
    { headers: BLOB_HEADERS(bytes.byteLength) },
  );

  const result = await getBlobBytes(mockTransport(streamed), blobId);

  expect(result?.blobId).toBe("blob-1");
  expect(result?.byteLength).toBe(bytes.byteLength);
  await expect(new Response(result?.encryptedBytes).text()).resolves.toBe(
    "streamed-blob-bytes",
  );
});

test("reads a buffered response with no body stream (native HTTP bridge / CapacitorHttp)", async () => {
  // CapacitorHttp buffers the response natively, so response.body is null even on
  // a valid 200 — the bytes are only reachable via arrayBuffer(). getBlobBytes must
  // buffer-and-rewrap rather than reject this as a malformed (missing-body) shape.
  const bytes = new TextEncoder().encode("encrypted-blob-bytes");
  const buffered = {
    body: null,
    headers: new Headers(BLOB_HEADERS(bytes.byteLength)),
    status: 200,
    statusText: "OK",
    arrayBuffer: async () => bytes.buffer,
  } as unknown as Response;

  const result = await getBlobBytes(mockTransport(buffered), blobId);

  expect(result).not.toBeNull();
  expect(result?.blobId).toBe("blob-1");
  expect(result?.byteLength).toBe(bytes.byteLength);
  await expect(new Response(result?.encryptedBytes).text()).resolves.toBe(
    "encrypted-blob-bytes",
  );
});

test("prefers the blob byte length header over an unusable content length", async () => {
  const bytes = new TextEncoder().encode("streamed-blob-bytes");
  const response = new Response(bytes, {
    headers: {
      ...BLOB_HEADERS(bytes.byteLength),
      "Content-Length": "invalid",
    },
  });

  const result = await getBlobBytes(mockTransport(response), blobId);

  expect(result?.byteLength).toBe(bytes.byteLength);
});

test("Content-Length cannot replace the required blob byte-length header", async () => {
  const response = new Response("bytes", {
    headers: {
      "X-Tearleads-Blob-Id": blobId,
      "X-Tearleads-Blob-Sha256": "sha256-1",
      "Content-Length": "5",
    },
  });
  expect(await getBlobBytes(mockTransport(response), blobId)).toBeNull();
});

test("rejects invalid blob ids before fetch", async () => {
  await expect(
    getBlobBytes(mockTransport(new Response()), "invalid"),
  ).rejects.toThrow("Invalid path parameters for blobs.bytes.get");
});
