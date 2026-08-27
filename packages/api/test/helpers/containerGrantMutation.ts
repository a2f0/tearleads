import type { TestUser } from "@symcrypt/bob-and-alice";
import type {
  ContainerAccessEventBody,
  ContainerKeyWrap,
  ContainerUserRecipientKey,
  VerifiedContainerAccessManifest,
  VerifiedContainerKekState,
} from "@symcrypt/crypto";
import { toFingerprint } from "@symcrypt/crypto";
import type {
  AccessManifestBundleWire,
  ContainerMutationRequest,
} from "@symcrypt/validators/request";
import { createContainerKeyWrap } from "./containerKeying";
import {
  createManifestBundle,
  createSignedContainerEvent,
  loadPrincipalPoliciesForContainerPaths,
} from "./containerMutationRotations";
import { joinOrg } from "./organizationMembership";

async function userRecipientKey(
  user: TestUser,
): Promise<ContainerUserRecipientKey> {
  const recipientKeyFingerprint = await toFingerprint(user.kem.publicKey);
  return {
    userId: user.userId,
    recipientKeyEpochId: `user:${user.userId}:encapsulation:${recipientKeyFingerprint}`,
    recipientKeyFingerprint,
  };
}

function userRecipientKeysFromKekTargets(
  kekState: VerifiedContainerKekState,
): ContainerUserRecipientKey[] {
  return kekState.recipientTargets
    .filter((target) => target.recipientKind === "user")
    .map((target) => ({
      userId: target.recipientId,
      recipientKeyEpochId: target.recipientKeyEpochId,
      recipientKeyFingerprint: target.recipientKeyFingerprint,
    }));
}

export async function buildContainerGrantRequest(input: {
  readonly accessLevel?: "admin" | "read" | "write" | undefined;
  readonly parentKekState: VerifiedContainerKekState | null;
  readonly previous: AccessManifestBundleWire;
  readonly previousContainerPath: readonly AccessManifestBundleWire[];
  readonly previousKekState: VerifiedContainerKekState;
  readonly recipient: TestUser;
  readonly signer: TestUser;
}): Promise<ContainerMutationRequest> {
  const previous = input.previous as unknown as VerifiedContainerAccessManifest;
  await joinOrg(previous.state.organizationId, input.signer, input.recipient);
  const recipientKey = await userRecipientKey(input.recipient);
  const principalPolicies = await loadPrincipalPoliciesForContainerPaths([
    input.previousContainerPath,
  ]);
  const grant = {
    accessLevel: input.accessLevel ?? ("write" as const),
    subjectId: input.recipient.userId,
    subjectType: "user" as const,
  };
  const body: ContainerAccessEventBody = {
    containerKeyEpochId: previous.state.containerKeyEpochId,
    eventType: "container.grant",
    grant,
    referencedPrincipalHead: null,
  };
  const event = await createSignedContainerEvent({
    body,
    dependencyManifestHashes: [
      ...new Set(
        input.previousContainerPath.map((bundle) => bundle.manifestHash),
      ),
    ],
    objectId: previous.state.containerId,
    organizationId: previous.state.organizationId,
    previousManifestHash: input.previous.manifestHash,
    signer: input.signer,
  });
  const bundle = await createManifestBundle(
    {
      ...previous.state,
      directGrants: [...previous.state.directGrants, grant],
      epoch: previous.state.epoch + 1,
      eventHash: event.eventHash,
      previousManifestHash: input.previous.manifestHash,
    },
    event,
  );
  const wraps = [
    ...(input.previousKekState.wraps as readonly ContainerKeyWrap[]),
    createContainerKeyWrap({
      containerKeyEpochId: input.previousKekState.containerKeyEpochId,
      recipientId: recipientKey.userId,
      recipientKeyEpochId: recipientKey.recipientKeyEpochId,
      recipientKeyFingerprint: recipientKey.recipientKeyFingerprint,
      recipientKind: "user",
      wrapManifestHash: bundle.manifestHash,
    }),
  ];

  return {
    body,
    containerManifestHistory: [input.previous],
    event: event.event,
    expectedManifestHash: bundle.manifestHash,
    keyEpoch: input.previousKekState.keyEpoch,
    keyring: null,
    manifest: bundle.manifest,
    parentKekState: input.parentKekState,
    predecessorBridge: null,
    previousContainerPath: [...input.previousContainerPath],
    previousManifest: input.previous,
    principalPolicies,
    userRecipientKeys: [
      ...userRecipientKeysFromKekTargets(input.previousKekState),
      recipientKey,
    ],
    wraps,
  } as unknown as ContainerMutationRequest;
}

export function buildRootGrantRequest(input: {
  readonly accessLevel?: "admin" | "read" | "write" | undefined;
  readonly previous: AccessManifestBundleWire;
  readonly previousKekState: VerifiedContainerKekState;
  readonly recipient: TestUser;
  readonly signer: TestUser;
}): Promise<ContainerMutationRequest> {
  return buildContainerGrantRequest({
    ...input,
    parentKekState: null,
    previousContainerPath: [input.previous],
  });
}
