import { expect } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { accessManifests, documentUpdates } from "@tearleads/api-shared/schema";
import {
  CONTENT_RECORD_ENCRYPTION_SUITE,
  computeContentRecordNonceDomainHash,
  computeDocumentContentRecordMetadataHash,
  startDocumentBaselineSegmentsDigest,
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
import { eq, inArray } from "drizzle-orm";
import { routeApp } from "../../src/routeApp";
import { currentDocumentLinkRows } from "./currentDocumentLinks";
import type { CreatedDocumentFixture } from "./documentAcknowledgementFixture";
import {
  type BaselineSegmentFields,
  type BaselineSegmentRange,
  baselineSegmentRanges,
  createSignedBaselineGroup,
} from "./documentBaselineGroups";
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
  // A checkpoint is a baseline of one segment: the whole group.
  const baselineId = crypto.randomUUID();
  const baselineFields: BaselineSegmentFields | undefined = input.checkpoint
    ? {
        baselineId,
        baselineSegmentCount: 1,
        baselineSegmentIndex: 0,
        baselineSegmentsDigest: await startDocumentBaselineSegmentsDigest({
          baselineId,
          documentId: input.created.id,
        }),
        ...(input.coversThroughUpdateId === undefined
          ? {}
          : { coversThroughUpdateId: input.coversThroughUpdateId }),
      }
    : undefined;
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
        ...baselineFields,
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
    baselineFields,
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
  /** Signs the update as a rotation baseline of one segment. */
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
          ...update.baselineFields,
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

/**
 * An unlink's rotation baseline: one signed group whose segments reach
 * `coverage`, by default the document's committed frontier, cut into
 * `segments` pieces. `ranges` signs exactly those ranges instead.
 */
export async function createSignedAtomicRotationBaseline(input: {
  readonly dependencyManifestHashes: readonly string[];
  readonly accessManifestHash: string;
  readonly contentKeyCommitment?: string | undefined;
  readonly contentKeyEpoch: number;
  /** The version the group's segments reach together. */
  readonly coverage?: string | undefined;
  readonly coversThroughUpdateId?: string | undefined;
  readonly documentId: string;
  readonly organizationId: string;
  readonly override?: Parameters<
    typeof createSignedBaselineGroup
  >[0]["override"];
  readonly owner: TestUser;
  readonly ranges?: readonly BaselineSegmentRange[] | undefined;
  /** How many segments to cut the coverage into; one when absent. */
  readonly segments?: number | undefined;
  readonly targetHash: string;
}): Promise<DocumentOutgoingUpdate[]> {
  const rows = await db
    .select({
      partialEndVersionVector: documentUpdates.partialEndVersionVector,
    })
    .from(documentUpdates)
    .where(eq(documentUpdates.documentId, input.documentId));
  const coverage =
    input.coverage ??
    mergeVersionVectors(rows.map((row) => row.partialEndVersionVector));
  return createSignedBaselineGroup({
    ...input,
    ranges: input.ranges ?? baselineSegmentRanges(coverage, input.segments),
  });
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
      .where(
        inArray(
          documentUpdates.id,
          (request.rotationBaseline ?? []).map((segment) => segment.id),
        ),
      ),
    currentDocumentLinkRows(input.documentId),
  ]);
  expect(manifest).toHaveLength(0);
  expect(update).toHaveLength(0);
  expect(links).toHaveLength(2);
}
