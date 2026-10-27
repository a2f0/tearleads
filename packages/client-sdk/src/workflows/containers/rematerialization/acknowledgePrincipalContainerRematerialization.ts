import type { ContainerMutationResponse } from "@tearleads/validators/response";
import { rememberVerifiedContainerHeads } from "../../../data/containers/shared/heldContainerHeads";
import type { AuthoredContainerMutationHead } from "../../../data/containers/shared/mutationAcknowledgement";
import { acknowledgeContainerMutationBatch } from "../../../data/containers/shared/mutationAcknowledgement";
import { scheduleHeldDescendantRecitations } from "../child/recite";
import type { PrincipalContainerRematerializationInput } from "./principalContainerRematerializationPlanning";
import type { PlannedRematerialization } from "./principalContainerRematerializationTargets";

export async function acknowledgePrincipalContainerRematerialization(
  input: PrincipalContainerRematerializationInput,
  entries: readonly PlannedRematerialization[],
  responses: readonly ContainerMutationResponse[],
  stillCurrent?: (() => boolean) | undefined,
): Promise<void> {
  const isCurrent = () =>
    input.stillCurrent?.() !== false && stillCurrent?.() !== false;
  const heads = entries.map((entry) => entry.planned.plan);
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
      stillCurrent: input.recitationStillCurrent ?? isCurrent,
      reportSecurityIncident: input.reportSecurityIncident,
    });
  }
}
