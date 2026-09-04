import type { AnyVerifiedPrincipalPolicy } from "@tearleads/crypto";
import type { ContainerMutationResponse } from "@tearleads/validators/response";
import { rememberVerifiedContainerHeads } from "../../../data/containers/shared/heldContainerHeads";
import { acknowledgeContainerMutation } from "../../../data/containers/shared/mutationAcknowledgement";
import type { ContainerReciteApi } from "../../../data/containers/shared/reciteApi";
import type { ContainerMutationAuthor } from "../../../data/containers/shared/types";
import type { SecurityIncidentReporter } from "../../../data/securityIncidents";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import { scheduleHeldDescendantRecitations } from "./recite";

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
  containerKey: Uint8Array;
  execSql: ExecSql;
  plan: TPlan;
  recitationPolicies: readonly AnyVerifiedPrincipalPolicy[];
  reportSecurityIncident: SecurityIncidentReporter;
  stillCurrent?: (() => boolean) | undefined;
  submit: () => Promise<ContainerMutationResponse | null>;
}): Promise<{
  containerKey: Uint8Array;
  plan: TPlan;
  response: ContainerMutationResponse;
} | null> {
  if (input.stillCurrent?.() === false) return null;
  const response = await input.submit();
  if (!response) {
    return null;
  }

  await acknowledgeContainerMutation({
    execSql: input.execSql,
    plan: input.plan,
    response,
    stillCurrent: input.stillCurrent,
  });
  if (input.stillCurrent?.() === false) return null;

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
      plans: [input.plan],
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
