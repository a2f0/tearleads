import { recoverOrganizationAccess } from "../../workflows/container-contents/recovery/accessRestoration";
import type { OrganizationDirectoryAndGroups } from "../../workflows/organizations";
import { withVerifiedLeaveRequests } from "../../workflows/organizations";
import { wasOrganizationPresentationAccessDeniedByServer } from "../../workflows/organizations/readModel/organizationPresentationAccessState";
import type { InternalRuntime } from "../runtime/workflowRuntime";
import { hydrateOrganizationGroupNamesForRuntime } from "./organizationGroupNameHydration";
import { leaveRequestVerifier } from "./organizationLeaveRequestVerifier";
import {
  type ActiveOrganizationDataRuntime,
  isOrganizationDataRuntimeCurrent,
} from "./organizationWorkflowRuntime";

/**
 * Run one read-model pass for the scope, then present what it applied: access
 * recovery when the pass restored a server-denied scope, group names, and
 * verified leave requests. A superseded pass resolves without a result.
 */
export function presentOrganizationReadModelPass(
  runtimeService: InternalRuntime,
  active: ActiveOrganizationDataRuntime,
  pass: () => Promise<OrganizationDirectoryAndGroups | null | undefined>,
  passIsCurrent: () => boolean = () => true,
): Promise<OrganizationDirectoryAndGroups | null | undefined> {
  // Snapshot the server-denied flag before reconciling. A reconcile that
  // flips it back to readable means org access was just restored (e.g. the
  // user was re-added to a group), and any write lanes idled by
  // permission-denied submissions have no self re-arm — regaining access is
  // their retry signal, mirroring how billing recovery re-requests all
  // lanes. Only a genuine server denial counts: a local session reset also
  // marks scopes denied, and re-arming on its first reconcile would race the
  // startup sync passes (e.g. pending-create adoption between panes).
  const accessWasDenied = wasOrganizationPresentationAccessDeniedByServer(
    {
      execSql: active.runtime.infra.execSql,
      organizationId: active.organizationId,
      requesterUserId: active.userId,
    },
    "readModel",
  );
  const domainScope = active.runtime.state.domainScope;
  const stillCurrent = () =>
    isOrganizationDataRuntimeCurrent(runtimeService, active, domainScope) &&
    passIsCurrent();

  const obsolete = () =>
    runtimeService.workflowInput().state.domainScope === domainScope
      ? null
      : undefined;
  return pass().then(async (directoryAndGroups) => {
    if (!stillCurrent()) return obsolete();
    // Feed success restores retry eligibility even if name decryption fails.
    const accessWasRestored =
      accessWasDenied &&
      directoryAndGroups !== null &&
      directoryAndGroups !== undefined;
    if (accessWasRestored)
      await recoverOrganizationAccess({
        domainScope,
        execSql: active.runtime.infra.execSql,
        organizationId: active.organizationId,
        stillCurrent,
        userId: active.userId,
      });
    if (!stillCurrent()) return obsolete();
    const presented = await withVerifiedLeaveRequests(
      await hydrateOrganizationGroupNamesForRuntime(
        runtimeService,
        active,
        domainScope,
        directoryAndGroups,
      ),
      leaveRequestVerifier(runtimeService, active.runtime, active),
    );
    // A transition during presentation publishes nothing for the old scope.
    return stillCurrent() ? presented : obsolete();
  });
}
