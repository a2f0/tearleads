import { expect, test } from "bun:test";
import { ApiClient } from "@tearleads/api-client";
import { createBlobAttachmentServiceFixture } from "../../../../test/helpers/workflows/blobAttachmentServiceFixture";
import {
  createSingleAttachmentHydrationApi,
  createUploadedAttachmentFixture,
} from "../../../../test/helpers/workflows/blobHydration";

/** Serves the ciphertext in two chunks; the second waits for the test. */
function serveTwoChunkBlob(input: {
  readonly blobId: string;
  readonly encrypted: Uint8Array<ArrayBuffer>;
  readonly sha256: string;
}) {
  const secondChunk = Promise.withResolvers<void>();
  const midpoint = Math.ceil(input.encrypted.byteLength / 2);
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const { pathname } = new URL(request.url);
      if (pathname === `/blobs/${input.blobId}/download`)
        return Response.json({
          blobId: input.blobId,
          byteLength: input.encrypted.byteLength,
          sha256: input.sha256,
          source: { kind: "api" },
        });
      if (pathname !== `/blobs/${input.blobId}/bytes`)
        return Response.json({ error: "Not found" }, { status: 404 });
      let served = 0;
      const body = new ReadableStream<Uint8Array>(
        {
          async pull(controller) {
            if (served === 0) {
              served = 1;
              controller.enqueue(input.encrypted.slice(0, midpoint));
              return;
            }
            await secondChunk.promise;
            controller.enqueue(input.encrypted.slice(midpoint));
            controller.close();
          },
        },
        { highWaterMark: 0 },
      );
      return new Response(body, {
        headers: {
          "Content-Type": "application/octet-stream",
          "X-Tearleads-Blob-Byte-Length": String(input.encrypted.byteLength),
          "X-Tearleads-Blob-Id": input.blobId,
          "X-Tearleads-Blob-Sha256": input.sha256,
        },
      });
    },
  });
  return {
    midpoint,
    origin: server.url.origin,
    releaseSecondChunk: () => secondChunk.resolve(),
    stop: () => server.stop(true),
  };
}

test("attachment hydration receives no more ciphertext once its caller retires", async () => {
  const fixture = await createUploadedAttachmentFixture();
  const encrypted = fixture.stagedBlob.encryptedBytes;
  const server = serveTwoChunkBlob({
    blobId: fixture.blobId,
    encrypted,
    sha256: fixture.stagedBlob.sha256,
  });
  const api = new ApiClient(server.origin);
  api.setAuthToken("identity-a");
  let delivered = 0;
  const firstChunkDelivered = Promise.withResolvers<void>();
  let current = true;
  try {
    const hydrating = createBlobAttachmentServiceFixture({
      api: createSingleAttachmentHydrationApi(fixture, async (id, options) => {
        const blob = await api.getBlobBytes(id, options);
        if (!blob) return null;
        // Count the bytes the transport hands to hydration.
        const counted = new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            delivered += chunk.byteLength;
            firstChunkDelivered.resolve();
            controller.enqueue(chunk);
          },
        });
        return {
          ...blob,
          encryptedBytes: blob.encryptedBytes.pipeThrough(counted),
        };
      }),
      encapsulationSecretKey: fixture.secretKey,
      execSql: fixture.execSql,
    })
      .hydrateDocumentAttachmentBlobs({
        attachments: [fixture.attachment],
        documentId: fixture.writerProjection.documentId,
        resolveProjectionUserKey: fixture.resolveProjectionUserKey,
        stillCurrent: () => current,
      })
      .catch(() => null);
    await firstChunkDelivered.promise;
    current = false;
    server.releaseSecondChunk();
    expect((await hydrating) ?? []).toEqual([]);
    // The second chunk arrives after the caller retired and is never handed on.
    expect(delivered).toBe(server.midpoint);
  } finally {
    server.stop();
    fixture.close();
  }
});
