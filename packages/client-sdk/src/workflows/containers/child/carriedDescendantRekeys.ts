import type { ContainerWriterProjectionResponse } from "@tearleads/validators/response";
import { MAX_ROTATION_CONTAINER_REKEYS } from "@tearleads/validators/util";
import type {
  ContainerMutationAuthor,
  ContainerRekeyApi,
  MaterializedContainerRekeyPlan,
} from "../../../data/containers/shared/types";
import {
  type ProjectionUserKeyResolver,
  type ReferencedPrincipalPolicyWarmer,
  verifyContainerWriterProjection,
} from "../../../data/keyingProjectionVerification";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import { buildMaterializedContainerRekeyPlan } from "./rekey";
import { rebaseContainerWriterProjection } from "./rekeyProjection";

/** What a rotation needs in hand to sign the descendant rekeys it must carry. */
export interface CarriedRekeyPlanningInput {
  readonly apiClient: Pick<ContainerRekeyApi, "getContainerWriterProjection">;
  readonly author: ContainerMutationAuthor;
  readonly execSql: ExecSql;
  readonly resolveProjectionUserKey: ProjectionUserKeyResolver;
  readonly stillCurrent?: (() => boolean) | undefined;
  readonly targetSecretKey: Uint8Array;
  readonly warmReferencedPrincipalPolicies?:
    | ReferencedPrincipalPolicyWarmer
    | undefined;
}

type SpeculativePath = Pick<
  ContainerWriterProjectionResponse,
  "containerKeks" | "path"
>;

/**
 * Re-root a served projection on the deepest not-yet-accepted ancestor. Each
 * carried plan's own path was built the same way, so the deepest one already
 * holds every speculative level above it.
 */
function rebaseOnDeepestAncestor(
  served: ContainerWriterProjectionResponse,
  speculativePaths: readonly SpeculativePath[],
): ContainerWriterProjectionResponse | null {
  let deepest: SpeculativePath | null = null;
  let deepestIndex = -1;
  for (const speculative of speculativePaths) {
    const containerId = speculative.containerKeks.at(-1)?.containerId;
    const index = served.containerKeks.findIndex(
      (kek) => kek.containerId === containerId,
    );
    if (index > deepestIndex) {
      deepest = speculative;
      deepestIndex = index;
    }
  }
  return deepest ? rebaseContainerWriterProjection(served, deepest) : null;
}

/**
 * Sign the descendant rekeys a rotation must commit with (#2340). The server
 * refuses a rotation that would leave a level above a directly granted
 * container pinned to a retired epoch, because the grantee could never re-key
 * that level itself and its writes would wait on another device. It names the
 * levels; this signs them, parent-first, each against the path the batch will
 * leave behind rather than the one currently served.
 *
 * `requiredContainerIds` is a hint, never an authority. Each container is
 * fetched and verified here, must sit below the rotated container, and is
 * signed only if this signer holds its key and write access — which a member
 * able to rotate the ancestor always does, since both inherit downward.
 */
export async function planCarriedDescendantRekeys(
  input: CarriedRekeyPlanningInput & {
    readonly requiredContainerIds: readonly string[];
    /**
     * Each rotated container's own path once the batch is accepted: one for a
     * standalone rotation, several for a policy batch that rotated many.
     */
    readonly rotated: SpeculativePath | readonly SpeculativePath[];
  },
): Promise<MaterializedContainerRekeyPlan[]> {
  const plans: MaterializedContainerRekeyPlan[] = [];
  const speculativePaths: SpeculativePath[] =
    "path" in input.rotated ? [input.rotated] : [...input.rotated];
  const planned = new Set<string>();
  for (const containerId of input.requiredContainerIds) {
    if (plans.length >= MAX_ROTATION_CONTAINER_REKEYS) break;
    if (planned.has(containerId)) continue;
    const served =
      await input.apiClient.getContainerWriterProjection(containerId);
    if (!served) {
      throw new Error("Carried descendant rekey projection is unavailable");
    }
    if (
      served.containerId !== containerId ||
      served.organizationId !== input.author.organizationId
    ) {
      throw new Error("Carried descendant rekey targets another container");
    }
    // Pin the served head before signing beyond it. The batch is acknowledged
    // against the latest durable pin, and a carried rekey is always past epoch
    // 1, so a device that never pinned this container would otherwise reject
    // its own batch after the server had committed it.
    await verifyContainerWriterProjection({
      execSql: input.execSql,
      projection: served,
      resolveUserKey: input.resolveProjectionUserKey,
      stillCurrent: input.stillCurrent,
      warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
    });
    const previousProjection = rebaseOnDeepestAncestor(
      served,
      speculativePaths,
    );
    if (!previousProjection) {
      throw new Error(
        "Carried descendant rekey is not below the rotated container",
      );
    }
    const plan = await buildMaterializedContainerRekeyPlan({
      author: input.author,
      execSql: input.execSql,
      // Nothing here is acknowledged yet: pins move only with the batch.
      persistVerificationCheckpoints: false,
      previousProjection,
      resolveProjectionUserKey: input.resolveProjectionUserKey,
      stillCurrent: input.stillCurrent,
      targetSecretKey: input.targetSecretKey,
      warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
    });
    planned.add(containerId);
    plans.push(plan);
    speculativePaths.push(plan.writerProjection);
  }
  return plans;
}
