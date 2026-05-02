import {
  type AccessEvent,
  type AccessEventType,
  type AccessManifest,
  type AccessObjectKind,
  type ContainerAccessManifestState,
  type ContainerCreateAccessEventBody,
  type ContainerKekRecipientTarget,
  type ContainerKeyEpoch,
  type ContainerKeyWrap,
  type ContainerUserRecipientKey,
  computeAccessEventBodyHash,
  computeAccessEventHash,
  computeAccessManifestHash,
  computeContainerKekRecipientTargetHash,
  computeContainerKeyEpochHash,
  computeDocumentContentKeyTargetHash,
  DOCUMENT_CONTENT_KEY_WRAP_SUITE,
  type DocumentContentKeyTarget,
  type DocumentLinkAccessEventBody,
  type DocumentLinkSetManifestState,
  deriveContainerAccessManifest,
  deriveDocumentLinkSetManifest,
  encryptWithDek,
  type KeyingCanonicalJson,
  signAccessEvent,
  toFingerprint,
  type UnsignedAccessEvent,
  wrapDekForRecipients,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { isPlainObject } from "@tearleads/validators/isPlainObject";
import type {
  ContainerMutationRequest,
  DocumentCreateRequest,
} from "@tearleads/validators/request";
import type { ContainerWriterProjectionResponse } from "@tearleads/validators/response";

const REGISTER_SIGNED_AT = "2026-04-07T00:00:00.000Z";

interface RegistrationBootstrapInput {
  encapsulationPublicKey: Uint8Array;
  organizationId: string;
  rootContainerId: string;
  signingPrivateKey: Uint8Array;
  signingPublicKey: Uint8Array;
  userId: string;
}

interface RegistrationBootstrap {
  initialRootContainer: ContainerMutationRequest;
  initialRootMetadataDocument: DocumentCreateRequest;
  rootMetadataDocumentId: string;
}

interface SignedRegistrationEventInput {
  body: ContainerCreateAccessEventBody | DocumentLinkAccessEventBody;
  dependencyManifestHashes?: readonly string[];
  eventType: AccessEventType;
  objectId: string;
  objectKind: AccessObjectKind;
  organizationId: string;
  previousManifestHash: string | null;
  signerDeviceId: string;
  signerKeyFingerprint: string;
  signerPrivateKey: Uint8Array;
  signerUserId: string;
}

interface RootContainerCreateArtifacts {
  body: ContainerCreateAccessEventBody;
  containerKey: Uint8Array;
  containerKeyEpochId: string;
  event: AccessEvent;
  eventHash: string;
  keyEpoch: ContainerKeyEpoch;
  keyEpochHash: string;
  keyTargetHash: string;
  manifest: AccessManifest;
  manifestHash: string;
  metadataDocumentId: string;
  recipientTargets: ContainerKekRecipientTarget[];
  request: ContainerMutationRequest;
  state: ContainerAccessManifestState;
  wraps: ContainerKeyWrap[];
}

function isCanonicalJson(value: unknown): value is KeyingCanonicalJson {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }

  if (typeof value === "number") {
    return Number.isFinite(value);
  }

  if (Array.isArray(value)) {
    // Array.prototype.every skips holes; fixture wire records must reject
    // sparse arrays before JSON serialization can coerce holes to null.
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index) || !isCanonicalJson(value[index])) {
        return false;
      }
    }

    return true;
  }

  if (!isPlainObject(value)) {
    return false;
  }

  return Object.values(value).every(
    (item) => item !== undefined && isCanonicalJson(item),
  );
}

function toWireJson(value: unknown, label: string): KeyingCanonicalJson {
  if (!isCanonicalJson(value)) {
    throw new Error(`${label} fixture is not canonical JSON`);
  }

  const serialized = JSON.stringify(value);
  if (typeof serialized !== "string") {
    throw new Error(`${label} fixture cannot be serialized to JSON`);
  }

  const parsed: unknown = JSON.parse(serialized);
  if (!isCanonicalJson(parsed)) {
    throw new Error(`${label} fixture did not round-trip as canonical JSON`);
  }

  return parsed;
}

function toWireRecord(value: unknown, label: string): Record<string, unknown> {
  const parsed = toWireJson(value, label);
  if (!isPlainObject(parsed)) {
    throw new Error(`${label} fixture must serialize to a JSON object`);
  }

  return parsed;
}

function toWireRecords(
  values: readonly unknown[],
  label: string,
): Record<string, unknown>[] {
  return values.map((value, index) =>
    toWireRecord(value, `${label}[${index}]`),
  );
}

function createSignerDeviceId(signingFingerprint: string): string {
  return `signing-key:${signingFingerprint}`;
}

async function signRegistrationEvent(
  input: SignedRegistrationEventInput,
): Promise<{ event: AccessEvent; eventHash: string }> {
  const unsigned: UnsignedAccessEvent = {
    version: 1,
    eventId: crypto.randomUUID(),
    eventType: input.eventType,
    objectKind: input.objectKind,
    objectId: input.objectId,
    organizationId: input.organizationId,
    previousManifestHash: input.previousManifestHash,
    dependencyManifestHashes: [...(input.dependencyManifestHashes ?? [])],
    bodyHash: await computeAccessEventBodyHash(
      toWireJson(input.body, `${input.eventType} event body`),
    ),
    signerUserId: input.signerUserId,
    signerDeviceId: input.signerDeviceId,
    signerKeyFingerprint: input.signerKeyFingerprint,
    signedAt: REGISTER_SIGNED_AT,
  };
  const event = await signAccessEvent(unsigned, input.signerPrivateKey);

  return {
    event,
    eventHash: await computeAccessEventHash(event),
  };
}

async function wrapRootContainerKeyForUser(input: {
  containerKey: Uint8Array;
  containerKeyEpochId: string;
  encapsulationPublicKey: Uint8Array;
  manifestHash: string;
  userId: string;
}): Promise<{
  recipientTarget: ContainerKekRecipientTarget;
  userRecipientKey: ContainerUserRecipientKey;
  wrap: ContainerKeyWrap;
}> {
  const [recipient] = await wrapDekForRecipients(input.containerKey, [
    input.encapsulationPublicKey,
  ]);
  if (!recipient) {
    throw new Error("Failed to wrap root container key for test user");
  }

  const userRecipientKey: ContainerUserRecipientKey = {
    userId: input.userId,
    recipientKeyEpochId: `user:${input.userId}:encapsulation:${recipient.keyFingerprint}`,
    recipientKeyFingerprint: recipient.keyFingerprint,
  };
  const recipientTarget: ContainerKekRecipientTarget = {
    recipientKind: "user",
    recipientId: input.userId,
    recipientKeyEpochId: userRecipientKey.recipientKeyEpochId,
    recipientKeyFingerprint: userRecipientKey.recipientKeyFingerprint,
  };

  return {
    recipientTarget,
    userRecipientKey,
    wrap: {
      containerKeyEpochId: input.containerKeyEpochId,
      recipientKind: "user",
      recipientId: input.userId,
      recipientKeyEpochId: userRecipientKey.recipientKeyEpochId,
      recipientKeyFingerprint: userRecipientKey.recipientKeyFingerprint,
      kemCipherText: bytesToBase64(recipient.kemCipherText),
      wrappedKey: bytesToBase64(recipient.wrappedKey),
      wrapManifestHash: input.manifestHash,
    },
  };
}

function rootContainerProjectionFromArtifacts(
  artifacts: RootContainerCreateArtifacts,
): ContainerWriterProjectionResponse {
  return {
    containerId: artifacts.state.containerId,
    organizationId: artifacts.state.organizationId,
    path: [
      {
        event: {
          event: toWireRecord(artifacts.event, "root container event"),
          body: toWireRecord(artifacts.body, "root container event body"),
          eventHash: artifacts.eventHash,
        },
        manifest: toWireRecord(artifacts.manifest, "root container manifest"),
        manifestHash: artifacts.manifestHash,
        state: toWireRecord(artifacts.state, "root container state"),
      },
    ],
    containerKeks: [
      {
        containerId: artifacts.state.containerId,
        accessManifestHash: artifacts.manifestHash,
        containerKeyEpochId: artifacts.containerKeyEpochId,
        containerKeyEpoch: artifacts.keyEpoch.keyEpoch,
        keyEpoch: toWireRecord(artifacts.keyEpoch, "root container key epoch"),
        keyEpochHash: artifacts.keyEpochHash,
        keyTargetHash: artifacts.keyTargetHash,
        parentContainerKeyEpochId: null,
        recipientTargets: toWireRecords(
          artifacts.recipientTargets,
          "root container recipient targets",
        ),
        wraps: toWireRecords(artifacts.wraps, "root container wraps"),
      },
    ],
  };
}

async function createRootContainerArtifacts(input: {
  encapsulationPublicKey: Uint8Array;
  organizationId: string;
  rootContainerId: string;
  rootMetadataDocumentId: string;
  signerDeviceId: string;
  signerKeyFingerprint: string;
  signingPrivateKey: Uint8Array;
  userId: string;
}): Promise<RootContainerCreateArtifacts> {
  const containerKey = crypto.getRandomValues(new Uint8Array(32));
  const containerKeyEpochId = crypto.randomUUID();
  const body: ContainerCreateAccessEventBody = {
    eventType: "container.create",
    parentContainerId: null,
    parentManifestHash: null,
    metadataDocumentId: input.rootMetadataDocumentId,
    containerKeyEpochId,
    directGrants: [
      {
        accessLevel: "admin",
        subjectId: input.userId,
        subjectType: "user",
      },
    ],
    referencedPrincipalHeads: [],
  };
  const { event, eventHash } = await signRegistrationEvent({
    body,
    eventType: "container.create",
    objectKind: "container",
    objectId: input.rootContainerId,
    organizationId: input.organizationId,
    previousManifestHash: null,
    signerDeviceId: input.signerDeviceId,
    signerKeyFingerprint: input.signerKeyFingerprint,
    signerPrivateKey: input.signingPrivateKey,
    signerUserId: input.userId,
  });
  const state: ContainerAccessManifestState = {
    version: 1,
    containerId: input.rootContainerId,
    organizationId: input.organizationId,
    epoch: 1,
    previousManifestHash: null,
    eventHash,
    parentContainerId: null,
    parentManifestHash: null,
    metadataDocumentId: input.rootMetadataDocumentId,
    containerKeyEpochId,
    directGrants: body.directGrants,
    referencedPrincipalHeads: [],
  };
  const manifest = await deriveContainerAccessManifest(state);
  const manifestHash = await computeAccessManifestHash(manifest);
  const keyEpoch: ContainerKeyEpoch = {
    id: containerKeyEpochId,
    containerId: input.rootContainerId,
    keyEpoch: 1,
    accessManifestHash: manifestHash,
    parentContainerKeyEpochId: null,
    createdByEventHash: eventHash,
    createdByManifestHash: manifestHash,
  };
  const { recipientTarget, userRecipientKey, wrap } =
    await wrapRootContainerKeyForUser({
      containerKey,
      containerKeyEpochId,
      encapsulationPublicKey: input.encapsulationPublicKey,
      manifestHash,
      userId: input.userId,
    });
  const recipientTargets = [recipientTarget];
  const keyTargetHash =
    await computeContainerKekRecipientTargetHash(recipientTargets);
  const keyEpochHash = await computeContainerKeyEpochHash(keyEpoch);

  return {
    body,
    containerKey,
    containerKeyEpochId,
    event,
    eventHash,
    keyEpoch,
    keyEpochHash,
    keyTargetHash,
    manifest,
    manifestHash,
    metadataDocumentId: input.rootMetadataDocumentId,
    recipientTargets,
    request: {
      event: toWireRecord(event, "root container request event"),
      body: toWireRecord(body, "root container request body"),
      expectedManifestHash: manifestHash,
      manifest: toWireRecord(manifest, "root container request manifest"),
      previousManifest: null,
      parentContainerPath: [],
      principalPolicies: [],
      keyEpoch: toWireRecord(keyEpoch, "root container request key epoch"),
      wraps: toWireRecords([wrap], "root container request wraps"),
      userRecipientKeys: toWireRecords(
        [userRecipientKey],
        "root container request user recipient keys",
      ),
    },
    state,
    wraps: [wrap],
  };
}

async function createRootMetadataDocumentRequest(input: {
  containerKey: Uint8Array;
  containerProjection: ContainerWriterProjectionResponse;
  organizationId: string;
  rootMetadataDocumentId: string;
  signerDeviceId: string;
  signerKeyFingerprint: string;
  signingPrivateKey: Uint8Array;
  userId: string;
}): Promise<DocumentCreateRequest> {
  const targetContainerKek = input.containerProjection.containerKeks.at(-1);
  if (!targetContainerKek) {
    throw new Error("Missing root container KEK for metadata document fixture");
  }

  const target: DocumentContentKeyTarget = {
    containerId: targetContainerKek.containerId,
    containerManifestHash: targetContainerKek.accessManifestHash,
    containerKeyEpochId: targetContainerKek.containerKeyEpochId,
    containerKeyEpoch: targetContainerKek.containerKeyEpoch,
  };
  const body: DocumentLinkAccessEventBody = {
    eventType: "document.link",
    containerId: target.containerId,
    containerManifestHash: target.containerManifestHash,
  };
  const { event, eventHash } = await signRegistrationEvent({
    body,
    dependencyManifestHashes: [target.containerManifestHash],
    eventType: "document.link",
    objectKind: "document",
    objectId: input.rootMetadataDocumentId,
    organizationId: input.organizationId,
    previousManifestHash: null,
    signerDeviceId: input.signerDeviceId,
    signerKeyFingerprint: input.signerKeyFingerprint,
    signerPrivateKey: input.signingPrivateKey,
    signerUserId: input.userId,
  });
  const state: DocumentLinkSetManifestState = {
    version: 1,
    documentId: input.rootMetadataDocumentId,
    organizationId: input.organizationId,
    epoch: 1,
    previousManifestHash: null,
    eventHash,
    linkedContainerIds: [target.containerId],
  };
  const manifest = await deriveDocumentLinkSetManifest(state);
  const manifestHash = await computeAccessManifestHash(manifest);
  const targetHash = await computeDocumentContentKeyTargetHash([target]);
  const contentKey = crypto.getRandomValues(new Uint8Array(32));
  const wrappedContentKey = await encryptWithDek(
    contentKey,
    input.containerKey,
  );

  return {
    event: toWireRecord(event, "root metadata document request event"),
    body: toWireRecord(body, "root metadata document request body"),
    expectedManifestHash: manifestHash,
    manifest: toWireRecord(manifest, "root metadata document request manifest"),
    previousManifest: null,
    targetContainerPath: toWireRecords(
      input.containerProjection.path,
      "root metadata document target container path",
    ),
    contentKeyBundle: {
      contentKeyEpoch: 1,
      linkSetManifestHash: manifestHash,
      targetHash,
      targets: [
        {
          ...target,
          wrappedKey: bytesToBase64(wrappedContentKey.ciphertext),
          wrappingMetadata: {
            suite: DOCUMENT_CONTENT_KEY_WRAP_SUITE,
            iv: bytesToBase64(wrappedContentKey.iv),
          },
        },
      ],
    },
  };
}

export async function createRegistrationBootstrap(
  input: RegistrationBootstrapInput,
): Promise<RegistrationBootstrap> {
  const rootMetadataDocumentId = crypto.randomUUID();
  const signerKeyFingerprint = await toFingerprint(input.signingPublicKey);
  const signerDeviceId = createSignerDeviceId(signerKeyFingerprint);
  const rootContainer = await createRootContainerArtifacts({
    encapsulationPublicKey: input.encapsulationPublicKey,
    organizationId: input.organizationId,
    rootContainerId: input.rootContainerId,
    rootMetadataDocumentId,
    signerDeviceId,
    signerKeyFingerprint,
    signingPrivateKey: input.signingPrivateKey,
    userId: input.userId,
  });
  const initialRootMetadataDocument = await createRootMetadataDocumentRequest({
    containerKey: rootContainer.containerKey,
    containerProjection: rootContainerProjectionFromArtifacts(rootContainer),
    organizationId: input.organizationId,
    rootMetadataDocumentId,
    signerDeviceId,
    signerKeyFingerprint,
    signingPrivateKey: input.signingPrivateKey,
    userId: input.userId,
  });

  return {
    initialRootContainer: rootContainer.request,
    initialRootMetadataDocument,
    rootMetadataDocumentId,
  };
}
