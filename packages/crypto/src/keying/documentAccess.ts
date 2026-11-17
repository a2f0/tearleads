import { computeAccessManifestHash, verifyAccessManifest } from "./accessEvent";
import type { VerifiedAccessEvent } from "./accessEventTypes";
import type { VerifyDocumentLinkSetManifestInput } from "./accessManifestVerificationTypes";
import type { VerifiedContainerAccessManifest } from "./containerAccessTypes";
import {
  requireAnyDocumentLinkedContainerWriteAccess,
  requireDocumentContainerPathWriteAccess,
} from "./documentAccessAuthorization";
import { normalizeDocumentAccessEventBody } from "./documentAccessBody";
import type {
  DocumentAccessEventBody,
  DocumentLinkAccessEventBody,
  DocumentLinkSetManifestState,
  DocumentUnlinkAccessEventBody,
  VerifiedDocumentLinkSetManifest,
  VerifiedDocumentLinkSetStateEvidence,
} from "./documentAccessTypes";
import { makeVerifiedDocumentLinkSetManifest } from "./documentAccessTypes";
import { assertDocumentBlobRewrapScope } from "./documentBlobRewraps";
import { assertDocumentLinkSetCitationScope } from "./documentCitationScope";
import {
  deriveDocumentLinkSetManifest,
  normalizeDocumentLinkSetManifestState,
} from "./documentLinkSetManifest";
import type { PrincipalPolicyAuthorization as Policy } from "./principalPolicyTypes";
import { runVerifier, throwVerification } from "./shared";
import type { KeyingVerificationResult } from "./verificationError";

type DocumentLinkSetManifestDerivationInput = {
  readonly authorizationMembership: "current" | "referenced";
  readonly body: DocumentAccessEventBody;
  readonly event: VerifiedAccessEvent;
  readonly previousManifest: VerifiedDocumentLinkSetStateEvidence | null;
  readonly targetContainerPath:
    | readonly VerifiedContainerAccessManifest[]
    | undefined;
  readonly authorizingContainerPaths:
    | readonly (readonly VerifiedContainerAccessManifest[])[]
    | undefined;
  readonly principalPolicies: readonly Policy[];
};

interface PreviousDocumentLinkSetTransition {
  readonly nextBase: Omit<DocumentLinkSetManifestState, "linkedContainerIds">;
  readonly previousState: DocumentLinkSetManifestState;
}

function assertDocumentAccessEventDomain(
  input: DocumentLinkSetManifestDerivationInput,
): void {
  const { body, event } = input;

  if (event.event.objectKind !== "document") {
    throwVerification(
      "object_mismatch",
      "document access event must target a document",
    );
  }

  if (body.eventType !== event.event.eventType) {
    throwVerification(
      "invalid_domain",
      "document access event body type does not match event type",
    );
  }
}

function preparePreviousDocumentLinkSetTransition(
  input: DocumentLinkSetManifestDerivationInput,
): PreviousDocumentLinkSetTransition {
  const { event, previousManifest } = input;

  if (!previousManifest) {
    throwVerification(
      "missing_dependency",
      `${input.body.eventType} requires the previous document link-set manifest`,
    );
  }

  if (event.event.previousManifestHash !== previousManifest.manifestHash) {
    throwVerification(
      "stale_predecessor",
      "document access event previous manifest does not match supplied previous manifest",
    );
  }

  if (
    previousManifest.state.documentId !== event.event.objectId ||
    previousManifest.state.organizationId !== event.event.organizationId
  ) {
    throwVerification(
      "object_mismatch",
      "document access previous manifest targets the wrong document",
    );
  }

  assertDocumentLinkSetCitationScope(input);
  return {
    previousState: previousManifest.state,
    nextBase: {
      version: 1,
      documentId: previousManifest.state.documentId,
      organizationId: previousManifest.state.organizationId,
      epoch: previousManifest.state.epoch + 1,
      previousManifestHash: previousManifest.manifestHash,
      eventHash: event.eventHash,
    },
  };
}

function deriveInitialDocumentLinkSetManifestState(
  input: DocumentLinkSetManifestDerivationInput,
  body: DocumentLinkAccessEventBody,
): DocumentLinkSetManifestState {
  if (body.blobRewraps.length !== 0) {
    throwVerification(
      "invalid_shape",
      "initial document.link cannot rewrap attachments",
    );
  }
  if (input.event.event.previousManifestHash !== null) {
    throwVerification(
      "stale_predecessor",
      "initial document.link must not have a previous manifest",
    );
  }

  assertDocumentLinkSetCitationScope(input);
  requireDocumentContainerPathWriteAccess({
    authorizationMembership: input.authorizationMembership,
    containerId: body.containerId,
    event: input.event,
    label: "document.link target",
    manifestHash: body.containerManifestHash,
    organizationId: input.event.event.organizationId,
    path: input.targetContainerPath,
    principalPolicies: input.principalPolicies,
  });

  return normalizeDocumentLinkSetManifestState({
    version: 1,
    documentId: input.event.event.objectId,
    organizationId: input.event.event.organizationId,
    epoch: 1,
    previousManifestHash: null,
    eventHash: input.event.eventHash,
    linkedContainerIds: [body.containerId],
  });
}

function deriveDocumentLinkManifestState(
  input: DocumentLinkSetManifestDerivationInput,
  body: DocumentLinkAccessEventBody,
  previous: PreviousDocumentLinkSetTransition,
): DocumentLinkSetManifestState {
  if (previous.previousState.linkedContainerIds.includes(body.containerId)) {
    throwVerification(
      "duplicate_entry",
      "document.link target container is already linked",
    );
  }

  requireAnyDocumentLinkedContainerWriteAccess({
    authorizationMembership: input.authorizationMembership,
    event: input.event,
    label: "document.link existing access",
    linkedContainerIds: previous.previousState.linkedContainerIds,
    organizationId: previous.previousState.organizationId,
    paths: input.authorizingContainerPaths,
    principalPolicies: input.principalPolicies,
  });
  requireDocumentContainerPathWriteAccess({
    authorizationMembership: input.authorizationMembership,
    containerId: body.containerId,
    event: input.event,
    label: "document.link target",
    manifestHash: body.containerManifestHash,
    organizationId: previous.previousState.organizationId,
    path: input.targetContainerPath,
    principalPolicies: input.principalPolicies,
  });

  return normalizeDocumentLinkSetManifestState({
    ...previous.nextBase,
    linkedContainerIds: [
      ...previous.previousState.linkedContainerIds,
      body.containerId,
    ],
  });
}

function deriveDocumentUnlinkManifestState(
  input: DocumentLinkSetManifestDerivationInput,
  body: DocumentUnlinkAccessEventBody,
  previous: PreviousDocumentLinkSetTransition,
): DocumentLinkSetManifestState {
  if (!previous.previousState.linkedContainerIds.includes(body.containerId)) {
    throwVerification(
      "missing_dependency",
      "document.unlink target container is not linked",
    );
  }

  const remainingLinkedContainerIds =
    previous.previousState.linkedContainerIds.filter(
      (containerId) => containerId !== body.containerId,
    );

  if (remainingLinkedContainerIds.length === 0) {
    throwVerification(
      "missing_dependency",
      "document.unlink must leave at least one linked container",
    );
  }

  requireDocumentContainerPathWriteAccess({
    authorizationMembership: input.authorizationMembership,
    containerId: body.containerId,
    event: input.event,
    label: "document.unlink target",
    manifestHash: body.containerManifestHash,
    organizationId: previous.previousState.organizationId,
    path: input.targetContainerPath,
    principalPolicies: input.principalPolicies,
  });
  requireAnyDocumentLinkedContainerWriteAccess({
    authorizationMembership: input.authorizationMembership,
    event: input.event,
    label: "document.unlink remaining access",
    linkedContainerIds: remainingLinkedContainerIds,
    organizationId: previous.previousState.organizationId,
    paths: input.authorizingContainerPaths,
    principalPolicies: input.principalPolicies,
  });

  return normalizeDocumentLinkSetManifestState({
    ...previous.nextBase,
    linkedContainerIds: remainingLinkedContainerIds,
  });
}

function deriveDocumentLinkSetManifestStateFromEvent(
  input: DocumentLinkSetManifestDerivationInput,
): DocumentLinkSetManifestState {
  assertDocumentAccessEventDomain(input);

  if (input.body.eventType === "document.link" && !input.previousManifest) {
    return deriveInitialDocumentLinkSetManifestState(input, input.body);
  }

  const previous = preparePreviousDocumentLinkSetTransition(input);

  if (input.body.eventType === "document.link") {
    return deriveDocumentLinkManifestState(input, input.body, previous);
  }

  return deriveDocumentUnlinkManifestState(input, input.body, previous);
}

export async function verifyDocumentLinkSetManifest({
  authorizationMembership = "current",
  authorizingContainerPaths,
  checkpointPredecessors,
  event,
  expectedManifestHash,
  localCheckpoint,
  manifest,
  previousManifest = null,
  principalPolicies = [],
  targetContainerPath,
}: VerifyDocumentLinkSetManifestInput): Promise<
  KeyingVerificationResult<VerifiedDocumentLinkSetManifest>
> {
  return runVerifier(async () => {
    const body = normalizeDocumentAccessEventBody(event.body);
    const state = deriveDocumentLinkSetManifestStateFromEvent({
      authorizationMembership,
      authorizingContainerPaths,
      body,
      event,
      previousManifest,
      principalPolicies,
      targetContainerPath,
    });
    assertDocumentBlobRewrapScope(body.blobRewraps, state);
    const derivedManifest = await deriveDocumentLinkSetManifest(state);
    const derivedManifestHash =
      await computeAccessManifestHash(derivedManifest);

    if (derivedManifestHash !== expectedManifestHash) {
      throwVerification(
        "hash_mismatch",
        "document link-set manifest hash does not match derived state",
      );
    }

    const verifiedManifest = await verifyAccessManifest({
      manifest,
      expectedManifestHash,
      event,
      expectedObject: {
        objectKind: "document",
        objectId: state.documentId,
      },
      expectedPreviousManifestHash: state.previousManifestHash,
      localCheckpoint,
      checkpointPredecessors,
    });

    if (!verifiedManifest.ok) {
      throw verifiedManifest.error;
    }

    return makeVerifiedDocumentLinkSetManifest({
      manifest: verifiedManifest.value.manifest,
      manifestHash: verifiedManifest.value.manifestHash,
      event,
      state,
      checkpoint: verifiedManifest.value.checkpoint,
    });
  });
}
