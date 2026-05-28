import { expect, test } from "bun:test";
import { createMiddleware } from "hono/factory";
import { createServiceTestRuntime } from "../../../test/helpers/serviceRuntime";
import type { SessionEnv } from "../../middleware/session";
import { createRouteApp } from "../../routeApp";
import { sha256Hex } from "../../utils/sha256";

function createAuthenticatedTestApp(userId: string) {
  return createRouteApp({
    requireAuth: createMiddleware<SessionEnv>(async (c, next) => {
      c.set("session", {
        createdAt: Date.now(),
        fingerprint: "test-fingerprint",
        id: "test-session",
        ipAddresses: [],
        lastActiveAt: Date.now(),
        lastActiveIp: null,
        userId,
      });
      return next();
    }),
    runtime: createServiceTestRuntime(),
  });
}

test("multipart blob stage routes support resumable upload completion", async () => {
  const encryptedBytes = "route-multipart-encrypted-bytes";
  const app = createAuthenticatedTestApp(crypto.randomUUID());
  const initiateResponse = await app.request("/blobs/stages/multipart", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      byteLength: new TextEncoder().encode(encryptedBytes).byteLength,
      sha256: await sha256Hex(encryptedBytes),
    }),
  });

  expect(initiateResponse.status).toBe(200);
  const initiated = await initiateResponse.json();

  const firstPartResponse = await app.request(
    `/blobs/stages/multipart/${initiated.stageId}/parts/1`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        encryptedBytes: "route-multipart",
        uploadId: initiated.uploadId,
      }),
    },
  );
  expect(firstPartResponse.status).toBe(200);
  const firstPart = await firstPartResponse.json();

  const statusResponse = await app.request(
    `/blobs/stages/multipart/${initiated.stageId}`,
  );
  expect(statusResponse.status).toBe(200);
  await expect(statusResponse.json()).resolves.toMatchObject({
    completed: false,
    uploadedParts: [firstPart.part],
  });

  const secondPartResponse = await app.request(
    `/blobs/stages/multipart/${initiated.stageId}/parts/2/bytes`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-Tearleads-Blob-Part-Byte-Length": new TextEncoder()
          .encode("-encrypted-bytes")
          .byteLength.toString(),
        "X-Tearleads-Blob-Part-Sha256": await sha256Hex("-encrypted-bytes"),
        "X-Tearleads-Blob-Upload-Id": initiated.uploadId,
      },
      body: "-encrypted-bytes",
    },
  );
  expect(secondPartResponse.status).toBe(200);
  const secondPart = await secondPartResponse.json();

  const completeResponse = await app.request(
    `/blobs/stages/multipart/${initiated.stageId}/complete`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        parts: [
          { etag: firstPart.part.etag, partNumber: 1 },
          { etag: secondPart.part.etag, partNumber: 2 },
        ],
        uploadId: initiated.uploadId,
      }),
    },
  );

  expect(completeResponse.status).toBe(200);
  await expect(completeResponse.json()).resolves.toMatchObject({
    byteLength: initiated.byteLength,
    sha256: initiated.sha256,
    stageId: initiated.stageId,
  });
});
