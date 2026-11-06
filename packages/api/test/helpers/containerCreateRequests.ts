import { expect } from "bun:test";
import type {
  AccessEvent,
  ContainerAccessEventBody,
  DocumentLinkAccessEventBody,
  DocumentLinkSetManifestState,
  KeyingCanonicalJson,
  VerifiedAccessEvent,
  VerifiedContainerKekState,
} from "@tearleads/crypto";
import {
  computeAccessEventBodyHash,
  computeAccessEventHash,
  computeAccessManifestHash,
  computeDocumentContentKeyTargetHash,
  deriveDocumentLinkSetManifest,
  signAccessEvent,
  verifySignedAccessEvent,
} from "@tearleads/crypto";
import { containerWrappingPublicKeyForTest } from "@tearleads/crypto/container-wrapping-test-fixtures";
import type { TestUser } from "@tearleads/test-utils";
import type {
  AccessManifestBundleWire,
  ContainerMutationRequest,
  DocumentCreateRequest,
} from "@tearleads/validators/request";
import { createTestContainerKekId } from "./containerKekMaterial";
import {
  createContainerKeyEpoch,
  createContainerKeyWrap,
  parentKekRef,
} from "./containerKeying";
import { containerManifestRefs } from "./containerManifestRefs";
import {
  asVerifiedContainerManifest,
  createManifestBundle,
  loadPrincipalPoliciesForContainerPaths,
} from "./containerMutationRotations";
import { contentKeyEnvelopeFixture } from "./contentKeyEnvelope";
import { principalPolicyRefs } from "./principalPolicyRefs";

export async function signAndCheckContainerEvent(input: {
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

  expect(verifiedEvent.ok).toBe(true);
  if (!verifiedEvent.ok) {
    throw verifiedEvent.error;
  }

  return verifiedEvent.value;
}

export async function buildCreateRequest(input: {
  readonly containerId: string;
  readonly systemSlot?: string | null;
  readonly dependencyManifestHashesOverride?: readonly string[];
  readonly parent: AccessManifestBundleWire;
  readonly parentContainerPath?: readonly AccessManifestBundleWire[];
  readonly parentKekState: VerifiedContainerKekState;
  readonly parentManifestHashOverride?: string;
  readonly signer: TestUser;
}): Promise<ContainerMutationRequest> {
  const parent = asVerifiedContainerManifest(input.parent);
  const parentContainerPath = input.parentContainerPath ?? [input.parent];
  const containerKeyEpochId = await createTestContainerKekId(
    input.containerId,
    1,
  );
  const parentManifestHash =
    input.parentManifestHashOverride ?? input.parent.manifestHash;
  const metadataDocumentId = crypto.randomUUID();
  const body: ContainerAccessEventBody = {
    containerKeyPublicKey:
      containerWrappingPublicKeyForTest(containerKeyEpochId),
    systemSlot: input.systemSlot ?? null,
    eventType: "container.create",
    parentContainerId: parent.state.containerId,
    parentManifestHash,
    metadataDocumentId,
    containerKeyEpochId,
    directGrants: [],
    referencedPrincipalHeads: [],
  };
  const event = await signAndCheckContainerEvent({
    body,
    dependencyManifestHashes: input.dependencyManifestHashesOverride ?? [
      ...new Set(parentContainerPath.map((manifest) => manifest.manifestHash)),
    ],
    objectId: input.containerId,
    organizationId: parent.state.organizationId,
    previousManifestHash: null,
    signer: input.signer,
  });
  const bundle = await createManifestBundle(
    {
      containerKeyPublicKey:
        containerWrappingPublicKeyForTest(containerKeyEpochId),
      systemSlot: input.systemSlot ?? null,
      version: 1,
      containerId: input.containerId,
      organizationId: parent.state.organizationId,
      epoch: 1,
      previousManifestHash: null,
      eventHash: event.eventHash,
      parentContainerId: parent.state.containerId,
      parentManifestHash,
      metadataDocumentId,
      containerKeyEpochId,
      directGrants: [],
      referencedPrincipalHeads: [],
    },
    event,
  );
  const keyEpoch = createContainerKeyEpoch({
    containerKeyEpochId,
    keyEpoch: 1,
    manifest: bundle,
    parentKekState: input.parentKekState,
  });
  const wraps = [
    createContainerKeyWrap({
      containerKeyEpochId,
      recipientKind: "container",
      recipientId: input.parentKekState.containerId,
      recipientKeyEpochId: input.parentKekState.containerKeyEpochId,
      recipientKeyFingerprint: input.parentKekState.keyEpochHash,
      wrapManifestHash: bundle.manifestHash,
    }),
  ];
  const principalPolicies = await loadPrincipalPoliciesForContainerPaths([
    parentContainerPath,
  ]);

  return {
    event: event.event as unknown as Record<string, unknown>,
    body: body as unknown,
    expectedManifestHash: bundle.manifestHash,
    manifest: bundle.manifest,
    parentContainerPathRefs: containerManifestRefs(parentContainerPath),
    principalPolicyRefs: principalPolicyRefs(principalPolicies),
    keyEpoch: keyEpoch as unknown as Record<string, unknown>,
    keyring: null,
    predecessorBridge: null,
    wraps: wraps as unknown as Record<string, unknown>[],
    parentKekRef: parentKekRef(input.parentKekState),
    userRecipientKeys: [],
  };
}

export async function buildMetadataDocumentCreateRequest(input: {
  readonly containerId: string;
  readonly containerRequest: ContainerMutationRequest;
  readonly parent: AccessManifestBundleWire;
  readonly signer: TestUser;
}): Promise<DocumentCreateRequest> {
  const parentState = asVerifiedContainerManifest(input.parent).state;
  const containerBody = input.containerRequest.body as {
    readonly containerKeyEpochId: string;
    readonly containerKeyPublicKey: string;
    readonly metadataDocumentId: string;
    readonly parentContainerId: string;
    readonly parentManifestHash: string;
  };
  const containerEventHash = await computeAccessEventHash(
    input.containerRequest.event as unknown as AccessEvent,
  );
  const childBundle: AccessManifestBundleWire = {
    event: {
      event: input.containerRequest.event,
      body: input.containerRequest.body,
      eventHash: containerEventHash,
    },
    manifest: input.containerRequest.manifest,
    manifestHash: input.containerRequest.expectedManifestHash,
    state: {
      containerKeyPublicKey: containerBody.containerKeyPublicKey,
      systemSlot: null,
      version: 1,
      containerId: input.containerId,
      organizationId: parentState.organizationId,
      epoch: 1,
      previousManifestHash: null,
      eventHash: containerEventHash,
      parentContainerId: containerBody.parentContainerId,
      parentManifestHash: containerBody.parentManifestHash,
      metadataDocumentId: containerBody.metadataDocumentId,
      containerKeyEpochId: containerBody.containerKeyEpochId,
      directGrants: [],
      referencedPrincipalHeads: [],
    },
  };
  const target = {
    containerId: input.containerId,
    containerManifestHash: childBundle.manifestHash,
    containerKeyEpochId: containerBody.containerKeyEpochId,
    containerKeyEpoch: 1,
  };
  const body: DocumentLinkAccessEventBody = {
    blobRewraps: [],
    eventType: "document.link",
    containerId: target.containerId,
    containerManifestHash: target.containerManifestHash,
  };
  const event = await signAccessEvent(
    {
      version: 1,
      eventId: crypto.randomUUID(),
      eventType: "document.link",
      objectKind: "document",
      objectId: containerBody.metadataDocumentId,
      organizationId: parentState.organizationId,
      previousManifestHash: null,
      dependencyManifestHashes: [
        input.parent.manifestHash,
        target.containerManifestHash,
      ],
      bodyHash: await computeAccessEventBodyHash(
        body as unknown as KeyingCanonicalJson,
      ),
      signerUserId: input.signer.userId,
      signerDeviceId: "test-device",
      signerKeyFingerprint: input.signer.fingerprint,
      signedAt: "2026-04-26T12:00:00.000Z",
    },
    input.signer.signing.signingPrivateKey,
  );
  const eventHash = await computeAccessEventHash(event);
  const state: DocumentLinkSetManifestState = {
    version: 1,
    documentId: containerBody.metadataDocumentId,
    organizationId: parentState.organizationId,
    epoch: 1,
    previousManifestHash: null,
    eventHash,
    linkedContainerIds: [target.containerId],
  };
  const manifest = await deriveDocumentLinkSetManifest(state);
  const manifestHash = await computeAccessManifestHash(manifest);
  const targetHash = await computeDocumentContentKeyTargetHash([target]);

  return {
    event: event as unknown as Record<string, unknown>,
    body: body as unknown,
    expectedManifestHash: manifestHash,
    manifest: manifest as unknown as Record<string, unknown>,
    targetContainerPathRefs: [
      {
        containerId: parentState.containerId,
        manifestHash: input.parent.manifestHash,
      },
      {
        containerId: target.containerId,
        manifestHash: childBundle.manifestHash,
      },
    ],
    contentKeyBundle: {
      contentKeyEpoch: 1,
      linkSetManifestHash: manifestHash,
      targetHash,
      targets: [
        {
          ...target,
          ...contentKeyEnvelopeFixture(
            "Document",
            `metadata-document-key:${containerBody.metadataDocumentId}`,
          ),
        },
      ],
    },
  };
}
