import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import type {
  VerifiedAccessEvent,
  VerifiedContainerAccessManifest,
  VerifiedDocumentLinkSetManifest,
  VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import { verifyDocumentPurgeEvent } from "@tearleads/crypto";
import type { DocumentPurgeRequest } from "@tearleads/validators/request";
import { loadPrincipalPoliciesForContainerPaths } from "../../../principals/principalPolicyProjection";
import { DocumentMutationError } from "../errors";
import {
  assertCurrentContainerPathRefs,
  loadCurrentDocumentManifest,
  verifyDocumentEvent,
} from "./verification";

export async function verifyDocumentPurgeRequest(input: {
  readonly documentId: string;
  readonly executor: DatabaseTransaction;
  readonly fingerprint: string;
  readonly request: DocumentPurgeRequest;
  readonly userId: string;
}): Promise<{
  readonly authorizingContainerPath: readonly VerifiedContainerAccessManifest[];
  readonly documentManifest: VerifiedDocumentLinkSetManifest;
  readonly event: VerifiedAccessEvent;
  readonly principalPolicies: readonly VerifiedPrincipalPolicy[];
}> {
  const event = await verifyDocumentEvent({
    body: input.request.body,
    event: input.request.event,
    executor: input.executor,
    expectedDocumentId: input.documentId,
    expectedEventType: "document.purge",
    fingerprint: input.fingerprint,
    userId: input.userId,
  });
  const documentManifest = await loadCurrentDocumentManifest(
    input.documentId,
    input.executor,
  );
  const authorizingContainerPath = await assertCurrentContainerPathRefs(
    input.executor,
    input.request.authorizingContainerPathRefs,
    "authorizingContainerPathRefs",
  );
  if (!authorizingContainerPath) {
    throw new DocumentMutationError(
      "Document purge authorization path is missing",
      400,
    );
  }
  const principalPolicies = await loadPrincipalPoliciesForContainerPaths(
    input.executor,
    [authorizingContainerPath],
  );
  const verified = await verifyDocumentPurgeEvent({
    authorizingContainerPath,
    documentManifest,
    event,
    expectedDocumentId: input.documentId,
    principalPolicies,
  });
  if (!verified.ok) throw verified.error;
  return {
    authorizingContainerPath,
    documentManifest,
    event: verified.value,
    principalPolicies,
  };
}
