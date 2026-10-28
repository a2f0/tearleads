import type { OrganizationLeaveRequestMembersHead } from "@tearleads/validators/util";
import { ProjectionDependencyUnavailableError } from "../../../data/keyingProjectionVerification/dependencyUnavailable";
import { assertProjectionVerificationCurrent } from "../../../data/keyingProjectionVerification/types";
import { requireOrganizationGroupHead } from "../../../data/principals/organizationAuthorityDescriptor";
import {
  createRuntimePrincipalPolicyCurrentResolver,
  type PrincipalPolicyRecoveryRuntime,
} from "../../principals/runtimePolicyRecovery";
import { loadCurrentOrganizationAuthority } from "../currentOrganizationAuthority";
import { loadLocalOrganizationPolicyReference } from "../readModel/localReadModelDetails";
import {
  createLeaveRequestMembershipCheck,
  type LeaveRequestMembershipCheck,
} from "./leaveRequestMembership";

interface MembersEvidenceInput {
  readonly runtime: PrincipalPolicyRecoveryRuntime;
  readonly organizationId: string;
  readonly stillCurrent: () => boolean;
}

/**
 * The organization's current Members head as the member's own device
 * discovers and verifies it now, for a leave request to cite.
 */
export async function loadCurrentMembersHead(
  input: MembersEvidenceInput,
): Promise<OrganizationLeaveRequestMembersHead> {
  const resolveCurrentPolicy = createRuntimePrincipalPolicyCurrentResolver(
    input.runtime,
  );
  if (!resolveCurrentPolicy)
    throw new ProjectionDependencyUnavailableError(
      "Asking to leave requires private paged recovery",
    );
  const authority = await loadCurrentOrganizationAuthority({
    execSql: input.runtime.infra.execSql,
    organizationId: input.organizationId,
    resolveCurrentPolicy,
    stillCurrent: input.stillCurrent,
  });
  assertProjectionVerificationCurrent(authority.stillCurrent);
  const head = requireOrganizationGroupHead(
    authority.descriptor,
    authority.descriptor.memberGroupId,
  );
  return {
    keyEpoch: head.keyEpoch,
    keyFingerprint: head.keyFingerprint,
    principalId: head.principalId,
    stateHash: head.stateHash,
    version: head.version,
  };
}

/**
 * Checks leave requests against the Members head in the organization policy
 * this device's read model selected, verified exactly through the private
 * paged verifier (from local evidence when it has it), and walks verified
 * Members history the same way when a request cites an earlier key epoch.
 */
export function createRuntimeLeaveRequestMembershipCheck(
  input: MembersEvidenceInput & { readonly currentUserId: string },
): LeaveRequestMembershipCheck {
  const resolve = createRuntimePrincipalPolicyCurrentResolver(input.runtime);
  return createLeaveRequestMembershipCheck({
    async loadMembersHead() {
      if (!resolve) return null;
      const organizationReference = await loadLocalOrganizationPolicyReference({
        currentUserId: input.currentUserId,
        execSql: input.runtime.infra.execSql,
        organizationId: input.organizationId,
        principalId: input.organizationId,
        principalType: "organization",
      });
      if (!organizationReference) return null;
      const authority = await loadCurrentOrganizationAuthority({
        execSql: input.runtime.infra.execSql,
        organizationId: input.organizationId,
        organizationReference,
        resolveCurrentPolicy: resolve,
        stillCurrent: input.stillCurrent,
      });
      assertProjectionVerificationCurrent(authority.stillCurrent);
      return requireOrganizationGroupHead(
        authority.descriptor,
        authority.descriptor.memberGroupId,
      );
    },
    loadHistoryPage: resolve
      ? async (head, beforeVersion) => {
          const resolved = await resolve({
            organizationId: input.organizationId,
            reference: head,
            preferLocalCurrent: true,
            stillCurrent: input.stillCurrent,
            historyPage: beforeVersion === undefined ? {} : { beforeVersion },
          });
          assertProjectionVerificationCurrent(resolved.stillCurrent);
          if (!resolved.historyPage)
            throw new Error("Verified Members history page is missing");
          return resolved.historyPage;
        }
      : undefined,
  });
}
