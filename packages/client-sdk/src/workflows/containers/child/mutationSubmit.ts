import type { AnyVerifiedPrincipalPolicy } from "@tearleads/crypto";
import type { ContainerMutationRequest } from "@tearleads/validators/request";
import {
  CONTAINER_MUTATION_ERROR_CODES,
  type ContainerRotationResponse,
  type ContainerWriterProjectionResponse,
} from "@tearleads/validators/response";
import { rememberVerifiedContainerHeads } from "../../../data/containers/shared/heldContainerHeads";
import {
  acknowledgeContainerMutation,
  acknowledgeContainerMutationBatch,
} from "../../../data/containers/shared/mutationAcknowledgement";
import type { ContainerReciteApi } from "../../../data/containers/shared/reciteApi";
import type {
  ContainerMutationAuthor,
  ContainerRotationResult,
  MaterializedContainerRekeyPlan,
} from "../../../data/containers/shared/types";
import type { SecurityIncidentReporter } from "../../../data/securityIncidents";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import {
  type CarriedRekeyPlanningInput,
  planCarriedDescendantRekeys,
} from "./carriedDescendantRekeys";
import { scheduleHeldDescendantRecitations } from "./recite";

/**
 * Supplied by mutations that mint a new key epoch (rekey, revoke, move). The
 * server refuses one that would strand a level above a directly granted
 * container, and names the descendant rekeys it must carry instead (#2340).
 */
export interface CarriedRekeys {
  readonly planning: CarriedRekeyPlanningInput;
  /** The rotated container's own path once the rotation is accepted. */
  readonly rotated: () => Promise<
    Pick<ContainerWriterProjectionResponse, "containerKeks" | "path">
  >;
}

/**
 * Adapt a rotation endpoint pair to one status-bearing call. An adapter with
 * only the plain method still rotates; it just cannot learn what to carry, so a
 * rotation that needs descendants fails as any other refusal does.
 */
export async function submitContainerRotation(input: {
  plain: () => Promise<ContainerRotationResponse | null>;
  result: (() => Promise<ContainerRotationResult>) | undefined;
}): Promise<ContainerRotationResult> {
  if (input.result) return input.result();
  const data = await input.plain();
  return data ? { data, ok: true } : { ok: false, status: null };
}

/**
 * Submit a rotation; if the server refuses it for stranding a level above a
 * directly granted container, sign the descendant rekeys it names and resubmit
 * once with them carried. The refused attempt rolled back whole, so the signed
 * rotation still extends the current head and only the descendants need
 * signing. A second refusal means the tree moved underneath, and the caller's
 * own retry starts from a fresh projection.
 */
export async function submitRotationCarryingDescendants(input: {
  carriedRekeys?: CarriedRekeys | undefined;
  stillCurrent?: (() => boolean) | undefined;
  submit: (
    carried: readonly ContainerMutationRequest[],
  ) => Promise<ContainerRotationResult>;
}): Promise<{
  carriedPlans: MaterializedContainerRekeyPlan[];
  result: ContainerRotationResult;
}> {
  const result = await input.submit([]);
  if (
    result.ok ||
    result.code !== CONTAINER_MUTATION_ERROR_CODES.descendantRekeysRequired ||
    !result.requiredContainerIds?.length ||
    !input.carriedRekeys
  ) {
    return { carriedPlans: [], result };
  }
  const carriedPlans = await planCarriedDescendantRekeys({
    ...input.carriedRekeys.planning,
    requiredContainerIds: result.requiredContainerIds,
    rotated: await input.carriedRekeys.rotated(),
  });
  if (input.stillCurrent?.() === false) return { carriedPlans: [], result };
  return {
    carriedPlans,
    result: await input.submit(carriedPlans.map(({ plan }) => plan.request)),
  };
}

/**
 * Submit and acknowledge remote share/rekey/revoke/move plans before scheduling
 * opportunistic descendant re-citations. Create separately handles its lost
 * response conflict; group share caches the rotated policy after this tail.
 */
export async function submitAcknowledgedContainerMutation<
  TPlan extends Parameters<typeof acknowledgeContainerMutation>[0]["plan"],
>(input: {
  apiClient: ContainerReciteApi;
  author: ContainerMutationAuthor;
  /** Present exactly when the plan minted a new key epoch. */
  carriedRekeys?: CarriedRekeys | undefined;
  containerKey: Uint8Array;
  execSql: ExecSql;
  plan: TPlan;
  recitationPolicies: readonly AnyVerifiedPrincipalPolicy[];
  reportSecurityIncident: SecurityIncidentReporter;
  stillCurrent?: (() => boolean) | undefined;
  submit: (
    carried: readonly ContainerMutationRequest[],
  ) => Promise<ContainerRotationResult>;
}): Promise<{
  containerKey: Uint8Array;
  plan: TPlan;
  response: ContainerRotationResponse;
} | null> {
  if (input.stillCurrent?.() === false) return null;
  const submitted = await submitRotationCarryingDescendants(input);
  if (!submitted.result.ok) return null;
  const { carriedPlans } = submitted;
  const response = submitted.result.data;

  const acknowledged =
    carriedPlans.length === 0
      ? await acknowledgeContainerMutation({
          execSql: input.execSql,
          plan: input.plan,
          response,
          stillCurrent: input.stillCurrent,
        })
      : // The rotation and what it carried committed together, so their pins
        // advance together: a missing acknowledgement refuses the whole batch.
        await acknowledgeContainerMutationBatch({
          execSql: input.execSql,
          plans: [input.plan, ...carriedPlans.map(({ plan }) => plan)],
          responses: [response, ...(response.containerRekeys ?? [])],
          stillCurrent: input.stillCurrent,
        });
  if (!acknowledged || input.stillCurrent?.() === false) return null;

  try {
    rememberVerifiedContainerHeads({
      execSql: input.execSql,
      organizationId: input.author.organizationId,
      heads: [],
      policies: input.recitationPolicies,
    });
    scheduleHeldDescendantRecitations({
      apiClient: input.apiClient,
      author: input.author,
      execSql: input.execSql,
      // A carried rekey already cites the current path, so re-citing it would
      // only spend its recitation budget.
      plans: [input.plan, ...carriedPlans.map(({ plan }) => plan)],
      reportSecurityIncident: input.reportSecurityIncident,
      stillCurrent: input.stillCurrent,
    });
  } catch {
    // Optional cache population cannot change an acknowledged mutation result.
  }
  return {
    containerKey: input.containerKey,
    plan: input.plan,
    response,
  };
}
