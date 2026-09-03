import { afterAll, beforeAll, expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  attachmentBindings,
  blobs,
  containers,
} from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import { authenticate } from "../../../test/helpers/authenticate";
import { uploadBlobObject } from "../../../test/helpers/blobObjectStore";
import { createCurrentDocumentProjection } from "../../../test/helpers/currentProtocolProjection";
import { registerUser } from "../../../test/helpers/registerUser";
import { del } from "../../adapters/redis";
import { routeApp } from "../../routeApp";
import { getDefaultApiServiceRuntime } from "../../services/runtime";

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
    signerPrivateKey: alice.signing.signingPrivateKey,
    signerUserId: alice.userId,
  });
}

test("GET /blobs/:blobId/bytes streams committed encrypted blob bytes", async () => {
  const createdDocument = await createAliceDocumentFixture();
  const documentId = String(createdDocument.id ?? "");
  const stagedBlobInput = await createStagedBlobInput("streamed-image-bytes");
  const storageKey = `blob-stages/${crypto.randomUUID()}`;
  await uploadBlobObject(
    getDefaultApiServiceRuntime().blobObjectStore,
    storageKey,
    stagedBlobInput.encryptedBytes,
  );

  const [blob] = await db
    .insert(blobs)
    .values({
      byteLength: stagedBlobInput.byteLength,
      sha256: stagedBlobInput.sha256,
      storageKey,
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
  expect(blobResponse.headers.get("content-length")).toBe(
    stagedBlobInput.byteLength.toString(),
  );
  expect(blobResponse.headers.get("x-tearleads-blob-byte-length")).toBe(
    stagedBlobInput.byteLength.toString(),
  );
  expect(blobResponse.headers.get("x-tearleads-blob-id")).toBe(blob.id);
  expect(blobResponse.headers.get("x-tearleads-blob-sha256")).toBe(
    stagedBlobInput.sha256,
  );
  const exposedHeaders =
    blobResponse.headers.get("access-control-expose-headers")?.toLowerCase() ??
    "";
  expect(exposedHeaders).toContain("x-tearleads-blob-byte-length");
  expect(exposedHeaders).toContain("x-tearleads-blob-sha256");
  expect(await blobResponse.text()).toBe(stagedBlobInput.encryptedBytes);
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
