import { createRuntimeLeaveRequestMembershipCheck } from "../../workflows/organizations/memberships/leaveRequestMembersEvidence";
import type { LeaveRequestVerifier } from "../../workflows/organizations/memberships/leaveRequestVerification";
import type {
  InternalRuntime,
  InternalWorkflowRuntimeInput,
} from "../runtime/workflowRuntime";

/**
 * What one view's leave requests are checked against. The signer comes from
 * the device's durable pin first, so a request already stored still verifies
 * offline, then a trusted remote resolution for a member not pinned yet. The
 * membership comes from this device's verified organization policy.
 */
export function leaveRequestVerifier(
  runtimeService: InternalRuntime,
  runtime: InternalWorkflowRuntimeInput,
  organization: { readonly organizationId: string; readonly userId: string },
): LeaveRequestVerifier {
  const { domainScope } = runtime.state;
  return {
    resolveTrustedUserIdentity: async (userId) =>
      (await runtimeService.identityLinks.resolvePinned(userId)) ??
      runtime.resolveTrustedUserIdentity(userId),
    membershipIsCurrent: createRuntimeLeaveRequestMembershipCheck({
      currentUserId: organization.userId,
      organizationId: organization.organizationId,
      runtime,
      stillCurrent: () =>
        runtimeService.workflowInput().state.domainScope === domainScope,
    }),
  };
}
