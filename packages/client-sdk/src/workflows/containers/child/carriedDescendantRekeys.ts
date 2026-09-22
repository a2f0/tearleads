import type { VerifiedPrincipalPolicy } from "@tearleads/crypto";
import type { ContainerWriterProjectionResponse } from "@tearleads/validators/response";
import { MAX_ROTATION_CONTAINER_REKEYS } from "@tearleads/validators/util";
import type {
  ContainerMutationAuthor,
  ContainerRekeyApi,
  MaterializedContainerRekeyPlan,
} from "../../../data/containers/shared/types";
import {
  type PrincipalPolicyCache,
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
  /**
   * Keys the batch minted and has yet to commit, by epoch id. A rotation's
   * successor is wrapped to recipients at heads the batch itself commits, so
   * no wrap on a re-rooted path opens it for the signer before then; the key
   * the signer just minted does, and its keyring then opens what sits below.
   */
  readonly knownContainerKeks?: ReadonlyMap<string, Uint8Array> | undefined;
  /**
   * Verified policies the batch itself commits, which the rebased paths cite
   * before any store holds them; and the one each carried rekey cites anew.
   */
  readonly principalPolicyCache?: PrincipalPolicyCache | undefined;
  readonly replacementPrincipalPolicy?: VerifiedPrincipalPolicy | undefined;
  readonly resolveProjectionUserKey: ProjectionUserKeyResolver;
  readonly stillCurrent?: (() => boolean) | undefined;
  readonly targetSecretKey: Uint8Array;
  readonly warmReferencedPrincipalPolicies?:
    | ReferencedPrincipalPolicyWarmer
    | undefined;
}

/** A rotated container's own path once its batch is accepted. */
export type SpeculativePath = Pick<
  ContainerWriterProjectionResponse,
  "containerKeks" | "organizationId" | "path"
>;

/**
 * Re-root a served projection on the deepest not-yet-accepted proper ancestor
 * among `speculativePaths`. Each carried plan's own path was built the same
 * way, so the deepest one already holds every speculative level above it. The
 * container's own path, when the batch rotates it too, is not an ancestor: the
 * caller is re-planning that rotation, and it extends what sits above.
 */
export function rebaseOnDeepestAncestor(
  served: ContainerWriterProjectionResponse,
  speculativePaths: readonly SpeculativePath[],
): {
  ancestor: SpeculativePath;
  projection: ContainerWriterProjectionResponse;
} | null {
  let deepest: SpeculativePath | null = null;
  let deepestIndex = -1;
  for (const speculative of speculativePaths) {
    const containerId = speculative.containerKeks.at(-1)?.containerId;
    if (containerId === served.containerId) continue;
    const index = served.containerKeks.findIndex(
      (kek) => kek.containerId === containerId,
    );
    if (index > deepestIndex) {
      deepest = speculative;
      deepestIndex = index;
    }
  }
  if (!deepest) return null;
  const projection = rebaseContainerWriterProjection(served, deepest);
  return projection ? { ancestor: deepest, projection } : null;
}

/**
 * Sign one carried rekey against the path its batch will leave behind. The
 * served projection is fetched by the caller; here it is verified, must sit
 * below one of the rotated containers and in that container's organization,
 * and is signed only if this signer holds its key and write access — which a
 * member able to rotate the ancestor always does, since both inherit downward.
 */
export async function planCarriedDescendantRekey(
  input: CarriedRekeyPlanningInput & {
    readonly rotated: readonly SpeculativePath[];
    readonly served: ContainerWriterProjectionResponse;
  },
): Promise<MaterializedContainerRekeyPlan> {
  // Pin the served head before signing beyond it. The batch is acknowledged
  // against the latest durable pin, and a carried rekey is always past epoch
  // 1, so a device that never pinned this container would otherwise reject
  // its own batch after the server had committed it.
  await verifyContainerWriterProjection({
    execSql: input.execSql,
    principalPolicyCache: input.principalPolicyCache,
    projection: input.served,
    resolveUserKey: input.resolveProjectionUserKey,
    stillCurrent: input.stillCurrent,
    warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
  });
  const rebased = rebaseOnDeepestAncestor(input.served, input.rotated);
  if (!rebased) {
    throw new Error(
      "Carried descendant rekey is not below the rotated container",
    );
  }
  // A batch locks whatever organizations it names, so the server holds each
  // to the rule on its own; a carried rekey belongs to the rotation it rides.
  if (input.served.organizationId !== rebased.ancestor.organizationId) {
    throw new Error(
      "Carried descendant rekey is outside the rotated container's organization",
    );
  }
  return buildMaterializedContainerRekeyPlan({
    author: {
      ...input.author,
      organizationId: rebased.ancestor.organizationId,
    },
    execSql: input.execSql,
    knownContainerKeks: input.knownContainerKeks,
    // Nothing here is acknowledged yet: pins move only with the batch.
    persistVerificationCheckpoints: false,
    previousProjection: rebased.projection,
    principalPolicyCache: input.principalPolicyCache,
    replacementPrincipalPolicy: input.replacementPrincipalPolicy,
    resolveProjectionUserKey: input.resolveProjectionUserKey,
    stillCurrent: input.stillCurrent,
    targetSecretKey: input.targetSecretKey,
    warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
  });
}

/**
 * Sign the descendant rekeys a rotation must commit with (#2340). The server
 * refuses a rotation that would leave a level above a directly granted
 * container pinned to a retired epoch, because the grantee could never re-key
 * that level itself and its writes would wait on another device. It names the
 * levels; this signs them, parent-first, each against the path the batch will
 * leave behind rather than the one currently served.
 *
 * `requiredContainerIds` is a hint, never an authority: each container is
 * fetched and verified here, and refused unless it sits below a rotation.
 */
export async function planCarriedDescendantRekeys(
  input: CarriedRekeyPlanningInput & {
    readonly requiredContainerIds: readonly string[];
    /** Each rotated container's own path once the batch is accepted. */
    readonly rotated: readonly SpeculativePath[];
  },
): Promise<MaterializedContainerRekeyPlan[]> {
  const plans: MaterializedContainerRekeyPlan[] = [];
  const speculativePaths: SpeculativePath[] = [...input.rotated];
  const knownContainerKeks = new Map(input.knownContainerKeks);
  const planned = new Set<string>();
  for (const containerId of input.requiredContainerIds) {
    if (plans.length >= MAX_ROTATION_CONTAINER_REKEYS) break;
    if (planned.has(containerId)) continue;
    const served =
      await input.apiClient.getContainerWriterProjection(containerId);
    if (!served) {
      throw new Error("Carried descendant rekey projection is unavailable");
    }
    if (served.containerId !== containerId) {
      throw new Error("Carried descendant rekey targets another container");
    }
    const plan = await planCarriedDescendantRekey({
      ...input,
      knownContainerKeks,
      rotated: speculativePaths,
      served,
    });
    planned.add(containerId);
    plans.push(plan);
    speculativePaths.push(plan.writerProjection);
    knownContainerKeks.set(plan.plan.containerKeyEpochId, plan.containerKey);
  }
  return plans;
}
