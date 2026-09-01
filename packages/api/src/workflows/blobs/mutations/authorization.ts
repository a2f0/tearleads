import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import { blobAuditObjects, blobs } from "@tearleads/api-shared/schema";
import type {
  AccessEvent,
  VerifiedContainerAccessManifest,
  VerifiedDocumentLinkSetManifest,
  VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import type {
  BlobAttachmentBindRequest,
  BlobAttachmentDetachRequest,
  BlobContentKeyTargetEnvelopeRequest,
} from "@tearleads/validators/request";
import { eq } from "drizzle-orm";
import { listBlobContentWriteHeaders } from "../../../access/read/blobContentKeyStore";
import {
  BlobKekTargetError,
  resolveCurrentBlobKekTargets,
} from "../../../access/read/blobKekTargets";
import { listCurrentContainerKekTargetClosureIdsMapped } from "../../../access/read/containerKekTargets";
import { uniqueSortedStrings } from "../../../utils/array";
import { assertOrganizationCanSync } from "../../billing/organizationSyncEligibility";
import { applyContainerRekeys } from "../../containers/mutations";
import {
  assertCurrentContainerPathRefGroups,
  loadCurrentDocumentManifest,
} from "../../documents/mutations";
import { loadPrincipalPoliciesForContainerPaths } from "../../principals/principalPolicyProjection";
import { lockAttachmentAuthorizationHeadsForShare } from "./authorizationLocks";
import {
  readBindBodyClaim,
  readBlobEvent,
  readDetachBodyClaim,
} from "./records";
import {
  type BindBlobAttachmentInput,
  BlobMutationError,
  type DetachBlobAttachmentInput,
} from "./types";

export interface AttachmentAuthorizationProof {
  readonly authorizingContainerPaths: readonly (readonly VerifiedContainerAccessManifest[])[];
  readonly documentManifest: VerifiedDocumentLinkSetManifest;
  readonly principalPolicies: readonly VerifiedPrincipalPolicy[];
}

function assertAttachmentEventSession(input: {
  readonly blobId: string;
  readonly event: AccessEvent;
  readonly expectedEventType: AccessEvent["eventType"];
  readonly fingerprint: string;
  readonly userId: string;
}): void {
  if (
    input.event.signerUserId !== input.userId ||
    input.event.signerKeyFingerprint !== input.fingerprint
  ) {
    throw new BlobMutationError("Forbidden", 403);
  }

  if (input.event.eventType !== input.expectedEventType) {
    throw new BlobMutationError("Unexpected attachment event type", 400);
  }

  if (
    input.event.objectKind !== "blob" ||
    input.event.objectId !== input.blobId
  ) {
    throw new BlobMutationError("Blob id mismatch", 400);
  }
}

export async function verifyAttachmentAuthorizationProof(input: {
  readonly bodyDocumentId: string;
  readonly executor: DatabaseTransaction;
  readonly request: BlobAttachmentBindRequest | BlobAttachmentDetachRequest;
}): Promise<AttachmentAuthorizationProof> {
  const [documentManifest, authorizingContainerPaths] = await Promise.all([
    loadCurrentDocumentManifest(input.bodyDocumentId, input.executor),
    assertCurrentContainerPathRefGroups(
      input.executor,
      input.request.authorizingContainerPathRefs,
      "authorizingContainerPathRefs",
    ),
  ]);

  if (!authorizingContainerPaths || authorizingContainerPaths.length === 0) {
    throw new BlobMutationError(
      "Attachment authorization paths are required",
      400,
    );
  }

  const principalPolicies = await loadPrincipalPoliciesForContainerPaths(
    input.executor,
    authorizingContainerPaths,
  );

  return {
    authorizingContainerPaths,
    documentManifest,
    principalPolicies,
  };
}

export async function assertAttachmentOrganizationCanSync(
  executor: DatabaseTransaction,
  proof: AttachmentAuthorizationProof,
  userId: string,
): Promise<void> {
  await assertOrganizationCanSync(
    executor,
    proof.documentManifest.state.organizationId,
    userId,
  );
}

export function createAttachmentAuthorizationLockPlan(input: {
  readonly authorizingContainerIds: readonly string[];
  readonly containerKekTargetClosureIds: readonly string[];
  readonly existingBlobTargets: readonly {
    readonly containerId: string;
    readonly documentId: string;
  }[];
  readonly documentId: string;
  readonly linkedContainerIds: readonly string[];
}): { readonly containerIds: string[]; readonly documentIds: string[] } {
  return {
    containerIds: uniqueSortedStrings([
      ...input.authorizingContainerIds,
      ...input.containerKekTargetClosureIds,
      ...input.linkedContainerIds,
      ...input.existingBlobTargets.map((target) => target.containerId),
    ]),
    documentIds: uniqueSortedStrings([
      input.documentId,
      ...input.existingBlobTargets.map((target) => target.documentId),
    ]),
  };
}

function assertContainerKekTargetClosureUnchanged(
  expectedIds: readonly string[],
  actualIds: readonly string[],
): void {
  if (
    expectedIds.length !== actualIds.length ||
    expectedIds.some((containerId, index) => containerId !== actualIds[index])
  ) {
    throw new BlobMutationError("Blob content-key target heads are stale", 409);
  }
}

async function resolveExistingBlobTargetsForLock(input: {
  readonly blobId: string;
  readonly executor: DatabaseTransaction;
  readonly organizationId: string;
}) {
  try {
    await assertStoredBlobOrganizationMatches({
      blobId: input.blobId,
      executor: input.executor,
      expectedOrganizationId: input.organizationId,
    });
  } catch (error) {
    if (error instanceof BlobMutationError && error.status === 404) {
      return { concealed: true, targets: [] } as const;
    }
    throw error;
  }
  try {
    const currentTargets = await resolveCurrentBlobKekTargets(
      input.blobId,
      input.executor,
    );
    assertBlobTargetOrganizationMatches({
      actualOrganizationId: currentTargets.organizationId,
      expectedOrganizationId: input.organizationId,
    });
    return { concealed: false, targets: currentTargets.targets } as const;
  } catch (error) {
    if (error instanceof BlobKekTargetError && error.status === 404) {
      return { concealed: false, targets: [] } as const;
    }
    throw error;
  }
}

export async function assertStoredBlobOrganizationMatches(input: {
  readonly blobId: string;
  readonly executor: DatabaseTransaction;
  readonly expectedOrganizationId: string;
}): Promise<void> {
  const storedHeader = (
    await listBlobContentWriteHeaders([input.blobId], input.executor)
  ).get(input.blobId);
  if (!storedHeader) {
    const [existingBlob] = await input.executor
      .select({ id: blobs.id })
      .from(blobs)
      .where(eq(blobs.id, input.blobId))
      .limit(1);
    if (existingBlob) {
      // Existing ciphertext without a verified organization claim is invalid
      // under the clean-break contract. Hide it like every foreign blob id.
      throw new BlobMutationError("Blob not found", 404);
    }

    const [auditedBlob] = await input.executor
      .select({ organizationId: blobAuditObjects.organizationId })
      .from(blobAuditObjects)
      .where(eq(blobAuditObjects.blobId, input.blobId))
      .limit(1);
    if (auditedBlob) {
      assertBlobTargetOrganizationMatches({
        actualOrganizationId: auditedBlob.organizationId,
        expectedOrganizationId: input.expectedOrganizationId,
      });
    }
    return;
  }
  assertBlobTargetOrganizationMatches({
    actualOrganizationId: storedHeader.header.organizationId,
    expectedOrganizationId: input.expectedOrganizationId,
  });
}

export function assertBlobTargetOrganizationMatches(input: {
  readonly actualOrganizationId: string;
  readonly expectedOrganizationId: string;
}): void {
  if (input.actualOrganizationId !== input.expectedOrganizationId) {
    // Match an unknown blob so callers cannot probe cross-organization ids.
    throw new BlobMutationError("Blob not found", 404);
  }
}

export function assertRequestedBlobTargetHeadsAreKnown(input: {
  readonly documentId: string;
  readonly existingBlobTargets: readonly {
    readonly containerId: string;
    readonly documentId: string;
  }[];
  readonly linkedContainerIds: readonly string[];
  readonly requestedTargets: readonly {
    readonly containerId: string;
    readonly documentId: string;
  }[];
}): void {
  const maximumTargetCount =
    input.existingBlobTargets.length + input.linkedContainerIds.length;
  if (input.requestedTargets.length > maximumTargetCount) {
    throw new BlobMutationError("Blob content-key target heads are stale", 409);
  }

  const knownContainerIds = new Set([
    ...input.linkedContainerIds,
    ...input.existingBlobTargets.map((target) => target.containerId),
  ]);
  const knownDocumentIds = new Set([
    input.documentId,
    ...input.existingBlobTargets.map((target) => target.documentId),
  ]);
  if (
    input.requestedTargets.some(
      (target) =>
        !knownContainerIds.has(target.containerId) ||
        !knownDocumentIds.has(target.documentId),
    )
  ) {
    throw new BlobMutationError("Blob content-key target heads are stale", 409);
  }
}

/**
 * Pin the complete authorization and key-target frontiers before an attachment
 * write. The container-then-document order matches document mutations, while
 * holding every target head prevents a concurrent relink or rekey from making
 * a bind's wrappers stale before commit.
 */
export async function lockAttachmentAuthorizationForShare(input: {
  readonly blobId?: string;
  readonly contentKeyTargets?: readonly BlobContentKeyTargetEnvelopeRequest[];
  readonly documentId: string;
  readonly executor: DatabaseTransaction;
  readonly proof: AttachmentAuthorizationProof;
  readonly request: BlobAttachmentBindRequest | BlobAttachmentDetachRequest;
}): Promise<void> {
  const existingBlobResolution =
    input.blobId === undefined || input.contentKeyTargets === undefined
      ? { concealed: false, targets: [] }
      : await resolveExistingBlobTargetsForLock({
          blobId: input.blobId,
          executor: input.executor,
          organizationId: input.proof.documentManifest.state.organizationId,
        });
  const existingBlobTargets = existingBlobResolution.targets;
  const linkedContainerIds =
    input.proof.documentManifest.state.linkedContainerIds;
  const authorizingContainerIds = input.proof.authorizingContainerPaths.flatMap(
    (path) => path.map((manifest) => manifest.state.containerId),
  );
  if (input.contentKeyTargets !== undefined) {
    assertRequestedBlobTargetHeadsAreKnown({
      documentId: input.documentId,
      existingBlobTargets,
      linkedContainerIds,
      requestedTargets: input.contentKeyTargets,
    });
  }
  if (existingBlobResolution.concealed) {
    throw new BlobMutationError("Blob not found", 404);
  }
  const containerKekTargetSeedIds = uniqueSortedStrings([
    ...authorizingContainerIds,
    ...linkedContainerIds,
    ...existingBlobTargets.map((target) => target.containerId),
  ]);
  const mapContainerKekTargetError = (message: string, status: 404 | 409) =>
    new BlobMutationError(message, status);
  const containerKekTargetClosureIds =
    await listCurrentContainerKekTargetClosureIdsMapped(
      containerKekTargetSeedIds,
      input.executor,
      mapContainerKekTargetError,
    );
  const lockPlan = createAttachmentAuthorizationLockPlan({
    authorizingContainerIds,
    containerKekTargetClosureIds,
    documentId: input.documentId,
    existingBlobTargets,
    linkedContainerIds,
  });
  await lockAttachmentAuthorizationHeadsForShare({
    ...lockPlan,
    executor: input.executor,
  });

  const lockedContainerKekTargetClosureIds =
    await listCurrentContainerKekTargetClosureIdsMapped(
      containerKekTargetSeedIds,
      input.executor,
      mapContainerKekTargetError,
    );
  assertContainerKekTargetClosureUnchanged(
    containerKekTargetClosureIds,
    lockedContainerKekTargetClosureIds,
  );

  const lockedManifest = await loadCurrentDocumentManifest(
    input.documentId,
    input.executor,
  );
  if (
    lockedManifest.manifestHash !== input.proof.documentManifest.manifestHash
  ) {
    throw new BlobMutationError("Document manifest changed concurrently", 409);
  }
  await assertCurrentContainerPathRefGroups(
    input.executor,
    input.request.authorizingContainerPathRefs,
    "authorizingContainerPathRefs",
  );
}

export async function applyAttachmentContainerRekeys(input: {
  readonly executor: DatabaseTransaction;
  readonly fingerprint: string;
  readonly request: BlobAttachmentBindRequest | BlobAttachmentDetachRequest;
  readonly userId: string;
}): Promise<void> {
  // Attachment writes accept signed container.rekey payloads before reading
  // current authorization paths or KEK targets, so stale key material can be
  // repaired in the same transaction as the blob write.
  await applyContainerRekeys({
    executor: input.executor,
    fingerprint: input.fingerprint,
    requests: input.request.containerRekeys,
    userId: input.userId,
  });
}

export function readBindRequestSession(input: BindBlobAttachmentInput) {
  const bindBody = readBindBodyClaim(input.request.body);
  const event = readBlobEvent(input.request.event, "Blob event");
  assertAttachmentEventSession({
    blobId: input.blobId,
    event,
    expectedEventType: "attachment.bind",
    fingerprint: input.fingerprint,
    userId: input.userId,
  });
  if (bindBody.blobId !== input.blobId) {
    throw new BlobMutationError("Blob id mismatch", 400);
  }

  return { bindBody, event };
}

export function readDetachRequestSession(input: DetachBlobAttachmentInput) {
  const detachBody = readDetachBodyClaim(input.request.body);
  const event = readBlobEvent(input.request.event, "Blob event");
  assertAttachmentEventSession({
    blobId: input.blobId,
    event,
    expectedEventType: "attachment.detach",
    fingerprint: input.fingerprint,
    userId: input.userId,
  });
  if (
    detachBody.blobId !== input.blobId ||
    detachBody.bindingId !== input.bindingId
  ) {
    throw new BlobMutationError("Attachment binding mismatch", 400);
  }

  return { detachBody, event };
}
