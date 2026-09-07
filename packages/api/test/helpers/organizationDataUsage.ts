import { db } from "@tearleads/api-shared/postgres";
import {
  blobContentWriteHeaders,
  blobs,
  containerMetadataDocuments,
  documentContentWriteHeaders,
  documents,
  documentUpdates,
} from "@tearleads/api-shared/schema";
import type { TestUser } from "@tearleads/bob-and-alice";
import {
  CONTENT_RECORD_ENCRYPTION_SUITE,
  type WriteHeader,
} from "@tearleads/crypto";
import type { OrganizationDataUsageResponse } from "@tearleads/validators/response";

function createUsageWriteHeader(input: {
  contentRecordId: string;
  objectId: string;
  objectKind: "blob" | "document";
  organizationId: string;
  writerUserId: string;
}): WriteHeader {
  return {
    version: 1,
    organizationId: input.organizationId,
    objectKind: input.objectKind,
    objectId: input.objectId,
    accessManifestHash: `${input.contentRecordId}:manifest`,
    contentKeyEpoch: 1,
    targetHash: `${input.contentRecordId}:target`,
    encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE,
    contentRecordId: input.contentRecordId,
    nonceDomainHash: `${input.contentRecordId}:nonce`,
    metadataHash: `${input.contentRecordId}:metadata`,
    ciphertextHash: `${input.contentRecordId}:ciphertext`,
    writerUserId: input.writerUserId,
    writerDeviceId: "test-device",
    writerKeyFingerprint: "test-writer-key",
    signedAt: "2026-05-12T12:00:00.000Z",
    signature: `${input.contentRecordId}:signature`,
  };
}

export async function seedUsageDocument(input: {
  actor: TestUser;
  organizationId: string;
  documentId: string;
  updates: ReadonlyArray<{ id: string; byteLength: number }>;
}) {
  await db
    .insert(documents)
    .values({
      id: input.documentId,
      createdByFingerprint: input.actor.fingerprint,
    })
    .onConflictDoNothing();
  await db.insert(documentUpdates).values(
    input.updates.map((update, index) => ({
      id: update.id,
      documentId: input.documentId,
      accessEpoch: 1,
      authorFingerprint: input.actor.fingerprint,
      encryptedData: `encrypted-${input.documentId}-update-${index}`,
      byteLength: update.byteLength,
      partialStartVersionVector: `${input.documentId}-start-${index}`,
      partialEndVersionVector: `${input.documentId}-end-${index}`,
      plaintextHash: `${input.documentId}-plaintext-${index}`,
    })),
  );
  await db.insert(documentContentWriteHeaders).values(
    input.updates.map((update, index) => {
      const header = createUsageWriteHeader({
        contentRecordId: `${update.id}:record`,
        objectId: input.documentId,
        objectKind: "document",
        organizationId: input.organizationId,
        writerUserId: input.actor.userId,
      });

      return {
        updateId: update.id,
        // Usage accounting does not interpret authorization target contents.
        authorizationTargets: [],
        documentId: input.documentId,
        organizationId: input.organizationId,
        contentKeyEpoch: 1,
        accessManifestHash: header.accessManifestHash,
        targetHash: header.targetHash,
        encryptionSuite: header.encryptionSuite,
        contentRecordId: header.contentRecordId,
        nonceDomainHash: header.nonceDomainHash,
        headerHash: `${update.id}:header:${index}`,
        header,
      };
    }),
  );
}

export async function seedOrganizationDataUsage(input: {
  actor: TestUser;
  organizationId: string;
}) {
  const blobId = crypto.randomUUID();

  await seedUsageDocument({
    actor: input.actor,
    organizationId: input.organizationId,
    documentId: crypto.randomUUID(),
    updates: [
      { id: crypto.randomUUID(), byteLength: 11 },
      { id: crypto.randomUUID(), byteLength: 13 },
    ],
  });

  // Container metadata is a built-in/system document: it must be
  // classified under `containerMetadata`, not `user`.
  const metadataDocumentId = crypto.randomUUID();
  await seedUsageDocument({
    actor: input.actor,
    organizationId: input.organizationId,
    documentId: metadataDocumentId,
    updates: [{ id: crypto.randomUUID(), byteLength: 7 }],
  });
  await db.insert(containerMetadataDocuments).values({
    containerId: crypto.randomUUID(),
    documentId: metadataDocumentId,
  });

  await db.insert(blobs).values({
    id: blobId,
    storageKey: `${blobId}:storage`,
    sha256: `${blobId}:sha256`,
    byteLength: 17,
  });
  await db.insert(blobContentWriteHeaders).values(
    [crypto.randomUUID(), crypto.randomUUID()].map((recordId, index) => {
      const contentRecordId = `${recordId}:record`;
      const header = createUsageWriteHeader({
        contentRecordId,
        objectId: blobId,
        objectKind: "blob",
        organizationId: input.organizationId,
        writerUserId: input.actor.userId,
      });

      return {
        recordId,
        blobId,
        authorization: {
          activeBindingIds: [],
          blobId,
          blobAccessManifestHash: header.accessManifestHash,
          blobKeyTargetHash: header.targetHash,
          documentManifestHashes: [],
          linkedContainerKeyEpochIds: [],
          linkedContainerManifestHashes: [],
          organizationId: input.organizationId,
          targets: [],
        },
        organizationId: input.organizationId,
        contentKeyEpoch: 1,
        accessManifestHash: header.accessManifestHash,
        targetHash: header.targetHash,
        encryptionSuite: header.encryptionSuite,
        contentRecordId: header.contentRecordId,
        nonceDomainHash: header.nonceDomainHash,
        headerHash: `${recordId}:header:${index}`,
        header,
      };
    }),
  );

  return {
    blobs: { blobCount: 1, byteLength: 17 },
    documents: {
      breakdown: [
        {
          category: "containerMetadata",
          byteLength: 67,
          documentCount: 2,
          updateCount: 2,
        },
        {
          category: "rosterProfiles",
          byteLength: 0,
          documentCount: 0,
          updateCount: 0,
        },
        {
          category: "organizationMetadata",
          byteLength: 0,
          documentCount: 0,
          updateCount: 0,
        },
        { category: "user", byteLength: 24, documentCount: 1, updateCount: 2 },
      ],
      byteLength: 91,
      documentCount: 3,
      updateCount: 4,
    },
    totalByteLength: 108,
  } satisfies Omit<OrganizationDataUsageResponse, "organizationId">;
}
