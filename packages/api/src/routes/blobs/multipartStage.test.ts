import { expect, mock, test } from "bun:test";
import { blobStages, organizationBilling } from "@tearleads/api-shared/schema";
import { MULTIPART_BLOB_STAGE_ERROR_CODES } from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import {
  blobObjectBytes,
  uploadBlobObject,
} from "../../../test/helpers/blobObjectStore";
import { createBlobStageOwner } from "../../../test/helpers/blobStageOwner";
import { createServiceTestRuntime } from "../../../test/helpers/serviceRuntime";
import type { SessionEnv } from "../../middleware/session";
import { createRouteApp } from "../../routeApp";
import {
  completeMultipartBlobStage,
  initiateMultipartBlobStage,
  uploadMultipartBlobPartBytes,
} from "../../services/blobs/multipartStage";
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

test.each([
  "not-a-uuid",
  "FD48148F-2BB0-420D-925A-7007D5C1C40F",
  "fd48148f-2bb0-120d-925a-7007d5c1c40f",
])("multipart initiation rejects invalid organization ID %s", async (organizationId) => {
  const app = createAuthenticatedTestApp(crypto.randomUUID());
  const response = await app.request("/blobs/stages/multipart", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ organizationId, byteLength: 1, sha256: "sha256" }),
  });
  expect(response.status).toBe(400);
  await expect(response.json()).resolves.toEqual({ error: "Invalid request" });
});

test("multipart initiation conceals unknown and inaccessible organizations", async () => {
  const owner = await createBlobStageOwner();
  const runtime = createServiceTestRuntime();
  const createUpload = mock(runtime.blobObjectStore.createMultipartUpload);
  runtime.blobObjectStore = {
    ...runtime.blobObjectStore,
    createMultipartUpload: createUpload,
  };
  const app = createAuthenticatedTestApp(crypto.randomUUID(), runtime);
  for (const organizationId of [owner.organizationId, crypto.randomUUID()]) {
    const response = await app.request("/blobs/stages/multipart", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId, byteLength: 1, sha256: "sha256" }),
    });
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Organization access denied",
    });
  }
  expect(createUpload).not.toHaveBeenCalled();
});

test("multipart initiation rejects an organization being purged", async () => {
  const { userId, organizationId } = await createBlobStageOwner();
  const runtime = createServiceTestRuntime();
  await runtime.db
    .update(organizationBilling)
    .set({ status: "deleting" })
    .where(eq(organizationBilling.organizationId, organizationId));
  const app = createAuthenticatedTestApp(userId, runtime);
  const response = await app.request("/blobs/stages/multipart", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ organizationId, byteLength: 1, sha256: "sha256" }),
  });
  expect(response.status).toBe(409);
  await expect(response.json()).resolves.toEqual({
    error: "Organization is being purged",
  });
});

test("multipart blob stage routes support resumable upload completion", async () => {
  const encryptedBytes = "route-multipart-encrypted-bytes";
  const runtime = createServiceTestRuntime();
  const { userId, organizationId } = await createBlobStageOwner();
  const app = createAuthenticatedTestApp(userId, runtime);
  const initiateResponse = await app.request("/blobs/stages/multipart", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      organizationId,
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
        "X-Tearleads-Blob-Part-Byte-Length":
          "route-multipart".length.toString(),
        "X-Tearleads-Blob-Part-Sha256": await sha256Hex("route-multipart"),
        "X-Tearleads-Blob-Upload-Id": initiated.uploadId,
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

  // Simulate S3 consuming the upload before the completedAt update commits.
  // Status must validate the assembled object and converge the database row,
  // not tell the client to abandon valid staged bytes.
  await runtime.db
    .update(blobStages)
    .set({ completedAt: null })
    .where(eq(blobStages.id, initiated.stageId));
  const completedStatusResponse = await app.request(
    `/blobs/stages/multipart/${initiated.stageId}`,
  );
  expect(completedStatusResponse.status).toBe(200);
  await expect(completedStatusResponse.json()).resolves.toMatchObject({
    completed: true,
    uploadedParts: [],
  });
  const [recoveredStage] = await runtime.db
    .select({ completedAt: blobStages.completedAt })
    .from(blobStages)
    .where(eq(blobStages.id, initiated.stageId));
  expect(recoveredStage?.completedAt).not.toBeNull();

  await runtime.blobObjectStore.deleteObject(
    `organizations/${organizationId}/blob-stages/${initiated.stageId}`,
  );
  const missingObjectResponse = await app.request(
    `/blobs/stages/multipart/${initiated.stageId}`,
  );
  expect(missingObjectResponse.status).toBe(404);
  await expect(missingObjectResponse.json()).resolves.toEqual({
    code: MULTIPART_BLOB_STAGE_ERROR_CODES.notFound,
    error: "Completed multipart object not found",
  });
});

test("multipart status identifies replaceable missing and expired stages", async () => {
  const { userId, organizationId } = await createBlobStageOwner();
  const runtime = createServiceTestRuntime();
  const app = createAuthenticatedTestApp(userId, runtime);
  const initiateStage = async (sha256: string) => {
    const response = await app.request("/blobs/stages/multipart", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId, byteLength: 12, sha256 }),
    });
    expect(response.status).toBe(200);
    return response.json();
  };

  const missingResponse = await app.request(
    `/blobs/stages/multipart/${crypto.randomUUID()}`,
  );
  expect(missingResponse.status).toBe(404);
  await expect(missingResponse.json()).resolves.toEqual({
    code: MULTIPART_BLOB_STAGE_ERROR_CODES.notFound,
    error: "Blob stage not found",
  });

  const orphaned = await initiateStage("orphaned-stage-sha256");
  await runtime.blobObjectStore.abortMultipartUpload({
    key: `organizations/${organizationId}/blob-stages/${orphaned.stageId}`,
    uploadId: orphaned.uploadId,
  });
  const orphanedResponse = await app.request(
    `/blobs/stages/multipart/${orphaned.stageId}`,
  );
  expect(orphanedResponse.status).toBe(404);
  await expect(orphanedResponse.json()).resolves.toEqual({
    code: MULTIPART_BLOB_STAGE_ERROR_CODES.notFound,
    error: "Multipart upload not found",
  });

  const expired = await initiateStage("expired-stage-sha256");
  await runtime.db
    .update(blobStages)
    .set({ expiresAt: new Date("2000-01-01T00:00:00.000Z") })
    .where(eq(blobStages.id, expired.stageId));

  const expiredResponse = await app.request(
    `/blobs/stages/multipart/${expired.stageId}`,
  );
  expect(expiredResponse.status).toBe(409);
  await expect(expiredResponse.json()).resolves.toEqual({
    code: MULTIPART_BLOB_STAGE_ERROR_CODES.expired,
    error: "Blob stage has expired",
  });
});

test("multipart status keeps recovered object corruption terminal", async () => {
  const runtime = createServiceTestRuntime();
  const { userId, organizationId } = await createBlobStageOwner();
  const app = createAuthenticatedTestApp(userId, runtime);
  const encryptedBytes = "expected-object";
  const initiated = await initiateMultipartBlobStage(runtime, {
    organizationId,
    byteLength: encryptedBytes.length,
    sha256: await sha256Hex(encryptedBytes),
    userId,
  });
  const part = await uploadMultipartBlobPartBytes(runtime, {
    byteLength: encryptedBytes.length,
    bytes: blobObjectBytes(encryptedBytes),
    partNumber: 1,
    sha256: await sha256Hex(encryptedBytes),
    stageId: initiated.stageId,
    uploadId: initiated.uploadId,
    userId,
  });
  await completeMultipartBlobStage(runtime, {
    parts: [{ etag: part.part.etag, partNumber: 1 }],
    stageId: initiated.stageId,
    uploadId: initiated.uploadId,
    userId,
  });
  await uploadBlobObject(
    runtime.blobObjectStore,
    `organizations/${organizationId}/blob-stages/${initiated.stageId}`,
    "tampered-object",
  );
  await runtime.db
    .update(blobStages)
    .set({ completedAt: null })
    .where(eq(blobStages.id, initiated.stageId));

  const response = await app.request(
    `/blobs/stages/multipart/${initiated.stageId}`,
  );
  expect(response.status).toBe(409);
  await expect(response.json()).resolves.toEqual({
    error: "Blob sha256 does not match multipart upload",
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
        "X-Tearleads-Blob-Part-Byte-Length": (100 * 1024 * 1024 + 1).toString(),
        "X-Tearleads-Blob-Part-Sha256": await sha256Hex("part-bytes"),
        "X-Tearleads-Blob-Upload-Id": crypto.randomUUID(),
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
        "X-Tearleads-Blob-Part-Byte-Length": "10",
        "X-Tearleads-Blob-Part-Sha256": await sha256Hex("part-bytes"),
        "X-Tearleads-Blob-Upload-Id": crypto.randomUUID(),
      },
      body: "part-bytes",
    },
  );

  expect(response.status).toBe(400);
  await expect(response.json()).resolves.toEqual({ error: "Invalid request" });
});
