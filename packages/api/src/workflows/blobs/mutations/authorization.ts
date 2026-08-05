import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import type {
  AccessEvent,
  VerifiedContainerAccessManifest,
  VerifiedDocumentLinkSetManifest,
  VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import type {
  BlobAttachmentBindRequest,
  BlobAttachmentDetachRequest,
} from "@tearleads/validators/request";
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
