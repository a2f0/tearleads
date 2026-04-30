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
  ContainerManifestBundle,
  ContainerMutationRequest,
} from "@tearleads/validators/request";

interface ContainerRekeyFixture {
  readonly bundle: ContainerManifestBundle | VerifiedContainerAccessManifest;
  readonly kekState: VerifiedContainerKekState;
}

interface BuiltContainerRekeyMutation {
  readonly bundle: ContainerManifestBundle;
  readonly container: {
    readonly bundle: VerifiedContainerAccessManifest;
    readonly kekState: VerifiedContainerKekState;
  };
  readonly kekState: VerifiedContainerKekState;
  readonly request: ContainerMutationRequest;
}

function asVerifiedContainerManifest(
  bundle: ContainerManifestBundle | VerifiedContainerAccessManifest,
): VerifiedContainerAccessManifest {
  return bundle as unknown as VerifiedContainerAccessManifest;
}

function containerManifestBundle(
  manifest: VerifiedContainerAccessManifest,
): ContainerManifestBundle {
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

function createRootContainerKeyEpoch(input: {
  readonly containerKeyEpochId: string;
  readonly keyEpoch: number;
  readonly manifest: ContainerManifestBundle;
}): ContainerKeyEpoch {
  const manifest = asVerifiedContainerManifest(input.manifest);

  return {
    id: input.containerKeyEpochId,
    containerId: manifest.state.containerId,
    keyEpoch: input.keyEpoch,
    accessManifestHash: manifest.manifestHash,
    parentContainerKeyEpochId: null,
    createdByEventHash: manifest.event.eventHash,
    createdByManifestHash: manifest.manifestHash,
  };
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

function createUserKeyWraps(input: {
  readonly containerKeyEpochId: string;
  readonly manifestHash: string;
  readonly userRecipientKeys: readonly ContainerUserRecipientKey[];
}): ContainerKeyWrap[] {
  return input.userRecipientKeys.map((target) => ({
    containerKeyEpochId: input.containerKeyEpochId,
    recipientKind: "user",
    recipientId: target.userId,
    recipientKeyEpochId: target.recipientKeyEpochId,
    recipientKeyFingerprint: target.recipientKeyFingerprint,
    kemCipherText: `kem:${input.containerKeyEpochId}:${target.userId}`,
    wrappedKey: `wrapped:${input.containerKeyEpochId}:${target.userId}`,
    wrapManifestHash: input.manifestHash,
  }));
}

export async function buildRootContainerRekeyMutation(input: {
  readonly previous: ContainerRekeyFixture;
  readonly signer: TestUser;
}): Promise<BuiltContainerRekeyMutation> {
  const previous = asVerifiedContainerManifest(input.previous.bundle);
  const previousBundle = containerManifestBundle(previous);
  const containerKeyEpochId = crypto.randomUUID();
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
  const bundle: ContainerManifestBundle = {
    event: event as unknown as Record<string, unknown>,
    manifest: manifest as unknown as Record<string, unknown>,
    manifestHash,
    state: state as unknown as Record<string, unknown>,
  };
  const keyEpoch = createRootContainerKeyEpoch({
    containerKeyEpochId,
    keyEpoch: input.previous.kekState.containerKeyEpoch + 1,
    manifest: bundle,
  });
  const userRecipientKeys = userRecipientKeysFromKekState(
    input.previous.kekState,
  );
  const wraps = createUserKeyWraps({
    containerKeyEpochId,
    manifestHash,
    userRecipientKeys,
  });
  const verifiedKekState = await verifyContainerKekState({
    containerManifest: asVerifiedContainerManifest(bundle),
    keyEpoch,
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
    },
    kekState: verifiedKekState.value,
    request: {
      event: event.event as unknown as Record<string, unknown>,
      body: body as unknown,
      expectedManifestHash: manifestHash,
      manifest: manifest as unknown as Record<string, unknown>,
      previousManifest: previousBundle,
      previousContainerPath: [previousBundle],
      keyEpoch: keyEpoch as unknown as Record<string, unknown>,
      wraps: wraps as unknown as Record<string, unknown>[],
      userRecipientKeys: userRecipientKeys as unknown as Record<
        string,
        unknown
      >[],
    },
  };
}
