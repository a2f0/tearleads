import {
  type DatabaseSession,
  gatherWithExecutor,
} from "@tearleads/api-shared/postgres";
import { containerDocumentSyncTombstones } from "@tearleads/api-shared/schema";
import type { VerifiedAccessEvent } from "@tearleads/crypto";
import {
  normalizeDocumentPurgeAccessEventBody,
  verifyDocumentPurgeEvent,
  verifySignedAccessEvent,
} from "@tearleads/crypto";
import type {
  AccessManifestBundleWireResponse,
  DocumentPurgeProofResponse,
} from "@tearleads/validators/response";
import { and, eq } from "drizzle-orm";
import { getStoredAccessEventByObjectType } from "../../../access/read/accessManifestStore";
import {
  keyingVerificationHttpStatus,
  projectionVerifiedAccessEventRecord,
} from "../../../keyingProjectionRecords";
import {
  ContainerWriterProjectionError,
  createContainerWriterProjectionContext,
} from "../../containers/writerProjection";
import { loadVerifiedPrincipalPolicySnapshotsForReferences } from "../../principals/principalPolicySnapshots";
import { loadSignerPublicKey } from "../../signerPublicKey";
import {
  StoredDocumentManifestError,
  verifyStoredDocumentManifest,
} from "../storedDocumentManifestVerification";
import { loadDocumentContainerDependencyMaterial } from "../writerProjection";
import {
  collectPurgeProofPrincipalReferences,
  type DocumentPurgeAuthorizationMaterial,
  loadDocumentPurgeProofMaterial,
} from "../writerProjectionPurgeProof";
import {
  authorizeDocumentPurgeProof,
  type ContainerProjectionContext,
  verifyStoredContainerPath,
} from "./documentPurgeProofAuthorization";
import {
  selectDocumentManifestPredecessors,
  uniquePurgeProofBundles,
} from "./documentPurgeProofHistory";
import { DocumentMutationError } from "./errors";

async function verifyStoredPurgeEvent(input: {
  readonly documentId: string;
  readonly event: VerifiedAccessEvent;
  readonly executor: DatabaseSession;
}): Promise<VerifiedAccessEvent> {
  const signerPublicKey = await loadSignerPublicKey(input.executor, {
    error: (message, status) => new DocumentMutationError(message, status),
    fingerprint: input.event.event.signerKeyFingerprint,
    userId: input.event.event.signerUserId,
  });
  const verified = await verifySignedAccessEvent({
    body: input.event.body,
    event: input.event.event,
    signerPublicKey,
  });
  if (!verified.ok) {
    throw new DocumentMutationError(
      verified.error.message,
      keyingVerificationHttpStatus(verified.error),
    );
  }
  if (
    verified.value.eventHash !== input.event.eventHash ||
    verified.value.event.objectId !== input.documentId ||
    verified.value.event.eventType !== "document.purge"
  ) {
    throw new DocumentMutationError(
      "Stored document purge event is inconsistent",
      409,
    );
  }
  return verified.value;
}

async function verifyRetainedPurgeManifests(input: {
  readonly context: ContainerProjectionContext;
  readonly material: Awaited<ReturnType<typeof loadDocumentPurgeProofMaterial>>;
}) {
  try {
    const authorizingContainerPath = await verifyStoredContainerPath({
      bundles: input.material.authorizingContainerPath,
      context: input.context,
    });
    const documentManifest = await verifyStoredDocumentManifest({
      bundle: input.material.documentManifest,
      containerContext: input.context,
    });
    await gatherWithExecutor(
      input.context.executor,
      input.material.documentManifestContainerPaths,
      (bundles) =>
        verifyStoredContainerPath({ bundles, context: input.context }),
    );
    return { authorizingContainerPath, documentManifest };
  } catch (error) {
    if (
      error instanceof StoredDocumentManifestError ||
      error instanceof ContainerWriterProjectionError
    ) {
      throw new DocumentMutationError(error.message, 409);
    }
    throw error;
  }
}

function internalPurgePrincipalReferences(
  material: Awaited<ReturnType<typeof loadDocumentPurgeProofMaterial>>,
) {
  return collectPurgeProofPrincipalReferences([
    ...material.authorizingContainerPath,
    ...material.authorizingContainerManifestHistory,
    ...material.documentContainerManifestHistory,
    ...material.documentManifestContainerPaths.flat(),
  ]);
}

function responsePurgePrincipalReferences(input: {
  readonly bundles: readonly AccessManifestBundleWireResponse[];
}) {
  return collectPurgeProofPrincipalReferences(input.bundles);
}

async function verifyProofMaterial(input: {
  readonly authorizationMaterial: DocumentPurgeAuthorizationMaterial;
  readonly body: ReturnType<typeof normalizeDocumentPurgeAccessEventBody>;
  readonly documentId: string;
  readonly documentManifestHash: string;
  readonly event: VerifiedAccessEvent;
  readonly executor: DatabaseSession;
}) {
  const material = await loadDocumentPurgeProofMaterial({
    authorizationMaterial: input.authorizationMaterial,
    authorizingContainerManifestHashes:
      input.body.authorizingContainerManifestHashes,
    documentManifestHash: input.documentManifestHash,
    executor: input.executor,
  });
  const internalEvidence =
    await loadVerifiedPrincipalPolicySnapshotsForReferences(
      input.executor,
      internalPurgePrincipalReferences(material),
    );
  const context = createContainerWriterProjectionContext(
    input.executor,
    internalEvidence.policies,
  );
  const { authorizingContainerPath, documentManifest } =
    await verifyRetainedPurgeManifests({ context, material });
  const principalPolicies = internalEvidence.policies;
  const verified = await verifyDocumentPurgeEvent({
    authorizingContainerPath,
    documentManifest,
    event: input.event,
    expectedDocumentId: input.documentId,
    principalPolicies,
  });
  if (!verified.ok) {
    throw new DocumentMutationError(
      verified.error.message,
      keyingVerificationHttpStatus(verified.error),
    );
  }
  return material;
}

function readStoredPurgeReference(event: VerifiedAccessEvent) {
  const body = normalizeDocumentPurgeAccessEventBody(event.body);
  const documentManifestHash = event.event.previousManifestHash;
  if (
    documentManifestHash === null ||
    documentManifestHash !== body.documentManifestHash
  ) {
    throw new DocumentMutationError(
      "Stored document purge predecessor is inconsistent",
      409,
    );
  }
  return { body, documentManifestHash };
}

async function loadPurgeTombstoneTime(input: {
  readonly containerId: string;
  readonly documentId: string;
  readonly executor: DatabaseSession;
}): Promise<string> {
  const [tombstone] = await input.executor
    .select({ purgedAt: containerDocumentSyncTombstones.updatedAt })
    .from(containerDocumentSyncTombstones)
    .where(
      and(
        eq(containerDocumentSyncTombstones.containerId, input.containerId),
        eq(containerDocumentSyncTombstones.documentId, input.documentId),
      ),
    )
    .limit(1);
  if (!tombstone) {
    throw new DocumentMutationError("Document purge tombstone is missing", 409);
  }
  return tombstone.purgedAt.toISOString();
}

export async function loadDocumentPurgeProof(input: {
  readonly documentCheckpointManifestHash?: string | undefined;
  readonly documentId: string;
  readonly executor: DatabaseSession;
  readonly userId: string;
}): Promise<DocumentPurgeProofResponse> {
  const storedEvent = await getStoredAccessEventByObjectType({
    eventType: "document.purge",
    executor: input.executor,
    objectId: input.documentId,
    objectKind: "document",
  });
  if (!storedEvent) {
    throw new DocumentMutationError("Document purge proof not found", 404);
  }
  const event = await verifyStoredPurgeEvent({
    documentId: input.documentId,
    event: storedEvent,
    executor: input.executor,
  });
  const { body, documentManifestHash } = readStoredPurgeReference(event);
  const authorizationMaterial = await authorizeDocumentPurgeProof({
    body,
    checkpointManifestHash: input.documentCheckpointManifestHash,
    documentId: input.documentId,
    executor: input.executor,
    userId: input.userId,
  });
  const material = await verifyProofMaterial({
    authorizationMaterial,
    body,
    documentId: input.documentId,
    documentManifestHash,
    event,
    executor: input.executor,
  });

  const documentManifestPredecessorBundles = selectDocumentManifestPredecessors(
    {
      authorizedCheckpointManifestHash: input.documentCheckpointManifestHash,
      head: material.documentManifest,
      history: material.documentManifestHistory,
    },
  );
  const documentDependencies = await loadDocumentContainerDependencyMaterial({
    documentManifest: material.documentManifest,
    documentManifestHistory: documentManifestPredecessorBundles,
    executor: input.executor,
    manifestCache: new Map(),
  });
  const responseContainerBundles = uniquePurgeProofBundles([
    ...material.authorizingContainerPath,
    ...material.authorizingContainerManifestHistory,
    ...documentDependencies.documentManifestContainerPaths.flat(),
    ...documentDependencies.documentContainerManifestHistory,
  ]);
  const responseEvidence =
    await loadVerifiedPrincipalPolicySnapshotsForReferences(
      input.executor,
      responsePurgePrincipalReferences({ bundles: responseContainerBundles }),
    );

  const purgedAt = await loadPurgeTombstoneTime({
    containerId: body.containerId,
    documentId: input.documentId,
    executor: input.executor,
  });

  return {
    authorizingContainerPath: material.authorizingContainerPath,
    documentContainerManifestHistory: uniquePurgeProofBundles([
      ...material.authorizingContainerManifestHistory,
      ...documentDependencies.documentContainerManifestHistory,
    ]),
    documentId: input.documentId,
    documentManifest: material.documentManifest,
    documentManifestContainerPaths:
      documentDependencies.documentManifestContainerPaths,
    documentManifestPredecessors: documentManifestPredecessorBundles,
    principalPolicySnapshots: responseEvidence.snapshots,
    purgeEvent: projectionVerifiedAccessEventRecord(event),
    purgedAt,
  };
}
