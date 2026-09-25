import type { ApiClient } from "@tearleads/api-client";
import type {
  PrincipalContainerGrant,
  VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import type { ContainerWriterProjectionResponse } from "@tearleads/validators/response";
import { MAX_ROTATION_CONTAINER_REKEYS } from "@tearleads/validators/util";
import { isContainerNotFoundFailure } from "../../data/containers/shared/mutationFailures";
import type {
  MaterializedContainerRekeyPlan,
  MaterializedContainerRevokePlan,
  MaterializedContainerSharePlan,
} from "../../data/containers/shared/types";
import type { PrincipalPolicyCache } from "../../data/keyingProjectionVerification";
import { referencedPrincipalPolicyKey } from "../../data/keyingProjectionVerification/principalPolicyCache";
import type { SpeculativePath } from "../containers/child/carriedDescendantRekeys";
import { containerWriterProjectionFromRotationPlan } from "../containers/child/rekeyProjection";

export type MaterializedPrincipalContainerMutationPlan =
  | MaterializedContainerRekeyPlan
  | MaterializedContainerRevokePlan
  | MaterializedContainerSharePlan;

/** A plan with its container's path once accepted; null for a grant, which rotates nothing. */
export interface PlannedRematerialization {
  /** A descendant rekey carried for a rotation above, not a rematerialization. */
  readonly carried: boolean;
  readonly planned: MaterializedPrincipalContainerMutationPlan;
  readonly rotated: SpeculativePath | null;
}

/**
 * One container a batch signs for: a group grant it rematerializes, or a
 * descendant rekey it carries for a rotation above (`grantRow` null).
 */
export interface RematerializationTarget {
  readonly grantRow: PrincipalContainerGrant | null;
  readonly projection: ContainerWriterProjectionResponse;
}

/**
 * Order a batch parent-first, by served depth. A group granted on a container
 * and on one of its descendants rotates both, and the lower rotation must be
 * signed against the epoch the upper one mints in this same batch, or it
 * extends a head the batch itself retires. A carried rekey sits below the
 * rotation it rides for the same reason. Ties keep id order for stability.
 */
export function orderRematerializationsParentFirst<
  T extends {
    readonly projection: {
      readonly containerId: string;
      readonly path: readonly unknown[];
    };
  },
>(batch: readonly T[]): T[] {
  return [...batch].sort(
    (left, right) =>
      left.projection.path.length - right.projection.path.length ||
      left.projection.containerId.localeCompare(right.projection.containerId),
  );
}

interface ProjectionApi {
  getContainerWriterProjection(
    containerId: string,
  ): Promise<ContainerWriterProjectionResponse | null>;
}

/** The served projection of a container the batch will sign for. */
export async function loadServedProjection(
  apiClient: ProjectionApi,
  containerId: string,
): Promise<ContainerWriterProjectionResponse> {
  const projection = await apiClient.getContainerWriterProjection(containerId);
  if (!projection) {
    throw new Error(
      `Container ${containerId} could not be prepared for principal rotation`,
    );
  }
  if (projection.containerId !== containerId) {
    throw new Error("Served projection describes another container");
  }
  return projection;
}

/**
 * Fetch what the batch signs for, parent-first. A named descendant the batch
 * already rematerializes is not fetched twice: its own rotation is re-planned
 * under whatever the batch carries above it. Names are a hint from the server,
 * never an authority; each is verified where it is planned.
 */
export async function loadRematerializationTargets(input: {
  readonly apiClient: Pick<ApiClient, "getContainerWriterProjectionResult">;
  readonly carriedContainerIds: readonly string[];
  readonly grants: readonly PrincipalContainerGrant[];
}): Promise<RematerializationTarget[]> {
  const grantByContainerId = new Map(
    input.grants.map((grant) => [grant.containerId, grant] as const),
  );
  const carried = [...new Set(input.carriedContainerIds)]
    .filter((containerId) => !grantByContainerId.has(containerId))
    .slice(0, MAX_ROTATION_CONTAINER_REKEYS);
  const targets: RematerializationTarget[] = [];
  for (const containerId of [...grantByContainerId.keys(), ...carried].sort(
    (left, right) => left.localeCompare(right),
  )) {
    const grantRow = grantByContainerId.get(containerId) ?? null;
    const result = await input.apiClient.getContainerWriterProjectionResult(
      containerId,
      { reportErrors: false },
    );
    if (!result.ok) {
      // This is only a planning hint. Keep the signed grant intact; the API
      // independently requires every live grant under the organization lock.
      if (
        grantRow &&
        result.kind === "http" &&
        isContainerNotFoundFailure(result)
      )
        continue;
      throw new Error(
        `Container ${containerId} could not be prepared for principal rotation: ${result.message}`,
      );
    }
    if (result.data.containerId !== containerId)
      throw new Error("Served projection describes another container");
    targets.push({ grantRow, projection: result.data });
  }
  return orderRematerializationsParentFirst(targets);
}

/** An in-memory cache holding only the policy this batch is about to commit. */
export function seededPrincipalPolicyCache(
  nextPolicy: VerifiedPrincipalPolicy,
): PrincipalPolicyCache {
  return new Map([
    [
      referencedPrincipalPolicyKey({
        keyEpoch: nextPolicy.keyEpoch,
        keyFingerprint: nextPolicy.state.keyFingerprint,
        principalId: nextPolicy.principalId,
        principalType: nextPolicy.principalType,
        stateHash: nextPolicy.stateHash,
        version: nextPolicy.version,
      }),
      nextPolicy,
    ],
  ]);
}

/** A rematerialization's path once accepted; null for a grant. */
export async function rotatedPath(input: {
  readonly planned: MaterializedPrincipalContainerMutationPlan;
  readonly previousProjection: ContainerWriterProjectionResponse;
}): Promise<SpeculativePath | null> {
  const { plan } = input.planned;
  if (!("keyring" in plan)) return null;
  return containerWriterProjectionFromRotationPlan({
    plan,
    previousProjection: input.previousProjection,
  });
}
