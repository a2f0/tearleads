import type { VerifiedPrincipalPolicy } from "@tearleads/crypto";
import { resolveDocumentCreateAuthor } from "../../workflows/documents";
import { buildPrincipalContainerRematerializationBatch } from "../../workflows/organizations/principalContainerRematerialization";
import { createRuntimePrincipalPolicyWarmer } from "../../workflows/principals/runtimePolicyWarmer";
import type { InternalWorkflowRuntimeInput } from "../workflowRuntime";
import type { OrganizationReadModelCoordinator } from "./organizationReadModels";

export async function preparePrincipalContainerMutations(input: {
  readonly groupId: string;
  readonly nextPolicy: VerifiedPrincipalPolicy;
  readonly organizationId: string;
  readonly readModelCoordinator: OrganizationReadModelCoordinator;
  readonly revokedContainerId?: string | undefined;
  readonly runtime: InternalWorkflowRuntimeInput;
}) {
  // Snapshot before accepting the server's reconciliation result: anything
  // known locally but omitted afterward is evidence that the server supplied
  // an incomplete revoke/rematerialization set.
  const locallyKnown =
    await input.readModelCoordinator.loadLocalGroupContainers(
      input.groupId,
      input.organizationId,
    );
  const reconciled = await input.readModelCoordinator.reconcile(
    input.organizationId,
  );
  if (reconciled === undefined) {
    throw new Error(
      "Organization grants could not be reconciled before the group mutation",
    );
  }
  const granted = await input.readModelCoordinator.loadLocalGroupContainers(
    input.groupId,
    input.organizationId,
  );
  const author = resolveDocumentCreateAuthor(input.runtime);
  const targetSecretKey = input.runtime.crypto.encapsulationKeyPair?.secretKey;
  if (!granted || !author || !targetSecretKey) {
    throw new Error(
      "Organization container rematerialization context is unavailable",
    );
  }
  return buildPrincipalContainerRematerializationBatch({
    apiClient: input.runtime.apiClient,
    author,
    execSql: input.runtime.infra.execSql,
    grants: granted.containers,
    groupId: input.groupId,
    locallyKnownContainerIds: locallyKnown?.containers.map(
      (container) => container.containerId,
    ),
    nextPolicy: input.nextPolicy,
    revokedContainerId: input.revokedContainerId,
    resolveTrustedUserIdentity: input.runtime.resolveTrustedUserIdentity,
    targetSecretKey,
    warmReferencedPrincipalPolicies: createRuntimePrincipalPolicyWarmer(
      input.runtime,
    ),
  });
}
