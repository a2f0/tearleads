import type {
  AccessEvent,
  AccessManifest,
  ContainerCreateAccessEventBody,
  ContainerKeyEpoch,
  ContainerKeyWrap,
  ContainerUserRecipientKey,
  ReferencedPrincipalHead,
} from "@tearleads/crypto";
import {
  computeAccessManifestHash,
  computeContainerKekRecipientTargetHash,
  computeContainerKeyEpochHash,
  computePrincipalStateHash,
  deriveContainerAccessManifest,
} from "@tearleads/crypto";
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
  readCanonicalRecord,
  readCanonicalRecords,
} from "../../../data/keyingCanonicalJson";

type InitialManagedPrincipalPolicy =
  CreateOrganizationGroupRequest["initialGroupPolicy"];

interface RootManagedPrincipalGrantInput {
  readonly principalId: string;
  readonly policy: InitialManagedPrincipalPolicy;
}

async function principalHeadFromInitialGroupPolicy(
  input: RootManagedPrincipalGrantInput,
): Promise<ReferencedPrincipalHead> {
  return {
    principalType: "group",
    principalId: input.principalId,
    version: input.policy.state.version,
    keyEpoch: input.policy.state.keyEpoch,
    stateHash: await computePrincipalStateHash(input.policy.state),
    keyFingerprint: input.policy.state.keyFingerprint,
  };
}

async function principalPolicyRecordFromInitialGroupPolicy(
  input: RootManagedPrincipalGrantInput,
): Promise<Record<string, unknown>> {
  const head = await principalHeadFromInitialGroupPolicy(input);

  return readCanonicalRecord(
    {
      principalType: head.principalType,
      principalId: head.principalId,
      version: head.version,
      keyEpoch: head.keyEpoch,
      stateHash: head.stateHash,
      state: {
        ...input.policy.state,
        stateHash: head.stateHash,
      },
      projection: input.policy.projection,
      checkpoint: {
        principalType: head.principalType,
        principalId: head.principalId,
        version: head.version,
        stateHash: head.stateHash,
      },
    },
    "Initial managed principal policy",
  );
}

function buildRootContainerCreateBody(input: {
  author: ContainerMutationAuthor;
  managedPrincipalGrant?: {
    readonly accessLevel: "admin";
    readonly principalHead: ReferencedPrincipalHead;
  };
  containerKeyEpochId: string;
  metadataDocumentId: string;
}): ContainerCreateAccessEventBody {
  if (input.managedPrincipalGrant) {
    return {
      ...buildContainerCreateBody({
        containerKeyEpochId: input.containerKeyEpochId,
        metadataDocumentId: input.metadataDocumentId,
        parentContainerId: null,
        parentManifestHash: null,
      }),
      directGrants: [
        {
          accessLevel: input.managedPrincipalGrant.accessLevel,
          subjectId: input.managedPrincipalGrant.principalHead.principalId,
          subjectType: input.managedPrincipalGrant.principalHead.principalType,
        },
      ],
      referencedPrincipalHeads: [input.managedPrincipalGrant.principalHead],
    };
  }

  return {
    ...buildContainerCreateBody({
      containerKeyEpochId: input.containerKeyEpochId,
      metadataDocumentId: input.metadataDocumentId,
      parentContainerId: null,
      parentManifestHash: null,
    }),
    directGrants: [
      {
        accessLevel: "admin",
        subjectId: input.author.signerUserId,
        subjectType: "user",
      },
    ],
  };
}

async function deriveRootContainerCreateManifest(input: {
  author: ContainerMutationAuthor;
  body: ContainerCreateAccessEventBody;
  containerId: string;
  containerKeyEpochId: string;
  eventHash: string;
  metadataDocumentId: string;
}): Promise<Pick<ContainerCreatePlan, "manifest" | "manifestHash" | "state">> {
  const { state } = await deriveContainerCreateManifest({
    // A root container belongs to the creator's own organization.
    organizationId: input.author.organizationId,
    containerId: input.containerId,
    containerKeyEpochId: input.containerKeyEpochId,
    eventHash: input.eventHash,
    metadataDocumentId: input.metadataDocumentId,
    parentContainerId: null,
    parentManifestHash: null,
  });
  state.directGrants = input.body.directGrants;
  state.referencedPrincipalHeads = input.body.referencedPrincipalHeads;
  const manifest = await deriveContainerAccessManifest(state);

  return {
    manifest,
    manifestHash: await computeAccessManifestHash(manifest),
    state,
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
  managedPrincipalHead: ReferencedPrincipalHead | null;
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
      await principalPolicyRecordFromInitialGroupPolicy({
        principalId: adminGroup.groupId,
        policy: adminGroup.initialGroupPolicy,
      }),
    ],
  };
}

async function wrapRootContainerKeyForPlan(input: {
  adminGroup: CreateOrganizationGroupRequest | null;
  containerKey: Uint8Array;
  containerKeyEpochId: string;
  manifestHash: string;
  managedPrincipalHead: ReferencedPrincipalHead | null;
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

function buildMaterializedRootContainerPlan(input: {
  body: ContainerCreateAccessEventBody;
  containerId: string;
  containerKeyEpochId: string;
  event: AccessEvent;
  eventHash: string;
  keyEpoch: ContainerKeyEpoch;
  keyEpochHash: string;
  keyTargetHash: string;
  manifest: AccessManifest;
  manifestHash: string;
  metadataDocumentId: string;
  principalPolicies: readonly Record<string, unknown>[];
  recipientTargets: ContainerCreatePlan["recipientTargets"];
  state: ContainerCreatePlan["state"];
  userRecipientKeys: readonly ContainerUserRecipientKey[];
  wraps: readonly ContainerKeyWrap[];
}): ContainerCreatePlan {
  return {
    body: input.body,
    containerId: input.containerId,
    containerKeyEpochId: input.containerKeyEpochId,
    event: input.event,
    eventHash: input.eventHash,
    keyEpoch: input.keyEpoch,
    keyEpochHash: input.keyEpochHash,
    keyTargetHash: input.keyTargetHash,
    manifest: input.manifest,
    manifestHash: input.manifestHash,
    metadataDocumentId: input.metadataDocumentId,
    parentContainerId: null,
    parentManifestHash: null,
    recipientTargets: [...input.recipientTargets],
    request: buildRootContainerCreateRequest({
      body: input.body,
      event: input.event,
      keyEpoch: input.keyEpoch,
      manifest: input.manifest,
      manifestHash: input.manifestHash,
      principalPolicies: input.principalPolicies,
      userRecipientKeys: input.userRecipientKeys,
      wraps: input.wraps,
    }),
    state: input.state,
    wraps: [...input.wraps],
  };
}

export async function buildRootContainerCreatePlan(input: {
  adminGroup?: CreateOrganizationGroupRequest | undefined;
  author: ContainerMutationAuthor;
  containerId: string;
  containerKey?: Uint8Array | undefined;
  containerKeyEpochId?: string | undefined;
  eventId?: string | undefined;
  metadataDocumentId: string;
  recipientEncapsulationPublicKey: Uint8Array;
  signedAt?: string | undefined;
}): Promise<MaterializedContainerCreatePlan> {
  const containerKey =
    input.containerKey ?? crypto.getRandomValues(new Uint8Array(32));
  if (containerKey.byteLength !== 32) {
    throw new Error("Container KEK material must be 32 bytes");
  }
  const adminGroup = input.adminGroup ?? null;
  const { managedPrincipalHead, managedPrincipalPolicies } =
    await buildRootManagedPrincipalContext(adminGroup);

  const containerKeyEpochId = await resolveContainerKekEpochId({
    containerId: input.containerId,
    keyEpoch: 1,
    keyMaterial: containerKey,
    override: input.containerKeyEpochId,
  });
  const body = buildRootContainerCreateBody({
    author: input.author,
    containerKeyEpochId,
    ...(managedPrincipalHead
      ? {
          managedPrincipalGrant: {
            accessLevel: "admin" as const,
            principalHead: managedPrincipalHead,
          },
        }
      : {}),
    metadataDocumentId: input.metadataDocumentId,
  });
  const { event, eventHash } = await signContainerCreateEvent({
    author: input.author,
    body,
    containerId: input.containerId,
    eventId: input.eventId ?? crypto.randomUUID(),
    // A root container belongs to the creator's own organization.
    organizationId: input.author.organizationId,
    parentPath: [],
    signedAt: input.signedAt ?? new Date().toISOString(),
  });
  const { manifest, manifestHash, state } =
    await deriveRootContainerCreateManifest({
      author: input.author,
      body,
      containerId: input.containerId,
      containerKeyEpochId,
      eventHash,
      metadataDocumentId: input.metadataDocumentId,
    });
  const keyEpoch = buildContainerCreateKeyEpoch({
    containerId: input.containerId,
    containerKeyEpochId,
    eventHash,
    manifestHash,
    parentContainerKeyEpochId: null,
  });
  const rootRecipient = await wrapRootContainerKeyForPlan({
    adminGroup,
    containerKey,
    containerKeyEpochId,
    manifestHash,
    managedPrincipalHead,
    recipientEncapsulationPublicKey: input.recipientEncapsulationPublicKey,
    userId: input.author.signerUserId,
  });
  const { recipientTarget, userRecipientKey, wrap } = rootRecipient;
  const recipientTargets = [recipientTarget];
  const keyTargetHash =
    await computeContainerKekRecipientTargetHash(recipientTargets);
  const keyEpochHash = await computeContainerKeyEpochHash(keyEpoch);
  const plan = buildMaterializedRootContainerPlan({
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
    principalPolicies: managedPrincipalPolicies,
    recipientTargets,
    state,
    wraps: [wrap],
    userRecipientKeys: userRecipientKey ? [userRecipientKey] : [],
  });

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
