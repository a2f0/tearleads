import type { TestUser } from "@tearleads/bob-and-alice";
import type {
  ContainerAccessEventBody,
  ContainerKeyWrap,
  VerifiedContainerKekState,
} from "@tearleads/crypto";
import {
  computeContainerKekKeyringHash,
  computeContainerKekPredecessorBridgeHash,
} from "@tearleads/crypto";
import type {
  AccessManifestBundleWire,
  ContainerMutationRequest,
} from "@tearleads/validators/request";
import {
  createRootContainerKeyEpoch,
  createTestContainerKekKeyring,
  createTestContainerKekMaterial,
  createTestContainerKekPredecessorBridge,
  createTestFillerKeyringEntries,
} from "./containerKekMaterial";
import {
  asVerifiedContainerManifest,
  createContainerKeyWrapForRecipientTarget,
  createContainerManifestBundle,
  createSignedAccessEvent,
  loadPrincipalPoliciesForContainerPath,
  userRecipientKeysFromKekTargets,
  userRecipientKeysFromRecipientTargets,
  verifyKekState,
} from "./keyingWriterProjectionKit";

export async function buildRootRevokeRequest(input: {
  readonly previous: AccessManifestBundleWire;
  readonly previousKekState: VerifiedContainerKekState;
  readonly revokedUser: TestUser;
  readonly signer: TestUser;
}): Promise<ContainerMutationRequest> {
  const previous = asVerifiedContainerManifest(input.previous);
  const principalPolicies = await loadPrincipalPoliciesForContainerPath([
    input.previous,
  ]);
  const nextKeyEpoch = input.previousKekState.containerKeyEpoch + 1;
  const { containerKeyEpochId, plaintextKek } =
    await createTestContainerKekMaterial({
      containerId: previous.state.containerId,
      keyEpoch: nextKeyEpoch,
    });
  const retiringKey = crypto.getRandomValues(new Uint8Array(32));
  const predecessorBridge = await createTestContainerKekPredecessorBridge({
    containerId: previous.state.containerId,
    predecessorContainerKey: retiringKey,
    predecessorContainerKeyEpochId: input.previousKekState.containerKeyEpochId,
    successorContainerKey: plaintextKek,
    successorContainerKeyEpochId: containerKeyEpochId,
  });
  const keyring = await createTestContainerKekKeyring({
    containerId: previous.state.containerId,
    keyEpoch: nextKeyEpoch,
    predecessorEntries: await createTestFillerKeyringEntries({
      containerId: previous.state.containerId,
      count: nextKeyEpoch - 2,
    }),
    retiringContainerKey: retiringKey,
    retiringContainerKeyEpochId: input.previousKekState.containerKeyEpochId,
    successorContainerKey: plaintextKek,
    successorContainerKeyEpochId: containerKeyEpochId,
  });
  const body: ContainerAccessEventBody = {
    eventType: "container.revoke",
    containerKeyEpochId,
    keyringHash: await computeContainerKekKeyringHash(keyring),
    predecessorBridgeHash:
      await computeContainerKekPredecessorBridgeHash(predecessorBridge),
    subjectType: "user",
    subjectId: input.revokedUser.userId,
  };
  const event = await createSignedAccessEvent({
    body,
    dependencyManifestHashes: [input.previous.manifestHash],
    objectId: previous.state.containerId,
    objectKind: "container",
    organizationId: previous.state.organizationId,
    previousManifestHash: input.previous.manifestHash,
    signer: input.signer,
  });
  const bundle = await createContainerManifestBundle(
    {
      ...previous.state,
      epoch: previous.state.epoch + 1,
      previousManifestHash: input.previous.manifestHash,
      eventHash: event.eventHash,
      containerKeyEpochId,
      directGrants: previous.state.directGrants.filter(
        (grant) =>
          grant.subjectType !== "user" ||
          grant.subjectId !== input.revokedUser.userId,
      ),
    },
    event,
  );
  const keyEpoch = createRootContainerKeyEpoch({
    containerKeyEpochId,
    keyEpoch: nextKeyEpoch,
    manifest: bundle,
  });
  const recipientTargets = input.previousKekState.recipientTargets.filter(
    (target) =>
      target.recipientKind !== "user" ||
      target.recipientId !== input.revokedUser.userId,
  );
  const wraps: ContainerKeyWrap[] = recipientTargets.map((recipientTarget) =>
    createContainerKeyWrapForRecipientTarget({
      containerKeyEpochId,
      recipientTarget,
      wrapManifestHash: bundle.manifestHash,
    }),
  );
  const kekState = await verifyKekState({
    bundle,
    keyEpoch,
    principalPolicies,
    userRecipientKeys: userRecipientKeysFromRecipientTargets(recipientTargets),
    wraps,
  });

  return {
    event: event.event as unknown as Record<string, unknown>,
    body: body as unknown,
    expectedManifestHash: bundle.manifestHash,
    manifest: bundle.manifest,
    previousManifest: input.previous,
    previousContainerPath: [input.previous],
    containerManifestHistory: [input.previous],
    principalPolicies: principalPolicies as unknown as Record<
      string,
      unknown
    >[],
    keyEpoch: keyEpoch as unknown as Record<string, unknown>,
    predecessorBridge: predecessorBridge as unknown as Record<string, unknown>,
    keyring: keyring as unknown as Record<string, unknown>,
    wraps: kekState.wraps as unknown as Record<string, unknown>[],
    parentKekState: null,
    userRecipientKeys: userRecipientKeysFromKekTargets(
      kekState,
    ) as unknown as Record<string, unknown>[],
  };
}
