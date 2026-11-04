import type {
  ContainerAccessEventBody,
  ContainerGrantPrincipalHead,
  ContainerKeyWrap,
  ContainerUserRecipientKey,
  VerifiedContainerKekState,
  VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import { derivePrincipalRecipientKeyEpochId } from "@tearleads/crypto";
import type { TestUser } from "@tearleads/test-utils";
import type {
  AccessManifestBundleWire,
  ContainerMutationRequest,
} from "@tearleads/validators/request";
import { signAndCheckContainerEvent } from "./containerCreateRequests";
import { userRecipientKey } from "./containerGrantMutation";
import { createContainerKeyWrap, parentKekRef } from "./containerKeying";
import {
  containerManifestRef,
  containerManifestRefs,
} from "./containerManifestRefs";
import {
  asVerifiedContainerManifest,
  createManifestBundle,
  loadPrincipalPoliciesForContainerPaths,
} from "./containerMutationRotations";
import {
  uniquePrincipalPolicies,
  userRecipientKeysFromKekTargets,
} from "./keyingWriterProjectionKit";
import { joinOrg } from "./organizationMembership";
import { principalPolicyRefs } from "./principalPolicyRefs";

export async function buildGrantRequest(input: {
  readonly parentKekState: VerifiedContainerKekState;
  readonly previous: AccessManifestBundleWire;
  readonly previousContainerPath: readonly AccessManifestBundleWire[];
  readonly previousKekState: VerifiedContainerKekState;
  readonly recipient: TestUser;
  readonly signer: TestUser;
}): Promise<ContainerMutationRequest> {
  const previous = asVerifiedContainerManifest(input.previous);
  await joinOrg(previous.state.organizationId, input.signer, input.recipient);
  const recipientKey = await userRecipientKey(input.recipient);
  const principalPolicies = await loadPrincipalPoliciesForContainerPaths([
    input.previousContainerPath,
  ]);
  const grant = {
    subjectType: "user" as const,
    subjectId: input.recipient.userId,
    accessLevel: "read" as const,
  };
  const body: ContainerAccessEventBody = {
    containerKeyPublicKey: previous.state.containerKeyPublicKey,
    eventType: "container.grant",
    containerKeyEpochId: previous.state.containerKeyEpochId,
    grant,
    referencedPrincipalHead: null,
  };
  const event = await signAndCheckContainerEvent({
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
      directGrants: [...previous.state.directGrants, grant],
    },
    event,
  );
  const wraps = [
    ...(input.previousKekState.wraps as readonly ContainerKeyWrap[]),
    createContainerKeyWrap({
      containerKeyEpochId: input.previousKekState.containerKeyEpochId,
      recipientKind: "user",
      recipientId: recipientKey.userId,
      recipientKeyEpochId: recipientKey.recipientKeyEpochId,
      recipientKeyFingerprint: recipientKey.recipientKeyFingerprint,
      wrapManifestHash: bundle.manifestHash,
    }),
  ];

  return {
    event: event.event,
    body,
    expectedManifestHash: bundle.manifestHash,
    manifest: bundle.manifest,
    previousManifestRef: containerManifestRef(input.previous),
    previousContainerPathRefs: containerManifestRefs(
      input.previousContainerPath,
    ),
    containerManifestHistoryRefs: [containerManifestRef(input.previous)],
    principalPolicyRefs: principalPolicyRefs(principalPolicies),
    keyEpoch: input.previousKekState.keyEpoch,
    keyring: null,
    predecessorBridge: null,
    wraps,
    parentKekRef: parentKekRef(input.parentKekState),
    userRecipientKeys: [
      ...userRecipientKeysFromKekTargets(input.previousKekState),
      recipientKey,
    ],
  } as unknown as ContainerMutationRequest;
}

export async function buildGroupGrantRequest(input: {
  readonly accessLevel?: "admin" | "read" | "write";
  readonly containerManifestHistory?: readonly AccessManifestBundleWire[];
  readonly parentKekState: VerifiedContainerKekState | null;
  readonly previous: AccessManifestBundleWire;
  readonly previousContainerPath: readonly AccessManifestBundleWire[];
  readonly previousKekState: VerifiedContainerKekState;
  readonly principalPolicies?: readonly VerifiedPrincipalPolicy[];
  readonly principalPolicy: VerifiedPrincipalPolicy;
  readonly principalReference: ContainerGrantPrincipalHead;
  readonly signer: TestUser;
  readonly userRecipientKeys?: readonly ContainerUserRecipientKey[];
}): Promise<ContainerMutationRequest> {
  const previous = asVerifiedContainerManifest(input.previous);
  const principalPolicies = uniquePrincipalPolicies([
    ...(await loadPrincipalPoliciesForContainerPaths([
      input.previousContainerPath,
    ])),
    ...(input.principalPolicies ?? []),
    input.principalPolicy,
  ]);
  const grant = {
    subjectType: "group" as const,
    subjectId: input.principalReference.principalId,
    accessLevel: input.accessLevel ?? ("read" as const),
  };
  const body: ContainerAccessEventBody = {
    containerKeyPublicKey: previous.state.containerKeyPublicKey,
    eventType: "container.grant",
    containerKeyEpochId: previous.state.containerKeyEpochId,
    grant,
    referencedPrincipalHead: input.principalReference,
  };
  const event = await signAndCheckContainerEvent({
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
      directGrants: [
        ...previous.state.directGrants.filter(
          (existingGrant) =>
            existingGrant.subjectType !== grant.subjectType ||
            existingGrant.subjectId !== grant.subjectId,
        ),
        grant,
      ],
      referencedPrincipalHeads: [
        ...previous.state.referencedPrincipalHeads.filter(
          (existingHead) =>
            existingHead.principalType !==
              input.principalReference.principalType ||
            existingHead.principalId !== input.principalReference.principalId,
        ),
        input.principalReference,
      ],
    },
    event,
  );
  const wraps = [
    ...(input.previousKekState.wraps as readonly ContainerKeyWrap[]).filter(
      (existingWrap) =>
        existingWrap.recipientKind !== "group" ||
        existingWrap.recipientId !== input.principalReference.principalId,
    ),
    createContainerKeyWrap({
      containerKeyEpochId: input.previousKekState.containerKeyEpochId,
      recipientKind: "group",
      recipientId: input.principalReference.principalId,
      recipientKeyEpochId: derivePrincipalRecipientKeyEpochId(
        input.principalReference,
      ),
      recipientKeyFingerprint: input.principalReference.keyFingerprint,
      wrapManifestHash: bundle.manifestHash,
    }),
  ];

  return {
    event: event.event as unknown as Record<string, unknown>,
    body: body as unknown,
    expectedManifestHash: bundle.manifestHash,
    manifest: bundle.manifest,
    previousManifestRef: containerManifestRef(input.previous),
    previousContainerPathRefs: containerManifestRefs(
      input.previousContainerPath,
    ),
    containerManifestHistoryRefs: containerManifestRefs(
      input.containerManifestHistory ?? [input.previous],
    ),
    principalPolicyRefs: principalPolicyRefs(principalPolicies),
    keyEpoch: input.previousKekState.keyEpoch as unknown as Record<
      string,
      unknown
    >,
    keyring: null,
    predecessorBridge: null,
    wraps: wraps as unknown as Record<string, unknown>[],
    parentKekRef: parentKekRef(input.parentKekState ?? null),
    userRecipientKeys: (input.userRecipientKeys ?? []) as unknown as Record<
      string,
      unknown
    >[],
  };
}
