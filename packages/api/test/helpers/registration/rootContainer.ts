import {
  type AccessEvent,
  type AccessManifest,
  type ContainerAccessManifestState,
  type ContainerCreateAccessEventBody,
  type ContainerKekRecipientTarget,
  type ContainerKeyEpoch,
  type ContainerKeyWrap,
  type ContainerUserRecipientKey,
  computeAccessManifestHash,
  computeContainerKekMaterialId,
  computeContainerKekRecipientTargetHash,
  computeContainerKeyEpochHash,
  deriveContainerAccessManifest,
  deriveContainerKekWrappingPublicKey,
} from "@tearleads/crypto";
import type {
  ContainerMutationRequest,
  CreateOrganizationGroupRequest,
  PrincipalPolicyRef,
} from "@tearleads/validators/request";
import {
  wrapRootContainerKeyForManagedPrincipal,
  wrapRootContainerKeyForUser,
} from "./containerKeyWraps";
import {
  principalHeadFromInitialGroupPolicy,
  principalPolicyRefFromInitialGroupPolicy,
} from "./groupPolicyHeads";
import { signRegistrationEvent } from "./signing";
import { toWireRecord, toWireRecords } from "./wire";

export interface RootContainerCreateArtifacts {
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
  principalPolicies: PrincipalPolicyRef[];
  recipientTargets: ContainerKekRecipientTarget[];
  request: ContainerMutationRequest;
  state: ContainerAccessManifestState;
  userRecipientKeys: ContainerUserRecipientKey[];
  wraps: ContainerKeyWrap[];
}

export async function createRootContainerArtifacts(input: {
  adminGroup?: CreateOrganizationGroupRequest | undefined;
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
  const containerKeyEpochId = await computeContainerKekMaterialId({
    containerId: input.rootContainerId,
    keyEpoch: 1,
    keyMaterial: containerKey,
  });
  const adminPrincipalHead = input.adminGroup
    ? await principalHeadFromInitialGroupPolicy({
        adminGroup: input.adminGroup,
      })
    : null;
  const principalPolicies = input.adminGroup
    ? [
        await principalPolicyRefFromInitialGroupPolicy({
          adminGroup: input.adminGroup,
        }),
      ]
    : [];
  const body: ContainerCreateAccessEventBody = {
    containerKeyPublicKey: await deriveContainerKekWrappingPublicKey({
      containerId: input.rootContainerId,
      keyMaterial: containerKey,
    }),
    systemSlot: null,
    eventType: "container.create",
    parentContainerId: null,
    parentManifestHash: null,
    metadataDocumentId: input.rootMetadataDocumentId,
    containerKeyEpochId,
    directGrants: [
      {
        accessLevel: "admin",
        subjectId: adminPrincipalHead?.principalId ?? input.userId,
        subjectType: adminPrincipalHead?.principalType ?? "user",
      },
    ],
    referencedPrincipalHeads: adminPrincipalHead ? [adminPrincipalHead] : [],
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
    containerKeyPublicKey: await deriveContainerKekWrappingPublicKey({
      containerId: input.rootContainerId,
      keyMaterial: containerKey,
    }),
    systemSlot: null,
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
    referencedPrincipalHeads: body.referencedPrincipalHeads,
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
  const rootRecipient =
    adminPrincipalHead && input.adminGroup
      ? {
          ...(await wrapRootContainerKeyForManagedPrincipal({
            containerKey,
            containerKeyEpochId,
            manifestHash,
            principalEncapsulationPublicKey:
              input.adminGroup.initialGroupPolicy.state.encapsulationPublicKey,
            principalHead: adminPrincipalHead,
          })),
          userRecipientKey: null,
        }
      : await wrapRootContainerKeyForUser({
          containerKey,
          containerKeyEpochId,
          encapsulationPublicKey: input.encapsulationPublicKey,
          manifestHash,
          userId: input.userId,
        });
  const { recipientTarget, userRecipientKey, wrap } = rootRecipient;
  const recipientTargets = [recipientTarget];
  const userRecipientKeys = userRecipientKey ? [userRecipientKey] : [];
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
    principalPolicies,
    recipientTargets,
    request: {
      event: toWireRecord(event, "root container request event"),
      body: toWireRecord(body, "root container request body"),
      expectedManifestHash: manifestHash,
      manifest: toWireRecord(manifest, "root container request manifest"),
      previousManifestRef: null,
      parentContainerPathRefs: [],
      principalPolicyRefs: principalPolicies,
      keyEpoch: toWireRecord(keyEpoch, "root container request key epoch"),
      predecessorBridge: null,
      keyring: null,
      wraps: toWireRecords([wrap], "root container request wraps"),
      userRecipientKeys: toWireRecords(
        userRecipientKeys,
        "root container request user recipient keys",
      ),
    },
    state,
    userRecipientKeys,
    wraps: [wrap],
  };
}
