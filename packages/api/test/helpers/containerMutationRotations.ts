import { db } from "@symcrypt/api-shared/postgres";
import type { TestUser } from "@symcrypt/bob-and-alice";
import type {
  ContainerAccessEventBody,
  ContainerAccessManifestState,
  ContainerGrantSubjectType,
  KeyingCanonicalJson,
  VerifiedAccessEvent,
  VerifiedContainerAccessManifest,
  VerifiedContainerKekState,
  VerifiedPrincipalPolicy,
} from "@symcrypt/crypto";
import {
  computeAccessEventBodyHash,
  computeAccessManifestHash,
  computeContainerKekPredecessorBridgeHash,
  deriveContainerAccessManifest,
  signAccessEvent,
  verifySignedAccessEvent,
} from "@symcrypt/crypto";
import type {
  AccessManifestBundleWire,
  ContainerMutationRequest,
} from "@symcrypt/validators/request";
import {
  createTestContainerKekId,
  createTestContainerKekPredecessorBridge,
  createTestRotationKeyring,
} from "./containerKekMaterial";
import {
  createContainerKeyEpoch,
  createContainerKeyWrap,
} from "./containerKeying";
import { refreshContainerMutationPrincipal } from "./containerMutationPrincipalRefresh";
import { loadVerifiedPrincipalPolicy } from "./principalPolicy";

export function asVerifiedContainerManifest(
  bundle: AccessManifestBundleWire,
): VerifiedContainerAccessManifest {
  return bundle as unknown as VerifiedContainerAccessManifest;
}

export async function createSignedContainerEvent(input: {
  readonly body: ContainerAccessEventBody;
  readonly dependencyManifestHashes?: readonly string[];
  readonly objectId: string;
  readonly organizationId: string;
  readonly previousManifestHash: string | null;
  readonly signer: TestUser;
}): Promise<VerifiedAccessEvent> {
  const event = await signAccessEvent(
    {
      version: 1,
      eventId: crypto.randomUUID(),
      eventType: input.body.eventType,
      objectKind: "container",
      objectId: input.objectId,
      organizationId: input.organizationId,
      previousManifestHash: input.previousManifestHash,
      dependencyManifestHashes: [...(input.dependencyManifestHashes ?? [])],
      bodyHash: await computeAccessEventBodyHash(
        input.body as unknown as KeyingCanonicalJson,
      ),
      signerUserId: input.signer.userId,
      signerDeviceId: "test-device",
      signerKeyFingerprint: input.signer.fingerprint,
      signedAt: "2026-04-26T12:00:00.000Z",
    },
    input.signer.signing.signingPrivateKey,
  );
  const verifiedEvent = await verifySignedAccessEvent({
    body: input.body as unknown as KeyingCanonicalJson,
    event,
    signerPublicKey: input.signer.signing.signingPublicKey,
  });

  if (!verifiedEvent.ok) {
    throw verifiedEvent.error;
  }

  return verifiedEvent.value;
}

export async function createManifestBundle(
  state: ContainerAccessManifestState,
  event: VerifiedAccessEvent,
): Promise<AccessManifestBundleWire> {
  const manifest = await deriveContainerAccessManifest(state);

  return {
    event: event as unknown as Record<string, unknown>,
    manifest: manifest as unknown as Record<string, unknown>,
    manifestHash: await computeAccessManifestHash(manifest),
    state: state as unknown as Record<string, unknown>,
  };
}

function principalPolicyKey(policy: VerifiedPrincipalPolicy): string {
  return [
    policy.principalType,
    policy.principalId,
    policy.version,
    policy.stateHash,
  ].join(":");
}

export async function loadPrincipalPoliciesForContainerPaths(
  paths: readonly (readonly AccessManifestBundleWire[])[],
): Promise<VerifiedPrincipalPolicy[]> {
  const principalPolicies = await Promise.all(
    paths.flatMap((path) =>
      path.flatMap((bundle) =>
        asVerifiedContainerManifest(bundle).state.referencedPrincipalHeads.map(
          (reference) =>
            loadVerifiedPrincipalPolicy(
              db,
              reference.principalType,
              reference.principalId,
            ),
        ),
      ),
    ),
  );
  const policiesByKey = new Map<string, VerifiedPrincipalPolicy>();

  for (const policy of principalPolicies) {
    policiesByKey.set(principalPolicyKey(policy), policy);
  }

  return [...policiesByKey.values()];
}

export async function buildRevokeRequest(input: {
  readonly parentKekState: VerifiedContainerKekState | null;
  readonly previous: AccessManifestBundleWire;
  readonly previousContainerPath: readonly AccessManifestBundleWire[];
  readonly previousKekState: VerifiedContainerKekState;
  readonly revokedGrant?: {
    readonly subjectId: string;
    readonly subjectType: ContainerGrantSubjectType;
  };
  readonly revokedUser?: TestUser;
  readonly signer: TestUser;
}): Promise<ContainerMutationRequest> {
  const previous = asVerifiedContainerManifest(input.previous);
  const principalPolicies = await loadPrincipalPoliciesForContainerPaths([
    input.previousContainerPath,
  ]);
  const containerKeyEpochId = await createTestContainerKekId(
    previous.state.containerId,
    input.previousKekState.containerKeyEpoch + 1,
  );
  const predecessorBridge = await createTestContainerKekPredecessorBridge({
    containerId: previous.state.containerId,
    predecessorContainerKeyEpochId: input.previousKekState.containerKeyEpochId,
    successorContainerKeyEpochId: containerKeyEpochId,
  });
  const { keyring, keyringHash } = await createTestRotationKeyring({
    containerId: previous.state.containerId,
    retiringKeyEpoch: input.previousKekState.containerKeyEpoch,
    retiringContainerKeyEpochId: input.previousKekState.containerKeyEpochId,
    successorContainerKeyEpochId: containerKeyEpochId,
  });
  const revokedGrant = input.revokedGrant ?? {
    subjectType: "user" as const,
    subjectId: input.revokedUser?.userId,
  };
  if (!revokedGrant.subjectId) {
    throw new Error("buildRevokeRequest requires a revoked grant");
  }
  const body: ContainerAccessEventBody = {
    eventType: "container.revoke",
    containerKeyEpochId,
    keyringHash,
    predecessorBridgeHash:
      await computeContainerKekPredecessorBridgeHash(predecessorBridge),
    subjectType: revokedGrant.subjectType,
    subjectId: revokedGrant.subjectId,
  };
  const event = await createSignedContainerEvent({
    body,
    dependencyManifestHashes: [
      ...new Set(
        input.previousContainerPath.map((manifest) => manifest.manifestHash),
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
      epoch: previous.state.epoch + 1,
      previousManifestHash: input.previous.manifestHash,
      eventHash: event.eventHash,
      containerKeyEpochId,
      directGrants: previous.state.directGrants.filter(
        (grant) =>
          grant.subjectType !== revokedGrant.subjectType ||
          grant.subjectId !== revokedGrant.subjectId,
      ),
      referencedPrincipalHeads: previous.state.referencedPrincipalHeads.filter(
        (principalHead) =>
          principalHead.principalType !== revokedGrant.subjectType ||
          principalHead.principalId !== revokedGrant.subjectId,
      ),
    },
    event,
  );
  const keyEpoch = createContainerKeyEpoch({
    containerKeyEpochId,
    keyEpoch: input.previousKekState.containerKeyEpoch + 1,
    manifest: bundle,
    parentKekState: input.parentKekState,
  });
  const wraps = input.parentKekState
    ? [
        createContainerKeyWrap({
          containerKeyEpochId,
          recipientKind: "container",
          recipientId: input.parentKekState.containerId,
          recipientKeyEpochId: input.parentKekState.containerKeyEpochId,
          recipientKeyFingerprint: input.parentKekState.keyEpochHash,
          wrapManifestHash: bundle.manifestHash,
        }),
      ]
    : [];

  return {
    event: event.event as unknown as Record<string, unknown>,
    body: body as unknown,
    expectedManifestHash: bundle.manifestHash,
    manifest: bundle.manifest,
    previousManifest: input.previous,
    previousContainerPath: [...input.previousContainerPath],
    principalPolicies: principalPolicies as unknown as Record<
      string,
      unknown
    >[],
    keyEpoch: keyEpoch as unknown as Record<string, unknown>,
    keyring: keyring as unknown as Record<string, unknown>,
    predecessorBridge: predecessorBridge as unknown as Record<string, unknown>,
    wraps: wraps as unknown as Record<string, unknown>[],
    parentKekState: input.parentKekState as unknown as Record<string, unknown>,
    userRecipientKeys: [],
  };
}

export async function buildRekeyRequest(input: {
  readonly parentKekState: VerifiedContainerKekState;
  readonly previous: AccessManifestBundleWire;
  readonly previousContainerPath: readonly AccessManifestBundleWire[];
  readonly previousKekState: VerifiedContainerKekState;
  readonly replacementPrincipalPolicy?: VerifiedPrincipalPolicy | undefined;
  readonly signer: TestUser;
}): Promise<ContainerMutationRequest> {
  const previous = asVerifiedContainerManifest(input.previous);
  const currentPrincipalPolicies = await loadPrincipalPoliciesForContainerPaths(
    [input.previousContainerPath],
  );
  const {
    principalPolicies,
    recipientTargets,
    referencedPrincipalHeads,
    userRecipientKeys,
  } = refreshContainerMutationPrincipal({
    currentPrincipalPolicies,
    currentRecipientTargets: input.previousKekState.recipientTargets,
    currentReferencedPrincipalHeads: previous.state.referencedPrincipalHeads,
    replacementPrincipalPolicy: input.replacementPrincipalPolicy,
  });
  const containerKeyEpochId = await createTestContainerKekId(
    previous.state.containerId,
    input.previousKekState.containerKeyEpoch + 1,
  );
  const predecessorBridge = await createTestContainerKekPredecessorBridge({
    containerId: previous.state.containerId,
    predecessorContainerKeyEpochId: input.previousKekState.containerKeyEpochId,
    successorContainerKeyEpochId: containerKeyEpochId,
  });
  const { keyring, keyringHash } = await createTestRotationKeyring({
    containerId: previous.state.containerId,
    retiringKeyEpoch: input.previousKekState.containerKeyEpoch,
    retiringContainerKeyEpochId: input.previousKekState.containerKeyEpochId,
    successorContainerKeyEpochId: containerKeyEpochId,
  });
  const body: ContainerAccessEventBody = {
    eventType: "container.rekey",
    containerKeyEpochId,
    keyringHash,
    predecessorBridgeHash:
      await computeContainerKekPredecessorBridgeHash(predecessorBridge),
    referencedPrincipalHeads,
  };
  const event = await createSignedContainerEvent({
    body,
    dependencyManifestHashes: [
      ...new Set(
        input.previousContainerPath.map((manifest) => manifest.manifestHash),
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
      epoch: previous.state.epoch + 1,
      previousManifestHash: input.previous.manifestHash,
      eventHash: event.eventHash,
      containerKeyEpochId,
      referencedPrincipalHeads,
    },
    event,
  );
  const keyEpoch = createContainerKeyEpoch({
    containerKeyEpochId,
    keyEpoch: input.previousKekState.containerKeyEpoch + 1,
    manifest: bundle,
    parentKekState: input.parentKekState,
  });
  const wraps = recipientTargets.map((target) =>
    createContainerKeyWrap({
      containerKeyEpochId,
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
    principalPolicies: principalPolicies as unknown as Record<
      string,
      unknown
    >[],
    keyEpoch: keyEpoch as unknown as Record<string, unknown>,
    keyring: keyring as unknown as Record<string, unknown>,
    predecessorBridge: predecessorBridge as unknown as Record<string, unknown>,
    wraps: wraps as unknown as Record<string, unknown>[],
    parentKekState: input.parentKekState as unknown as Record<string, unknown>,
    userRecipientKeys: userRecipientKeys as unknown as Record<
      string,
      unknown
    >[],
  };
}

export async function buildMoveRequest(input: {
  readonly destinationParent: AccessManifestBundleWire;
  readonly destinationParentKekState: VerifiedContainerKekState;
  readonly destinationParentPath: readonly AccessManifestBundleWire[];
  readonly previous: AccessManifestBundleWire;
  readonly previousContainerPath: readonly AccessManifestBundleWire[];
  readonly previousKekState: VerifiedContainerKekState;
  readonly signer: TestUser;
}): Promise<ContainerMutationRequest> {
  const previous = asVerifiedContainerManifest(input.previous);
  const destinationParent = asVerifiedContainerManifest(
    input.destinationParent,
  );
  const principalPolicies = await loadPrincipalPoliciesForContainerPaths([
    input.previousContainerPath,
    input.destinationParentPath,
  ]);
  const containerKeyEpochId = await createTestContainerKekId(
    previous.state.containerId,
    input.previousKekState.containerKeyEpoch + 1,
  );
  const predecessorBridge = await createTestContainerKekPredecessorBridge({
    containerId: previous.state.containerId,
    predecessorContainerKeyEpochId: input.previousKekState.containerKeyEpochId,
    successorContainerKeyEpochId: containerKeyEpochId,
  });
  const { keyring, keyringHash } = await createTestRotationKeyring({
    containerId: previous.state.containerId,
    retiringKeyEpoch: input.previousKekState.containerKeyEpoch,
    retiringContainerKeyEpochId: input.previousKekState.containerKeyEpochId,
    successorContainerKeyEpochId: containerKeyEpochId,
  });
  const body: ContainerAccessEventBody = {
    eventType: "container.move",
    parentContainerId: destinationParent.state.containerId,
    parentManifestHash: input.destinationParent.manifestHash,
    containerKeyEpochId,
    keyringHash,
    predecessorBridgeHash:
      await computeContainerKekPredecessorBridgeHash(predecessorBridge),
  };
  const event = await createSignedContainerEvent({
    body,
    dependencyManifestHashes: [
      ...new Set(
        [...input.previousContainerPath, ...input.destinationParentPath].map(
          (manifest) => manifest.manifestHash,
        ),
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
      epoch: previous.state.epoch + 1,
      previousManifestHash: input.previous.manifestHash,
      eventHash: event.eventHash,
      parentContainerId: destinationParent.state.containerId,
      parentManifestHash: input.destinationParent.manifestHash,
      containerKeyEpochId,
    },
    event,
  );
  const keyEpoch = createContainerKeyEpoch({
    containerKeyEpochId,
    keyEpoch: input.previousKekState.containerKeyEpoch + 1,
    manifest: bundle,
    parentKekState: input.destinationParentKekState,
  });
  const wraps = [
    createContainerKeyWrap({
      containerKeyEpochId,
      recipientKind: "container",
      recipientId: input.destinationParentKekState.containerId,
      recipientKeyEpochId: input.destinationParentKekState.containerKeyEpochId,
      recipientKeyFingerprint: input.destinationParentKekState.keyEpochHash,
      wrapManifestHash: bundle.manifestHash,
    }),
  ];

  return {
    event: event.event as unknown as Record<string, unknown>,
    body: body as unknown,
    expectedManifestHash: bundle.manifestHash,
    manifest: bundle.manifest,
    previousManifest: input.previous,
    previousContainerPath: [...input.previousContainerPath],
    destinationParentContainerPath: [...input.destinationParentPath],
    principalPolicies: principalPolicies as unknown as Record<
      string,
      unknown
    >[],
    keyEpoch: keyEpoch as unknown as Record<string, unknown>,
    keyring: keyring as unknown as Record<string, unknown>,
    predecessorBridge: predecessorBridge as unknown as Record<string, unknown>,
    wraps: wraps as unknown as Record<string, unknown>[],
    parentKekState: input.destinationParentKekState as unknown as Record<
      string,
      unknown
    >,
    userRecipientKeys: [],
  };
}
