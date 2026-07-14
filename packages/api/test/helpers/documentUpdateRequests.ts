import { expect } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  accessManifests,
  documentContainerLinks,
  documentUpdates,
} from "@tearleads/api-shared/schema";
import type { TestUser } from "@tearleads/bob-and-alice";
import {
  CONTENT_RECORD_ENCRYPTION_SUITE,
  computeContentRecordNonceDomainHash,
  computeDocumentContentRecordCiphertextHash,
  computeDocumentContentRecordMetadataHash,
  signWriteHeader,
} from "@tearleads/crypto";
import {
  createDocument,
  emptyVersionVector,
  encodeVersionVector,
  exportUpdatesSince,
  getUpdateVersionVectors,
  mergeVersionVectors,
} from "@tearleads/loro";
import type {
  DocumentLinkSetMutationRequest,
  DocumentOutgoingUpdate,
  DocumentSyncRequest,
} from "@tearleads/validators/request";
import type { DocumentCreateResponse } from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import { routeApp } from "../../src/routeApp";
import type { StoredRootFixture } from "./keyingWriterProjectionKit";

async function createSignedOrdinaryUpdate(input: {
  readonly checkpoint: boolean;
  readonly created: DocumentCreateResponse;
  readonly owner: TestUser;
}) {
  const id = crypto.randomUUID();
  const document = await createDocument(`sync-audit-${id}`);
  const partialStartVersionVector = encodeVersionVector(document);
  document.getText("text").update(`sync audit update ${id}`);
  const exportedVectors = getUpdateVersionVectors(
    exportUpdatesSince(document, partialStartVersionVector),
  );
  const vectors = {
    ...exportedVectors,
    ...(input.checkpoint
      ? { partialStartVersionVector: emptyVersionVector() }
      : {}),
  };
  const encryptedData = `encrypted-sync-audit-update:${id}`;
  const organizationId = String(
    Reflect.get(input.created.accessManifest.state, "organizationId"),
  );
  const writeHeader = await signWriteHeader(
    {
      version: 1,
      organizationId,
      objectKind: "document",
      objectId: input.created.id,
      accessManifestHash: input.created.contentKeyBundle.linkSetManifestHash,
      contentKeyEpoch: input.created.contentKeyBundle.contentKeyEpoch,
      targetHash: input.created.contentKeyBundle.targetHash,
      encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE,
      contentRecordId: id,
      nonceDomainHash: await computeContentRecordNonceDomainHash({
        version: 1,
        organizationId,
        objectKind: "document",
        objectId: input.created.id,
        contentKeyEpoch: input.created.contentKeyBundle.contentKeyEpoch,
        encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE,
        contentRecordId: id,
      }),
      metadataHash: await computeDocumentContentRecordMetadataHash({
        ...(input.checkpoint
          ? {
              checkpointKind: "rotate_baseline" as const,
              checkpointPayloadKind: "full_history_snapshot" as const,
              sourceVersionVector: vectors.partialEndVersionVector,
            }
          : {}),
        documentId: input.created.id,
        partialEndVersionVector: vectors.partialEndVersionVector,
        partialStartVersionVector: vectors.partialStartVersionVector,
        updateId: id,
      }),
      ciphertextHash:
        await computeDocumentContentRecordCiphertextHash(encryptedData),
      writerUserId: input.owner.userId,
      writerDeviceId: "test-device",
      writerKeyFingerprint: input.owner.fingerprint,
      signedAt: "2026-04-27T12:00:00.000Z",
    },
    input.owner.signing.signingPrivateKey,
  );
  return {
    encryptedData,
    id,
    vectors,
    writeHeader: writeHeader as unknown as Record<string, unknown>,
  };
}

export async function createSignedDocumentSyncRequest(input: {
  readonly checkpoint?: boolean;
  readonly created: DocumentCreateResponse;
  readonly owner: TestUser;
  readonly root: StoredRootFixture;
}): Promise<{
  readonly request: DocumentSyncRequest;
  readonly updateId: string;
}> {
  const update = await createSignedOrdinaryUpdate({
    ...input,
    checkpoint: input.checkpoint ?? false,
  });
  return {
    updateId: update.id,
    request: {
      contentKeyEpoch: input.created.contentKeyBundle.contentKeyEpoch,
      expectedLinkSetManifestHash:
        input.created.contentKeyBundle.linkSetManifestHash,
      expectedTargetHash: input.created.contentKeyBundle.targetHash,
      authorizingContainerPathRefs: [
        [
          {
            containerId: input.root.kekState.containerId,
            manifestHash: input.root.bundle.manifestHash,
          },
        ],
      ],
      localVersionVector: null,
      outgoingUpdates: [
        {
          ...(input.checkpoint
            ? {
                checkpointKind: "rotate_baseline" as const,
                checkpointPayloadKind: "full_history_snapshot" as const,
                sourceVersionVector: update.vectors.partialEndVersionVector,
              }
            : {}),
          encryptedData: update.encryptedData,
          id: update.id,
          partialStartVersionVector: update.vectors.partialStartVersionVector,
          partialEndVersionVector: update.vectors.partialEndVersionVector,
          writeHeader: update.writeHeader,
        },
      ],
    },
  };
}

export async function createSignedAtomicRotationBaseline(input: {
  readonly accessManifestHash: string;
  readonly contentKeyEpoch: number;
  readonly documentId: string;
  readonly organizationId: string;
  readonly owner: TestUser;
  readonly sourceVersionVector?: string;
  readonly targetHash: string;
}): Promise<DocumentOutgoingUpdate> {
  const rows = await db
    .select({
      partialEndVersionVector: documentUpdates.partialEndVersionVector,
    })
    .from(documentUpdates)
    .where(eq(documentUpdates.documentId, input.documentId));
  const sourceVersionVector =
    input.sourceVersionVector ??
    mergeVersionVectors(rows.map((row) => row.partialEndVersionVector));
  const id = crypto.randomUUID();
  const partialStartVersionVector = emptyVersionVector();
  const encryptedData = `encrypted-rotation-baseline:${id}`;
  const writeHeader = await signWriteHeader(
    {
      version: 1,
      organizationId: input.organizationId,
      objectKind: "document",
      objectId: input.documentId,
      accessManifestHash: input.accessManifestHash,
      contentKeyEpoch: input.contentKeyEpoch,
      targetHash: input.targetHash,
      encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE,
      contentRecordId: id,
      nonceDomainHash: await computeContentRecordNonceDomainHash({
        version: 1,
        organizationId: input.organizationId,
        objectKind: "document",
        objectId: input.documentId,
        contentKeyEpoch: input.contentKeyEpoch,
        encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE,
        contentRecordId: id,
      }),
      metadataHash: await computeDocumentContentRecordMetadataHash({
        checkpointKind: "rotate_baseline",
        checkpointPayloadKind: "full_history_snapshot",
        documentId: input.documentId,
        partialEndVersionVector: sourceVersionVector,
        partialStartVersionVector,
        sourceVersionVector,
        updateId: id,
      }),
      ciphertextHash:
        await computeDocumentContentRecordCiphertextHash(encryptedData),
      writerUserId: input.owner.userId,
      writerDeviceId: "test-device",
      writerKeyFingerprint: input.owner.fingerprint,
      signedAt: "2026-07-14T12:00:00.000Z",
    },
    input.owner.signing.signingPrivateKey,
  );
  return {
    checkpointKind: "rotate_baseline",
    checkpointPayloadKind: "full_history_snapshot",
    id,
    encryptedData,
    partialStartVersionVector,
    partialEndVersionVector: sourceVersionVector,
    sourceVersionVector,
    writeHeader: { ...writeHeader },
  };
}

export async function expectStaleAtomicUnlinkRollsBack(input: {
  readonly buildRequest: () => Promise<DocumentLinkSetMutationRequest>;
  readonly documentId: string;
  readonly token: string;
}): Promise<void> {
  const request = await input.buildRequest();
  const response = await routeApp.request(
    `/documents/${input.documentId}/unlink`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    },
  );
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({
    error: "Document unlink rotation baseline is stale",
  });
  const [manifest, update, links] = await Promise.all([
    db
      .select({ id: accessManifests.id })
      .from(accessManifests)
      .where(eq(accessManifests.manifestHash, request.expectedManifestHash)),
    db
      .select({ id: documentUpdates.id })
      .from(documentUpdates)
      .where(eq(documentUpdates.id, request.rotationBaseline?.id ?? "missing")),
    db
      .select({ containerId: documentContainerLinks.containerId })
      .from(documentContainerLinks)
      .where(eq(documentContainerLinks.documentId, input.documentId)),
  ]);
  expect(manifest).toHaveLength(0);
  expect(update).toHaveLength(0);
  expect(links).toHaveLength(2);
}
