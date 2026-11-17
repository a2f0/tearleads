import type { ProjectionPolicyEvidenceResponse } from "@tearleads/validators/response";
import type { signedAuthorityRecoveryHistory } from "./principalAuthorityRecovery";
import { principalPolicyHead } from "./principalPolicyFixtures";
import { createPublicHistoryFixture } from "./publicPrincipalHistory";

export async function createPublicProjectionHistoryFixture(
  history: Awaited<ReturnType<typeof signedAuthorityRecoveryHistory>>,
  extra = history.admin,
) {
  const f = await createPublicHistoryFixture(
    { ...history, bundle: history.group },
    [history.admin, history.directory, extra],
  );
  const evidence: ProjectionPolicyEvidenceResponse = {
    organization: f.source(history.directory),
    organizationPayloads: [
      {
        reference: principalPolicyHead(history.directory),
        payload: history.directory.currentPayload,
      },
    ],
    groups: [f.source(history.admin), f.source(history.group)],
  };
  return {
    ...f,
    options: {
      ...f.options,
      evidence,
      organizationId: history.organizationId,
      references: [principalPolicyHead(history.created)],
    },
  };
}
