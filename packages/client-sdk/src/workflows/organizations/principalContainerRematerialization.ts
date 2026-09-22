import type {
  ContainerDirectGrant,
  PrincipalContainerGrant,
} from "@tearleads/crypto";
import type { ContainerMutationRequest } from "@tearleads/validators/request";
import type {
  ContainerMutationResponse,
  ContainerWriterProjectionResponse,
} from "@tearleads/validators/response";
import { MAX_ROTATION_CONTAINER_REKEYS } from "@tearleads/validators/util";
import { rememberVerifiedContainerHeads } from "../../data/containers/shared/heldContainerHeads";
import type { AuthoredContainerMutationHead } from "../../data/containers/shared/mutationAcknowledgement";
import { acknowledgeContainerMutationBatch } from "../../data/containers/shared/mutationAcknowledgement";
import {
  getTargetContainerContext,
  readContainerState,
} from "../../data/containers/shared/projection";
import {
  type PrincipalPolicyCache,
  verifyContainerWriterProjection,
} from "../../data/keyingProjectionVerification";
import { createProjectionUserKeyResolver } from "../../data/keyingProjectionVerification/userKeyResolver";
import { rebaseOnDeepestAncestor } from "../containers/child/carriedDescendantRekeys";
import { scheduleHeldDescendantRecitations } from "../containers/child/recite";
import { buildMaterializedContainerRekeyPlan } from "../containers/child/rekey";
import { isSpeculativeContainerWriterProjection } from "../containers/child/rekeyProjection";
import { buildMaterializedContainerRevokePlan } from "../containers/child/revoke";
import { buildMaterializedContainerSharePlan } from "../containers/child/shareMaterialization";
import {
  addPlan,
  type BatchPlanning,
  carryLevel,
  type PrincipalContainerRematerializationInput,
  staleLevelsAbove,
} from "./principalContainerRematerializationPlanning";
import {
  loadRematerializationTargets,
  loadServedProjection,
  type MaterializedPrincipalContainerMutationPlan,
  type PlannedRematerialization,
  type RematerializationTarget,
  rotatedPath,
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
  return (await buildPrincipalContainerRematerializationPlans(input)).map(
    (entry) => entry.planned.plan.request,
  );
}

export interface PreparedPrincipalContainerRematerializationBatch {
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
}

function authoredMutationHead(
  planned: MaterializedPrincipalContainerMutationPlan,
): AuthoredContainerMutationHead {
  return planned.plan;
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
  const { grantRow, rematerialization } = input;
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
  for (const containerId of rebased
    ? staleLevelsAbove(rebased.projection)
    : []) {
    await carryLevel(
      batch,
      await loadServedProjection(rematerialization.apiClient, containerId),
    );
  }
  if (!target.grantRow) {
    await carryLevel(batch, target.projection);
    return;
  }
  const previousProjection =
    rebaseOnDeepestAncestor(target.projection, batch.rotatedAbove)
      ?.projection ?? target.projection;
  const planned = await buildPrincipalContainerRematerializationPlan({
    grantRow: target.grantRow,
    knownContainerKeks: batch.knownContainerKeks,
    principalPolicyCache: batch.principalPolicyCache,
    projection: previousProjection,
    rematerialization,
    resolveProjectionUserKey: batch.resolveProjectionUserKey,
  });
  addPlan(batch, {
    planned,
    rotated: await rotatedPath({ planned, previousProjection }),
  });
}

/**
 * Sign the batch parent-first. `carriedContainerIds` are the descendant rekeys
 * a refused attempt was told to carry; woven in by depth, each sits under the
 * rotation it rides, and a named container the batch rematerializes anyway is
 * re-planned there rather than rotated twice.
 */
async function buildPrincipalContainerRematerializationPlans(
  input: PrincipalContainerRematerializationInput,
  carriedContainerIds: readonly string[] = [],
): Promise<PlannedRematerialization[]> {
  if (
    input.revokedContainerId &&
    !input.grants.some(
      (grant) => grant.containerId === input.revokedContainerId,
    )
  ) {
    throw new Error("Revoked container is not granted to the group");
  }
  const targets = await loadRematerializationTargets({
    apiClient: input.apiClient,
    carriedContainerIds,
    grants: input.grants,
  });
  const batch: BatchPlanning = {
    knownContainerKeks: new Map(),
    plans: [],
    // A rotation planned above cites the group at the head this batch commits,
    // which no store holds yet; the cache is what lets a rebased path verify.
    principalPolicyCache: seededPrincipalPolicyCache(input.nextPolicy),
    rematerialization: input,
    resolveProjectionUserKey: createProjectionUserKeyResolver({
      resolveTrustedUserIdentity: input.resolveTrustedUserIdentity,
    }),
    rotatedAbove: [],
  };
  for (const target of targets) {
    await planRematerializationTarget(batch, target);
  }
  return batch.plans;
}

/**
 * The server names a level it found pinned to a retired epoch. A batch answers
 * with a rotation of it: a carried rekey, or its own rematerialization when
 * that is a rekey or revoke. A rematerialized grant rotates nothing, so a
 * batch that both grants a container and must re-key it cannot be signed;
 * no policy change the SDK builds combines the two.
 */
function assertNamedContainersRotated(
  plans: readonly PlannedRematerialization[],
  requiredContainerIds: readonly string[],
): void {
  const rotatedIds = new Set(
    plans.flatMap((entry) =>
      entry.rotated ? [entry.planned.plan.containerId] : [],
    ),
  );
  const unrotated = requiredContainerIds
    .slice(0, MAX_ROTATION_CONTAINER_REKEYS)
    .find((containerId) => !rotatedIds.has(containerId));
  if (unrotated !== undefined) {
    throw new Error(
      `Container ${unrotated} needs a rekey this policy change only grants`,
    );
  }
}

export async function preparePrincipalContainerRematerializationBatch(
  input: PrincipalContainerRematerializationInput,
): Promise<PreparedPrincipalContainerRematerializationBatch> {
  const entries = await buildPrincipalContainerRematerializationPlans(input);
  const requests = () => entries.map((entry) => entry.planned.plan.request);
  return {
    get plans() {
      return entries.map((entry) => entry.planned);
    },
    get requests() {
      return requests();
    },
    carry: async (requiredContainerIds) => {
      // The refused attempt rolled back whole, so every served head still
      // stands; the batch is signed again from them with the named levels in.
      const replanned = await buildPrincipalContainerRematerializationPlans(
        input,
        requiredContainerIds,
      );
      assertNamedContainersRotated(replanned, requiredContainerIds);
      entries.splice(0, entries.length, ...replanned);
      return requests();
    },
    acknowledge: async (responses, stillCurrent) => {
      const isCurrent = () =>
        input.stillCurrent?.() !== false && stillCurrent?.() !== false;
      const heads = entries.map((entry) => authoredMutationHead(entry.planned));
      const acknowledged = await acknowledgeContainerMutationBatch({
        execSql: input.execSql,
        plans: heads,
        responses,
        stillCurrent: isCurrent,
      });
      if (!acknowledged || !isCurrent()) return;
      const plansByOrganization = new Map<
        string,
        AuthoredContainerMutationHead[]
      >();
      for (const head of heads) {
        const organizationId = head.state.organizationId;
        const group = plansByOrganization.get(organizationId) ?? [];
        group.push(head);
        plansByOrganization.set(organizationId, group);
      }
      for (const [organizationId, organizationPlans] of plansByOrganization) {
        try {
          rememberVerifiedContainerHeads({
            organizationId,
            execSql: input.execSql,
            heads: [],
            policies: [input.nextPolicy],
          });
        } catch {
          // Cache failure must not invalidate the durably acknowledged batch.
          continue;
        }
        scheduleHeldDescendantRecitations({
          apiClient: input.apiClient,
          author: { ...input.author, organizationId },
          execSql: input.execSql,
          plans: organizationPlans,
          stillCurrent: isCurrent,
          reportSecurityIncident: input.reportSecurityIncident,
        });
      }
    },
  };
}
