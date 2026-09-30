import { expect, spyOn, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  accessEvents,
  accessManifests,
  accessManifestVerifications,
} from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
import * as crypto from "@tearleads/crypto";
import { eq } from "drizzle-orm";
import { authenticate } from "../../../test/helpers/authenticate";
import {
  bootstrapRoot,
  createDocument,
  createDocumentRequest,
} from "../../../test/helpers/keyingWriterProjectionKit";
import { registerUser } from "../../../test/helpers/registerUser";
import { routeApp } from "../../routeApp";
import { clearProcessVerificationMarkers } from "../../workflows/containers/writerProjection/verificationMarkers";
import * as markStoredDocument from "../../workflows/documents/markStoredDocumentManifest";
import { deleteDocumentRows } from "../../workflows/documents/mutations/purgeDocumentRows";
import { StoredDocumentManifestError } from "../../workflows/documents/storedDocumentManifestVerification";

async function setup() {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const created = await createDocument({ owner, root });
  return { created, owner, root };
}

async function readMarker(manifestHash: string): Promise<string | null> {
  const [row] = await db
    .select({ mac: accessManifestVerifications.mac })
    .from(accessManifestVerifications)
    .where(eq(accessManifestVerifications.manifestHash, manifestHash));
  return row?.mac ?? null;
}

async function projectionSignatureChecks(
  documentId: string,
  token: string,
): Promise<{ readonly checks: number; readonly status: number }> {
  const verify = spyOn(crypto, "verifySignedAccessEvent");
  try {
    const response = await routeApp.request(
      `/documents/${documentId}/writer-projection`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    return { checks: verify.mock.calls.length, status: response.status };
  } finally {
    verify.mockRestore();
  }
}

test("a document create marks the manifest it stores", async () => {
  const { created, owner } = await setup();
  expect(await readMarker(created.accessManifest.manifestHash)).not.toBeNull();
  // The first read writes back markers for the unmarked provisioned root.
  expect(
    (await projectionSignatureChecks(created.id, owner.token)).status,
  ).toBe(200);
  expect(await projectionSignatureChecks(created.id, owner.token)).toEqual({
    checks: 0,
    status: 200,
  });
});

test("a forged document marker is ignored and replaced", async () => {
  const { created, owner } = await setup();
  const manifestHash = created.accessManifest.manifestHash;
  const genuine = await readMarker(manifestHash);
  await projectionSignatureChecks(created.id, owner.token);
  await db
    .update(accessManifestVerifications)
    .set({ mac: Buffer.alloc(32).toString("base64") })
    .where(eq(accessManifestVerifications.manifestHash, manifestHash));
  // Another process has only the table: the document manifest is unmarked
  // there, so exactly its event verifies.
  clearProcessVerificationMarkers();
  expect(await projectionSignatureChecks(created.id, owner.token)).toEqual({
    checks: 1,
    status: 200,
  });
  expect(await readMarker(manifestHash)).toBe(genuine);
});

test("a marked document row edited in place is refused", async () => {
  const { created, owner } = await setup();
  await projectionSignatureChecks(created.id, owner.token);
  await db
    .update(accessEvents)
    .set({ signature: "tampered-signature" })
    .where(eq(accessEvents.eventHash, created.accessManifest.event.eventHash));
  expect(
    (await projectionSignatureChecks(created.id, owner.token)).status,
  ).toBe(409);
});

test("marking refuses a hash that is not a stored document manifest", async () => {
  const { root } = await setup();
  await expect(
    markStoredDocument.markStoredDocumentManifest(db, root.bundle.manifestHash),
  ).rejects.toMatchObject({ status: 409 });
});

test("deleting a document's history deletes its markers", async () => {
  const { created } = await setup();
  const manifestHash = created.accessManifest.manifestHash;
  expect(await readMarker(manifestHash)).not.toBeNull();
  // A signed purge keeps its history for purge proofs; container deletion
  // and organization purge remove a document's history outright.
  await db.transaction((executor) =>
    deleteDocumentRows({
      documentId: created.id,
      executor,
      orphanedBlobIds: [],
      retainAccessHistory: false,
    }),
  );
  expect(
    await db
      .select()
      .from(accessManifests)
      .where(eq(accessManifests.manifestHash, manifestHash)),
  ).toEqual([]);
  expect(await readMarker(manifestHash)).toBeNull();
});

test("a refused write-time document mark rejects the create with a conflict", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const mark = spyOn(
    markStoredDocument,
    "markStoredDocumentManifest",
  ).mockRejectedValue(new StoredDocumentManifestError("test"));
  try {
    const response = await routeApp.request("/documents", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(await createDocumentRequest({ owner, root })),
    });
    expect(response.status).toBe(409);
    expect(mark).toHaveBeenCalledTimes(1);
  } finally {
    mark.mockRestore();
  }
});
