import { expect, mock, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { attachmentBindings, blobs } from "@tearleads/api-shared/schema";
import { BlobDownloadResponseSchema } from "@tearleads/validators/operation";
import { eq } from "drizzle-orm";
import { authenticate } from "../../../test/helpers/authenticate";
import { createCurrentDocumentProjection } from "../../../test/helpers/currentProtocolProjection";
import { registerServiceUser } from "../../../test/helpers/registerServiceUser";
import { createServiceTestRuntime } from "../../../test/helpers/serviceRuntime";
import { requireAuth } from "../../middleware/session";
import { createGetBlobDownloadRoute } from "./getBlobDownload";

async function registerAuthenticatedUser() {
  const registered = await registerServiceUser();
  registered.user.fingerprint = registered.fingerprint;
  registered.user.userId = registered.registration.userId;
  await authenticate(registered.user);
  return registered;
}

async function fixture() {
  const owner = await registerAuthenticatedUser();
  const document = await createCurrentDocumentProjection({
    containerIds: [owner.registration.rootContainerId],
    createdByFingerprint: owner.fingerprint,
    organizationId: owner.registration.organizationId,
    signerPrivateKey: owner.user.signing.signingPrivateKey,
    signerUserId: owner.registration.userId,
  });
  const storageKey = `organizations/${owner.registration.organizationId}/blob-stages/${crypto.randomUUID()}`;
  const [blob] = await db
    .insert(blobs)
    .values({ byteLength: 5, sha256: "a".repeat(64), storageKey })
    .returning({ id: blobs.id });
  if (!blob) throw new Error("Missing fixture blob");
  await db
    .insert(attachmentBindings)
    .values({ blobId: blob.id, documentId: document.id, slotId: "download" });
  const createDownloadUrl = mock(
    async (_input: { key: string; expiresIn: number }) => ({
      url: "https://storage.test/blob?signature=secret",
      expiresAt: "2026-10-13T12:05:00.000Z",
    }),
  );
  const runtime = createServiceTestRuntime();
  const getObjectStream = mock(runtime.blobObjectStore.getObjectStream);
  runtime.blobObjectStore = {
    ...runtime.blobObjectStore,
    createDownloadUrl,
    getObjectStream,
  };
  const route = createGetBlobDownloadRoute({ requireAuth, runtime });
  const headers = { Authorization: `Bearer ${owner.user.token}` };
  return {
    blob,
    createDownloadUrl,
    getObjectStream,
    headers,
    owner,
    route,
    runtime,
    storageKey,
  };
}

test("GET download signs authorized metadata without reading object bytes", async () => {
  const f = await fixture();
  const response = await f.route.request(`/blobs/${f.blob.id}/download`, {
    headers: f.headers,
  });
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(BlobDownloadResponseSchema.parse(await response.json())).toEqual({
    blobId: f.blob.id,
    byteLength: 5,
    sha256: "a".repeat(64),
    source: {
      kind: "signed-url",
      url: "https://storage.test/blob?signature=secret",
      expiresAt: "2026-10-13T12:05:00.000Z",
    },
  });
  expect(f.createDownloadUrl).toHaveBeenCalledWith({
    key: f.storageKey,
    expiresIn: 300,
  });
  expect(f.getObjectStream).not.toHaveBeenCalled();
});

test("GET download refuses missing, foreign, and detached blobs before signing", async () => {
  const f = await fixture();
  const other = await registerAuthenticatedUser();
  expect(
    (
      await f.route.request(`/blobs/${f.blob.id}/download`, {
        headers: { Authorization: `Bearer ${other.user.token}` },
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await f.route.request(`/blobs/${crypto.randomUUID()}/download`, {
        headers: f.headers,
      })
    ).status,
  ).toBe(404);
  await db
    .update(attachmentBindings)
    .set({ detachedAt: new Date() })
    .where(eq(attachmentBindings.blobId, f.blob.id));
  expect(
    (
      await f.route.request(`/blobs/${f.blob.id}/download`, {
        headers: f.headers,
      })
    ).status,
  ).toBe(404);
  expect(f.createDownloadUrl).not.toHaveBeenCalled();
});

test("GET download authenticates before validation and keeps memory storage available", async () => {
  const f = await fixture();
  expect((await f.route.request("/blobs/invalid/download")).status).toBe(401);
  expect(
    (await f.route.request("/blobs/invalid/download", { headers: f.headers }))
      .status,
  ).toBe(400);
  expect(f.createDownloadUrl).not.toHaveBeenCalled();
  const memoryRoute = createGetBlobDownloadRoute({
    requireAuth,
    runtime: createServiceTestRuntime(),
  });
  const response = await memoryRoute.request(`/blobs/${f.blob.id}/download`, {
    headers: f.headers,
  });
  expect(response.status).toBe(200);
  expect(
    BlobDownloadResponseSchema.parse(await response.json()).source,
  ).toEqual({ kind: "api" });
});
