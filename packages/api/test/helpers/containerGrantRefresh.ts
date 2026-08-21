import type { TestUser } from "@symcrypt/bob-and-alice";
import type {
  ContainerAccessEventBody,
  VerifiedContainerKekState,
  VerifiedPrincipalPolicy,
} from "@symcrypt/crypto";
import type {
  AccessManifestBundleWire,
  ContainerMutationRequest,
} from "@symcrypt/validators/request";
import { createContainerKeyWrap } from "./containerKeying";
import { refreshContainerMutationPrincipal } from "./containerMutationPrincipalRefresh";
import {
  asVerifiedContainerManifest,
  createManifestBundle,
  createSignedContainerEvent,
  loadPrincipalPoliciesForContainerPaths,
} from "./containerMutationRotations";

export async function buildPrincipalGrantRefreshRequest(input: {
  readonly parentKekState: VerifiedContainerKekState | null;
  readonly previous: AccessManifestBundleWire;
  readonly previousContainerPath: readonly AccessManifestBundleWire[];
  readonly previousKekState: VerifiedContainerKekState;
  readonly replacementPrincipalPolicy: VerifiedPrincipalPolicy;
  readonly signer: TestUser;
}): Promise<ContainerMutationRequest> {
  const previous = asVerifiedContainerManifest(input.previous);
  const currentPrincipalPolicies = await loadPrincipalPoliciesForContainerPaths(
    [input.previousContainerPath],
  );
  const refreshed = refreshContainerMutationPrincipal({
    currentPrincipalPolicies,
    currentRecipientTargets: input.previousKekState.recipientTargets,
    currentReferencedPrincipalHeads: previous.state.referencedPrincipalHeads,
    replacementPrincipalPolicy: input.replacementPrincipalPolicy,
  });
  const replacementGrant = previous.state.directGrants.find(
    (grant) =>
      grant.subjectType === input.replacementPrincipalPolicy.principalType &&
      grant.subjectId === input.replacementPrincipalPolicy.principalId,
  );
  const replacementHead = refreshed.referencedPrincipalHeads.find(
    (head) =>
      head.principalType === input.replacementPrincipalPolicy.principalType &&
      head.principalId === input.replacementPrincipalPolicy.principalId,
  );
  if (!replacementGrant || !replacementHead) {
    throw new Error("Expected container grant for replacement principal");
  }
  const body: ContainerAccessEventBody = {
    eventType: "container.grant",
    containerKeyEpochId: previous.state.containerKeyEpochId,
    grant: replacementGrant,
    referencedPrincipalHead: replacementHead,
  };
  const event = await createSignedContainerEvent({
    body,
    dependencyManifestHashes: [input.previous.manifestHash],
    objectId: previous.state.containerId,
    organizationId: previous.state.organizationId,
    previousManifestHash: input.previous.manifestHash,
    signer: input.signer,
  });
  const bundle = await createManifestBundle(
    {
      ...previous.state,
      epoch: previous.state.epoch + 1,
      previousManifestHash: input.previous.manifestHash,
      eventHash: event.eventHash,
      referencedPrincipalHeads: refreshed.referencedPrincipalHeads,
    },
    event,
  );
  const wraps = refreshed.recipientTargets.map((target) =>
    createContainerKeyWrap({
      containerKeyEpochId: input.previousKekState.containerKeyEpochId,
      recipientKind: target.recipientKind,
      recipientId: target.recipientId,
      recipientKeyEpochId: target.recipientKeyEpochId,
      recipientKeyFingerprint: target.recipientKeyFingerprint,
      wrapManifestHash: bundle.manifestHash,
    }),
  );

  return {
    event: event.event as unknown as Record<string, unknown>,
    body: body as unknown,
    expectedManifestHash: bundle.manifestHash,
    manifest: bundle.manifest,
    previousManifest: input.previous,
    previousContainerPath: [...input.previousContainerPath],
    containerManifestHistory: [input.previous],
    principalPolicies: refreshed.principalPolicies as unknown as Record<
      string,
      unknown
    >[],
    keyEpoch: input.previousKekState.keyEpoch as unknown as Record<
      string,
      unknown
    >,
    keyring: null,
    predecessorBridge: null,
    wraps: wraps as unknown as Record<string, unknown>[],
    parentKekState: input.parentKekState as unknown as Record<string, unknown>,
    userRecipientKeys: refreshed.userRecipientKeys as unknown as Record<
      string,
      unknown
    >[],
  };
}
