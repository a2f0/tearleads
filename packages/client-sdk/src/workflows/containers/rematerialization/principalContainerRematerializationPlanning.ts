import type { ApiClient } from "@tearleads/api-client";
import {
  KeyingVerificationError,
  type PrincipalContainerGrant,
} from "@tearleads/crypto";
import type { ContainerWriterProjectionResponse } from "@tearleads/validators/response";
import { MAX_ROTATION_CONTAINER_REKEYS } from "@tearleads/validators/util";
import type { ContainerReciteApi } from "../../../data/containers/shared/reciteApi";
import type { ContainerMutationAuthor } from "../../../data/containers/shared/types";
import {
  type PrincipalPolicyCache,
  type ReferencedPrincipalPolicyWarmer,
  verifyContainerWriterProjection,
} from "../../../data/keyingProjectionVerification";
import type { ResolvedPrincipalPolicyEvidence } from "../../../data/keyingProjectionVerification/types";
import type { createProjectionUserKeyResolver } from "../../../data/keyingProjectionVerification/userKeyResolver";
import type { CurrentPolicyReferenceResolver } from "../../../data/principals/currentPolicyReferenceResolver";
import type { PrincipalPolicyCurrentEvidence } from "../../../data/principals/principalPolicyEvidence";
import type { SecurityIncidentReporter } from "../../../data/shared/securityIncidents";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import type { TrustedUserIdentityResolver } from "../../../data/trustedUserIdentity";
import {
  planCarriedDescendantRekey,
  rebaseOnDeepestAncestor,
  type SpeculativePath,
} from "../child/rekey/carriedDescendantRekeys";
import { isSpeculativeContainerWriterProjection } from "../child/rekey/rekeyProjection";
import type { PlannedRematerialization } from "./principalContainerRematerializationTargets";

export interface RematerializationApi
  extends ContainerReciteApi,
    Pick<ApiClient, "getContainerWriterProjectionResult"> {
  getContainerWriterProjection(
    containerId: string,
  ): Promise<ContainerWriterProjectionResponse | null>;
  evictContainerWriterProjection?(containerId: string): void;
}

export interface PrincipalRematerializationPredecessor {
  readonly authored?: readonly ResolvedPrincipalPolicyEvidence[] | undefined;
  readonly policies: readonly PrincipalPolicyCurrentEvidence[];
  readonly projections: readonly ContainerWriterProjectionResponse[];
  readonly knownContainerKeks: ReadonlyMap<string, Uint8Array>;
}

export interface PrincipalContainerRematerializationInput {
  readonly preceding?: PrincipalRematerializationPredecessor | undefined;
  readonly reportSecurityIncident: SecurityIncidentReporter;
  readonly apiClient: RematerializationApi;
  readonly author: ContainerMutationAuthor;
  readonly execSql: ExecSql;
  readonly grants: readonly PrincipalContainerGrant[];
  readonly groupId: string;
  readonly nextPolicy: PrincipalPolicyCurrentEvidence;
  readonly resolveAuthoredPolicyReferences?:
    | CurrentPolicyReferenceResolver
    | undefined;
  readonly revokedContainerId?: string | undefined;
  readonly resolveTrustedUserIdentity: TrustedUserIdentityResolver;
  readonly stillCurrent?: (() => boolean) | undefined;
  /** Session lifetime for best-effort work after durable acknowledgement. */
  readonly recitationStillCurrent?: (() => boolean) | undefined;
  readonly targetSecretKey: Uint8Array;
  readonly warmReferencedPrincipalPolicies?:
    | ReferencedPrincipalPolicyWarmer
    | undefined;
}

/** What the batch has signed so far, in the order it will be submitted. */
export interface BatchPlanning {
  /**
   * Keys the batch minted, by epoch id. A rotation wraps its successor to the
   * group at the head this batch commits, which no store can open yet; a
   * level planned beneath it opens that epoch with the key minted here, and
   * its keyring then opens the retired epoch the level below is pinned to.
   */
  readonly knownContainerKeks: Map<string, Uint8Array>;
  readonly plans: PlannedRematerialization[];
  readonly principalPolicyCache: PrincipalPolicyCache;
  readonly rematerialization: PrincipalContainerRematerializationInput;
  readonly resolveProjectionUserKey: ReturnType<
    typeof createProjectionUserKeyResolver
  >;
  readonly rotatedAbove: SpeculativePath[];
  /** Every path the batch authored, a grant's included, in signing order. */
  readonly authoredAbove: SpeculativePath[];
}

/** How many rekeys the batch carries beyond its rematerializations. */
function carriedCount(batch: BatchPlanning): number {
  return batch.plans.filter((entry) => entry.carried).length;
}

/**
 * Sign a rekey of `served` under the batch's rotations above it, and add it.
 * The server accepts at most `MAX_ROTATION_CONTAINER_REKEYS` carried entries;
 * past that a rematerialization below them could not be signed on a current
 * path, so the batch is refused here, before signing what the server would
 * refuse anyway, and the policy change has to wait for a lazy repair of the
 * tree. Groups granted that far apart on one chain are not a shape the SDK
 * creates.
 */
export async function carryLevel(
  batch: BatchPlanning,
  served: ContainerWriterProjectionResponse,
): Promise<void> {
  const { rematerialization } = batch;
  if (carriedCount(batch) >= MAX_ROTATION_CONTAINER_REKEYS) {
    throw new Error(
      `Policy change would carry more than ${MAX_ROTATION_CONTAINER_REKEYS} descendant rekeys`,
    );
  }
  const planned = await planCarriedDescendantRekey({
    apiClient: rematerialization.apiClient,
    author: rematerialization.author,
    execSql: rematerialization.execSql,
    knownContainerKeks: batch.knownContainerKeks,
    principalPolicyCache: batch.principalPolicyCache,
    // Its path cites the policy this batch commits, so like every
    // rematerialized rotation it must cite the successor.
    replacementPrincipalPolicy: rematerialization.nextPolicy,
    resolveAuthoredPolicyReferences:
      rematerialization.resolveAuthoredPolicyReferences,
    resolveProjectionUserKey: batch.resolveProjectionUserKey,
    rotated: batch.rotatedAbove,
    served,
    stillCurrent: rematerialization.stillCurrent,
    targetSecretKey: rematerialization.targetSecretKey,
    warmReferencedPrincipalPolicies:
      rematerialization.warmReferencedPrincipalPolicies,
  });
  addPlan(batch, {
    carried: true,
    planned,
    rotated: planned.writerProjection,
    nextProjection: planned.writerProjection,
  });
}

/**
 * Re-root a granted target on the deepest path the batch authored above it, a
 * grant's included: the server applies the batch in order, so the target
 * cites every head an earlier entry advances. Its served head is pinned first,
 * as a carried rekey's is. The batch is acknowledged against the latest
 * durable pin, and a re-rooted path pins nothing, so a device that never
 * pinned this container would refuse its own batch once the server took it.
 * Only what the API served is pinned: in a compound transaction the target
 * may already sit on the preceding batch's heads, which a refused commit
 * never makes real.
 */
export async function rerootOnAuthoredPaths(
  batch: BatchPlanning,
  served: ContainerWriterProjectionResponse,
): Promise<ContainerWriterProjectionResponse> {
  const rebased = rebaseOnDeepestAncestor(served, batch.authoredAbove);
  if (!rebased) return served;
  if (isSpeculativeContainerWriterProjection(served)) {
    return rebased.projection;
  }
  const { rematerialization } = batch;
  await verifyContainerWriterProjection({
    execSql: rematerialization.execSql,
    principalPolicyCache: batch.principalPolicyCache,
    projection: served,
    resolveUserKey: batch.resolveProjectionUserKey,
    stillCurrent: rematerialization.stillCurrent,
    warmReferencedPrincipalPolicies:
      rematerialization.warmReferencedPrincipalPolicies,
  });
  return rebased.projection;
}

export function addPlan(
  batch: BatchPlanning,
  entry: PlannedRematerialization,
): void {
  batch.plans.push(entry);
  if (entry.nextProjection) batch.authoredAbove.push(entry.nextProjection);
  if (!entry.rotated) return;
  batch.rotatedAbove.push(entry.rotated);
  const minted = entry.rotated.containerKeks.at(-1)?.containerKeyEpochId;
  if (minted) batch.knownContainerKeks.set(minted, entry.planned.containerKey);
}

/**
 * Levels of a re-rooted path pinned to an epoch the batch retires above them:
 * those strictly between the rotated ancestor the path was re-rooted on and
 * the target, parent-first, from the first stale one down. A rotation planned
 * above a target strands every level between the two, and each must be
 * re-keyed under the one above before the target can be signed. The batch
 * carries them without waiting to be told: they are proper ancestors of a
 * granted container, so the server would name them, and a refusal per level
 * is a round trip each. Anything stale above the rotated ancestor is not this
 * batch's doing and is left alone. `carryLevel` holds the count to the cap.
 */
export function staleLevelsAbove(
  projection: ContainerWriterProjectionResponse,
  rotatedAncestorId: string,
): string[] {
  const keks = projection.containerKeks;
  const ancestor = keks.findIndex(
    (kek) => kek.containerId === rotatedAncestorId,
  );
  if (ancestor < 0) return [];
  const between = keks.slice(ancestor, -1);
  const firstStale = between.findIndex(
    (kek, index) =>
      index > 0 &&
      kek.parentContainerKeyEpochId !== between[index - 1]?.containerKeyEpochId,
  );
  return firstStale < 0
    ? []
    : between.slice(firstStale).map((kek) => kek.containerId);
}

/**
 * The server names a level it found pinned to a retired epoch. A batch answers
 * with a rotation of it: a carried rekey, or its own rematerialization when
 * that is a rekey or revoke. A rematerialized grant rotates nothing, so a
 * batch that both grants a container and must re-key it cannot be signed;
 * no policy change the SDK builds combines the two.
 */
export function assertNamedContainersRotated(
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

/**
 * Plan once more after a rollback. A batch reads the served heads of what it
 * signs for, then verifies them, and this device's own re-citation of held
 * descendants, scheduled by a share above, may pin a newer head in between
 * (#2647). The second plan reads fresh heads held to the same pins, so a
 * server that serves a rolled-back head again still fails the batch.
 */
export async function planOnceMoreAfterRollback<T>(
  apiClient: Pick<RematerializationApi, "evictContainerWriterProjection">,
  containerIds: readonly string[],
  plan: () => Promise<T>,
): Promise<T> {
  try {
    return await plan();
  } catch (error) {
    if (
      !(error instanceof KeyingVerificationError) ||
      error.code !== "rollback"
    )
      throw error;
    for (const containerId of containerIds) {
      apiClient.evictContainerWriterProjection?.(containerId);
    }
    return plan();
  }
}
