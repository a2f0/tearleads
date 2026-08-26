import type { DatabaseSession } from "@symcrypt/api-shared/postgres";
import { containerDocumentSyncTombstones } from "@symcrypt/api-shared/schema";
import type {
  VerifiedAccessEvent,
  VerifiedContainerAccessManifest,
  VerifiedDocumentLinkSetManifest,
} from "@symcrypt/crypto";
import {
  normalizeDocumentPurgeAccessEventBody,
  verifyDocumentPurgeEvent,
  verifySignedAccessEvent,
} from "@symcrypt/crypto";
import type { DocumentPurgeProofResponse } from "@symcrypt/validators/response";
import { and, eq } from "drizzle-orm";
import { getStoredAccessEventByObjectType } from "../../../access/read/accessManifestStore";
import {
  keyingVerificationHttpStatus,
  projectionVerifiedAccessEventRecord,
} from "../../../keyingProjectionRecords";
import {
  ContainerWriterProjectionError,
  createContainerWriterProjectionContext,
  resolveContainerAccessProjection,
} from "../../containers/writerProjection";
import { loadContainerManifestBundleByHash } from "../../containers/writerProjection/accessPaths";
import { verifyStoredContainerManifest } from "../../containers/writerProjection/storedManifestVerification";
import { loadPrincipalPoliciesForContainerPaths } from "../../principals/principalPolicyProjection";
import { loadSignerPublicKey } from "../../signerPublicKey";
import {
  StoredDocumentManifestError,
  verifyStoredDocumentManifest,
} from "../storedDocumentManifestVerification";
import { loadDocumentPurgeProofMaterial } from "../writerProjectionPurgeProof";
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

async function verifyProofMaterial(input: {
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
    authorizingContainerManifestHash: body.containerManifestHash,
    documentManifestHash,
    executor: input.executor,
  });
  const context = createContainerWriterProjectionContext(input.executor);
  let documentManifest: VerifiedDocumentLinkSetManifest;
  const authorizingContainerPath: VerifiedContainerAccessManifest[] = [];
  try {
    documentManifest = await verifyStoredDocumentManifest({
      bundle: material.documentManifest,
      containerContext: context,
    });
    for (const bundle of material.authorizingContainerPath) {
      authorizingContainerPath.push(
        await verifyStoredContainerManifest({
          bundle,
          context,
          loadBundle: (manifestHash) =>
            loadContainerManifestBundleByHash(context, manifestHash),
        }),
      );
    }
  } catch (error) {
    if (
      error instanceof StoredDocumentManifestError ||
      error instanceof ContainerWriterProjectionError
    ) {
      throw new DocumentMutationError(error.message, 409);
    }
    throw error;
  }
  const principalPolicies = await loadPrincipalPoliciesForContainerPaths(
    input.executor,
    [authorizingContainerPath],
  );
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
  return { body, material };
}

export async function loadDocumentPurgeProof(input: {
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
  const { body, material } = await verifyProofMaterial({
    documentId: input.documentId,
    event,
    executor: input.executor,
  });

  try {
    await resolveContainerAccessProjection({
      containerId: body.containerId,
      executor: input.executor,
      minimumAccessLevel: "read",
      userId: input.userId,
    });
  } catch (error) {
    if (error instanceof ContainerWriterProjectionError) {
      throw new DocumentMutationError(error.message, error.status);
    }
    throw error;
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
