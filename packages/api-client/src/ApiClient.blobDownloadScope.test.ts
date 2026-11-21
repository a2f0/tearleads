import { expect } from "bun:test";
import { HttpResponse, http } from "msw";
import {
  apiBaseUrl,
  createDeferred,
  server,
  testApiClient,
} from "../test/helpers/apiClientTestHarness";
import { ApiClient } from "./ApiClient";

const blobId = "44444444-4444-4444-8444-444444444444";
const downloadPath = `${apiBaseUrl}/blobs/${blobId}/download`;
const storageUrl = "https://storage.test/scoped-object?signature=secret";
const encoder = new TextEncoder();

function descriptor(source: "signed-url" | "api") {
  return {
    blobId,
    byteLength: 10,
    sha256: "b".repeat(64),
    source:
      source === "api"
        ? { kind: "api" }
        : {
            kind: "signed-url",
            url: storageUrl,
            expiresAt: "2026-01-01T00:00:00.000Z",
          },
  };
}

/** A host can retire a caller by switching organization or by signing in again. */
const retirements = {
  "organization change": (scope: { current: boolean }) => {
    scope.current = false;
  },
  "independent sign-in": (_scope: { current: boolean }, client: ApiClient) => {
    client.setAuthToken("identity-b", { boundary: "replacement" });
  },
} as const;

/** Two five-byte chunks; the second waits until the test releases it. */
function gatedBody(secondChunk: Promise<void>) {
  const state = { cancelled: false, served: 0 };
  const stream = new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        if (state.served === 1) await secondChunk;
        if (state.cancelled) return;
        state.served += 1;
        controller.enqueue(
          encoder.encode(state.served === 1 ? "first" : "later"),
        );
        if (state.served === 2) controller.close();
      },
      cancel() {
        state.cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  return { state, stream };
}

async function readDelivered(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return { bytes, failed: false };
      bytes += value.byteLength;
    }
  } catch {
    return { bytes, failed: true };
  }
}

for (const [name, retire] of Object.entries(retirements)) {
  testApiClient(
    `a signed download answered after its caller retired returns no stream (${name})`,
    async () => {
      const entered = createDeferred<void>();
      const release = createDeferred<void>();
      let storageRequests = 0;
      server.use(
        http.get(downloadPath, () =>
          HttpResponse.json(descriptor("signed-url")),
        ),
        http.get("https://storage.test/scoped-object", async () => {
          storageRequests += 1;
          entered.resolve();
          await release.promise;
          return HttpResponse.text("firstlater");
        }),
      );
      const client = new ApiClient(apiBaseUrl);
      client.setAuthToken("identity-a");
      const scope = { current: true };
      const pending = client.getBlobBytes(blobId, {
        stillCurrent: () => scope.current,
      });
      await entered.promise;
      retire(scope, client);
      release.resolve();
      expect(await pending).toBeNull();
      expect(storageRequests).toBe(1);
    },
  );

  for (const source of ["signed-url", "api"] as const) {
    testApiClient(
      `a ${source} download stream delivers no chunk after its caller retires (${name})`,
      async () => {
        const second = createDeferred<void>();
        const body = gatedBody(second.promise);
        server.use(
          http.get(downloadPath, () => HttpResponse.json(descriptor(source))),
          http.get(
            "https://storage.test/scoped-object",
            () => new HttpResponse(body.stream),
          ),
          http.get(
            `${apiBaseUrl}/blobs/${blobId}/bytes`,
            () =>
              new HttpResponse(body.stream, {
                headers: {
                  "Content-Type": "application/octet-stream",
                  "X-Tearleads-Blob-Id": blobId,
                  "X-Tearleads-Blob-Byte-Length": "10",
                  "X-Tearleads-Blob-Sha256": "b".repeat(64),
                },
              }),
          ),
        );
        const client = new ApiClient(apiBaseUrl);
        client.setAuthToken("identity-a");
        const scope = { current: true };
        const blob = await client.getBlobBytes(blobId, {
          stillCurrent: () => scope.current,
        });
        if (!blob) throw new Error("expected a stream");
        const reader = blob.encryptedBytes.getReader();
        const first = await reader.read();
        expect(first.value?.byteLength).toBe(5);
        retire(scope, client);
        second.resolve();
        reader.releaseLock();
        expect(await readDelivered(blob.encryptedBytes)).toEqual({
          bytes: 0,
          failed: true,
        });
      },
    );
  }
}
