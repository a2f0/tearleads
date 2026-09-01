import type { VerifiedPrincipalPolicy } from "@tearleads/crypto";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import { resolveDocumentCreateAuthor } from "../../workflows/documents";
import {
  type PreparedPrincipalContainerRematerializationBatch,
  preparePrincipalContainerRematerializationBatch,
} from "../../workflows/organizations/principalContainerRematerialization";
import { createRuntimePrincipalPolicyWarmer } from "../../workflows/principals/runtimePolicyWarmer";
import type { InternalWorkflowRuntimeInput } from "../workflowRuntime";

export async function preparePrincipalContainerMutations(input: {
  readonly currentPolicy: PrincipalPolicyBundleResponse;
  readonly groupId: string;
  readonly nextPolicy: VerifiedPrincipalPolicy;
  readonly organizationId: string;
  readonly revokedContainerId?: string | undefined;
  readonly runtime: InternalWorkflowRuntimeInput;
}): Promise<PreparedPrincipalContainerRematerializationBatch> {
  const author = resolveDocumentCreateAuthor(input.runtime);
  const targetSecretKey = input.runtime.crypto.encapsulationKeyPair?.secretKey;
  if (!author || !targetSecretKey) {
    throw new Error(
      "Organization container rematerialization context is unavailable",
    );
  }
  return preparePrincipalContainerRematerializationBatch({
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
    revokedContainerId: input.revokedContainerId,
    resolveTrustedUserIdentity: input.runtime.resolveTrustedUserIdentity,
    targetSecretKey,
    warmReferencedPrincipalPolicies: createRuntimePrincipalPolicyWarmer(
      input.runtime,
    ),
  });
}
