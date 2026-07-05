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

test("blob upload capabilities report durable multipart only for S3 storage", async () => {
  const userId = crypto.randomUUID();
  const memoryResponse = await createAuthenticatedTestApp(userId).request(
    "/blobs/uploads/capabilities",
  );
  expect(memoryResponse.status).toBe(200);
  await expect(memoryResponse.json()).resolves.toEqual({
    multipart: { durable: false, enabled: false },
  });

  const s3Runtime = {
    ...createServiceTestRuntime(),
    blobObjectStoreKind: "s3" as const,
  };
  const s3Response = await createAuthenticatedTestApp(
    userId,
    s3Runtime,
  ).request("/blobs/uploads/capabilities");
  expect(s3Response.status).toBe(200);
  await expect(s3Response.json()).resolves.toEqual({
    multipart: { durable: true, enabled: true },
  });
});

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

test("multipart part routes reject unsafe integer part numbers", async () => {
  const app = createAuthenticatedTestApp(crypto.randomUUID());
  const response = await app.request(
    `/blobs/stages/multipart/${crypto.randomUUID()}/parts/9007199254740993`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        encryptedBytes: "part-bytes",
        uploadId: crypto.randomUUID(),
      }),
    },
  );

  expect(response.status).toBe(400);
  await expect(response.json()).resolves.toEqual({ error: "Invalid request" });
});
