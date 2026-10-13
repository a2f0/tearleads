import { expect, test } from "bun:test";
import { createOperationTransport } from "../../operationTransportFactory";
import type {
  OperationResponseRequestFn,
  ResponseRequestValidationFailureInput,
} from "../../types";
import { getBlobBytes } from "./get";

const blobId = "11111111-1111-4111-8111-111111111111";
function transport() {
  const request: OperationResponseRequestFn = Object.assign(
    async () => ({
      ok: true as const,
      data: Response.json({
        blobId,
        byteLength: 5,
        sha256: "a".repeat(64),
        source: {
          kind: "signed-url",
          url: "https://storage.test/object",
          expiresAt: "2000-01-01T00:00:00.000Z",
        },
      }),
    }),
    {
      reportFailure: (_input: ResponseRequestValidationFailureInput): never => {
        throw new Error("Unexpected invalid response");
      },
    },
  );
  return createOperationTransport(request);
}

test("signed downloads support native buffered HTTP responses", async () => {
  const bytes = new TextEncoder().encode("bytes");
  const response = {
    body: null,
    status: 200,
    arrayBuffer: async () => bytes.buffer,
  } as unknown as Response;
  const blob = await getBlobBytes(transport(), blobId, async () => response);
  await expect(new Response(blob?.encryptedBytes).text()).resolves.toBe(
    "bytes",
  );
});

test("accepted streams stay lazy and readable past the descriptor expiry", async () => {
  let pulls = 0;
  let fetchOptions: RequestInit | undefined;
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        pulls += 1;
        controller.enqueue(new TextEncoder().encode("bytes"));
        controller.close();
      },
    },
    { highWaterMark: 0 },
  );
  const blob = await getBlobBytes(transport(), blobId, async (_url, init) => {
    fetchOptions = init;
    return new Response(stream);
  });
  // Bun's Request getters currently lose these options; check the actual
  // fetch input here, and credential headers through ApiClient's HTTP test.
  expect(fetchOptions).toEqual({
    cache: "no-store",
    credentials: "omit",
    redirect: "error",
    referrerPolicy: "no-referrer",
  });
  expect(pulls).toBe(0);
  await expect(new Response(blob?.encryptedBytes).text()).resolves.toBe(
    "bytes",
  );
  expect(pulls).toBe(1);
});

test("body interruption propagates without silently restarting the stream", async () => {
  let fetches = 0;
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        controller.error(
          new Error(
            "Network failure: https://storage.test/object?signature=secret",
          ),
        );
      },
    },
    { highWaterMark: 0 },
  );
  const blob = await getBlobBytes(transport(), blobId, async () => {
    fetches += 1;
    return new Response(stream);
  });
  await expect(new Response(blob?.encryptedBytes).text()).rejects.toThrow(
    "Blob download interrupted",
  );
  expect(fetches).toBe(1);
});

test("cancelling a signed download cancels storage and redacts native errors", async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    cancel() {
      cancelled = true;
      throw new Error("https://storage.test/object?signature=secret");
    },
  });
  const blob = await getBlobBytes(
    transport(),
    blobId,
    async () => new Response(stream),
  );
  expect(blob).not.toBeNull();
  await expect(blob?.encryptedBytes.cancel()).rejects.toThrow(
    "Blob download cancellation failed",
  );
  expect(cancelled).toBe(true);
});
