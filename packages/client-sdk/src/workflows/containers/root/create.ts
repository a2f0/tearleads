import type {
  AccessEvent,
  AccessManifest,
  ContainerCreateAccessEventBody,
  ContainerGrantPrincipalHead,
  ContainerKeyEpoch,
  ContainerKeyWrap,
  ContainerUserRecipientKey,
} from "@tearleads/crypto";
import {
  computeContainerKekRecipientTargetHash,
  computeContainerKeyEpochHash,
  deriveContainerKekWrappingPublicKey,
  normalizeContainerAccessEventBody,
} from "@tearleads/crypto";
import type { ContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import type {
  ContainerMutationRequest,
  CreateOrganizationGroupRequest,
} from "@tearleads/validators/request";
import type { ContainerWriterProjectionResponse } from "@tearleads/validators/response";
import {
  buildContainerCreateBody,
  buildContainerCreateKeyEpoch,
  deriveContainerCreateManifest,
  resolveContainerKekEpochId,
  signContainerCreateEvent,
} from "../../../data/containers/shared/events";
import {
  wrapContainerKeyToManagedPrincipal,
  wrapContainerKeyToRootUser,
} from "../../../data/containers/shared/projection";
import type {
  ContainerCreatePlan,
  ContainerMutationAuthor,
  MaterializedContainerCreatePlan,
} from "../../../data/containers/shared/types";
import {
  readCanonicalJson,
  readCanonicalRecord,
  readCanonicalRecords,
} from "../../../data/keyingCanonicalJson";

import {
  principalHeadFromInitialGroupPolicy,
  principalPolicyRecordFromInitialGroupPolicy,
} from "./initialGroupPolicy";

function buildRootContainerCreateBody(input: {
  author: ContainerMutationAuthor;
  managedPrincipalHead: ContainerGrantPrincipalHead | null;
  containerKeyEpochId: string;
  containerKeyPublicKey: string;
  metadataDocumentId: string;
  memberHead: ContainerGrantPrincipalHead | null;
  systemSlot: ContainerSystemSlot | null;
}): ContainerCreateAccessEventBody {
  const baseBody = buildContainerCreateBody({
    systemSlot: input.systemSlot,
    containerKeyEpochId: input.containerKeyEpochId,
    containerKeyPublicKey: input.containerKeyPublicKey,
    metadataDocumentId: input.metadataDocumentId,
    parentContainerId: null,
    parentManifestHash: null,
  });
  if (input.managedPrincipalHead) {
    return {
      ...baseBody,
      directGrants: [
        {
          accessLevel: "admin",
          subjectId: input.managedPrincipalHead.principalId,
          subjectType: input.managedPrincipalHead.principalType,
        },
        ...(input.memberHead
          ? [
              {
                accessLevel: "read" as const,
                subjectId: input.memberHead.principalId,
                subjectType: "group" as const,
              },
            ]
          : []),
      ],
      referencedPrincipalHeads: [
        input.managedPrincipalHead,
        ...(input.memberHead ? [input.memberHead] : []),
      ],
    };
  }

  return {
    ...baseBody,
    directGrants: [
      {
        accessLevel: "admin",
        subjectId: input.author.signerUserId,
        subjectType: "user",
      },
    ],
  };
}

function buildRootContainerCreateRequest(input: {
  body: ContainerCreateAccessEventBody;
  event: AccessEvent;
  keyEpoch: ContainerKeyEpoch;
  manifest: AccessManifest;
  manifestHash: string;
  principalPolicies: readonly Record<string, unknown>[];
  userRecipientKeys: readonly ContainerUserRecipientKey[];
  wraps: readonly ContainerKeyWrap[];
}): ContainerMutationRequest {
  return {
    event: readCanonicalRecord(input.event, "Container root create event"),
    body: readCanonicalRecord(input.body, "Container root create body"),
    expectedManifestHash: input.manifestHash,
    manifest: readCanonicalRecord(
      input.manifest,
      "Container root create manifest",
    ),
    previousManifest: null,
    parentContainerPath: [],
    principalPolicies: readCanonicalRecords(
      input.principalPolicies,
      "Container root create principal policies",
    ),
    keyEpoch: readCanonicalRecord(
      input.keyEpoch,
      "Container root create key epoch",
    ),
    predecessorBridge: null,
    keyring: null,
    wraps: readCanonicalRecords(input.wraps, "Container root create wraps"),
    userRecipientKeys: readCanonicalRecords(
      input.userRecipientKeys,
      "Container root create user recipient keys",
    ),
  };
}

async function buildRootManagedPrincipalContext(
  adminGroup: CreateOrganizationGroupRequest | null,
): Promise<{
  managedPrincipalHead: ContainerGrantPrincipalHead | null;
  managedPrincipalPolicies: Record<string, unknown>[];
}> {
  if (!adminGroup) {
    return {
      managedPrincipalHead: null,
      managedPrincipalPolicies: [],
    };
  }

  const managedPrincipalHead = await principalHeadFromInitialGroupPolicy({
    principalId: adminGroup.groupId,
    policy: adminGroup.initialGroupPolicy,
  });

  return {
    managedPrincipalHead,
    managedPrincipalPolicies: [
      principalPolicyRecordFromInitialGroupPolicy({
        head: managedPrincipalHead,
        policy: adminGroup.initialGroupPolicy,
      }),
    ],
  };
}

async function deriveRootCreateArtifacts(input: {
  author: ContainerMutationAuthor;
  body: ContainerCreateAccessEventBody;
  containerId: string;
  containerKeyEpochId: string;
  metadataDocumentId: string;
  signedAt: string | undefined;
}) {
  if (!input.body.containerKeyPublicKey)
    throw new Error("Root container public key is missing");
  const { event, eventHash } = await signContainerCreateEvent({
    author: input.author,
    body: input.body,
    containerId: input.containerId,
    eventId: crypto.randomUUID(),
    // A root container belongs to the creator's own organization.
    organizationId: input.author.organizationId,
    parentPath: [],
    signedAt: input.signedAt ?? new Date().toISOString(),
  });
  const { manifest, manifestHash, state } = await deriveContainerCreateManifest(
    {
      systemSlot: input.body.systemSlot,
      containerId: input.containerId,
      containerKeyEpochId: input.containerKeyEpochId,
      containerKeyPublicKey: input.body.containerKeyPublicKey,
      directGrants: input.body.directGrants,
      eventHash,
      metadataDocumentId: input.metadataDocumentId,
      // A root container belongs to the creator's own organization.
      organizationId: input.author.organizationId,
      parentContainerId: null,
      parentManifestHash: null,
      referencedPrincipalHeads: input.body.referencedPrincipalHeads,
    },
  );
  const keyEpoch = buildContainerCreateKeyEpoch({
    containerId: input.containerId,
    containerKeyEpochId: input.containerKeyEpochId,
    eventHash,
    manifestHash,
    parentContainerKeyEpochId: null,
  });
  return { event, eventHash, keyEpoch, manifest, manifestHash, state };
}

async function wrapRootContainerKeyForPlan(input: {
  adminGroup: CreateOrganizationGroupRequest | null;
  containerKey: Uint8Array;
  containerKeyEpochId: string;
  manifestHash: string;
  managedPrincipalHead: ContainerGrantPrincipalHead | null;
  recipientEncapsulationPublicKey: Uint8Array;
  userId: string;
}) {
  if (input.adminGroup && input.managedPrincipalHead) {
    return {
      ...(await wrapContainerKeyToManagedPrincipal({
        containerKey: input.containerKey,
        containerKeyEpochId: input.containerKeyEpochId,
        manifestHash: input.manifestHash,
        principalEncapsulationPublicKey:
          input.adminGroup.initialGroupPolicy.state.encapsulationPublicKey,
        principalHead: input.managedPrincipalHead,
      })),
      userRecipientKey: null,
    };
  }

  return wrapContainerKeyToRootUser({
    containerKey: input.containerKey,
    containerKeyEpochId: input.containerKeyEpochId,
    manifestHash: input.manifestHash,
    recipientEncapsulationPublicKey: input.recipientEncapsulationPublicKey,
    userId: input.userId,
  });
}

async function wrapRootContainerRecipients(
  input: Parameters<typeof wrapRootContainerKeyForPlan>[0] & {
    memberGroup: CreateOrganizationGroupRequest | null;
    memberHead: ContainerGrantPrincipalHead | null;
  },
) {
  const root = await wrapRootContainerKeyForPlan(input);
  const member =
    input.memberGroup && input.memberHead
      ? await wrapContainerKeyToManagedPrincipal({
          ...input,
          principalEncapsulationPublicKey:
            input.memberGroup.initialGroupPolicy.state.encapsulationPublicKey,
          principalHead: input.memberHead,
        })
      : null;
  return {
    recipientTargets: [
      root.recipientTarget,
      ...(member ? [member.recipientTarget] : []),
    ],
    wraps: [root.wrap, ...(member ? [member.wrap] : [])],
    userRecipientKeys: root.userRecipientKey ? [root.userRecipientKey] : [],
  };
}

function rootKeyMaterial(key?: Uint8Array): Uint8Array {
  const material = key ?? crypto.getRandomValues(new Uint8Array(32));
  if (material.byteLength !== 32)
    throw new Error("Container KEK material must be 32 bytes");
  return material;
}

function normalizedRootCreateBody(
  input: Parameters<typeof buildRootContainerCreateBody>[0],
): ContainerCreateAccessEventBody {
  const body = normalizeContainerAccessEventBody(
    readCanonicalJson(buildRootContainerCreateBody(input), "Root create body"),
  );
  if (body.eventType !== "container.create")
    throw new Error("Expected root creation body");
  return body;
}

export async function buildRootContainerCreatePlan(input: {
  adminGroup?: CreateOrganizationGroupRequest | undefined;
  memberGroup?: CreateOrganizationGroupRequest | undefined;
  systemSlot?: ContainerSystemSlot | undefined;
  author: ContainerMutationAuthor;
  containerId: string;
  containerKey?: Uint8Array | undefined;
  metadataDocumentId: string;
  recipientEncapsulationPublicKey: Uint8Array;
  signedAt?: string | undefined;
}): Promise<MaterializedContainerCreatePlan> {
  const containerKey = rootKeyMaterial(input.containerKey);
  const adminGroup = input.adminGroup ?? null;
  const { managedPrincipalHead, managedPrincipalPolicies } =
    await buildRootManagedPrincipalContext(adminGroup);

  const member = await buildRootManagedPrincipalContext(
    input.memberGroup ?? null,
  );
  if (input.memberGroup && !adminGroup)
    throw new Error("Members root grant requires Admins authority");
  managedPrincipalPolicies.push(...member.managedPrincipalPolicies);
  const containerKeyEpochId = await resolveContainerKekEpochId({
    containerId: input.containerId,
    keyEpoch: 1,
    keyMaterial: containerKey,
  });
  const body = normalizedRootCreateBody({
    containerKeyPublicKey: await deriveContainerKekWrappingPublicKey({
      containerId: input.containerId,
      keyMaterial: containerKey,
    }),
    memberHead: member.managedPrincipalHead,
    systemSlot: input.systemSlot ?? null,
    author: input.author,
    containerKeyEpochId,
    managedPrincipalHead,
    metadataDocumentId: input.metadataDocumentId,
  });
  const { event, eventHash, keyEpoch, manifest, manifestHash, state } =
    await deriveRootCreateArtifacts({
      author: input.author,
      body,
      containerId: input.containerId,
      containerKeyEpochId,
      metadataDocumentId: input.metadataDocumentId,
      signedAt: input.signedAt,
    });
  const { recipientTargets, wraps, userRecipientKeys } =
    await wrapRootContainerRecipients({
      memberGroup: input.memberGroup ?? null,
      memberHead: member.managedPrincipalHead,
      adminGroup,
      containerKey,
      containerKeyEpochId,
      manifestHash,
      managedPrincipalHead,
      recipientEncapsulationPublicKey: input.recipientEncapsulationPublicKey,
      userId: input.author.signerUserId,
    });
  const keyTargetHash =
    await computeContainerKekRecipientTargetHash(recipientTargets);
  const keyEpochHash = await computeContainerKeyEpochHash(keyEpoch);
  const plan: ContainerCreatePlan = {
    body,
    containerId: input.containerId,
    containerKeyEpochId,
    event,
    eventHash,
    keyEpoch,
    keyEpochHash,
    keyTargetHash,
    manifest,
    manifestHash,
    metadataDocumentId: input.metadataDocumentId,
    parentContainerId: null,
    parentManifestHash: null,
    recipientTargets,
    request: buildRootContainerCreateRequest({
      body,
      event,
      keyEpoch,
      manifest,
      manifestHash,
      principalPolicies: managedPrincipalPolicies,
      userRecipientKeys,
      wraps,
    }),
    state,
    wraps,
  };

  return { containerKey, plan };
}

export function rootContainerWriterProjectionFromCreatePlan(
  plan: ContainerCreatePlan,
): ContainerWriterProjectionResponse {
  return {
    containerId: plan.containerId,
    organizationId: plan.state.organizationId,
    path: [
      {
        event: {
          event: readCanonicalRecord(plan.event, "Container root event"),
          body: readCanonicalRecord(plan.body, "Container root body"),
          eventHash: plan.eventHash,
        },
        manifest: readCanonicalRecord(plan.manifest, "Container root manifest"),
        manifestHash: plan.manifestHash,
        state: readCanonicalRecord(plan.state, "Container root state"),
      },
    ],
    containerKeks: [
      {
        containerId: plan.containerId,
        accessManifestHash: plan.manifestHash,
        containerKeyEpochId: plan.containerKeyEpochId,
        containerKeyEpoch: plan.keyEpoch.keyEpoch,
        keyEpoch: readCanonicalRecord(
          plan.keyEpoch,
          "Container root key epoch",
        ),
        keyEpochHash: plan.keyEpochHash,
        keyTargetHash: plan.keyTargetHash,
        containerManifestHistory: [],
        parentContainerKeyEpochId: null,
        keyring: null,
        recipientTargets: readCanonicalRecords(
          plan.recipientTargets,
          "Container root recipient targets",
        ),
        wraps: readCanonicalRecords(plan.wraps, "Container root wraps"),
      },
    ],
  };
}
