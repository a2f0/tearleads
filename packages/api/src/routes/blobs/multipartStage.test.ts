import { expect, test } from "bun:test";
import { createMiddleware } from "hono/factory";
import { createServiceTestRuntime } from "../../../test/helpers/serviceRuntime";
import type { SessionEnv } from "../../middleware/session";
import { createRouteApp } from "../../routeApp";
import type { ApiServiceRuntime } from "../../services/runtime";
import { sha256Hex } from "../../utils/sha256";

function createAuthenticatedTestApp(
  userId: string,
  runtime: ApiServiceRuntime = createServiceTestRuntime(),
) {
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
    runtime,
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
    `/blobs/stages/multipart/${initiated.stageId}/parts/1/bytes`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-SymCrypt-Blob-Part-Byte-Length": "route-multipart".length.toString(),
        "X-SymCrypt-Blob-Part-Sha256": await sha256Hex("route-multipart"),
        "X-SymCrypt-Blob-Upload-Id": initiated.uploadId,
      },
      body: "route-multipart",
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
        "X-SymCrypt-Blob-Part-Byte-Length": new TextEncoder()
          .encode("-encrypted-bytes")
          .byteLength.toString(),
        "X-SymCrypt-Blob-Part-Sha256": await sha256Hex("-encrypted-bytes"),
        "X-SymCrypt-Blob-Upload-Id": initiated.uploadId,
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

test("multipart part routes reject a part declared above the size ceiling", async () => {
  // An over-declared byte length is rejected on the header, before the body is
  // buffered, so an absurd Content-Length cannot force an allocation. The store
  // is never reached; a stage need not exist.
  const app = createAuthenticatedTestApp(crypto.randomUUID());
  const response = await app.request(
    `/blobs/stages/multipart/${crypto.randomUUID()}/parts/1/bytes`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-SymCrypt-Blob-Part-Byte-Length": (100 * 1024 * 1024 + 1).toString(),
        "X-SymCrypt-Blob-Part-Sha256": await sha256Hex("part-bytes"),
        "X-SymCrypt-Blob-Upload-Id": crypto.randomUUID(),
      },
      body: "part-bytes",
    },
  );

  expect(response.status).toBe(400);
  await expect(response.json()).resolves.toEqual({ error: "Invalid request" });
});

test("multipart part routes reject unsafe integer part numbers", async () => {
  const app = createAuthenticatedTestApp(crypto.randomUUID());
  const response = await app.request(
    `/blobs/stages/multipart/${crypto.randomUUID()}/parts/9007199254740993/bytes`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-SymCrypt-Blob-Part-Byte-Length": "10",
        "X-SymCrypt-Blob-Part-Sha256": await sha256Hex("part-bytes"),
        "X-SymCrypt-Blob-Upload-Id": crypto.randomUUID(),
      },
      body: "part-bytes",
    },
  );

  expect(response.status).toBe(400);
  await expect(response.json()).resolves.toEqual({ error: "Invalid request" });
});
