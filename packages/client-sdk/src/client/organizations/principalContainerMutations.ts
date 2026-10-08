import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import type { CurrentPolicyReferenceResolver } from "../../data/principals/currentPolicyReferenceResolver";
import type { PrincipalPolicyCurrentEvidence } from "../../data/principals/principalPolicyEvidence";
import { resolveDocumentCreateAuthor } from "../../workflows/documents";
import {
  type PreparedPrincipalContainerRematerializationBatch,
  preparePrincipalContainerRematerializationBatch,
} from "../../workflows/organizations/principalContainerRematerialization";
import { createRuntimePrincipalPolicyWarmer } from "../../workflows/principals/runtimePolicyWarmer";
import type { InternalWorkflowRuntimeInput } from "../workflowRuntime";

export async function preparePrincipalContainerMutations(input: {
  readonly currentPolicy: Pick<PrincipalPolicyBundleResponse, "currentGrants">;
  readonly groupId: string;
  readonly nextPolicy: PrincipalPolicyCurrentEvidence;
  readonly resolveAuthoredPolicyReferences?:
    | CurrentPolicyReferenceResolver
    | undefined;
  readonly organizationId: string;
  readonly revokedContainerId?: string | undefined;
  readonly runtime: InternalWorkflowRuntimeInput;
  readonly stillCurrent: () => boolean;
  readonly recitationStillCurrent?: (() => boolean) | undefined;
}): Promise<PreparedPrincipalContainerRematerializationBatch> {
  const author = resolveDocumentCreateAuthor(input.runtime);
  const targetSecretKey = input.runtime.crypto.encapsulationKeyPair?.secretKey;
  if (!author || !targetSecretKey) {
    throw new Error(
      "Organization container rematerialization context is unavailable",
    );
  }
  return preparePrincipalContainerRematerializationBatch({
    stillCurrent: input.stillCurrent,
    recitationStillCurrent: input.recitationStillCurrent,
    reportSecurityIncident: input.runtime.util.reportSecurityIncident,
    apiClient: input.runtime.apiClient,
    author,
    execSql: input.runtime.infra.execSql,
    grants: [
      ...new Map(
        [...input.currentPolicy.currentGrants, ...input.nextPolicy.grants].map(
          (grant) => [grant.containerId, grant] as const,
        ),
      ).values(),
    ],
    groupId: input.groupId,
    nextPolicy: input.nextPolicy,
    resolveAuthoredPolicyReferences: input.resolveAuthoredPolicyReferences,
    revokedContainerId: input.revokedContainerId,
    resolveTrustedUserIdentity: input.runtime.resolveTrustedUserIdentity,
    targetSecretKey,
    warmReferencedPrincipalPolicies: createRuntimePrincipalPolicyWarmer(
      input.runtime,
    ),
  });
}
