import type {
  ContainerDirectGrant,
  PrincipalContainerGrant,
} from "@tearleads/crypto";
import type { ContainerMutationRequest } from "@tearleads/validators/request";
import type {
  ContainerMutationResponse,
  ContainerWriterProjectionResponse,
} from "@tearleads/validators/response";
import {
  getTargetContainerContext,
  readContainerState,
} from "../../../data/containers/shared/projection";
import {
  type PrincipalPolicyCache,
  verifyContainerWriterProjection,
} from "../../../data/keyingProjectionVerification";
import { assertProjectionVerificationCurrent } from "../../../data/keyingProjectionVerification/types";
import { createProjectionUserKeyResolver } from "../../../data/keyingProjectionVerification/userKeyResolver";
import { buildMaterializedContainerRekeyPlan } from "../child/rekey";
import { rebaseOnDeepestAncestor } from "../child/rekey/carriedDescendantRekeys";
import {
  containerWriterProjectionFromRotationPlan,
  containerWriterProjectionFromSharePlan,
  isSpeculativeContainerWriterProjection,
} from "../child/rekey/rekeyProjection";
import { buildMaterializedContainerRevokePlan } from "../child/revoke";
import { selectReplacementPrincipalPolicyReferences } from "../child/rotation/replacementPrincipalPolicyReferences";
import { buildMaterializedContainerSharePlan } from "../child/share/shareMaterialization";
import { acknowledgePrincipalContainerRematerialization } from "./acknowledgePrincipalContainerRematerialization";
import { withPrecedingRematerialization } from "./precedingPrincipalRematerialization";
import {
  addPlan,
  assertNamedContainersRotated,
  type BatchPlanning,
  carryLevel,
  type PrincipalContainerRematerializationInput,
  type PrincipalRematerializationPredecessor,
  planOnceMoreAfterRollback,
  rerootOnAuthoredPaths,
  staleLevelsAbove,
} from "./principalContainerRematerializationPlanning";
import {
  loadRematerializationTargets,
  loadServedProjection,
  type MaterializedPrincipalContainerMutationPlan,
  type PlannedRematerialization,
  type RematerializationTarget,
  seededPrincipalPolicyCache,
} from "./principalContainerRematerializationTargets";

function matchingGroupGrant(input: {
  readonly directGrants: readonly ContainerDirectGrant[];
  readonly groupId: string;
}): ContainerDirectGrant | null {
  return (
    input.directGrants.find(
      (grant) =>
        grant.subjectType === "group" && grant.subjectId === input.groupId,
    ) ?? null
  );
}

function referencedGroupKeyEpoch(input: {
  readonly groupId: string;
  readonly referencedPrincipalHeads: ReturnType<
    typeof readContainerState
  >["referencedPrincipalHeads"];
}): number | null {
  return (
    input.referencedPrincipalHeads.find(
      (head) =>
        head.principalType === "group" && head.principalId === input.groupId,
    )?.keyEpoch ?? null
  );
}

async function loadGrantedContainerContext(
  input: PrincipalContainerRematerializationInput,
  grantRow: PrincipalContainerGrant,
  projection: ContainerWriterProjectionResponse,
  principalPolicyCache: PrincipalPolicyCache,
) {
  // A projection re-rooted on a rotation this batch has yet to commit must
  // not pin anything: its heads are speculative until acknowledged, and a
  // pin past the group's served head would refuse the other served paths.
  await verifyContainerWriterProjection({
    execSql: input.execSql,
    persistVerificationCheckpoints:
      !isSpeculativeContainerWriterProjection(projection),
    principalPolicyCache,
    projection,
    resolveUserKey: createProjectionUserKeyResolver({
      resolveTrustedUserIdentity: input.resolveTrustedUserIdentity,
    }),
    stillCurrent: input.stillCurrent,
    warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
  });
  const state = readContainerState(
    getTargetContainerContext(projection).manifest,
  );
  const grant = matchingGroupGrant({
    directGrants: state.directGrants,
    groupId: input.groupId,
  });
  if (grant && grant.accessLevel !== grantRow.accessLevel) {
    const nextGrant = input.nextPolicy.grants.find(
      (candidate) => candidate.containerId === grantRow.containerId,
    );
    if (!nextGrant || nextGrant.accessLevel !== grantRow.accessLevel) {
      throw new Error(
        `Container ${grantRow.containerId} does not contain the expected group grant`,
      );
    }
  }
  const referencedKeyEpoch = referencedGroupKeyEpoch({
    groupId: input.groupId,
    referencedPrincipalHeads: state.referencedPrincipalHeads,
  });
  if (grant && referencedKeyEpoch === null) {
    throw new Error(
      `Container ${grantRow.containerId} is missing its group reference`,
    );
  }
  return { grant, projection, referencedKeyEpoch };
}

export async function buildPrincipalContainerRematerializationBatch(
  input: PrincipalContainerRematerializationInput,
): Promise<ContainerMutationRequest[]> {
  return (
    await buildPrincipalContainerRematerializationPlans(input)
  ).entries.map((entry) => entry.planned.plan.request);
}

export interface PreparedPrincipalContainerRematerializationBatch {
  readonly preceding?: PrincipalRematerializationPredecessor | undefined;
  readonly retiredContainerIds: readonly string[];
  readonly acknowledge: (
    responses: readonly ContainerMutationResponse[],
    stillCurrent?: (() => boolean) | undefined,
  ) => Promise<void>;
  /**
   * Re-sign the batch with the descendant rekeys the server named for its
   * rotations woven in, parent-first, each against the path the batch will
   * leave behind. A named container the batch already rotates is re-planned
   * under what is carried above it, so no container rotates twice. Returns the
   * whole request list, which replaces `requests`; `acknowledge` then expects
   * the responses in that order.
   */
  readonly carry: (
    requiredContainerIds: readonly string[],
  ) => Promise<readonly ContainerMutationRequest[]>;
  readonly plans: readonly MaterializedPrincipalContainerMutationPlan[];
  readonly requests: readonly ContainerMutationRequest[];
  /** Rebuild a refused batch against fresh served container heads. */
  readonly refreshAfterConflict?:
    | (() => Promise<readonly ContainerMutationRequest[]>)
    | undefined;
}

async function buildPrincipalContainerRematerializationPlan(input: {
  readonly grantRow: PrincipalContainerGrant;
  /** Keys the batch minted above this container; see `BatchPlanning`. */
  readonly knownContainerKeks: ReadonlyMap<string, Uint8Array>;
  /** Holds the policy this batch commits, which rebased paths already cite. */
  readonly principalPolicyCache: PrincipalPolicyCache;
  /** The served projection, re-rooted on any rotation planned above it. */
  readonly projection: ContainerWriterProjectionResponse;
  readonly rematerialization: PrincipalContainerRematerializationInput;
  readonly resolveProjectionUserKey: ReturnType<
    typeof createProjectionUserKeyResolver
  >;
}): Promise<MaterializedPrincipalContainerMutationPlan> {
  const { grantRow } = input;
  const rematerialization = {
    ...input.rematerialization,
    nextPolicy: await selectReplacementPrincipalPolicyReferences({
      policy: input.rematerialization.nextPolicy,
      projection: input.projection,
      principalPolicyCache: input.principalPolicyCache,
      resolveAuthoredPolicyReferences:
        input.rematerialization.resolveAuthoredPolicyReferences,
    }),
  };
  const { grant, projection, referencedKeyEpoch } =
    await loadGrantedContainerContext(
      rematerialization,
      grantRow,
      input.projection,
      input.principalPolicyCache,
    );
  const nextGrant = rematerialization.nextPolicy.grants.find(
    (candidate) => candidate.containerId === grantRow.containerId,
  );
  const author = {
    ...rematerialization.author,
    organizationId: projection.organizationId,
  };
  const sharedInput = {
    author,
    execSql: rematerialization.execSql,
    knownContainerKeks: input.knownContainerKeks,
    // Planning against a path this batch has yet to commit pins nothing; the
    // acknowledgement advances every head at once. The rekey planner applies
    // this rule itself; revoke and grant planning take it from here.
    persistVerificationCheckpoints:
      !isSpeculativeContainerWriterProjection(projection),
    previousProjection: projection,
    principalPolicyCache: input.principalPolicyCache,
    resolveProjectionUserKey: input.resolveProjectionUserKey,
    stillCurrent: rematerialization.stillCurrent,
    targetSecretKey: rematerialization.targetSecretKey,
    warmReferencedPrincipalPolicies:
      rematerialization.warmReferencedPrincipalPolicies,
  };
  if (grantRow.containerId === rematerialization.revokedContainerId) {
    if (!grant) {
      throw new Error(
        `Container ${grantRow.containerId} does not contain the revoked group grant`,
      );
    }
    return buildMaterializedContainerRevokePlan({
      ...sharedInput,
      replacementPrincipalPolicy: rematerialization.nextPolicy,
      revokedSubject: {
        subjectId: rematerialization.groupId,
        subjectType: "group",
      },
    });
  }
  if (!grant || grant.accessLevel !== nextGrant?.accessLevel) {
    if (!nextGrant) {
      throw new Error(
        `Container ${grantRow.containerId} is absent from the next group grant set`,
      );
    }
    return buildMaterializedContainerSharePlan({
      ...sharedInput,
      accessLevel: nextGrant.accessLevel,
      recipient: {
        principalPolicy: rematerialization.nextPolicy,
        subjectId: rematerialization.groupId,
        subjectType: "group",
      },
    });
  }
  if (referencedKeyEpoch === rematerialization.nextPolicy.keyEpoch) {
    return buildMaterializedContainerSharePlan({
      ...sharedInput,
      accessLevel: grant.accessLevel,
      recipient: {
        principalPolicy: rematerialization.nextPolicy,
        subjectId: rematerialization.groupId,
        subjectType: "group",
      },
    });
  }
  return buildMaterializedContainerRekeyPlan({
    ...sharedInput,
    replacementPrincipalPolicy: rematerialization.nextPolicy,
  });
}

/**
 * Plan one target against the paths already planned above it. A grant's
 * rematerialization extends the served head; a rotation's, and every carried
 * rekey, extends the epoch the batch mints above it.
 */
async function planRematerializationTarget(
  batch: BatchPlanning,
  target: RematerializationTarget,
): Promise<void> {
  const { rematerialization } = batch;
  const rebased = rebaseOnDeepestAncestor(
    target.projection,
    batch.rotatedAbove,
  );
  const stale = rebased
    ? staleLevelsAbove(
        rebased.projection,
        rebased.ancestor.containerKeks.at(-1)?.containerId ?? "",
      )
    : [];
  for (const containerId of stale) {
    await carryLevel(
      batch,
      await loadServedProjection(rematerialization.apiClient, containerId),
    );
  }
  if (!target.grantRow) {
    await carryLevel(batch, target.projection);
    return;
  }
  // Each level carried above re-roots the target one step deeper.
  const previousProjection = await rerootOnAuthoredPaths(
    batch,
    target.projection,
  );
  const planned = await buildPrincipalContainerRematerializationPlan({
    grantRow: target.grantRow,
    knownContainerKeks: batch.knownContainerKeks,
    principalPolicyCache: batch.principalPolicyCache,
    projection: previousProjection,
    rematerialization,
    resolveProjectionUserKey: batch.resolveProjectionUserKey,
  });
  const nextProjection =
    "keyring" in planned.plan
      ? await containerWriterProjectionFromRotationPlan({
          plan: planned.plan,
          previousProjection,
        })
      : await containerWriterProjectionFromSharePlan({
          plan: planned.plan,
          previousProjection,
        });
  addPlan(batch, {
    carried: false,
    planned,
    rotated: "keyring" in planned.plan ? nextProjection : null,
    nextProjection,
  });
}

/**
 * Sign the batch parent-first. `carriedContainerIds` are the descendant rekeys
 * a refused attempt was told to carry; woven in by depth, each sits under the
 * rotation it rides, and a named container the batch rematerializes anyway is
 * re-planned there rather than rotated twice.
 */
function buildPrincipalContainerRematerializationPlans(
  input: PrincipalContainerRematerializationInput,
  carriedContainerIds: readonly string[] = [],
) {
  return planOnceMoreAfterRollback(
    input.apiClient,
    [...input.grants.map((grant) => grant.containerId), ...carriedContainerIds],
    () => planRematerializationBatch(input, carriedContainerIds),
  );
}

async function planRematerializationBatch(
  input: PrincipalContainerRematerializationInput,
  carriedContainerIds: readonly string[],
): Promise<{
  entries: PlannedRematerialization[];
  retiredContainerIds: readonly string[];
  preceding: PrincipalRematerializationPredecessor;
}> {
  input = withPrecedingRematerialization(input);
  if (
    input.revokedContainerId &&
    !input.grants.some(
      (grant) => grant.containerId === input.revokedContainerId,
    )
  ) {
    throw new Error("Revoked container is not granted to the group");
  }
  const { targets, retiredContainerIds } = await loadRematerializationTargets({
    apiClient: input.apiClient,
    carriedContainerIds,
    grants: input.grants,
  });
  const batch: BatchPlanning = {
    knownContainerKeks: new Map(input.preceding?.knownContainerKeks),
    plans: [],
    // A rotation planned above cites the group at the head this batch commits,
    // which no store holds yet; the cache is what lets a rebased path verify.
    principalPolicyCache: new Map([
      ...(input.preceding?.policies ?? []).flatMap((policy) => [
        ...seededPrincipalPolicyCache(policy),
      ]),
      ...seededPrincipalPolicyCache(input.nextPolicy),
    ]),
    rematerialization: input,
    resolveProjectionUserKey: createProjectionUserKeyResolver({
      resolveTrustedUserIdentity: input.resolveTrustedUserIdentity,
    }),
    rotatedAbove: [],
    authoredAbove: [],
  };
  for (const target of targets) {
    await planRematerializationTarget(batch, target);
  }
  return {
    entries: batch.plans,
    retiredContainerIds,
    preceding: {
      policies: [...(input.preceding?.policies ?? []), input.nextPolicy],
      projections: [
        ...(input.preceding?.projections ?? []),
        ...batch.plans.flatMap((entry) =>
          entry.nextProjection ? [entry.nextProjection] : [],
        ),
      ],
      knownContainerKeks: batch.knownContainerKeks,
    },
  };
}

export async function preparePrincipalContainerRematerializationBatch(
  input: PrincipalContainerRematerializationInput,
): Promise<PreparedPrincipalContainerRematerializationBatch> {
  let { entries, retiredContainerIds, preceding } =
    await buildPrincipalContainerRematerializationPlans(input);
  const requests = () => entries.map((entry) => entry.planned.plan.request);
  return {
    get preceding() {
      return preceding;
    },
    get retiredContainerIds() {
      return retiredContainerIds;
    },
    get plans() {
      return entries.map((entry) => entry.planned);
    },
    get requests() {
      return requests();
    },
    refreshAfterConflict: async () => {
      assertProjectionVerificationCurrent(input.stillCurrent);
      for (const containerId of new Set([
        ...input.grants.map((grant) => grant.containerId),
        ...entries.map((entry) => entry.planned.plan.containerId),
      ])) {
        input.apiClient.evictContainerWriterProjection?.(containerId);
      }
      const replanned =
        await buildPrincipalContainerRematerializationPlans(input);
      entries = replanned.entries;
      retiredContainerIds = replanned.retiredContainerIds;
      preceding = replanned.preceding;
      return requests();
    },
    carry: async (requiredContainerIds) => {
      // The refused attempt rolled back whole, so every served head still
      // stands; the batch is signed again from them with the named levels in.
      const replanned = await buildPrincipalContainerRematerializationPlans(
        input,
        requiredContainerIds,
      );
      assertNamedContainersRotated(replanned.entries, requiredContainerIds);
      entries = replanned.entries;
      retiredContainerIds = replanned.retiredContainerIds;
      preceding = replanned.preceding;
      return requests();
    },
    acknowledge: (responses, stillCurrent) =>
      acknowledgePrincipalContainerRematerialization(
        input,
        entries,
        responses,
        stillCurrent,
      ),
  };
}
