import {
  type DatabaseSession,
  gatherWithExecutor,
} from "@tearleads/api-shared/postgres";
import { containerDocumentSyncTombstones } from "@tearleads/api-shared/schema";
import type { VerifiedAccessEvent } from "@tearleads/crypto";
import {
  type normalizeDocumentPurgeAccessEventBody,
  verifyDocumentPurgeEvent,
} from "@tearleads/crypto";
import type { DocumentPurgeProofResponse } from "@tearleads/validators/response";
import { and, eq } from "drizzle-orm";
import { hasAnyDocumentManifestObservation } from "../../../access/read/documentManifestObservationStore";
import {
  keyingVerificationHttpStatus,
  projectionVerifiedAccessEventRecord,
} from "../../../keyingProjectionRecords";
import {
  ContainerWriterProjectionError,
  createContainerWriterProjectionContext,
} from "../../containers/writerProjection";
import { loadPrincipalPolicySelections } from "../../principals/principalPolicySelections";
import { loadPurgePolicyEvidence } from "../../principals/purgePolicyEvidence";
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
import { loadAuthorizedDocumentPurgeEvent } from "./documentPurgeEventAccess";
import {
  type ContainerProjectionContext,
  verifyStoredContainerPath,
} from "./documentPurgeProofAuthorization";
import {
  selectDocumentManifestPredecessors,
  uniquePurgeProofBundles,
} from "./documentPurgeProofHistory";
import { DocumentMutationError } from "./errors";

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
  const internalEvidence = await loadPrincipalPolicySelections(
    input.executor,
    internalPurgePrincipalReferences(material),
  );
  const context = createContainerWriterProjectionContext(
    input.executor,
    internalEvidence,
  );
  const { authorizingContainerPath, documentManifest } =
    await verifyRetainedPurgeManifests({ context, material });
  const principalPolicies = internalEvidence;
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
  const { event, body, documentManifestHash, authorizationMaterial } =
    await loadAuthorizedDocumentPurgeEvent(input);
  const material = await verifyProofMaterial({
    authorizationMaterial,
    body,
    documentId: input.documentId,
    documentManifestHash,
    event,
    executor: input.executor,
  });

  const callerObservedDocument =
    input.documentCheckpointManifestHash === undefined &&
    (await hasAnyDocumentManifestObservation(input.executor, {
      documentId: input.documentId,
      userId: input.userId,
    }));
  const documentManifestPredecessorBundles = selectDocumentManifestPredecessors(
    {
      authorizedCheckpointManifestHash: input.documentCheckpointManifestHash,
      includeObservedHistory: callerObservedDocument,
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
  const policyEvidence = await loadPurgePolicyEvidence({
    executor: input.executor,
    bundles: responseContainerBundles,
    scope: {
      objectKind: "document-purge",
      objectId: input.documentId,
      organizationId: event.event.organizationId,
      userId: input.userId,
    },
  });

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
    policyEvidence,
    purgeEvent: projectionVerifiedAccessEventRecord(event),
    purgedAt,
  };
}
