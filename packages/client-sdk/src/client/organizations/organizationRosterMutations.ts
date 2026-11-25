import {
  type OrganizationDirectoryUser,
  setOrganizationRosterTwoFactorRequired,
  updateOrganizationRosterEntry,
  withVerifiedDirectoryUser,
} from "../../workflows/organizations";
import type { InternalRuntime } from "../runtime/workflowRuntime";
import { leaveRequestVerifier } from "./organizationLeaveRequestVerifier";
import { authenticatedOrganizationId } from "./organizationWorkflowRuntime";

/**
 * Callers store a roster response as directory state, so its leave request
 * passes the same check as one read from the read model.
 */
function verifiedDirectoryUser(
  runtimeService: InternalRuntime,
  runtime: ReturnType<InternalRuntime["workflowInput"]>,
  organizationId: string,
  user: OrganizationDirectoryUser | null,
) {
  return (
    user &&
    withVerifiedDirectoryUser(
      organizationId,
      user,
      leaveRequestVerifier(runtimeService, runtime, {
        organizationId,
        userId: runtime.auth.userId ?? "",
      }),
    )
  );
}

export async function updateActiveRosterEntry(
  runtimeService: InternalRuntime,
  userId: string,
  profileDocumentId: string | null,
) {
  const runtime = runtimeService.workflowInput();
  const organizationId = authenticatedOrganizationId(runtime);
  if (!organizationId || userId.length === 0) {
    return null;
  }
  const user = await updateOrganizationRosterEntry({
    apiClient: runtime.apiClient,
    organizationId,
    profileDocumentId,
    userId,
  });
  return verifiedDirectoryUser(runtimeService, runtime, organizationId, user);
}

/** An administrator sets whether a member must sign in with two-factor. */
export async function setActiveRosterTwoFactorRequired(
  runtimeService: InternalRuntime,
  userId: string,
  required: boolean,
) {
  const runtime = runtimeService.workflowInput();
  const organizationId = authenticatedOrganizationId(runtime);
  if (!organizationId || userId.length === 0) {
    return null;
  }
  const user = await setOrganizationRosterTwoFactorRequired({
    apiClient: runtime.apiClient,
    organizationId,
    required,
    userId,
  });
  return verifiedDirectoryUser(runtimeService, runtime, organizationId, user);
}
