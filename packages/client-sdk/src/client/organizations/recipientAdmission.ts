import { assertProjectionVerificationCurrent } from "../../data/keyingProjectionVerification/types";
import { requireOrganizationGroupHead } from "../../data/principals/organizationAuthorityDescriptor";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { UnverifiedUserIdentityError } from "../../data/trustedUserIdentity";
import { loadCurrentOrganizationAuthority } from "../../workflows/organizations/currentOrganizationAuthority";
import {
  isRosterVouchedRecipient,
  type RosterAdmissionEvidence,
} from "../../workflows/organizations/memberships/rosterVouchedAdmission";
import { createRuntimePrincipalPolicyCurrentResolver } from "../../workflows/principals/runtimePolicyRecovery";
import type { InternalRuntime } from "../runtime/workflowRuntime";
import { currentOrganizationMutation } from "./principalMutationScope";

type AdmissionRuntimeService = Pick<
  InternalRuntime,
  "identityLinks" | "sessionGeneration" | "workflowInput"
>;

function createRosterAdmissionEvidence(
  service: AdmissionRuntimeService,
  admittingExecSql: ExecSql,
  organizationId: string,
): RosterAdmissionEvidence | null {
  const { runtime, stillCurrent } = currentOrganizationMutation(service);
  const resolve = createRuntimePrincipalPolicyCurrentResolver(runtime);
  if (!resolve) return null;
  return {
    async loadCurrentMembers() {
      const authority = await loadCurrentOrganizationAuthority({
        execSql: runtime.infra.execSql,
        organizationId,
        resolveCurrentPolicy: resolve,
        stillCurrent,
      });
      const { memberGroupId } = authority.descriptor;
      const members = await authority.readGroup(memberGroupId);
      assertProjectionVerificationCurrent(members.stillCurrent);
      return {
        envelopes: members.current.currentMemberEnvelopes.envelopes,
        head: requireOrganizationGroupHead(authority.descriptor, memberGroupId),
      };
    },
    async loadHistoryPage(head, beforeVersion) {
      const resolved = await resolve({
        organizationId,
        reference: head,
        preferLocalCurrent: true,
        stillCurrent,
        historyPage: beforeVersion === undefined ? {} : { beforeVersion },
      });
      assertProjectionVerificationCurrent(resolved.stillCurrent);
      if (!resolved.historyPage)
        throw new Error("Verified Members history page is missing");
      return resolved.historyPage;
    },
    async loadPin(userId) {
      const pin = await service.identityLinks.loadAdmissionPin(
        userId,
        admittingExecSql,
      );
      return pin
        ? {
            encapsulationKeyFingerprint:
              pin.identity.encapsulationKeyFingerprint,
            signingKeyFingerprint: pin.identity.signingKeyFingerprint,
            verified: pin.verified,
          }
        : null;
    },
    loadStateEnvelopes: (state) =>
      runtime.apiClient.getPrincipalMemberEnvelopes(
        state.principalType,
        state.principalId,
        state.stateHash,
      ),
  };
}

/**
 * Admits a user as a folder or group recipient, against the trust store of the
 * database the admitting runtime writes: a pin that a verified identity link
 * or this device's own keys established, or else the active organization's
 * signed roster vouching for their encryption key (`isRosterVouchedRecipient`).
 * Throws the original `UnverifiedUserIdentityError` when neither admits.
 */
export async function requireAdmittedRecipient(
  service: AdmissionRuntimeService,
  admittingExecSql: ExecSql,
  userId: string,
): Promise<void> {
  try {
    await service.identityLinks.requireVerified(userId, admittingExecSql);
  } catch (error) {
    const runtime = service.workflowInput();
    const organizationId = runtime.auth.organizationId;
    if (!(error instanceof UnverifiedUserIdentityError) || !organizationId)
      throw error;
    const evidence = createRosterAdmissionEvidence(
      service,
      admittingExecSql,
      organizationId,
    );
    if (!evidence) throw error;
    // First sight pins the keys the server serves as observed; the roster
    // must then vouch for exactly that encryption key.
    if (!(await runtime.resolveTrustedUserIdentity(userId))) throw error;
    if (!(await isRosterVouchedRecipient(userId, evidence))) throw error;
  }
}
