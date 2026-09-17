import type { DomainScope } from "../../data/domainScope";
import { loadLocalOrganizationPolicyReference } from "../../workflows/organizations";
import { createRuntimeGroupMetadataAccess } from "../../workflows/organizations/groupMetadataRuntime";
import { hydrateOrganizationGroupNames } from "../../workflows/organizations/organizationGroupNames";
import type { OrganizationDirectoryAndGroups } from "../../workflows/organizations/readModel";
import type { InternalRuntime } from "../workflowRuntime";
import {
  type ActiveOrganizationDataRuntime,
  activeOrganizationDataRuntime,
} from "./organizationWorkflowRuntime";

export async function hydrateOrganizationGroupNamesForRuntime(
  runtimeService: InternalRuntime,
  active: ActiveOrganizationDataRuntime,
  domainScope: DomainScope,
  directoryAndGroups: OrganizationDirectoryAndGroups | null | undefined,
) {
  if (directoryAndGroups && active.runtime.crypto.encapsulationKeyPair) {
    const stillCurrent = () => {
      const current = activeOrganizationDataRuntime(
        runtimeService,
        active.organizationId,
      );
      return (
        current?.userId === active.userId &&
        current.runtime.state.domainScope === domainScope
      );
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
      readEncryptedName: createRuntimeGroupMetadataAccess(
        active.runtime,
        active.organizationId,
        stillCurrent,
      ).readName,
      resolveTrustedUserIdentity: active.runtime.resolveTrustedUserIdentity,
      stillCurrent,
    });
  }
  return directoryAndGroups;
}
