import type { DomainScope } from "../../data/domainScope";
import { loadLocalOrganizationPolicyReference } from "../../workflows/organizations";
import { createRuntimeGroupMetadataAccess } from "../../workflows/organizations/groupMetadataRuntime";
import { hydrateOrganizationGroupNames } from "../../workflows/organizations/organizationGroupNames";
import type { OrganizationDirectoryAndGroups } from "../../workflows/organizations/readModel";
import { createRuntimePrincipalPolicyCurrentResolver } from "../../workflows/principals/runtimePolicyRecovery";
import type { InternalRuntime } from "../workflowRuntime";
import {
  type ActiveOrganizationDataRuntime,
  isOrganizationDataRuntimeCurrent,
} from "./organizationWorkflowRuntime";

export async function hydrateOrganizationGroupNamesForRuntime(
  runtimeService: InternalRuntime,
  active: ActiveOrganizationDataRuntime,
  domainScope: DomainScope,
  directoryAndGroups: OrganizationDirectoryAndGroups | null | undefined,
) {
  if (directoryAndGroups && active.runtime.crypto.encapsulationKeyPair) {
    const stillCurrent = () =>
      isOrganizationDataRuntimeCurrent(runtimeService, active, domainScope);
    // Labels and their metadata root belong to this one reconciliation view.
    const currentRecovery = {
      resolveCurrentPolicy: createRuntimePrincipalPolicyCurrentResolver(
        active.runtime,
      ),
      recoveryBatch: {},
    };
    return hydrateOrganizationGroupNames({
      apiClient: active.runtime.apiClient,
      directory: directoryAndGroups,
      execSql: active.runtime.infra.execSql,
      organizationId: active.organizationId,
      organizationPolicyReference: await loadLocalOrganizationPolicyReference({
        currentUserId: active.userId,
        execSql: active.runtime.infra.execSql,
        organizationId: active.organizationId,
        principalId: active.organizationId,
        principalType: "organization",
      }),
      reportSecurityIncident: active.runtime.util.reportSecurityIncident,
      readEncryptedName: createRuntimeGroupMetadataAccess(
        active.runtime,
        active.organizationId,
        stillCurrent,
        currentRecovery,
      ).readName,
      resolveTrustedUserIdentity: active.runtime.resolveTrustedUserIdentity,
      ...currentRecovery,
      stillCurrent,
    });
  }
  return directoryAndGroups;
}
