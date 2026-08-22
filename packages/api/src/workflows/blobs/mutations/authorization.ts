import type { DatabaseTransaction } from "@symcrypt/api-shared/postgres";
import type {
  AccessEvent,
  VerifiedContainerAccessManifest,
  VerifiedDocumentLinkSetManifest,
  VerifiedPrincipalPolicy,
} from "@symcrypt/crypto";
import type {
  BlobAttachmentBindRequest,
  BlobAttachmentDetachRequest,
} from "@symcrypt/validators/request";
import { lockAccessManifestHeadsForShare } from "../../../access/read/accessManifestStore";
import { uniqueSortedStrings } from "../../../utils/array";
import { assertOrganizationCanSync } from "../../billing/organizationSyncEligibility";
import { applyContainerRekeys } from "../../containers/mutations";
import {
  assertCurrentContainerPathRefGroups,
  loadCurrentDocumentManifest,
} from "../../documents/mutations";
import { loadPrincipalPoliciesForContainerPaths } from "../../principals/principalPolicyProjection";
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
  readonly contentKeyTargets: readonly {
    readonly containerId: string;
    readonly documentId: string;
  }[];
  readonly documentId: string;
  readonly linkedContainerIds: readonly string[];
}): { readonly containerIds: string[]; readonly documentIds: string[] } {
  return {
    containerIds: uniqueSortedStrings([
      ...input.authorizingContainerIds,
      ...input.linkedContainerIds,
      ...input.contentKeyTargets.map((target) => target.containerId),
    ]),
    documentIds: uniqueSortedStrings([
      input.documentId,
      ...input.contentKeyTargets.map((target) => target.documentId),
    ]),
  };
}

/**
 * Pin the complete authorization and key-target frontiers before an attachment
 * write. The container-then-document order matches document mutations, while
 * holding every target head prevents a concurrent relink or rekey from making
 * a bind's wrappers stale before commit.
 */
export async function lockAttachmentAuthorizationForShare(input: {
  readonly documentId: string;
  readonly executor: DatabaseTransaction;
  readonly proof: AttachmentAuthorizationProof;
  readonly request: BlobAttachmentBindRequest | BlobAttachmentDetachRequest;
}): Promise<void> {
  const contentKeyTargets =
    "contentKeyBundle" in input.request
      ? input.request.contentKeyBundle.targets
      : [];
  const lockPlan = createAttachmentAuthorizationLockPlan({
    authorizingContainerIds: input.proof.authorizingContainerPaths.flatMap(
      (path) => path.map((manifest) => manifest.state.containerId),
    ),
    contentKeyTargets,
    documentId: input.documentId,
    linkedContainerIds: input.proof.documentManifest.state.linkedContainerIds,
  });
  await lockAccessManifestHeadsForShare(
    "container",
    lockPlan.containerIds,
    input.executor,
  );
  await lockAccessManifestHeadsForShare(
    "document",
    lockPlan.documentIds,
    input.executor,
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
