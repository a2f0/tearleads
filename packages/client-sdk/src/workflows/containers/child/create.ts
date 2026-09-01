import {
  type AccessEvent,
  type AccessManifest,
  type ContainerCreateAccessEventBody,
  type ContainerKekRecipientTarget,
  type ContainerKeyEpoch,
  type ContainerKeyWrap,
  computeContainerKekRecipientTargetHash,
  computeContainerKeyEpochHash,
  type VerifiedPrincipalPolicy,
} from "@symcrypt/crypto";
import type { ContainerMutationRequest } from "@symcrypt/validators/request";
import type {
  ContainerKekResponse,
  ContainerWriterProjectionResponse,
} from "@symcrypt/validators/response";
import {
  buildContainerCreateBody,
  buildContainerCreateKeyEpoch,
  buildParentRecipientTargets,
  deriveContainerCreateManifest,
  resolveContainerKekEpochId,
  signContainerCreateEvent,
} from "../../../data/containers/shared/events";
import { acknowledgeContainerMutation } from "../../../data/containers/shared/mutationAcknowledgement";
import {
  asContainerManifestBundle,
  getParentCreateContext,
  wrapContainerKeyToManagedPrincipal,
  wrapContainerKeyToParent,
} from "../../../data/containers/shared/projection";
import type {
  BuildContainerCreatePlanInput,
  ContainerCreatePlan,
  ContainerCreatePlanContext,
  ContainerMutationAuthor,
  CreateRemoteContainerResult,
  MaterializedContainerCreatePlan,
} from "../../../data/containers/shared/types";
import { unwrapContainerKekPath } from "../../../data/documents/shared/projection";
import {
  type ProjectionVerificationOptions,
  projectionVerificationOptions,
} from "../../../data/documents/shared/types";
import {
  readCanonicalRecord,
  readCanonicalRecords,
} from "../../../data/keyingCanonicalJson";
import type {
  ProjectionUserKeyResolver,
  ReferencedPrincipalPolicyWarmer,
} from "../../../data/keyingProjectionVerification";
import {
  collectContainerWriterProjectionPrincipalPolicies,
  nullOnProjectionVerificationCancellation,
  requireProjectionUserKeyResolver,
} from "../../../data/keyingProjectionVerification";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import {
  type ContainerCreateRepairState,
  type RemoteContainerCreateInput,
  repairContainerCreateFailure,
  submitRemoteContainerCreate,
} from "./createSubmission";
import { containerMutationRequestCore } from "./mutationRequestCore";
import { requireUnwrappedKek } from "./rotationContext";

function assertContainerCreatePlanInput(input: {
  containerKey: Uint8Array;
  parentKekMaterial: Uint8Array;
}): void {
  if (input.containerKey.byteLength !== 32) {
    throw new Error("Container KEK material must be 32 bytes");
  }
  if (input.parentKekMaterial.byteLength !== 32) {
    throw new Error("Container parent KEK material must be 32 bytes");
  }
  // The child container's organization is derived from the parent projection
  // (see buildContainerCreatePlan), so it always matches the parent by
  // construction — a member writing under another org's shared root is the
  // expected case, not an error. The author supplies only the signer identity.
}

function buildContainerCreateRequest(input: {
  body: ContainerCreateAccessEventBody;
  event: AccessEvent;
  keyEpoch: ContainerKeyEpoch;
  manifest: AccessManifest;
  manifestHash: string;
  parentKek: ContainerKekResponse;
  parentProjection: ContainerWriterProjectionResponse;
  principalPolicies: readonly VerifiedPrincipalPolicy[];
  wraps: readonly ContainerKeyWrap[];
}): ContainerMutationRequest {
  return {
    ...containerMutationRequestCore("create", {
      ...input,
      userRecipientKeys: [],
    }),
    previousManifest: null,
    parentContainerPath: input.parentProjection.path.map(
      asContainerManifestBundle,
    ),
    predecessorBridge: null,
    keyring: null,
    parentKekState: readCanonicalRecord(
      input.parentKek,
      "Container create parent KEK state",
    ),
  };
}

async function resolveContainerCreatePlanContext(
  input: BuildContainerCreatePlanInput,
): Promise<ContainerCreatePlanContext> {
  assertContainerCreatePlanInput(input);
  const containerId = input.containerId ?? crypto.randomUUID();

  return {
    ...input,
    containerId,
    containerKeyEpochId: await resolveContainerKekEpochId({
      containerId,
      keyEpoch: 1,
      keyMaterial: input.containerKey,
      override: input.containerKeyEpochId,
    }),
    eventId: input.eventId ?? crypto.randomUUID(),
    metadataDocumentId: input.metadataDocumentId ?? crypto.randomUUID(),
    parent: getParentCreateContext(input.parentProjection),
    signedAt: input.signedAt ?? new Date().toISOString(),
  };
}

function buildChildContainerCreateBody(
  context: ContainerCreatePlanContext,
  managedGrant: BuildContainerCreatePlanInput["managedPrincipalGrant"],
): ContainerCreateAccessEventBody {
  const baseBody = buildContainerCreateBody({
    containerKeyEpochId: context.containerKeyEpochId,
    metadataDocumentId: context.metadataDocumentId,
    parentContainerId: context.parentProjection.containerId,
    parentManifestHash: context.parent.manifest.manifestHash,
  });
  if (!managedGrant) {
    return baseBody;
  }
  return {
    ...baseBody,
    directGrants: [
      {
        accessLevel: managedGrant.accessLevel,
        subjectId: managedGrant.principalHead.principalId,
        subjectType: managedGrant.principalHead.principalType,
      },
    ],
    referencedPrincipalHeads: [managedGrant.principalHead],
  };
}

// A managed-principal grant adds a second recipient: the group/organization key
// wrap alongside the parent-inheritance wrap. The server derives both targets
// (parent inheritance + directGrant) and requires exactly one wrap each; target
// order is irrelevant since the key-target hash is normalized.
async function buildChildContainerWrapsAndTargets(input: {
  context: ContainerCreatePlanContext;
  managedGrant: BuildContainerCreatePlanInput["managedPrincipalGrant"];
  manifestHash: string;
}): Promise<{
  recipientTargets: ContainerKekRecipientTarget[];
  wraps: ContainerKeyWrap[];
}> {
  const { context, managedGrant, manifestHash } = input;
  const parentWrap = await wrapContainerKeyToParent({
    containerKey: context.containerKey,
    containerKeyEpochId: context.containerKeyEpochId,
    manifestHash,
    parentKek: context.parent.kek,
    parentKekMaterial: context.parentKekMaterial,
  });
  const parentTargets = buildParentRecipientTargets(context.parent.kek);
  if (!managedGrant) {
    return { recipientTargets: parentTargets, wraps: [parentWrap] };
  }
  const managedRecipient = await wrapContainerKeyToManagedPrincipal({
    containerKey: context.containerKey,
    containerKeyEpochId: context.containerKeyEpochId,
    manifestHash,
    principalEncapsulationPublicKey:
      managedGrant.principalEncapsulationPublicKey,
    principalHead: managedGrant.principalHead,
  });
  return {
    recipientTargets: [...parentTargets, managedRecipient.recipientTarget],
    wraps: [parentWrap, managedRecipient.wrap],
  };
}

export async function buildContainerCreatePlan(
  input: BuildContainerCreatePlanInput,
): Promise<ContainerCreatePlan> {
  const context = await resolveContainerCreatePlanContext(input);
  const parentContainerId = context.parentProjection.containerId;
  const parentManifestHash = context.parent.manifest.manifestHash;
  const managedGrant = input.managedPrincipalGrant;
  const body = buildChildContainerCreateBody(context, managedGrant);
  // The new container belongs to the parent's organization, not the author's.
  // A member writing under another org's shared root mints a container owned by
  // that org; the author only supplies the signer identity.
  const organizationId = context.parentProjection.organizationId;
  const { event, eventHash } = await signContainerCreateEvent({
    author: context.author,
    body,
    containerId: context.containerId,
    eventId: context.eventId,
    organizationId,
    parentPath: context.parentProjection.path,
    signedAt: context.signedAt,
  });
  const { manifest, manifestHash, state } = await deriveContainerCreateManifest(
    {
      containerId: context.containerId,
      containerKeyEpochId: context.containerKeyEpochId,
      directGrants: body.directGrants,
      eventHash,
      metadataDocumentId: context.metadataDocumentId,
      organizationId,
      parentContainerId,
      parentManifestHash,
      referencedPrincipalHeads: body.referencedPrincipalHeads,
    },
  );
  const keyEpoch = buildContainerCreateKeyEpoch({
    containerId: context.containerId,
    containerKeyEpochId: context.containerKeyEpochId,
    eventHash,
    manifestHash,
    parentContainerKeyEpochId: context.parent.kek.containerKeyEpochId,
  });
  const { recipientTargets, wraps } = await buildChildContainerWrapsAndTargets({
    context,
    managedGrant,
    manifestHash,
  });
  const keyTargetHash =
    await computeContainerKekRecipientTargetHash(recipientTargets);
  const keyEpochHash = await computeContainerKeyEpochHash(keyEpoch);
  return {
    body,
    containerId: context.containerId,
    containerKeyEpochId: context.containerKeyEpochId,
    event,
    eventHash,
    keyEpoch,
    keyEpochHash,
    keyTargetHash,
    manifest,
    manifestHash,
    metadataDocumentId: context.metadataDocumentId,
    parentContainerId,
    parentManifestHash,
    recipientTargets,
    request: buildContainerCreateRequest({
      body,
      event,
      keyEpoch,
      manifest,
      manifestHash,
      parentKek: context.parent.kek,
      parentProjection: context.parentProjection,
      principalPolicies: context.principalPolicies ?? [],
      wraps,
    }),
    state,
    wraps,
  };
}

export async function buildMaterializedContainerCreatePlan(
  input: {
    author: ContainerMutationAuthor;
    containerId?: string | undefined;
    containerKey?: Uint8Array | undefined;
    containerKeyEpochId?: string | undefined;
    eventId?: string | undefined;
    execSql?: ExecSql | undefined;
    metadataDocumentId?: string | undefined;
    parentProjection: ContainerWriterProjectionResponse;
    parentSecretKey: Uint8Array;
    signedAt?: string | undefined;
    // Fetches the parent path's referenced principal policies on demand when
    // they are not cached locally — lets a member create under another org's
    // shared root without having first hydrated that org's group policy.
    warmReferencedPrincipalPolicies?:
      | ReferencedPrincipalPolicyWarmer
      | undefined;
  } & ProjectionVerificationOptions,
): Promise<MaterializedContainerCreatePlan> {
  const containerKey =
    input.containerKey ?? crypto.getRandomValues(new Uint8Array(32));

  const parentKeksByEpochId = await unwrapContainerKekPath({
    execSql: input.execSql,
    projection: input.parentProjection,
    secretKey: input.parentSecretKey,
    ...projectionVerificationOptions(input),
  });
  const parent = getParentCreateContext(input.parentProjection);
  const parentKekMaterial = requireUnwrappedKek(
    parentKeksByEpochId,
    parent.kek,
    "Container parent",
  );
  const principalPolicies = input.resolveProjectionUserKey
    ? await collectContainerWriterProjectionPrincipalPolicies({
        execSql: input.execSql,
        projection: input.parentProjection,
        resolveUserKey: input.resolveProjectionUserKey,
        stillCurrent: input.stillCurrent,
        warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
      })
    : [];
  const plan = await buildContainerCreatePlan({
    author: input.author,
    containerId: input.containerId,
    containerKey,
    containerKeyEpochId: input.containerKeyEpochId,
    eventId: input.eventId,
    metadataDocumentId: input.metadataDocumentId,
    parentKekMaterial,
    parentProjection: input.parentProjection,
    principalPolicies,
    signedAt: input.signedAt,
  });

  return {
    containerKey,
    plan,
  };
}

export function childContainerWriterProjectionFromCreatePlan(input: {
  materializedPlan: MaterializedContainerCreatePlan;
  parentProjection: ContainerWriterProjectionResponse;
}): ContainerWriterProjectionResponse {
  const { materializedPlan, parentProjection } = input;
  const { plan } = materializedPlan;
  const parentKek = getParentCreateContext(parentProjection).kek;

  return {
    containerId: plan.containerId,
    organizationId: plan.state.organizationId,
    path: [
      ...parentProjection.path,
      {
        event: {
          event: readCanonicalRecord(plan.event, "Container child event"),
          body: readCanonicalRecord(plan.body, "Container child body"),
          eventHash: plan.eventHash,
        },
        manifest: readCanonicalRecord(
          plan.manifest,
          "Container child manifest",
        ),
        manifestHash: plan.manifestHash,
        state: readCanonicalRecord(plan.state, "Container child state"),
      },
    ],
    containerKeks: [
      ...parentProjection.containerKeks,
      {
        containerId: plan.containerId,
        accessManifestHash: plan.manifestHash,
        containerKeyEpochId: plan.containerKeyEpochId,
        containerKeyEpoch: plan.keyEpoch.keyEpoch,
        keyEpoch: readCanonicalRecord(
          plan.keyEpoch,
          "Container child key epoch",
        ),
        keyEpochHash: plan.keyEpochHash,
        keyTargetHash: plan.keyTargetHash,
        containerManifestHistory: [],
        parentContainerKeyEpochId: parentKek.containerKeyEpochId,
        keyring: null,
        recipientTargets: readCanonicalRecords(
          plan.recipientTargets,
          "Container child recipient targets",
        ),
        wraps: readCanonicalRecords(plan.wraps, "Container child wraps"),
      },
    ],
  };
}

async function createRemoteContainerWithRepairs(input: {
  readonly containerId: string;
  readonly containerKey: Uint8Array;
  readonly eventId: string;
  readonly metadataDocumentId: string;
  readonly parentProjection: ContainerWriterProjectionResponse;
  readonly request: RemoteContainerCreateInput;
  readonly resolveProjectionUserKey: ProjectionUserKeyResolver;
  readonly signedAt: string;
}): Promise<CreateRemoteContainerResult | null> {
  let parentProjection = input.parentProjection;
  const repairState: ContainerCreateRepairState = {
    didRepairStaleParent: false,
    didRepairStalePolicies: false,
  };
  for (;;) {
    const materializedPlan = await buildMaterializedContainerCreatePlan({
      author: input.request.author,
      containerId: input.containerId,
      containerKey: input.containerKey,
      containerKeyEpochId: input.request.containerKeyEpochId,
      eventId: input.eventId,
      execSql: input.request.execSql,
      metadataDocumentId: input.metadataDocumentId,
      parentProjection,
      parentSecretKey: input.request.parentSecretKey,
      resolveProjectionUserKey: input.resolveProjectionUserKey,
      signedAt: input.signedAt,
      stillCurrent: input.request.stillCurrent,
      warmReferencedPrincipalPolicies:
        input.request.warmReferencedPrincipalPolicies,
    });
    const submitted = await submitRemoteContainerCreate({
      apiClient: input.request.apiClient,
      plan: materializedPlan.plan,
      stillCurrent: input.request.stillCurrent,
    });
    if (!submitted) return null;
    if (!submitted.ok) {
      const repair = await repairContainerCreateFailure({
        apiClient: input.request.apiClient,
        execSql: input.request.execSql,
        failure: submitted,
        parentContainerId: input.request.parentContainerId,
        parentProjection,
        reportSecurityIncident: input.request.reportSecurityIncident,
        resolveTrustedUserIdentity: input.request.resolveTrustedUserIdentity,
        state: repairState,
        stillCurrent: input.request.stillCurrent,
      });
      if (repair.kind === "retry") {
        parentProjection = repair.parentProjection;
        continue;
      }
      if (repair.kind === "unavailable") {
        return null;
      }
      submitted.report();
      return null;
    }
    await acknowledgeContainerMutation({
      execSql: input.request.execSql,
      plan: materializedPlan.plan,
      response: submitted.response,
      stillCurrent: input.request.stillCurrent,
    });
    return {
      containerKey: materializedPlan.containerKey,
      containerId: submitted.response.containerId,
      metadataDocumentId: materializedPlan.plan.metadataDocumentId,
      plan: materializedPlan.plan,
      response: submitted.response,
    };
  }
}
export async function createRemoteContainer(
  input: RemoteContainerCreateInput,
): Promise<CreateRemoteContainerResult | null> {
  const resolveProjectionUserKey = requireProjectionUserKeyResolver(
    input.resolveProjectionUserKey,
    "Remote container create",
  );
  const parentProjection =
    input.parentProjection ??
    (await input.apiClient.getContainerWriterProjection(
      input.parentContainerId,
    ));
  if (!parentProjection) {
    return null;
  }
  return nullOnProjectionVerificationCancellation(() =>
    createRemoteContainerWithRepairs({
      containerId: input.containerId ?? crypto.randomUUID(),
      containerKey:
        input.containerKey ?? crypto.getRandomValues(new Uint8Array(32)),
      eventId: input.eventId ?? crypto.randomUUID(),
      metadataDocumentId: input.metadataDocumentId ?? crypto.randomUUID(),
      parentProjection,
      request: input,
      resolveProjectionUserKey,
      signedAt: input.signedAt ?? new Date().toISOString(),
    }),
  );
}
