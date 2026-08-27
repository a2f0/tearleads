import type { DatabaseSession } from "@symcrypt/api-shared/postgres";
import { containerDocumentSyncTombstones } from "@symcrypt/api-shared/schema";
import type {
  VerifiedAccessEvent,
  VerifiedContainerAccessManifest,
} from "@symcrypt/crypto";
import {
  normalizeDocumentPurgeAccessEventBody,
  resolveHistoricalContainerPathUserAccessLevel,
  verifyDocumentPurgeEvent,
  verifySignedAccessEvent,
} from "@symcrypt/crypto";
import type {
  AccessManifestBundleWireResponse,
  DocumentPurgeProofResponse,
} from "@symcrypt/validators/response";
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
import { loadContainerManifestBundleByHash } from "../../containers/writerProjection/accessPaths";
import { verifyStoredContainerManifest } from "../../containers/writerProjection/storedManifestVerification";
import { loadVerifiedPrincipalPolicySnapshotsForReferences } from "../../principals/principalPolicySnapshots";
import { loadSignerPublicKey } from "../../signerPublicKey";
import {
  StoredDocumentManifestError,
  verifyStoredDocumentManifest,
} from "../storedDocumentManifestVerification";
import { DocumentWriterProjectionError } from "../writerProjection";
import {
  collectPurgeProofPrincipalReferences,
  loadAuthorizingContainerCheckpointMaterial,
  loadDocumentPurgeProofMaterial,
} from "../writerProjectionPurgeProof";
import { DocumentMutationError } from "./errors";

const MAX_CONTAINER_HISTORY_DEPTH = 4_096;
type ContainerProjectionContext = ReturnType<
  typeof createContainerWriterProjectionContext
>;

function documentManifestSnapshot(bundle: AccessManifestBundleWireResponse) {
  return {
    manifest: bundle.manifest,
    manifestHash: bundle.manifestHash,
    state: bundle.state,
  };
}

function accessManifestSnapshot(bundle: AccessManifestBundleWireResponse) {
  return {
    manifest: bundle.manifest,
    manifestHash: bundle.manifestHash,
  };
}

function documentManifestPredecessors(input: {
  readonly checkpointManifestHash?: string | undefined;
  readonly head: AccessManifestBundleWireResponse;
  readonly history: readonly AccessManifestBundleWireResponse[];
}) {
  if (
    input.checkpointManifestHash === undefined ||
    input.checkpointManifestHash === input.head.manifestHash
  ) {
    return [];
  }
  const checkpointIndex = input.history.findIndex(
    (bundle) => bundle.manifestHash === input.checkpointManifestHash,
  );
  if (checkpointIndex < 0) {
    throw new DocumentMutationError(
      "Document purge checkpoint does not belong to the retained document chain",
      409,
    );
  }
  return input.history.slice(0, checkpointIndex).map((bundle) => ({
    manifest: bundle.manifest,
    manifestHash: bundle.manifestHash,
  }));
}

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

async function verifyStoredContainerPath(input: {
  readonly bundles: readonly AccessManifestBundleWireResponse[];
  readonly context: ContainerProjectionContext;
}): Promise<VerifiedContainerAccessManifest[]> {
  const verified: VerifiedContainerAccessManifest[] = [];
  for (const bundle of input.bundles) {
    verified.push(
      await verifyStoredContainerManifest({
        bundle,
        context: input.context,
        loadBundle: (manifestHash) =>
          loadContainerManifestBundleByHash(input.context, manifestHash),
      }),
    );
  }
  return verified;
}

async function assertCheckpointHeadExtends(input: {
  readonly authorizingManifest: VerifiedContainerAccessManifest;
  readonly bundle: AccessManifestBundleWireResponse;
  readonly context: ContainerProjectionContext;
}) {
  let currentBundle = input.bundle;
  let current = await verifyStoredContainerManifest({
    bundle: currentBundle,
    context: input.context,
    loadBundle: (manifestHash) =>
      loadContainerManifestBundleByHash(input.context, manifestHash),
  });
  const visited = new Set<string>();
  const reverseChain: ReturnType<typeof accessManifestSnapshot>[] = [];
  for (let depth = 0; depth < MAX_CONTAINER_HISTORY_DEPTH; depth += 1) {
    if (
      current.state.containerId !== input.authorizingManifest.state.containerId
    ) {
      throw new DocumentMutationError(
        "Document purge authorization checkpoint belongs to another container",
        409,
      );
    }
    if (current.manifestHash === input.authorizingManifest.manifestHash) {
      return reverseChain.reverse();
    }
    if (
      current.state.epoch <= input.authorizingManifest.state.epoch ||
      !current.state.previousManifestHash ||
      visited.has(current.manifestHash)
    ) {
      break;
    }
    reverseChain.push(accessManifestSnapshot(currentBundle));
    visited.add(current.manifestHash);
    currentBundle = await loadContainerManifestBundleByHash(
      input.context,
      current.state.previousManifestHash,
    );
    current = await verifyStoredContainerManifest({
      bundle: currentBundle,
      context: input.context,
      loadBundle: (manifestHash) =>
        loadContainerManifestBundleByHash(input.context, manifestHash),
    });
  }
  throw new DocumentMutationError(
    "Document purge authorization checkpoint does not extend the signed path",
    409,
  );
}

async function loadVerifiedCheckpointMaterial(input: {
  readonly authorizingContainerPath: readonly VerifiedContainerAccessManifest[];
  readonly checkpointManifestHashes: readonly string[];
  readonly context: ContainerProjectionContext;
  readonly executor: DatabaseSession;
}) {
  if (
    input.checkpointManifestHashes.length !==
    input.authorizingContainerPath.length
  ) {
    throw new DocumentMutationError(
      "Document purge authorization checkpoint count is inconsistent",
      400,
    );
  }
  let checkpointMaterial: Awaited<
    ReturnType<typeof loadAuthorizingContainerCheckpointMaterial>
  >;
  try {
    checkpointMaterial = await loadAuthorizingContainerCheckpointMaterial({
      checkpointManifestHashes: input.checkpointManifestHashes,
      executor: input.executor,
    });
  } catch (error) {
    if (error instanceof DocumentWriterProjectionError) {
      throw new DocumentMutationError(error.message, 409);
    }
    throw error;
  }
  if (
    checkpointMaterial.heads.length !== input.authorizingContainerPath.length
  ) {
    throw new DocumentMutationError(
      "Document purge authorization checkpoint count is inconsistent",
      409,
    );
  }
  const chains: Awaited<ReturnType<typeof assertCheckpointHeadExtends>>[] = [];
  for (const [index, bundle] of checkpointMaterial.heads.entries()) {
    const authorizingManifest = input.authorizingContainerPath[index];
    if (!authorizingManifest) {
      throw new DocumentMutationError(
        "Document purge authorization checkpoint count is inconsistent",
        409,
      );
    }
    chains.push(
      await assertCheckpointHeadExtends({
        authorizingManifest,
        bundle,
        context: input.context,
      }),
    );
  }
  return { ...checkpointMaterial, chains };
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
    await Promise.all(
      input.material.documentManifestContainerPaths.map((bundles) =>
        verifyStoredContainerPath({ bundles, context: input.context }),
      ),
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
  readonly material: Awaited<ReturnType<typeof loadDocumentPurgeProofMaterial>>;
}) {
  return collectPurgeProofPrincipalReferences([
    ...input.material.authorizingContainerPath,
    ...input.material.authorizingContainerManifestHistory,
  ]);
}

async function verifyProofMaterial(input: {
  readonly checkpointManifestHashes?: readonly string[] | undefined;
  readonly documentCheckpointManifestHash?: string | undefined;
  readonly documentId: string;
  readonly event: VerifiedAccessEvent;
  readonly executor: DatabaseSession;
}) {
  const body = normalizeDocumentPurgeAccessEventBody(input.event.body);
  const documentManifestHash = input.event.event.previousManifestHash;
  if (
    documentManifestHash === null ||
    documentManifestHash !== body.documentManifestHash
  ) {
    throw new DocumentMutationError(
      "Stored document purge predecessor is inconsistent",
      409,
    );
  }
  const material = await loadDocumentPurgeProofMaterial({
    authorizingContainerManifestHashes: body.authorizingContainerManifestHashes,
    documentManifestHash,
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
  const checkpointMaterial = await loadVerifiedCheckpointMaterial({
    authorizingContainerPath,
    checkpointManifestHashes:
      input.checkpointManifestHashes ??
      authorizingContainerPath.map((manifest) => manifest.manifestHash),
    context,
    executor: input.executor,
  });
  const responseEvidence =
    await loadVerifiedPrincipalPolicySnapshotsForReferences(
      input.executor,
      responsePurgePrincipalReferences({ material }),
    );
  return {
    authorizingContainerPath,
    body,
    material: {
      authorizingContainerCheckpointChains: checkpointMaterial.chains,
      authorizingContainerPath: material.authorizingContainerPath,
      documentContainerManifestHistory:
        material.authorizingContainerManifestHistory,
      documentManifest: documentManifestSnapshot(material.documentManifest),
      documentManifestPredecessors: documentManifestPredecessors({
        checkpointManifestHash: input.documentCheckpointManifestHash,
        head: material.documentManifest,
        history: material.documentManifestHistory,
      }),
      principalPolicySnapshots: responseEvidence.snapshots,
    },
    principalPolicies,
  };
}

export async function loadDocumentPurgeProof(input: {
  readonly checkpointManifestHashes?: readonly string[] | undefined;
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
  const { authorizingContainerPath, body, material, principalPolicies } =
    await verifyProofMaterial({
      checkpointManifestHashes: input.checkpointManifestHashes,
      documentCheckpointManifestHash: input.documentCheckpointManifestHash,
      documentId: input.documentId,
      event,
      executor: input.executor,
    });

  // A purge proof is terminal history, not a claim about the container's
  // current state. A replica that had access when the purge was signed must
  // still be able to learn that it should delete its local copy after the user
  // is revoked or the container itself is deleted.
  const hadPurgePathAccess =
    resolveHistoricalContainerPathUserAccessLevel({
      path: authorizingContainerPath,
      principalPolicies,
      userId: input.userId,
    }) !== null;
  if (!hadPurgePathAccess) {
    throw new DocumentMutationError("Forbidden", 403);
  }

  const [tombstone] = await input.executor
    .select({ purgedAt: containerDocumentSyncTombstones.updatedAt })
    .from(containerDocumentSyncTombstones)
    .where(
      and(
        eq(containerDocumentSyncTombstones.containerId, body.containerId),
        eq(containerDocumentSyncTombstones.documentId, input.documentId),
      ),
    )
    .limit(1);
  if (!tombstone) {
    throw new DocumentMutationError("Document purge tombstone is missing", 409);
  }

  return {
    ...material,
    documentId: input.documentId,
    purgeEvent: projectionVerifiedAccessEventRecord(event),
    purgedAt: tombstone.purgedAt.toISOString(),
  };
}
