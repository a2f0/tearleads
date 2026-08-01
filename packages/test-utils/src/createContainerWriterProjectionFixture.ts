import {
  type AccessEvent,
  type ContainerAccessManifestState,
  type ContainerCreateAccessEventBody,
  type ContainerKekRecipientTarget,
  type ContainerKeyEpoch,
  type ContainerKeyWrap,
  computeAccessEventBodyHash,
  computeAccessEventHash,
  computeAccessManifestHash,
  computeContainerKekMaterialId,
  computeContainerKekRecipientTargetHash,
  computeContainerKeyEpochHash,
  deriveContainerAccessManifest,
  encryptWithDek,
  type KeyingCanonicalJson,
  signAccessEvent,
  wrapDekForRecipients,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import type { ContainerWriterProjectionResponse } from "@tearleads/validators/response";

const projectionKekMaterials = new WeakMap<
  ContainerWriterProjectionResponse,
  Uint8Array[]
>();

interface CreateContainerWriterProjectionFixtureInput {
  readonly containerId: string;
  readonly encapsulationPublicKey: Uint8Array;
  readonly metadataDocumentId?: string | undefined;
  readonly organizationId: string;
  readonly parentProjection?: ContainerWriterProjectionResponse | undefined;
  readonly signedAt?: string | undefined;
  readonly signerDeviceId?: string | undefined;
  readonly signerKeyFingerprint: string;
  readonly signerPrivateKey: Uint8Array;
  readonly userId: string;
}

function readParentContainerId(
  parentProjection: ContainerWriterProjectionResponse,
): string {
  const parentManifest = parentProjection.path.at(-1);
  const parentContainerId =
    parentManifest && Reflect.get(parentManifest.state, "containerId");
  if (typeof parentContainerId !== "string" || parentContainerId.length === 0) {
    throw new Error("Parent projection container id is unavailable");
  }

  return parentContainerId;
}

async function signContainerCreateEvent(input: {
  readonly body: ContainerCreateAccessEventBody;
  readonly containerId: string;
  readonly organizationId: string;
  readonly parentProjection?: ContainerWriterProjectionResponse | undefined;
  readonly signedAt: string;
  readonly signerDeviceId: string;
  readonly signerKeyFingerprint: string;
  readonly signerPrivateKey: Uint8Array;
  readonly userId: string;
}): Promise<{ readonly event: AccessEvent; readonly eventHash: string }> {
  const event = await signAccessEvent(
    {
      version: 1,
      eventId: `${input.containerId}-event-1`,
      eventType: "container.create",
      objectKind: "container",
      objectId: input.containerId,
      organizationId: input.organizationId,
      previousManifestHash: null,
      dependencyManifestHashes:
        input.parentProjection?.path.map((bundle) => bundle.manifestHash) ?? [],
      bodyHash: await computeAccessEventBodyHash(
        input.body as unknown as KeyingCanonicalJson,
      ),
      signerUserId: input.userId,
      signerDeviceId: input.signerDeviceId,
      signerKeyFingerprint: input.signerKeyFingerprint,
      signedAt: input.signedAt,
    },
    input.signerPrivateKey,
  );

  return {
    event,
    eventHash: await computeAccessEventHash(event),
  };
}

async function wrapContainerKekToUser(input: {
  readonly containerKek: Uint8Array;
  readonly containerKeyEpochId: string;
  readonly encapsulationPublicKey: Uint8Array;
  readonly manifestHash: string;
  readonly userId: string;
}): Promise<{
  readonly recipientTarget: ContainerKekRecipientTarget;
  readonly wrap: ContainerKeyWrap;
}> {
  const [recipient] = await wrapDekForRecipients(input.containerKek, [
    input.encapsulationPublicKey,
  ]);
  if (!recipient) {
    throw new Error("Expected projection fixture recipient wrap");
  }
  const recipientKeyEpochId = `user:${input.userId}:encapsulation:${recipient.keyFingerprint}`;
  const recipientTarget = {
    recipientKind: "user" as const,
    recipientId: input.userId,
    recipientKeyEpochId,
    recipientKeyFingerprint: recipient.keyFingerprint,
  };

  return {
    recipientTarget,
    wrap: {
      containerKeyEpochId: input.containerKeyEpochId,
      recipientKind: "user",
      recipientId: input.userId,
      recipientKeyEpochId,
      recipientKeyFingerprint: recipient.keyFingerprint,
      kemCipherText: bytesToBase64(recipient.kemCipherText),
      wrappedKey: bytesToBase64(recipient.wrappedKey),
      wrapManifestHash: input.manifestHash,
    },
  };
}

async function wrapContainerKekToParent(input: {
  readonly containerKek: Uint8Array;
  readonly containerKeyEpochId: string;
  readonly manifestHash: string;
  readonly parentKek: ContainerWriterProjectionResponse["containerKeks"][number];
  readonly parentKekMaterial: Uint8Array;
}): Promise<{
  readonly recipientTarget: ContainerKekRecipientTarget;
  readonly wrap: ContainerKeyWrap;
}> {
  const wrapped = await encryptWithDek(
    input.containerKek,
    input.parentKekMaterial,
  );
  const recipientTarget = {
    recipientKind: "container" as const,
    recipientId: input.parentKek.containerId,
    recipientKeyEpochId: input.parentKek.containerKeyEpochId,
    recipientKeyFingerprint: input.parentKek.keyEpochHash,
  };

  return {
    recipientTarget,
    wrap: {
      containerKeyEpochId: input.containerKeyEpochId,
      recipientKind: "container",
      recipientId: input.parentKek.containerId,
      recipientKeyEpochId: input.parentKek.containerKeyEpochId,
      recipientKeyFingerprint: input.parentKek.keyEpochHash,
      kemCipherText: bytesToBase64(wrapped.iv),
      wrappedKey: bytesToBase64(wrapped.ciphertext),
      wrapManifestHash: input.manifestHash,
    },
  };
}

export async function createContainerWriterProjectionFixture(
  input: CreateContainerWriterProjectionFixtureInput,
): Promise<ContainerWriterProjectionResponse> {
  const parentProjection = input.parentProjection;
  const parentManifest = parentProjection?.path.at(-1) ?? null;
  const parentKek = parentProjection?.containerKeks.at(-1) ?? null;
  const parentMaterials = parentProjection
    ? projectionKekMaterials.get(parentProjection)
    : undefined;
  const parentKekMaterial = parentMaterials?.at(-1) ?? null;
  if (parentProjection && (!parentKek || !parentKekMaterial)) {
    throw new Error("Parent projection KEK material is unavailable");
  }

  const containerKek = crypto.getRandomValues(new Uint8Array(32));
  const containerKeyEpochId = await computeContainerKekMaterialId({
    containerId: input.containerId,
    keyEpoch: 1,
    keyMaterial: containerKek,
  });
  const parentContainerId = parentProjection
    ? readParentContainerId(parentProjection)
    : null;
  const parentManifestHash = parentManifest?.manifestHash ?? null;
  const body: ContainerCreateAccessEventBody = {
    eventType: "container.create",
    parentContainerId,
    parentManifestHash,
    metadataDocumentId:
      input.metadataDocumentId ?? `${input.containerId}-metadata-document`,
    containerKeyEpochId,
    directGrants: parentProjection
      ? []
      : [
          {
            subjectType: "user",
            subjectId: input.userId,
            accessLevel: "admin",
          },
        ],
    referencedPrincipalHeads: [],
  };
  const { event, eventHash } = await signContainerCreateEvent({
    body,
    containerId: input.containerId,
    organizationId: input.organizationId,
    parentProjection,
    signedAt: input.signedAt ?? "2026-04-27T00:00:00.000Z",
    signerDeviceId: input.signerDeviceId ?? "test-device-1",
    signerKeyFingerprint: input.signerKeyFingerprint,
    signerPrivateKey: input.signerPrivateKey,
    userId: input.userId,
  });
  const state: ContainerAccessManifestState = {
    version: 1,
    containerId: input.containerId,
    organizationId: input.organizationId,
    epoch: 1,
    previousManifestHash: null,
    eventHash,
    parentContainerId,
    parentManifestHash,
    metadataDocumentId: body.metadataDocumentId,
    containerKeyEpochId,
    directGrants: body.directGrants,
    referencedPrincipalHeads: [],
  };
  const manifest = await deriveContainerAccessManifest(state);
  const manifestHash = await computeAccessManifestHash(manifest);
  const keyEpoch: ContainerKeyEpoch = {
    id: containerKeyEpochId,
    containerId: input.containerId,
    keyEpoch: 1,
    accessManifestHash: manifestHash,
    parentContainerKeyEpochId: parentKek?.containerKeyEpochId ?? null,
    createdByEventHash: eventHash,
    createdByManifestHash: manifestHash,
  };
  const recipientMaterial = parentKek
    ? await wrapContainerKekToParent({
        containerKek,
        containerKeyEpochId,
        manifestHash,
        parentKek,
        parentKekMaterial: parentKekMaterial as Uint8Array,
      })
    : await wrapContainerKekToUser({
        containerKek,
        containerKeyEpochId,
        encapsulationPublicKey: input.encapsulationPublicKey,
        manifestHash,
        userId: input.userId,
      });
  const recipientTargets = [recipientMaterial.recipientTarget];
  const keyTargetHash =
    await computeContainerKekRecipientTargetHash(recipientTargets);
  const keyEpochHash = await computeContainerKeyEpochHash(keyEpoch);
  const projection: ContainerWriterProjectionResponse = {
    containerId: input.containerId,
    organizationId: input.organizationId,
    path: [
      ...(parentProjection?.path ?? []),
      {
        event: {
          event: event as unknown as Record<string, unknown>,
          body: body as unknown as Record<string, unknown>,
          eventHash,
        },
        manifest: manifest as unknown as Record<string, unknown>,
        manifestHash,
        state: state as unknown as Record<string, unknown>,
      },
    ],
    containerKeks: [
      ...(parentProjection?.containerKeks ?? []),
      {
        containerId: input.containerId,
        accessManifestHash: manifestHash,
        containerKeyEpochId,
        containerKeyEpoch: 1,
        keyEpoch: keyEpoch as unknown as Record<string, unknown>,
        keyEpochHash,
        keyTargetHash,
        parentContainerKeyEpochId: keyEpoch.parentContainerKeyEpochId,
        containerManifestHistory: [],
        predecessorKeks: [],
        recipientTargets: recipientTargets as unknown as Record<
          string,
          unknown
        >[],
        wraps: [recipientMaterial.wrap as unknown as Record<string, unknown>],
      },
    ],
  };
  projectionKekMaterials.set(projection, [
    ...(parentMaterials ?? []),
    containerKek,
  ]);

  return projection;
}
