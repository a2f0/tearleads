import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import { documents } from "@tearleads/api-shared/schema";
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
import { eq } from "drizzle-orm";
import { getCurrentAccessManifestHead } from "../../../access/read/accessManifestStore";
import { applyContainerRekeys } from "../../containers/mutations";
import {
  assertCurrentContainerPathRefGroups,
  assertDocumentManifestBundleConsistent,
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

async function assertDocumentManifestCurrent(input: {
  readonly documentId: string;
  readonly executor: DatabaseTransaction;
  readonly manifest: VerifiedDocumentLinkSetManifest;
}): Promise<void> {
  if (
    input.manifest.state.documentId !== input.documentId ||
    input.manifest.manifest.objectKind !== "document" ||
    input.manifest.manifest.objectId !== input.documentId
  ) {
    throw new BlobMutationError(
      "Attachment document manifest does not match body",
      409,
    );
  }

  const [document] = await input.executor
    .select({ id: documents.id })
    .from(documents)
    .where(eq(documents.id, input.documentId))
    .limit(1);
  if (!document) {
    throw new BlobMutationError("Document not found", 404);
  }

  const head = await getCurrentAccessManifestHead(
    "document",
    input.documentId,
    input.executor,
  );
  if (!head) {
    throw new BlobMutationError("Document link-set manifest head missing", 404);
  }
  if (head.manifestHash !== input.manifest.manifestHash) {
    throw new BlobMutationError("Document link-set manifest is stale", 409);
  }
}

export async function verifyAttachmentAuthorizationProof(input: {
  readonly bodyDocumentId: string;
  readonly executor: DatabaseTransaction;
  readonly request: BlobAttachmentBindRequest | BlobAttachmentDetachRequest;
}): Promise<AttachmentAuthorizationProof> {
  const [documentManifest, authorizingContainerPaths] = await Promise.all([
    assertDocumentManifestBundleConsistent(
      input.request.documentManifest,
      "documentManifest",
    ),
    assertCurrentContainerPathRefGroups(
      input.executor,
      input.request.authorizingContainerPathRefs,
      "authorizingContainerPathRefs",
    ),
  ]);
  await assertDocumentManifestCurrent({
    documentId: input.bodyDocumentId,
    executor: input.executor,
    manifest: documentManifest,
  });

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
