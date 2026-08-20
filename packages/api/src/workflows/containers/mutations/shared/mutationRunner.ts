import type {
  ReferencedPrincipalHead,
  VerifiedContainerAccessManifest,
  VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import type { ContainerMutationResponse } from "@tearleads/validators/response";
import {
  getCurrentPrincipalState,
  listContainerGrantsForState,
} from "../../../../access/read/principalStateStore";
import { assertOrganizationCanSync } from "../../../billing/organizationSyncEligibility";
import { lockOrganizationReadModelHeadForUpdateInTransaction } from "../../../organizations/readModelChanges";
import { lockAndFindMissingGroupReferencesInTransaction } from "../../../principals/groupReferenceLock";
import { createContainerWriterProjectionContext } from "../../writerProjection";
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
import { assertVerifiedContainerGrantReferencesValid } from "./groupReferences";
import {
  assertCurrentContainerPath,
  assertHistoricalContainerManifestsConsistent,
  assertManifestHeadCurrent,
  assertMutationHeadCanAdvance,
  verifyContainerManifestFromRequest,
} from "./manifests";
import { planContainerMutationBatchLocks } from "./mutationBatchLocks";
import { persistVerifiedMutation } from "./persistence";
import { assertPrincipalPoliciesCurrent } from "./principalPolicies";
import { principalPoliciesFromRequest } from "./principalPolicyRecords";
import { resolveVerifiedStoredContainerManifest } from "./storedManifestArtifacts";

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
  readonly executor: MutateContainerWithExecutorInput["executor"];
  readonly request: MutateContainerWithExecutorInput["request"];
  readonly referencedPrincipalHeads: readonly ReferencedPrincipalHead[];
}) {
  return assertPrincipalPoliciesCurrent(
    input.executor,
    principalPoliciesFromRequest(input.request),
    {
      referencedPrincipalHeads: input.referencedPrincipalHeads,
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
  previousManifest: MutateContainerWithExecutorInput["request"]["previousManifest"],
): Promise<VerifiedContainerAccessManifest | null> {
  if (previousManifest === undefined || previousManifest === null) {
    return null;
  }

  return resolveVerifiedStoredContainerManifest(
    context,
    previousManifest,
    "previousManifest",
  );
}

async function assertPreviousManifestHeadCurrent(
  context: ContainerMutationContext,
  manifest: VerifiedContainerAccessManifest | null,
): Promise<void> {
  if (manifest) {
    await assertManifestHeadCurrent(context, manifest, "previousManifest");
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
  readonly principalPolicies: readonly VerifiedPrincipalPolicy[];
}

async function assertGroupGrantSetChangesAreAtomic(
  context: ContainerMutationContext,
  artifacts: VerifiedMutationArtifacts,
): Promise<void> {
  const previousByGroupId = new Map(
    (artifacts.previousManifest?.state.directGrants ?? [])
      .filter((grant) => grant.subjectType === "group")
      .map((grant) => [grant.subjectId, grant] as const),
  );
  const currentByGroupId = new Map(
    artifacts.manifest.state.directGrants
      .filter((grant) => grant.subjectType === "group")
      .map((grant) => [grant.subjectId, grant] as const),
  );
  const changedGroupIds = [
    ...new Set([...previousByGroupId.keys(), ...currentByGroupId.keys()]),
  ].filter((groupId) => {
    const previous = previousByGroupId.get(groupId);
    const current = currentByGroupId.get(groupId);
    return previous?.accessLevel !== current?.accessLevel;
  });
  for (const groupId of changedGroupIds) {
    if (groupId === context.mutatingGroupPrincipalId) {
      continue;
    }
    const currentGrant = currentByGroupId.get(groupId);
    if (!currentGrant) {
      throw new ContainerMutationError(
        "Group grants must be revoked atomically with principal rotation",
        409,
      );
    }
    const principalState = await getCurrentPrincipalState(
      "group",
      groupId,
      context.executor,
    );
    const signedGrants = principalState
      ? await listContainerGrantsForState(
          "group",
          groupId,
          principalState.stateHash,
          context.executor,
        )
      : [];
    if (
      !signedGrants.some(
        (grant) =>
          grant.containerId === artifacts.manifest.state.containerId &&
          grant.accessLevel === currentGrant.accessLevel,
      )
    ) {
      throw new ContainerMutationError(
        "Group grant changes require a matching signed principal grant index",
        409,
      );
    }
  }
}

interface PrelockedContainerMutationBatchScope {
  readonly groupIds: ReadonlySet<string>;
  readonly organizationIds: ReadonlySet<string>;
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
    input.request.previousContainerPath,
    "previousContainerPath",
  );
  const parentContainerPath = await assertCurrentContainerPath(
    context,
    input.request.parentContainerPath,
    "parentContainerPath",
  );
  const destinationParentContainerPath = await assertCurrentContainerPath(
    context,
    input.request.destinationParentContainerPath,
    "destinationParentContainerPath",
  );
  const containerManifestHistory =
    await assertHistoricalContainerManifestsConsistent(
      context,
      input.request.containerManifestHistory,
    );
  const previousManifest = await loadPreviousContainerManifest(
    context,
    input.request.previousManifest,
  );
  await assertPreviousManifestHeadCurrent(context, previousManifest);
  const principalPolicies = await readCurrentPrincipalPolicies({
    executor: context.executor,
    request: input.request,
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
): Promise<void> {
  if (inputs.length === 0) {
    return;
  }
  if (prelockedBatchScopeByContext.has(context)) {
    throw new Error("Container mutation context already has a prelocked batch");
  }

  const scope = await deriveVerifiedBatchScope(context, inputs);
  await lockVerifiedBatchScope(context, scope);
  prelockedBatchScopeByContext.set(context, scope);
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

export async function mutateContainerWithExecutor(
  input: MutateContainerWithExecutorInput,
): Promise<ContainerMutationResponse> {
  const context: ContainerMutationContext = input.context ?? {
    executor: input.executor,
    manifestHeadByContainerId: new Map(),
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
  const artifacts = await verifyMutationArtifacts(context, input);
  await assertGroupGrantSetChangesAreAtomic(context, artifacts);
  if (prelockedBatchScope) {
    assertMutationWithinPrelockedScope(prelockedBatchScope, artifacts.manifest);
    await assertVerifiedContainerGrantReferencesValid({
      executor: context.executor,
      manifest: artifacts.manifest,
    });
  } else if (artifacts.manifest.state.organizationId !== organizationId) {
    throw new ContainerMutationError("Container organization mismatch", 409);
  }
  await assertContainerBuiltinGrantPolicyPreserved({
    executor: context.executor,
    manifest: artifacts.manifest,
    previousManifest: artifacts.previousManifest,
  });
  await assertMutationHeadCanAdvance(context, artifacts.manifest);
  const verifiedKekMutation = await verifyContainerKekFromRequest(
    context.executor,
    input.request,
    artifacts.manifest,
    {
      containerManifestHistory: artifacts.containerManifestHistory,
      principalPolicies: artifacts.principalPolicies,
    },
  );
  await assertMutationOrganizationCanSync(
    context,
    input.expectedEventType,
    artifacts.manifest.state.organizationId,
    input.userId,
  );

  return persistVerifiedMutation(
    context,
    artifacts.manifest,
    verifiedKekMutation,
    artifacts.previousManifest,
    artifacts.previousContainerPath,
  );
}
