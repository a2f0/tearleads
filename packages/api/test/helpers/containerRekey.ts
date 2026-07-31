import type { TestUser } from "@tearleads/bob-and-alice";
import type {
  ContainerAccessEventBody,
  ContainerKeyEpoch,
  ContainerKeyWrap,
  ContainerUserRecipientKey,
  KeyingCanonicalJson,
  VerifiedAccessEvent,
  VerifiedContainerAccessManifest,
  VerifiedContainerKekState,
  VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import {
  computeAccessEventBodyHash,
  computeAccessManifestHash,
  deriveContainerAccessManifest,
  signAccessEvent,
  verifyContainerKekState,
  verifySignedAccessEvent,
} from "@tearleads/crypto";
import type {
  AccessManifestBundleWire,
  ContainerMutationRequest,
} from "@tearleads/validators/request";
import {
  createRootContainerKeyEpoch,
  createTestContainerKekMaterial,
  createTestContainerKekPredecessorBridge,
} from "./containerKekMaterial";

interface ContainerRekeyFixture {
  readonly bundle: AccessManifestBundleWire | VerifiedContainerAccessManifest;
  readonly kekState: VerifiedContainerKekState;
  readonly plaintextKek?: Uint8Array | undefined;
  readonly principalPolicies?: readonly VerifiedPrincipalPolicy[];
}

interface BuiltContainerRekeyMutation {
  readonly bundle: AccessManifestBundleWire;
  readonly container: {
    readonly bundle: VerifiedContainerAccessManifest;
    readonly kekState: VerifiedContainerKekState;
    readonly plaintextKek: Uint8Array;
    readonly principalPolicies?: readonly VerifiedPrincipalPolicy[];
  };
  readonly kekState: VerifiedContainerKekState;
  readonly plaintextKek: Uint8Array;
  readonly request: ContainerMutationRequest;
}

function asVerifiedContainerManifest(
  bundle: AccessManifestBundleWire | VerifiedContainerAccessManifest,
): VerifiedContainerAccessManifest {
  return bundle as unknown as VerifiedContainerAccessManifest;
}

function containerManifestBundle(
  manifest: VerifiedContainerAccessManifest,
): AccessManifestBundleWire {
  return {
    event: manifest.event as unknown as Record<string, unknown>,
    manifest: manifest.manifest as unknown as Record<string, unknown>,
    manifestHash: manifest.manifestHash,
    state: manifest.state as unknown as Record<string, unknown>,
  };
}

async function createSignedContainerRekeyEvent(input: {
  readonly body: ContainerAccessEventBody;
  readonly previousManifest: VerifiedContainerAccessManifest;
  readonly signer: TestUser;
}): Promise<VerifiedAccessEvent> {
  const event = await signAccessEvent(
    {
      version: 1,
      eventId: crypto.randomUUID(),
      eventType: input.body.eventType,
      objectKind: "container",
      objectId: input.previousManifest.state.containerId,
      organizationId: input.previousManifest.state.organizationId,
      previousManifestHash: input.previousManifest.manifestHash,
      dependencyManifestHashes: [input.previousManifest.manifestHash],
      bodyHash: await computeAccessEventBodyHash(
        input.body as unknown as KeyingCanonicalJson,
      ),
      signerUserId: input.signer.userId,
      signerDeviceId: "test-device",
      signerKeyFingerprint: input.signer.fingerprint,
      signedAt: "2026-04-27T12:00:00.000Z",
    },
    input.signer.signing.signingPrivateKey,
  );
  const verified = await verifySignedAccessEvent({
    body: input.body as unknown as KeyingCanonicalJson,
    event,
    signerPublicKey: input.signer.signing.signingPublicKey,
  });

  if (!verified.ok) {
    throw verified.error;
  }

  return verified.value;
}

function userRecipientKeysFromKekState(
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

function createRecipientKeyWraps(input: {
  readonly containerKeyEpochId: string;
  readonly manifestHash: string;
  readonly recipientTargets: readonly VerifiedContainerKekState["recipientTargets"][number][];
}): ContainerKeyWrap[] {
  return input.recipientTargets.map((target) => ({
    containerKeyEpochId: input.containerKeyEpochId,
    recipientKind: target.recipientKind,
    recipientId: target.recipientId,
    recipientKeyEpochId: target.recipientKeyEpochId,
    recipientKeyFingerprint: target.recipientKeyFingerprint,
    kemCipherText: `kem:${input.containerKeyEpochId}:${target.recipientId}`,
    wrappedKey: `wrapped:${input.containerKeyEpochId}:${target.recipientId}`,
    wrapManifestHash: input.manifestHash,
  }));
}

export function appendUnexpectedUserWrapToRekey(
  request: ContainerMutationRequest,
): void {
  const keyEpoch = request.keyEpoch as unknown as ContainerKeyEpoch;
  const unexpectedUserId = "unexpected-rekey-user";
  const unexpectedFingerprint = "0".repeat(64);
  request.wraps = [
    ...request.wraps,
    {
      containerKeyEpochId: keyEpoch.id,
      recipientKind: "user",
      recipientId: unexpectedUserId,
      recipientKeyEpochId: `user:${unexpectedUserId}:encapsulation:${unexpectedFingerprint}`,
      recipientKeyFingerprint: unexpectedFingerprint,
      kemCipherText: `kem:${keyEpoch.id}:${unexpectedUserId}`,
      wrappedKey: `wrapped:${keyEpoch.id}:${unexpectedUserId}`,
      wrapManifestHash: request.expectedManifestHash,
    },
  ];
}

export async function buildRootContainerRekeyMutation(input: {
  readonly previous: ContainerRekeyFixture;
  readonly signer: TestUser;
}): Promise<BuiltContainerRekeyMutation> {
  const previous = asVerifiedContainerManifest(input.previous.bundle);
  const previousBundle = containerManifestBundle(previous);
  const nextKeyEpoch = input.previous.kekState.containerKeyEpoch + 1;
  const { containerKeyEpochId, plaintextKek } =
    await createTestContainerKekMaterial({
      containerId: previous.state.containerId,
      keyEpoch: nextKeyEpoch,
    });
  const predecessorBridge = await createTestContainerKekPredecessorBridge({
    containerId: previous.state.containerId,
    ...(input.previous.plaintextKek
      ? { predecessorContainerKey: input.previous.plaintextKek }
      : {}),
    predecessorContainerKeyEpochId: input.previous.kekState.containerKeyEpochId,
    successorContainerKey: plaintextKek,
    successorContainerKeyEpochId: containerKeyEpochId,
  });
  const body: ContainerAccessEventBody = {
    eventType: "container.rekey",
    containerKeyEpochId,
  };
  const event = await createSignedContainerRekeyEvent({
    body,
    previousManifest: previous,
    signer: input.signer,
  });
  const state = {
    ...previous.state,
    epoch: previous.state.epoch + 1,
    previousManifestHash: previous.manifestHash,
    eventHash: event.eventHash,
    containerKeyEpochId,
  };
  const manifest = await deriveContainerAccessManifest(state);
  const manifestHash = await computeAccessManifestHash(manifest);
  const bundle: AccessManifestBundleWire = {
    event: event as unknown as Record<string, unknown>,
    manifest: manifest as unknown as Record<string, unknown>,
    manifestHash,
    state: state as unknown as Record<string, unknown>,
  };
  const keyEpoch = createRootContainerKeyEpoch({
    containerKeyEpochId,
    keyEpoch: nextKeyEpoch,
    manifest: bundle,
  });
  const userRecipientKeys = userRecipientKeysFromKekState(
    input.previous.kekState,
  );
  const principalPolicies = input.previous.principalPolicies ?? [];
  const wraps = createRecipientKeyWraps({
    containerKeyEpochId,
    manifestHash,
    recipientTargets: input.previous.kekState.recipientTargets,
  });
  const verifiedKekState = await verifyContainerKekState({
    containerManifest: asVerifiedContainerManifest(bundle),
    keyEpoch,
    principalPolicies,
    userRecipientKeys,
    wraps,
  });

  if (!verifiedKekState.ok) {
    throw verifiedKekState.error;
  }

  const verifiedBundle = bundle as unknown as VerifiedContainerAccessManifest;
  return {
    bundle,
    container: {
      bundle: verifiedBundle,
      kekState: verifiedKekState.value,
      plaintextKek,
      principalPolicies,
    },
    kekState: verifiedKekState.value,
    plaintextKek,
    request: {
      event: event.event as unknown as Record<string, unknown>,
      body: body as unknown,
      expectedManifestHash: manifestHash,
      manifest: manifest as unknown as Record<string, unknown>,
      previousManifest: previousBundle,
      previousContainerPath: [previousBundle],
      keyEpoch: keyEpoch as unknown as Record<string, unknown>,
      predecessorBridge: predecessorBridge as unknown as Record<
        string,
        unknown
      >,
      principalPolicies: principalPolicies as unknown as Record<
        string,
        unknown
      >[],
      wraps: wraps as unknown as Record<string, unknown>[],
      userRecipientKeys: userRecipientKeys as unknown as Record<
        string,
        unknown
      >[],
    },
  };
}
