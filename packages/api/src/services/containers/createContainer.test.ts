import { expect, test } from "bun:test";
import { toFingerprint, wrapDekForRecipients } from "@tearleads/crypto";
import type { PublicKeyRequest } from "@tearleads/validators/request";
import { eq } from "drizzle-orm";
import { createTestUser } from "../../../test/helpers/createTestUser";
import { db } from "../../adapters/postgres";
import { containerMetadataDocuments, containers } from "../../schema";
import { registerPublicKey } from "../auth/registerPublicKey";
import type { ApiServiceRuntime } from "../runtime";
import { createContainer } from "./createContainer";

function createTestRuntime(): ApiServiceRuntime {
  const values = new Map<string, string>();

  return {
    db,
    eventPublisher: {
      publish: async () => {},
    },
    keyValueStore: {
      del: async (key) => {
        values.delete(key);
      },
      get: async (key) => values.get(key) ?? null,
      set: async (key, value) => {
        values.set(key, value);
      },
    },
    principalSignerTrustStore: {
      getTrustedSignerPublicKey: async () => null,
    },
    sessionTokenIssuer: {
      createSession: async () => "test-session",
    },
  };
}

async function createPublicKeyRequest(
  user: ReturnType<typeof createTestUser>,
): Promise<PublicKeyRequest> {
  const dek = crypto.getRandomValues(new Uint8Array(32));
  const [wrappedDekEnvelope] = await wrapDekForRecipients(dek, [
    user.kem.publicKey,
  ]);

  if (!wrappedDekEnvelope) {
    throw new Error("Failed to wrap DEK for test user");
  }

  return {
    rootContainerId: crypto.randomUUID(),
    signingPublicKey: Array.from(user.signing.signingPublicKey),
    encapsulationPublicKey: Array.from(user.kem.publicKey),
    initialRootMetadataUpdates: [],
    wrappedDekEnvelope: {
      keyFingerprint: wrappedDekEnvelope.keyFingerprint,
      kemCipherText: Array.from(wrappedDekEnvelope.kemCipherText),
      wrappedKey: Array.from(wrappedDekEnvelope.wrappedKey),
    },
  };
}

test("createContainer service creates a metadata document without route helpers", async () => {
  const runtime = createTestRuntime();
  const user = createTestUser();
  const registration = await registerPublicKey(
    runtime,
    await createPublicKeyRequest(user),
  );
  const fingerprint = await toFingerprint(user.signing.signingPublicKey);
  const childId = crypto.randomUUID();

  const created = await createContainer(runtime, {
    id: childId,
    createdByFingerprint: fingerprint,
    initialMetadataUpdates: [],
    parentId: registration.rootContainerId,
    userId: registration.userId,
  });

  expect(created.id).toBe(childId);
  expect(created.parentId).toBe(registration.rootContainerId);
  expect(created.metadataAccessEpoch).toBe(1);
  expect(created.metadataRecipientEncapsulationPublicKeys).toHaveLength(1);

  const [container] = await db
    .select({
      id: containers.id,
      parentId: containers.parentId,
    })
    .from(containers)
    .where(eq(containers.id, childId))
    .limit(1);
  expect(container?.parentId).toBe(registration.rootContainerId);

  const [metadataDocument] = await db
    .select({
      containerId: containerMetadataDocuments.containerId,
      documentId: containerMetadataDocuments.documentId,
    })
    .from(containerMetadataDocuments)
    .where(eq(containerMetadataDocuments.containerId, childId))
    .limit(1);
  expect(metadataDocument).toEqual({
    containerId: childId,
    documentId: created.metadataDocumentId,
  });
});
