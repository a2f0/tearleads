import {
  type AccessEvent,
  type AccessManifest,
  type ContainerAccessManifestState,
  type ContainerCreateAccessEventBody,
  type ContainerKekRecipientTarget,
  type ContainerKeyEpoch,
  type ContainerKeyWrap,
  computeAccessManifestHash,
  computeContainerKekMaterialId,
  computeContainerKekRecipientTargetHash,
  computeContainerKeyEpochHash,
  deriveContainerAccessManifest,
  deriveContainerKekWrappingPublicKey,
  wrapDekForRecipients,
} from "@tearleads/crypto";
import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import type {
  ContainerMutationRequest,
  CreateOrganizationGroupRequest,
} from "@tearleads/validators/request";
import type { ContainerWriterProjectionResponse } from "@tearleads/validators/response";
import { parentKekRef } from "../containerKeying";
import { containerManifestRefs } from "../containerManifestRefs";
import { wrapRootContainerKeyForManagedPrincipal } from "./containerKeyWraps";
import {
  principalHeadFromInitialGroupPolicy,
  principalPolicyRefFromInitialGroupPolicy,
} from "./groupPolicyHeads";
import type { RootContainerCreateArtifacts } from "./rootContainer";
import { signRegistrationEvent } from "./signing";
import { toWireRecord, toWireRecords } from "./wire";

interface ChildContainerCreateArtifacts {
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

export async function createChildContainerArtifacts(input: {
  metadataDocumentId: string;
  systemSlot: string;
  managedGrant?:
    | { accessLevel: "read"; group: CreateOrganizationGroupRequest }
    | undefined;
  parent: RootContainerCreateArtifacts;
  parentProjection: ContainerWriterProjectionResponse;
  signerDeviceId: string;
  signerKeyFingerprint: string;
  signingPrivateKey: Uint8Array;
  userId: string;
}): Promise<ChildContainerCreateArtifacts> {
  const parentKek = input.parentProjection.containerKeks.at(-1);
  if (!parentKek) {
    throw new Error("Missing parent container KEK for child fixture");
  }

  const containerKey = crypto.getRandomValues(new Uint8Array(32));
  const containerId = input.metadataDocumentId;
  const containerKeyEpochId = await computeContainerKekMaterialId({
    containerId,
    keyEpoch: 1,
    keyMaterial: containerKey,
  });
  const managedGrant = input.managedGrant;
  const managedHead = managedGrant
    ? await principalHeadFromInitialGroupPolicy({
        adminGroup: managedGrant.group,
      })
    : null;
  const body: ContainerCreateAccessEventBody = {
    containerKeyPublicKey: await deriveContainerKekWrappingPublicKey({
      containerId,
      keyMaterial: containerKey,
    }),
    systemSlot: input.systemSlot,
    eventType: "container.create",
    parentContainerId: input.parent.state.containerId,
    parentManifestHash: input.parent.manifestHash,
    metadataDocumentId: input.metadataDocumentId,
    containerKeyEpochId,
    directGrants:
      managedGrant && managedHead
        ? [
            {
              accessLevel: managedGrant.accessLevel,
              subjectId: managedHead.principalId,
              subjectType: managedHead.principalType,
            },
          ]
        : [],
    referencedPrincipalHeads: managedHead ? [managedHead] : [],
  };
  const { event, eventHash } = await signRegistrationEvent({
    body,
    dependencyManifestHashes: input.parentProjection.path.map(
      (bundle) => bundle.manifestHash,
    ),
    eventType: "container.create",
    objectKind: "container",
    objectId: containerId,
    organizationId: input.parent.state.organizationId,
    previousManifestHash: null,
    signerDeviceId: input.signerDeviceId,
    signerKeyFingerprint: input.signerKeyFingerprint,
    signerPrivateKey: input.signingPrivateKey,
    signerUserId: input.userId,
  });
  const state: ContainerAccessManifestState = {
    containerKeyPublicKey: await deriveContainerKekWrappingPublicKey({
      containerId,
      keyMaterial: containerKey,
    }),
    systemSlot: input.systemSlot,
    version: 1,
    containerId,
    organizationId: input.parent.state.organizationId,
    epoch: 1,
    previousManifestHash: null,
    eventHash,
    parentContainerId: input.parent.state.containerId,
    parentManifestHash: input.parent.manifestHash,
    metadataDocumentId: input.metadataDocumentId,
    containerKeyEpochId,
    directGrants: body.directGrants,
    referencedPrincipalHeads: body.referencedPrincipalHeads,
  };
  const manifest = await deriveContainerAccessManifest(state);
  const manifestHash = await computeAccessManifestHash(manifest);
  const keyEpoch: ContainerKeyEpoch = {
    id: containerKeyEpochId,
    containerId,
    keyEpoch: 1,
    accessManifestHash: manifestHash,
    parentContainerKeyEpochId: parentKek.containerKeyEpochId,
    createdByEventHash: eventHash,
    createdByManifestHash: manifestHash,
  };
  const parentTarget: ContainerKekRecipientTarget = {
    recipientKind: "container",
    recipientId: parentKek.containerId,
    recipientKeyEpochId: parentKek.containerKeyEpochId,
    recipientKeyFingerprint: parentKek.keyEpochHash,
  };
  const parentPublicKey = await deriveContainerKekWrappingPublicKey({
    containerId: parentKek.containerId,
    keyMaterial: input.parent.containerKey,
  });
  const [wrappedContainerKey] = await wrapDekForRecipients(containerKey, [
    base64ToBytes(parentPublicKey),
  ]);
  if (!wrappedContainerKey) throw new Error("Missing parent wrapping fixture");
  const parentWrap: ContainerKeyWrap = {
    containerKeyEpochId,
    recipientKind: "container",
    recipientId: parentKek.containerId,
    recipientKeyEpochId: parentKek.containerKeyEpochId,
    recipientKeyFingerprint: parentKek.keyEpochHash,
    kemCipherText: bytesToBase64(wrappedContainerKey.kemCipherText),
    wrappedKey: bytesToBase64(wrappedContainerKey.wrappedKey),
    wrapManifestHash: manifestHash,
  };
  const managedRecipient =
    managedGrant && managedHead
      ? await wrapRootContainerKeyForManagedPrincipal({
          containerKey,
          containerKeyEpochId,
          manifestHash,
          principalEncapsulationPublicKey:
            managedGrant.group.initialGroupPolicy.state.encapsulationPublicKey,
          principalHead: managedHead,
        })
      : null;
  const recipientTargets: ContainerKekRecipientTarget[] = managedRecipient
    ? [parentTarget, managedRecipient.recipientTarget]
    : [parentTarget];
  const wraps: ContainerKeyWrap[] = managedRecipient
    ? [parentWrap, managedRecipient.wrap]
    : [parentWrap];
  const keyTargetHash =
    await computeContainerKekRecipientTargetHash(recipientTargets);
  const keyEpochHash = await computeContainerKeyEpochHash(keyEpoch);
  // The Members group policy justifies the group KEK recipient target; the
  // parent's Admins policy justifies writing under the root parent.
  const principalPolicies =
    managedGrant && managedHead
      ? [
          ...input.parent.principalPolicies,
          await principalPolicyRefFromInitialGroupPolicy({
            adminGroup: managedGrant.group,
          }),
        ]
      : input.parent.principalPolicies;

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
    metadataDocumentId: input.metadataDocumentId,
    recipientTargets,
    request: {
      event: toWireRecord(event, "child container request event"),
      body: toWireRecord(body, "child container request body"),
      expectedManifestHash: manifestHash,
      manifest: toWireRecord(manifest, "child container request manifest"),
      previousManifestRef: null,
      parentContainerPathRefs: containerManifestRefs(
        input.parentProjection.path,
      ),
      principalPolicyRefs: principalPolicies,
      keyEpoch: toWireRecord(keyEpoch, "child container request key epoch"),
      predecessorBridge: null,
      keyring: null,
      wraps: toWireRecords(wraps, "child container request wraps"),
      parentKekRef: parentKekRef(parentKek),
      userRecipientKeys: [],
    },
    state,
    wraps,
  };
}

export function childContainerProjectionFromArtifacts(input: {
  child: ChildContainerCreateArtifacts;
  parentProjection: ContainerWriterProjectionResponse;
}): ContainerWriterProjectionResponse {
  const parentKek = input.parentProjection.containerKeks.at(-1);
  if (!parentKek) {
    throw new Error(
      "Missing parent container KEK for child projection fixture",
    );
  }

  return {
    policyEvidence: {
      organization: null,
      organizationPayloads: [],
      groups: [],
    },
    containerId: input.child.state.containerId,
    organizationId: input.child.state.organizationId,
    path: [
      ...input.parentProjection.path,
      {
        event: {
          event: toWireRecord(input.child.event, "child container event"),
          body: toWireRecord(input.child.body, "child container event body"),
          eventHash: input.child.eventHash,
        },
        manifest: toWireRecord(
          input.child.manifest,
          "child container manifest",
        ),
        manifestHash: input.child.manifestHash,
        state: toWireRecord(input.child.state, "child container state"),
      },
    ],
    containerKeks: [
      ...input.parentProjection.containerKeks,
      {
        containerId: input.child.state.containerId,
        accessManifestHash: input.child.manifestHash,
        containerKeyEpochId: input.child.containerKeyEpochId,
        containerKeyEpoch: input.child.keyEpoch.keyEpoch,
        keyEpoch: toWireRecord(
          input.child.keyEpoch,
          "child container key epoch",
        ),
        keyEpochHash: input.child.keyEpochHash,
        keyTargetHash: input.child.keyTargetHash,
        containerManifestHistory: [],
        keyring: null,
        parentContainerKeyEpochId: parentKek.containerKeyEpochId,
        recipientTargets: toWireRecords(
          input.child.recipientTargets,
          "child container recipient targets",
        ),
        wraps: toWireRecords(input.child.wraps, "child container wraps"),
      },
    ],
  };
}
