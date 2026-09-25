import type { ApiClient } from "@tearleads/api-client";
import type {
  PrincipalContainerGrant,
  VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import type { ContainerWriterProjectionResponse } from "@tearleads/validators/response";
import { MAX_ROTATION_CONTAINER_REKEYS } from "@tearleads/validators/util";
import type { ContainerReciteApi } from "../../data/containers/shared/reciteApi";
import type { ContainerMutationAuthor } from "../../data/containers/shared/types";
import type {
  PrincipalPolicyCache,
  ReferencedPrincipalPolicyWarmer,
} from "../../data/keyingProjectionVerification";
import type { createProjectionUserKeyResolver } from "../../data/keyingProjectionVerification/userKeyResolver";
import type { SecurityIncidentReporter } from "../../data/securityIncidents";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import type { TrustedUserIdentityResolver } from "../../data/trustedUserIdentity";
import {
  planCarriedDescendantRekey,
  type SpeculativePath,
} from "../containers/child/carriedDescendantRekeys";
import type { PlannedRematerialization } from "./principalContainerRematerializationTargets";

export interface RematerializationApi
  extends ContainerReciteApi,
    Pick<ApiClient, "getContainerWriterProjectionResult"> {
  getContainerWriterProjection(
    containerId: string,
  ): Promise<ContainerWriterProjectionResponse | null>;
}

export interface PrincipalContainerRematerializationInput {
  readonly reportSecurityIncident: SecurityIncidentReporter;
  readonly apiClient: RematerializationApi;
  readonly author: ContainerMutationAuthor;
  readonly execSql: ExecSql;
  readonly grants: readonly PrincipalContainerGrant[];
  readonly groupId: string;
  readonly nextPolicy: VerifiedPrincipalPolicy;
  readonly revokedContainerId?: string | undefined;
  readonly resolveTrustedUserIdentity: TrustedUserIdentityResolver;
  readonly stillCurrent?: (() => boolean) | undefined;
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
    resolveProjectionUserKey: batch.resolveProjectionUserKey,
    rotated: batch.rotatedAbove,
    served,
    stillCurrent: rematerialization.stillCurrent,
    targetSecretKey: rematerialization.targetSecretKey,
    warmReferencedPrincipalPolicies:
      rematerialization.warmReferencedPrincipalPolicies,
  });
  addPlan(batch, { carried: true, planned, rotated: planned.writerProjection });
}

export function addPlan(
  batch: BatchPlanning,
  entry: PlannedRematerialization,
): void {
  batch.plans.push(entry);
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
