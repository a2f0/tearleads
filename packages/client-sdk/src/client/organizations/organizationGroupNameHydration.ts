import { loadLocalOrganizationPolicyReference } from "../../workflows/organizations";
import { createSelectedCurrentGroupMetadataContainerVerifier } from "../../workflows/organizations/groupMetadata/currentGroupMetadataAuthority";
import { createRuntimeGroupMetadataAccess } from "../../workflows/organizations/groupMetadata/groupMetadataRuntime";
import { hydrateOrganizationGroupNames } from "../../workflows/organizations/groupNames/organizationGroupNames";
import type { OrganizationDirectoryAndGroups } from "../../workflows/organizations/readModel";
import type { ActiveOrganizationDataRuntime } from "./organizationWorkflowRuntime";

export async function hydrateOrganizationGroupNamesForRuntime(
  active: ActiveOrganizationDataRuntime,
  /** The reconcile pass's session guard; its loads commit only under it. */
  stillCurrent: () => boolean,
  directoryAndGroups: OrganizationDirectoryAndGroups | null | undefined,
) {
  if (directoryAndGroups && active.runtime.crypto.encapsulationKeyPair) {
    // Labels and their metadata root belong to this one reconciliation view.
    const currentRecovery = {
      resolveCurrentPolicy:
        active.runtime.principalPolicies.createCurrentPolicyResolver(),
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
        stillCurrent,
      }),
      reportSecurityIncident: active.runtime.util.reportSecurityIncident,
      createCurrentNameReader: (authority) =>
        createRuntimeGroupMetadataAccess(
          active.runtime,
          active.organizationId,
          stillCurrent,
          createSelectedCurrentGroupMetadataContainerVerifier({
            authority,
            organizationId: active.organizationId,
            stillCurrent,
          }),
        ).readName,
      readEncryptedName: createRuntimeGroupMetadataAccess(
        active.runtime,
        active.organizationId,
        stillCurrent,
        undefined,
        currentRecovery,
      ).readName,
      resolveTrustedUserIdentity: active.runtime.resolveTrustedUserIdentity,
      ...currentRecovery,
      stillCurrent,
    });
  }
  return directoryAndGroups;
}
