import { expect } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { accessManifests, documentUpdates } from "@tearleads/api-shared/schema";
import {
  CONTENT_RECORD_ENCRYPTION_SUITE,
  computeContentRecordNonceDomainHash,
  computeDocumentContentRecordMetadataHash,
} from "@tearleads/crypto";
import {
  createDocument,
  emptyVersionVector,
  encodeVersionVector,
  exportUpdatesSince,
  getUpdateVersionVectors,
  mergeVersionVectors,
} from "@tearleads/loro";
import type { TestUser } from "@tearleads/test-utils";
import type {
  DocumentLinkSetMutationRequest,
  DocumentOutgoingUpdate,
  DocumentSyncRequest,
} from "@tearleads/validators/request";
import { DOCUMENT_MUTATION_ERROR_CODES } from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import { routeApp } from "../../src/routeApp";
import { currentDocumentLinkRows } from "./currentDocumentLinks";
import type { CreatedDocumentFixture } from "./documentAcknowledgementFixture";
import {
  CONTENT_KEY_COMMITMENT_FIXTURE,
  signWithDocumentEnvelope,
} from "./documentEnvelopeFixture";
import type { StoredRootFixture } from "./keyingWriterProjectionKit";

type ContainerPathRefs = NonNullable<
  DocumentSyncRequest["authorizingContainerPathRefs"]
>;

function rootPathRefs(
  root: Pick<StoredRootFixture, "bundle" | "kekState">,
): ContainerPathRefs {
  return [
    [
      {
        containerId: root.kekState.containerId,
        manifestHash: root.bundle.manifestHash,
      },
    ],
  ];
}

/**
 * Vectors a writer signs in place of the ones its payload carries: the server
 * cannot read the payload, so only the signed span is visible to it.
 */
export interface DeclaredSpan {
  readonly partialEndVersionVector: string;
  readonly partialStartVersionVector: string;
}

async function createSignedOrdinaryUpdate(input: {
  readonly authorizingContainerPathRefs: ContainerPathRefs;
  readonly checkpoint: boolean;
  readonly contentKeyCommitment?: string | undefined;
  readonly contentKeyBundle?: CreatedDocumentFixture["contentKeyBundle"];
  readonly coversThroughUpdateId?: string | undefined;
  readonly created: CreatedDocumentFixture;
  readonly declaredSpan?: DeclaredSpan | undefined;
  /** The dependency vector to sign and send; none when absent. */
  readonly dependencyVersionVector?: string | undefined;
  readonly owner: TestUser;
  readonly updateId?: string | undefined;
}) {
  const dependencyVersionVector =
    input.dependencyVersionVector ?? emptyVersionVector();
  const contentKeyBundle =
    input.contentKeyBundle ?? input.created.contentKeyBundle;
  const id = input.updateId ?? crypto.randomUUID();
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
    ...input.declaredSpan,
  };
  const plaintextHash = `plaintext-hash:${id}`;
  const organizationId = String(
    Reflect.get(input.created.accessManifest.state, "organizationId"),
  );
  const { encryptedData, writeHeader } = await signWithDocumentEnvelope(
    `encrypted-sync-audit-update:${id}`,
    {
      version: 1,
      dependencyManifestHashes: [
        ...new Set(
          input.authorizingContainerPathRefs.flatMap((path) =>
            path.map((ref) => ref.manifestHash),
          ),
        ),
      ].sort(),
      organizationId,
      objectKind: "document",
      objectId: input.created.id,
      accessManifestHash: contentKeyBundle.linkSetManifestHash,
      contentKeyEpoch: contentKeyBundle.contentKeyEpoch,
      targetHash: contentKeyBundle.targetHash,
      encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE,
      contentRecordId: id,
      nonceDomainHash: await computeContentRecordNonceDomainHash({
        version: 1,
        organizationId,
        objectKind: "document",
        objectId: input.created.id,
        contentKeyEpoch: contentKeyBundle.contentKeyEpoch,
        encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE,
        contentRecordId: id,
      }),
      metadataHash: await computeDocumentContentRecordMetadataHash({
        ...(input.checkpoint
          ? {
              checkpointKind: "rotate_baseline" as const,
              checkpointPayloadKind: "full_history_snapshot" as const,
              coversThroughUpdateId: input.coversThroughUpdateId,
              sourceVersionVector: vectors.partialEndVersionVector,
            }
          : {}),
        dependencyVersionVector,
        documentId: input.created.id,
        partialEndVersionVector: vectors.partialEndVersionVector,
        partialStartVersionVector: vectors.partialStartVersionVector,
        plaintextHash,
        updateId: id,
      }),
      writerUserId: input.owner.userId,
      writerDeviceId: "test-device",
      writerKeyFingerprint: input.owner.fingerprint,
      signedAt: "2026-04-27T12:00:00.000Z",
    },
    input.owner.signing.signingPrivateKey,
    input.contentKeyCommitment,
  );
  return {
    dependencyVersionVector,
    encryptedData,
    id,
    plaintextHash,
    vectors,
    writeHeader: writeHeader as unknown as Record<string, unknown>,
  };
}

export async function createSignedDocumentSyncRequest(input: {
  /** Defaults to the root alone; the update's header cites every path. */
  readonly authorizingContainerPathRefs?: ContainerPathRefs | undefined;
  readonly checkpoint?: boolean;
  /**
   * The commitment the update's envelope and any carried bundle declare;
   * defaults to `CONTENT_KEY_COMMITMENT_FIXTURE`.
   */
  readonly contentKeyCommitment?: string | undefined;
  /**
   * Signs the update (and the request expectations) against this bundle
   * instead of the create-time one — e.g. a healed epoch+1 bundle re-wrapped
   * to post-revoke targets. Pair with includeContentKeyBundle to carry the
   * bundle in the request so the server stores it.
   */
  readonly contentKeyBundle?: CreatedDocumentFixture["contentKeyBundle"];
  /** A checkpoint's signed processed cursor. */
  readonly coversThroughUpdateId?: string | undefined;
  readonly created: CreatedDocumentFixture;
  readonly declaredSpan?: DeclaredSpan | undefined;
  /** The dependency vector to sign and send; none when absent. */
  readonly dependencyVersionVector?: string | undefined;
  readonly includeContentKeyBundle?: boolean;
  readonly owner: TestUser;
  readonly root: Pick<StoredRootFixture, "bundle" | "kekState">;
  /** Re-signs a queued update under its existing id. */
  readonly updateId?: string | undefined;
}): Promise<{
  readonly request: DocumentSyncRequest;
  readonly updateId: string;
}> {
  const contentKeyBundle =
    input.contentKeyBundle ?? input.created.contentKeyBundle;
  const authorizingContainerPathRefs =
    input.authorizingContainerPathRefs ?? rootPathRefs(input.root);
  const update = await createSignedOrdinaryUpdate({
    ...input,
    authorizingContainerPathRefs,
    checkpoint: input.checkpoint ?? false,
  });
  return {
    updateId: update.id,
    request: {
      contentKeyEpoch: contentKeyBundle.contentKeyEpoch,
      expectedLinkSetManifestHash: contentKeyBundle.linkSetManifestHash,
      expectedTargetHash: contentKeyBundle.targetHash,
      ...(input.includeContentKeyBundle
        ? {
            contentKeyBundle: {
              contentKeyCommitment:
                input.contentKeyCommitment ?? CONTENT_KEY_COMMITMENT_FIXTURE,
              contentKeyEpoch: contentKeyBundle.contentKeyEpoch,
              linkSetManifestHash: contentKeyBundle.linkSetManifestHash,
              targetHash: contentKeyBundle.targetHash,
              targets: contentKeyBundle.targets,
            },
          }
        : {}),
      authorizingContainerPathRefs,
      localVersionVector: null,
      outgoingUpdates: [
        {
          ...(input.checkpoint
            ? {
                checkpointKind: "rotate_baseline" as const,
                checkpointPayloadKind: "full_history_snapshot" as const,
                ...(input.coversThroughUpdateId === undefined
                  ? {}
                  : { coversThroughUpdateId: input.coversThroughUpdateId }),
                sourceVersionVector: update.vectors.partialEndVersionVector,
              }
            : {}),
          dependencyVersionVector: update.dependencyVersionVector,
          encryptedData: update.encryptedData,
          id: update.id,
          partialStartVersionVector: update.vectors.partialStartVersionVector,
          partialEndVersionVector: update.vectors.partialEndVersionVector,
          plaintextHash: update.plaintextHash,
          writeHeader: update.writeHeader,
        },
      ],
      supportsPullPagination: true,
    },
  };
}

/**
 * A document's first update as a create or an attachment bind carries it:
 * one signed update from empty, its end as the local version.
 */
export async function createFirstUpdateSyncRequest(input: {
  readonly authorizingContainerPathRefs?: ContainerPathRefs | undefined;
  readonly document: CreatedDocumentFixture;
  readonly owner: TestUser;
  readonly root: Pick<StoredRootFixture, "bundle" | "kekState">;
  readonly updateId?: string | undefined;
}): Promise<{ readonly id: string; readonly request: DocumentSyncRequest }> {
  const { request, updateId } = await createSignedDocumentSyncRequest({
    authorizingContainerPathRefs: input.authorizingContainerPathRefs,
    created: input.document,
    owner: input.owner,
    root: input.root,
    updateId: input.updateId,
  });
  const [update] = request.outgoingUpdates;
  if (!update) throw new Error("Expected one update");
  return {
    id: updateId,
    request: { ...request, localVersionVector: update.partialEndVersionVector },
  };
}

export async function createSignedAtomicRotationBaseline(input: {
  readonly dependencyManifestHashes: readonly string[];
  readonly accessManifestHash: string;
  readonly contentKeyCommitment?: string | undefined;
  readonly contentKeyEpoch: number;
  readonly coversThroughUpdateId?: string | undefined;
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
  const plaintextHash = `plaintext-hash:${id}`;
  const { encryptedData, writeHeader } = await signWithDocumentEnvelope(
    `encrypted-rotation-baseline:${id}`,
    {
      version: 1,
      dependencyManifestHashes: [...input.dependencyManifestHashes].sort(),
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
        coversThroughUpdateId: input.coversThroughUpdateId,
        dependencyVersionVector: emptyVersionVector(),
        documentId: input.documentId,
        partialEndVersionVector: sourceVersionVector,
        partialStartVersionVector,
        plaintextHash,
        sourceVersionVector,
        updateId: id,
      }),
      writerUserId: input.owner.userId,
      writerDeviceId: "test-device",
      writerKeyFingerprint: input.owner.fingerprint,
      signedAt: "2026-07-14T12:00:00.000Z",
    },
    input.owner.signing.signingPrivateKey,
    input.contentKeyCommitment,
  );
  return {
    checkpointKind: "rotate_baseline",
    checkpointPayloadKind: "full_history_snapshot",
    ...(input.coversThroughUpdateId === undefined
      ? {}
      : { coversThroughUpdateId: input.coversThroughUpdateId }),
    id,
    dependencyVersionVector: emptyVersionVector(),
    encryptedData,
    partialStartVersionVector,
    partialEndVersionVector: sourceVersionVector,
    plaintextHash,
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
    code: DOCUMENT_MUTATION_ERROR_CODES.unlinkRotationBaselineStale,
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
    currentDocumentLinkRows(input.documentId),
  ]);
  expect(manifest).toHaveLength(0);
  expect(update).toHaveLength(0);
  expect(links).toHaveLength(2);
}
