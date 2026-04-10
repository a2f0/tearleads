import { expect, test } from "bun:test";
import {
  encryptForRecipients,
  serializeBlobEnvelope,
  toFingerprint,
} from "@tearleads/crypto";
import { base64ToBytes } from "@tearleads/encoding";
import { eq } from "drizzle-orm";
import { createTestUser } from "../../../test/helpers/createTestUser";
import {
  createPublicKeyRequest,
  createRecordingDb,
  createServiceTestRuntime,
} from "../../../test/helpers/serviceRuntime";
import { db } from "../../adapters/postgres";
import { attachmentBindings, blobStages, blobs } from "../../schema";
import { sha256Hex } from "../../utils/sha256";
import { registerPublicKey } from "../auth/registerPublicKey";
import {
  CommitDocumentChangeError,
  commitDocumentChange,
} from "./commitDocumentChange";
import { createDocumentSyncStore } from "./documentSyncStore";
import { stageBlob } from "./stageBlob";

async function registerServiceUser() {
  const runtime = createServiceTestRuntime();
  const user = createTestUser();
  const registration = await registerPublicKey(
    runtime,
    await createPublicKeyRequest(user),
  );
  const fingerprint = await toFingerprint(user.signing.signingPublicKey);

  return { fingerprint, registration, user };
}

async function createServiceDocument() {
  const { fingerprint, registration, user } = await registerServiceUser();
  const store = createDocumentSyncStore(createServiceTestRuntime());
  const created = await store.createDocument({
    createdByFingerprint: fingerprint,
    createdByUserId: registration.userId,
    linkedContainerIds: [registration.rootContainerId],
  });

  if (!created) {
    throw new Error("Failed to create service test document");
  }

  return { created, fingerprint, registration, user };
}

async function createEncryptedBlobBytes(
  plaintext: string,
  encodedRecipientPublicKeys: string[],
): Promise<string> {
  const envelope = await encryptForRecipients(
    new TextEncoder().encode(plaintext),
    encodedRecipientPublicKeys.map((publicKey) => base64ToBytes(publicKey)),
  );

  return serializeBlobEnvelope(envelope);
}

async function stageServiceBlob(input: {
  encryptedBytes: string;
  userId: string;
}) {
  return stageBlob(createServiceTestRuntime(), {
    encryptedBytes: input.encryptedBytes,
    byteLength: new TextEncoder().encode(input.encryptedBytes).byteLength,
    sha256: await sha256Hex(input.encryptedBytes),
    userId: input.userId,
  });
}

async function expectCommitDocumentChangeError(
  promise: Promise<unknown>,
): Promise<CommitDocumentChangeError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(CommitDocumentChangeError);
    return error as CommitDocumentChangeError;
  }

  throw new Error("Expected commitDocumentChange to fail");
}

test("commitDocumentChange promotes staged blobs into active attachment bindings", async () => {
  const { created, fingerprint, registration } = await createServiceDocument();
  const encryptedBytes = await createEncryptedBlobBytes(
    "service-attachment-bytes",
    created.recipientEncapsulationPublicKeys,
  );
  const stage = await stageServiceBlob({
    encryptedBytes,
    userId: registration.userId,
  });
  const recording = createRecordingDb();

  const result = await commitDocumentChange(
    createServiceTestRuntime(recording.db),
    {
      documentId: created.document.id,
      request: {
        accessEpoch: created.currentAccessEpoch,
        attachmentCommits: [
          {
            expectedBindingId: null,
            slotId: "service-slot",
            stageId: stage.stageId,
          },
        ],
        attachmentDetaches: [],
        attachmentRewraps: [],
        loroUpdate: null,
      },
      session: {
        fingerprint,
        userId: registration.userId,
      },
    },
  );

  expect(result.currentAccessEpoch).toBe(created.currentAccessEpoch);
  expect(result.acceptedOutgoingUpdateIds).toEqual([]);
  expect(result.committedBindings).toEqual([
    {
      bindingId: expect.any(String),
      blobId: expect.any(String),
      slotId: "service-slot",
    },
  ]);
  expect(result.detachedBindingIds).toEqual([]);
  expect(result.documentRecipientEnvelopes).toEqual(
    created.documentRecipientEnvelopes,
  );
  expect(recording.calls.get("transaction") ?? 0).toBeGreaterThan(0);
  const committedBinding = result.committedBindings[0];
  if (!committedBinding) {
    throw new Error("Expected service test committed binding");
  }

  const [binding] = await db
    .select({
      blobId: attachmentBindings.blobId,
      documentId: attachmentBindings.documentId,
      slotId: attachmentBindings.slotId,
    })
    .from(attachmentBindings)
    .where(eq(attachmentBindings.id, committedBinding.bindingId))
    .limit(1);
  expect(binding).toEqual({
    blobId: committedBinding.blobId,
    documentId: created.document.id,
    slotId: "service-slot",
  });

  const [blob] = await db
    .select({
      encryptedBytes: blobs.encryptedBytes,
      storageKey: blobs.storageKey,
    })
    .from(blobs)
    .where(eq(blobs.id, committedBinding.blobId))
    .limit(1);
  expect(blob).toEqual({
    encryptedBytes,
    storageKey: stage.stageId,
  });

  const [remainingStage] = await db
    .select({ id: blobStages.id })
    .from(blobStages)
    .where(eq(blobStages.id, stage.stageId))
    .limit(1);
  expect(remainingStage).toBeUndefined();
});

test("commitDocumentChange reports missing, forbidden, and stale access cases", async () => {
  const { created, fingerprint, registration } = await createServiceDocument();
  const other = await registerServiceUser();

  const missing = await expectCommitDocumentChangeError(
    commitDocumentChange(createServiceTestRuntime(), {
      documentId: crypto.randomUUID(),
      request: {
        accessEpoch: created.currentAccessEpoch,
        attachmentCommits: [],
        attachmentDetaches: [],
        attachmentRewraps: [],
        loroUpdate: null,
      },
      session: {
        fingerprint,
        userId: registration.userId,
      },
    }),
  );
  expect(missing.status).toBe(404);
  expect(missing.message).toBe("Document not found");

  const forbidden = await expectCommitDocumentChangeError(
    commitDocumentChange(createServiceTestRuntime(), {
      documentId: created.document.id,
      request: {
        accessEpoch: created.currentAccessEpoch,
        attachmentCommits: [],
        attachmentDetaches: [],
        attachmentRewraps: [],
        loroUpdate: null,
      },
      session: {
        fingerprint: other.fingerprint,
        userId: other.registration.userId,
      },
    }),
  );
  expect(forbidden.status).toBe(403);
  expect(forbidden.message).toBe("Forbidden");

  const stale = await expectCommitDocumentChangeError(
    commitDocumentChange(createServiceTestRuntime(), {
      documentId: created.document.id,
      request: {
        accessEpoch: created.currentAccessEpoch + 1,
        attachmentCommits: [],
        attachmentDetaches: [],
        attachmentRewraps: [],
        loroUpdate: null,
      },
      session: {
        fingerprint,
        userId: registration.userId,
      },
    }),
  );
  expect(stale.status).toBe(409);
  expect(stale.message).toBe("Stale access epoch");
});
