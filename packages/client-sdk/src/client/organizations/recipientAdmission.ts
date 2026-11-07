import type { ContainerAccessLevel } from "@tearleads/crypto";
import { runWithSecurityIncidentReporting } from "../../data/keyingProjectionVerification/error";
import { assertProjectionVerificationCurrent } from "../../data/keyingProjectionVerification/types";
import { requireOrganizationGroupHead } from "../../data/principals/organizationAuthorityDescriptor";
import type { SecurityIncidentReporter } from "../../data/shared/securityIncidents";
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
 * Whether the signed roster vouches for `userId` on this device. First sight
 * pins the keys the server serves as observed, and the roster must then vouch
 * for exactly that encryption key. Served material that fails verification is
 * recorded as a security incident before the error propagates.
 */
export function isReportedRosterVouchedRecipient(input: {
  readonly evidence: RosterAdmissionEvidence;
  readonly organizationId: string;
  readonly reportSecurityIncident: SecurityIncidentReporter;
  readonly resolveTrustedUserIdentity: (userId: string) => Promise<unknown>;
  readonly userId: string;
}): Promise<boolean> {
  const { evidence, userId } = input;
  return runWithSecurityIncidentReporting(
    input.reportSecurityIncident,
    {
      objectId: userId,
      objectKind: "user",
      operation: "container.share.roster_vouch",
      organizationId: input.organizationId,
    },
    async () =>
      Boolean(await input.resolveTrustedUserIdentity(userId)) &&
      isRosterVouchedRecipient(userId, evidence),
  );
}

/**
 * Admits a folder share recipient, against the trust store of the database
 * the admitting runtime writes: a pin that a verified identity link or this
 * device's own keys established, or, for a read share only, the active
 * organization's signed roster vouching for their encryption key
 * (`isRosterVouchedRecipient`). Vouching never authenticates the recipient's
 * signing key, so it cannot back write or admin access, whose signed actions
 * would be checked against that key. Throws the original
 * `UnverifiedUserIdentityError` when nothing admits.
 */
export async function requireShareRecipient(
  service: AdmissionRuntimeService,
  admittingExecSql: ExecSql,
  userId: string,
  accessLevel: ContainerAccessLevel,
): Promise<void> {
  try {
    await service.identityLinks.requireVerified(userId, admittingExecSql);
  } catch (error) {
    const runtime = service.workflowInput();
    const organizationId = runtime.auth.organizationId;
    if (
      !(error instanceof UnverifiedUserIdentityError) ||
      accessLevel !== "read" ||
      !organizationId
    )
      throw error;
    const evidence = createRosterAdmissionEvidence(
      service,
      admittingExecSql,
      organizationId,
    );
    if (!evidence) throw error;
    const vouched = await isReportedRosterVouchedRecipient({
      evidence,
      organizationId,
      reportSecurityIncident: runtime.util.reportSecurityIncident,
      resolveTrustedUserIdentity: runtime.resolveTrustedUserIdentity,
      userId,
    });
    if (!vouched) throw error;
  }
}
