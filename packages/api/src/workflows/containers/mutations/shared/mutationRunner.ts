import type {
  PrincipalPolicyAuthorization,
  ReferencedPrincipalHead,
  VerifiedContainerAccessManifest,
} from "@tearleads/crypto";
import type { ContainerMutationResponse } from "@tearleads/validators/response";
import { assertOrganizationCanSync } from "../../../billing/organizationSyncEligibility";
import { lockOrganizationReadModelHeadForUpdateInTransaction } from "../../../organizations/readModelChanges";
import { lockAndFindMissingGroupReferencesInTransaction } from "../../../principals/groupReferenceLock";
import { createContainerWriterProjectionContext } from "../../writerProjection";
import { loadKekCreationCitations } from "../../writerProjection/kekCreationCitations";
import { ContainerMutationError } from "../errors";
import type {
  ContainerMutationContext,
  MutateContainerInput,
  MutateContainerWithExecutorInput,
} from "../types";
import { assertContainerBuiltinGrantPolicyPreserved } from "./builtinGrants";
import { verifyContainerKekFromRequest } from "./containerKek";
import {
  assertAccessEventDependenciesMatchRequest,
  verifyMutationEvent,
} from "./events";
import {
  assertGroupGrantSetChangesAreAtomic,
  assertVerifiedContainerGrantReferencesValid,
} from "./groupReferences";
import {
  assertCurrentContainerPath,
  assertManifestHeadCurrent,
  assertMutationHeadCanAdvance,
  verifyContainerManifestFromRequest,
} from "./manifests";
import { deriveContainerMutationAncestors } from "./mutationAncestors";
import { planContainerMutationBatchLocks } from "./mutationBatchLocks";
import { persistVerifiedMutation } from "./persistence";
import { assertPrincipalPoliciesCurrent } from "./principalPolicies";
import {
  resolveCitedContainerHistory,
  resolveVerifiedStoredContainerManifest,
} from "./storedManifestArtifacts";

function collectReferencedPrincipalHeads(
  paths: readonly (
    | readonly VerifiedContainerAccessManifest[]
    | null
    | undefined
  )[],
): ReferencedPrincipalHead[] {
  return paths.flatMap((path) =>
    (path ?? []).flatMap((manifest) => manifest.state.referencedPrincipalHeads),
  );
}

async function readCurrentPrincipalPolicies(input: {
  readonly evidence?: readonly PrincipalPolicyAuthorization[] | undefined;
  readonly executor: MutateContainerWithExecutorInput["executor"];
  readonly request: MutateContainerWithExecutorInput["request"];
  readonly referencedPrincipalHeads: readonly ReferencedPrincipalHead[];
  readonly requesterUserId: string;
}) {
  return assertPrincipalPoliciesCurrent(
    input.executor,
    input.request.principalPolicyRefs,
    {
      evidence: input.evidence,
      referencedPrincipalHeads: input.referencedPrincipalHeads,
      requesterUserId: input.requesterUserId,
    },
  );
}

async function assertMutationOrganizationCanSync(
  context: ContainerMutationContext,
  eventType: MutateContainerWithExecutorInput["expectedEventType"],
  organizationId: string,
  userId: string,
): Promise<void> {
  if (eventType === "container.create") {
    return;
  }

  await assertOrganizationCanSync(context.executor, organizationId, userId);
}

async function loadPreviousContainerManifest(
  context: ContainerMutationContext,
  previousManifestRef: MutateContainerWithExecutorInput["request"]["previousManifestRef"],
): Promise<VerifiedContainerAccessManifest | null> {
  if (previousManifestRef === undefined || previousManifestRef === null) {
    return null;
  }

  return resolveVerifiedStoredContainerManifest(
    context,
    previousManifestRef,
    "previousManifestRef",
  );
}

async function assertPreviousManifestHeadCurrent(
  context: ContainerMutationContext,
  manifest: VerifiedContainerAccessManifest | null,
): Promise<void> {
  if (manifest) {
    await assertManifestHeadCurrent(context, manifest, "previousManifestRef");
  }
}

interface VerifiedMutationArtifacts {
  readonly containerManifestHistory:
    | readonly VerifiedContainerAccessManifest[]
    | undefined;
  readonly destinationParentContainerPath:
    | readonly VerifiedContainerAccessManifest[]
    | undefined;
  readonly manifest: VerifiedContainerAccessManifest;
  readonly parentContainerPath:
    | readonly VerifiedContainerAccessManifest[]
    | undefined;
  readonly previousContainerPath:
    | readonly VerifiedContainerAccessManifest[]
    | undefined;
  readonly previousManifest: VerifiedContainerAccessManifest | null;
  readonly principalPolicies: readonly PrincipalPolicyAuthorization[];
}

interface PrelockedContainerMutationBatchScope {
  readonly groupIds: Set<string>;
  readonly organizationIds: Set<string>;
}

const prelockedBatchScopeByContext = new WeakMap<
  ContainerMutationContext,
  PrelockedContainerMutationBatchScope
>();

function containerGroupReferenceIds(
  manifest: VerifiedContainerAccessManifest,
): string[] {
  return manifest.state.directGrants.flatMap((grant) =>
    grant.subjectType === "group" ? [grant.subjectId] : [],
  );
}

async function verifyMutationArtifacts(
  context: ContainerMutationContext,
  input: MutateContainerWithExecutorInput,
): Promise<VerifiedMutationArtifacts> {
  const previousContainerPath = await assertCurrentContainerPath(
    context,
    input.request.previousContainerPathRefs,
    "previousContainerPathRefs",
  );
  const parentContainerPath = await assertCurrentContainerPath(
    context,
    input.request.parentContainerPathRefs,
    "parentContainerPathRefs",
  );
  const destinationParentContainerPath = await assertCurrentContainerPath(
    context,
    input.request.destinationParentContainerPathRefs,
    "destinationParentContainerPathRefs",
  );
  const previousManifest = await loadPreviousContainerManifest(
    context,
    input.request.previousManifestRef,
  );
  await assertPreviousManifestHeadCurrent(context, previousManifest);
  const containerManifestHistory = await resolveCitedContainerHistory(
    context,
    input.request.containerManifestHistoryRefs,
    previousManifest,
  );
  const principalPolicies = await readCurrentPrincipalPolicies({
    evidence: context.verifiedPrincipalPolicies,
    executor: context.executor,
    request: input.request,
    requesterUserId: input.userId,
    referencedPrincipalHeads: collectReferencedPrincipalHeads([
      previousContainerPath,
      parentContainerPath,
      destinationParentContainerPath,
      containerManifestHistory,
      previousManifest ? [previousManifest] : null,
    ]),
  });

  const event = await verifyMutationEvent(context.executor, input);
  assertAccessEventDependenciesMatchRequest(input.request, event);
  const manifest = await verifyContainerManifestFromRequest(
    input.request,
    event,
    {
      destinationParentContainerPath,
      parentContainerPath,
      previousContainerPath,
      previousManifest,
      principalPolicies,
    },
  );

  return {
    containerManifestHistory,
    destinationParentContainerPath,
    manifest,
    parentContainerPath,
    previousContainerPath,
    previousManifest,
    principalPolicies,
  };
}

function cachePreflightManifestHead(
  context: ContainerMutationContext,
  manifest: VerifiedContainerAccessManifest,
): void {
  context.manifestHeadByContainerId.set(manifest.state.containerId, {
    objectKind: "container",
    objectId: manifest.state.containerId,
    organizationId: manifest.state.organizationId,
    epoch: manifest.state.epoch,
    manifestHash: manifest.manifestHash,
    updatedAt: new Date(0),
  });
  context.verifiedManifestByHash.set(manifest.manifestHash, manifest);
}

async function deriveVerifiedBatchScope(
  context: ContainerMutationContext,
  inputs: readonly MutateContainerInput[],
): Promise<PrelockedContainerMutationBatchScope> {
  const preflightContext: ContainerMutationContext = {
    executor: context.executor,
    mutatingGroupPrincipalId: context.mutatingGroupPrincipalId,
    manifestHeadByContainerId: new Map(),
    verifiedManifestByHash: new Map(),
    writerProjectionContext: createContainerWriterProjectionContext(
      context.executor,
    ),
  };
  const groupIds = new Set<string>();
  const organizationIds = new Set<string>();

  for (const input of inputs) {
    const artifacts = await verifyMutationArtifacts(preflightContext, {
      ...input,
      executor: context.executor,
    });
    await assertGroupGrantSetChangesAreAtomic(preflightContext, artifacts);
    await assertMutationHeadCanAdvance(preflightContext, artifacts.manifest);
    organizationIds.add(artifacts.manifest.state.organizationId);
    for (const groupId of containerGroupReferenceIds(artifacts.manifest)) {
      groupIds.add(groupId);
    }

    // Later rekeys in one document/blob write may depend on an earlier rekey
    // from the same batch. Advance only the preflight cache so their signed
    // paths can be verified without writing before the full lock set is known.
    cachePreflightManifestHead(preflightContext, artifacts.manifest);
  }

  return { groupIds, organizationIds };
}

async function lockVerifiedBatchScope(
  context: ContainerMutationContext,
  scope: PrelockedContainerMutationBatchScope,
): Promise<void> {
  const lockPlan = planContainerMutationBatchLocks(scope);
  const missingGroupIds = await lockAndFindMissingGroupReferencesInTransaction(
    context.executor,
    lockPlan.groupIds,
  );
  if (missingGroupIds.length > 0) {
    throw new ContainerMutationError(
      "Container manifest references a missing group",
      409,
    );
  }

  for (const organizationId of lockPlan.organizationIds) {
    const headLocked =
      await lockOrganizationReadModelHeadForUpdateInTransaction(
        context.executor,
        organizationId,
      );
    if (!headLocked) {
      throw new Error("Organization read-model cursor head is missing");
    }
  }
}

/**
 * Verify a mutation batch without writes, then lock every group and
 * organization in deterministic group -> organization order. Per-item writes
 * still repeat mutable-source verification under these transaction locks.
 */
export async function prelockContainerMutationBatch(
  context: ContainerMutationContext,
  inputs: readonly MutateContainerInput[],
  additionalOrganizationIds: readonly string[] = [],
): Promise<void> {
  if (inputs.length === 0 && additionalOrganizationIds.length === 0) {
    return;
  }
  if (prelockedBatchScopeByContext.has(context)) {
    throw new Error("Container mutation context already has a prelocked batch");
  }

  const scope = await deriveVerifiedBatchScope(context, inputs);
  for (const organizationId of additionalOrganizationIds) {
    scope.organizationIds.add(organizationId);
  }
  await lockVerifiedBatchScope(context, scope);
  prelockedBatchScopeByContext.set(context, scope);
}

/** Locks a newly provisioned org and reserved groups once (#3396). */
export async function prelockProvisionedOrganizationScope(
  context: ContainerMutationContext,
  scope: {
    readonly groupIds: readonly string[];
    readonly organizationId: string;
  },
): Promise<void> {
  if (prelockedBatchScopeByContext.has(context)) {
    throw new Error("Container mutation context already has a prelocked batch");
  }
  const batchScope: PrelockedContainerMutationBatchScope = {
    groupIds: new Set(scope.groupIds),
    organizationIds: new Set([scope.organizationId]),
  };
  await lockVerifiedBatchScope(context, batchScope);
  prelockedBatchScopeByContext.set(context, batchScope);
}

function assertMutationWithinPrelockedScope(
  scope: PrelockedContainerMutationBatchScope,
  manifest: VerifiedContainerAccessManifest,
): void {
  if (
    !scope.organizationIds.has(manifest.state.organizationId) ||
    containerGroupReferenceIds(manifest).some(
      (groupId) => !scope.groupIds.has(groupId),
    )
  ) {
    throw new ContainerMutationError(
      "Container mutation escaped its prelocked batch scope",
      409,
    );
  }
}

/** Committed mutation, verified ancestor paths, and move previous parent. */
export interface ContainerMutationOutcome {
  readonly ancestorIds: readonly string[];
  readonly metadataDocumentId: string;
  readonly parentContainerPath?:
    | readonly VerifiedContainerAccessManifest[]
    | undefined;
  readonly previousAncestorIds?: readonly string[] | undefined;
  readonly previousParentId: string | null | undefined;
  readonly response: ContainerMutationResponse;
  readonly verifiedManifest: VerifiedContainerAccessManifest;
  readonly verifiedPrincipalPolicies: readonly PrincipalPolicyAuthorization[];
}

async function finalizeVerifiedContainerMutation(input: {
  readonly artifacts: Awaited<ReturnType<typeof verifyMutationArtifacts>>;
  readonly context: ContainerMutationContext;
  readonly expectedEventType: MutateContainerWithExecutorInput["expectedEventType"];
  readonly userId: string;
  readonly verifiedKekMutation: Awaited<
    ReturnType<typeof verifyContainerKekFromRequest>
  >;
}): Promise<ContainerMutationOutcome> {
  const { artifacts, context, expectedEventType, userId, verifiedKekMutation } =
    input;
  const ancestors = deriveContainerMutationAncestors({
    destinationParentContainerPath: artifacts.destinationParentContainerPath,
    eventType: expectedEventType,
    parentContainerPath: artifacts.parentContainerPath,
    previousContainerPath: artifacts.previousContainerPath,
  });
  return {
    ...ancestors,
    metadataDocumentId: artifacts.manifest.state.metadataDocumentId,
    ...(artifacts.parentContainerPath !== undefined
      ? { parentContainerPath: artifacts.parentContainerPath }
      : {}),
    previousParentId:
      expectedEventType === "container.move"
        ? artifacts.previousManifest?.state.parentContainerId
        : undefined,
    response: await persistVerifiedMutation(
      context,
      userId,
      artifacts.manifest,
      verifiedKekMutation,
      artifacts.previousManifest,
      artifacts.previousContainerPath,
    ),
    verifiedManifest: artifacts.manifest,
    verifiedPrincipalPolicies: artifacts.principalPolicies,
  };
}

export async function mutateContainerWithExecutorOutcome(
  input: MutateContainerWithExecutorInput,
): Promise<ContainerMutationOutcome> {
  const context: ContainerMutationContext = input.context ?? {
    executor: input.executor,
    manifestHeadByContainerId: new Map(),
    verifiedLiveContainerOrgs: new Map(),
    verifiedManifestByHash: new Map(),
    writerProjectionContext: createContainerWriterProjectionContext(
      input.executor,
    ),
  };
  const prelockedBatchScope = prelockedBatchScopeByContext.get(context);
  let organizationId: string | null = null;

  if (!prelockedBatchScope) {
    const initialArtifacts = await verifyMutationArtifacts(context, input);
    await assertVerifiedContainerGrantReferencesValid({
      executor: context.executor,
      manifest: initialArtifacts.manifest,
    });
    organizationId = initialArtifacts.manifest.state.organizationId;
    const headLocked =
      await lockOrganizationReadModelHeadForUpdateInTransaction(
        context.executor,
        organizationId,
      );
    if (!headLocked) {
      throw new Error("Organization read-model cursor head is missing");
    }
  }

  // Initial verification establishes a trusted group/organization lock scope.
  // Clear the read cache and repeat all mutable source checks under those locks
  // so a concurrently revoked writer cannot commit stale authorization.
  context.manifestHeadByContainerId.clear();
  context.verifiedLiveContainerOrgs?.clear();
  context.writerProjectionContext.liveContainerOrganizationById.clear();
  const artifacts = await verifyMutationArtifacts(context, input);
  await assertGroupGrantSetChangesAreAtomic(context, artifacts);
  if (prelockedBatchScope) {
    assertMutationWithinPrelockedScope(prelockedBatchScope, artifacts.manifest);
  } else if (artifacts.manifest.state.organizationId !== organizationId) {
    throw new ContainerMutationError("Container organization mismatch", 409);
  }
  await assertVerifiedContainerGrantReferencesValid({
    executor: context.executor,
    manifest: artifacts.manifest,
  });
  await assertContainerBuiltinGrantPolicyPreserved({
    executor: context.executor,
    manifest: artifacts.manifest,
    previousManifest: artifacts.previousManifest,
  });
  await assertMutationHeadCanAdvance(context, artifacts.manifest);
  await loadKekCreationCitations(context.writerProjectionContext, [
    artifacts.manifest,
    ...(artifacts.containerManifestHistory ?? []),
  ]);
  const verifiedKekMutation = await verifyContainerKekFromRequest(
    context.executor,
    input.request,
    artifacts.manifest,
    {
      containerManifestHistory: artifacts.containerManifestHistory,
      parentManifestHistory: [
        ...context.writerProjectionContext.verifiedManifestByHash.values(),
        ...context.verifiedManifestByHash.values(),
      ],
      previousManifest: artifacts.previousManifest,
      principalPolicies: artifacts.principalPolicies,
    },
  );
  await assertMutationOrganizationCanSync(
    context,
    input.expectedEventType,
    artifacts.manifest.state.organizationId,
    input.userId,
  );

  return finalizeVerifiedContainerMutation({
    artifacts,
    context,
    expectedEventType: input.expectedEventType,
    userId: input.userId,
    verifiedKekMutation,
  });
}
