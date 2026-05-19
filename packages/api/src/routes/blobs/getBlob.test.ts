import { afterAll, beforeAll, expect, test } from "bun:test";
import { createTestUser } from "@tearleads/bob-and-alice";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import { authenticate } from "../../../test/helpers/authenticate";
import { createCurrentDocumentProjection } from "../../../test/helpers/currentProtocolProjection";
import { registerUser } from "../../../test/helpers/registerUser";
import { db } from "../../adapters/postgres";
import { del } from "../../adapters/redis";
import { routeApp } from "../../routeApp";
import { attachmentBindings, blobs, containers } from "../../schema";

const alice = createTestUser();

beforeAll(async () => {
  await registerUser(alice);
  await authenticate(alice);
});

afterAll(async () => {
  await del(alice.fingerprint);
});

async function createStagedBlobInput(encryptedBytes: string) {
  const encodedBytes = new TextEncoder().encode(encryptedBytes);
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", encodedBytes),
  );

  return {
    encryptedBytes,
    byteLength: encodedBytes.byteLength,
    sha256: Array.from(digest, (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join(""),
  };
}

async function createAliceDocumentFixture() {
  const [container] = await db
    .select({ organizationId: containers.organizationId })
    .from(containers)
    .where(eq(containers.id, alice.rootContainerId))
    .limit(1);
  invariant(container, "expected Alice root container");

  return createCurrentDocumentProjection({
    containerIds: [alice.rootContainerId],
    createdByFingerprint: alice.fingerprint,
    organizationId: container.organizationId,
  });
}

test("GET /blobs/:blobId returns committed encrypted blob bytes for readable blobs", async () => {
  const createdDocument = await createAliceDocumentFixture();
  const documentId = String(createdDocument.id ?? "");
  const stagedBlobInput = await createStagedBlobInput("encrypted-image-bytes");

  const [blob] = await db
    .insert(blobs)
    .values({
      byteLength: stagedBlobInput.byteLength,
      encryptedBytes: stagedBlobInput.encryptedBytes,
      sha256: stagedBlobInput.sha256,
      storageKey: crypto.randomUUID(),
    })
    .returning({ id: blobs.id });
  invariant(blob, "expected blob row");
  await db.insert(attachmentBindings).values({
    blobId: blob.id,
    documentId,
    slotId: "slot_image",
  });

  const blobResponse = await routeApp.request(`/blobs/${blob.id}`, {
    headers: {
      Authorization: `Bearer ${alice.token}`,
    },
    method: "GET",
  });

  expect(blobResponse.status).toBe(200);
  expect(await blobResponse.json()).toEqual({
    blobId: blob.id,
    encryptedBytes: stagedBlobInput.encryptedBytes,
    sha256: stagedBlobInput.sha256,
  });
});

test("GET /blobs/:blobId/bytes streams committed encrypted blob bytes", async () => {
  const createdDocument = await createAliceDocumentFixture();
  const documentId = String(createdDocument.id ?? "");
  const stagedBlobInput = await createStagedBlobInput("streamed-image-bytes");

  const [blob] = await db
    .insert(blobs)
    .values({
      byteLength: stagedBlobInput.byteLength,
      encryptedBytes: stagedBlobInput.encryptedBytes,
      sha256: stagedBlobInput.sha256,
      storageKey: crypto.randomUUID(),
    })
    .returning({ id: blobs.id });
  invariant(blob, "expected blob row");
  await db.insert(attachmentBindings).values({
    blobId: blob.id,
    documentId,
    slotId: "slot_streamed_image",
  });

  const blobResponse = await routeApp.request(`/blobs/${blob.id}/bytes`, {
    headers: {
      Authorization: `Bearer ${alice.token}`,
    },
    method: "GET",
  });

  expect(blobResponse.status).toBe(200);
  expect(blobResponse.headers.get("content-type")).toBe(
    "application/octet-stream",
  );
  expect(blobResponse.headers.get("x-tearleads-blob-id")).toBe(blob.id);
  expect(blobResponse.headers.get("x-tearleads-blob-sha256")).toBe(
    stagedBlobInput.sha256,
  );
  expect(blobResponse.headers.get("access-control-expose-headers")).toContain(
    "X-Tearleads-Blob-Sha256",
  );
  expect(await blobResponse.text()).toBe(stagedBlobInput.encryptedBytes);
});

test("GET /blobs/:blobId rejects malformed blob ids", async () => {
  const blobResponse = await routeApp.request("/blobs/not-a-uuid", {
    headers: {
      Authorization: `Bearer ${alice.token}`,
    },
    method: "GET",
  });

  expect(blobResponse.status).toBe(400);
  expect(await blobResponse.json()).toEqual({
    error: "Invalid request",
  });
});

test("GET /blobs/:blobId/bytes rejects malformed blob ids", async () => {
  const blobResponse = await routeApp.request("/blobs/not-a-uuid/bytes", {
    headers: {
      Authorization: `Bearer ${alice.token}`,
    },
    method: "GET",
  });

  expect(blobResponse.status).toBe(400);
  expect(await blobResponse.json()).toEqual({
    error: "Invalid request",
  });
});
