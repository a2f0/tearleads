import type { ApiClient } from "@tearleads/api-client";
import {
  computeUserIdentityBundleFingerprint,
  KeyingVerificationError,
} from "@tearleads/crypto";
import type {
  CurrentPrincipalMemberEnvelopesResponse,
  PrincipalStateResponse,
} from "@tearleads/validators/response";
import { assertProjectionVerificationCurrent } from "../../data/keyingProjectionVerification/types";
import { requireOrganizationGroupHead } from "../../data/principals/organizationAuthorityDescriptor";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { loadCurrentOrganizationAuthority } from "../../workflows/organizations/currentOrganizationAuthority";
import type { RosterAdmissionEvidence } from "../../workflows/organizations/memberships/rosterVouchedAdmission";
import { createRuntimePrincipalPolicyCurrentResolver } from "../../workflows/principals/runtimePolicyRecovery";
import type { InternalRuntime } from "../runtime/workflowRuntime";
import { currentOrganizationMutation } from "./principalMutationScope";

/**
 * The server's member envelopes for one state, or null when it has no such
 * state. A response that fails its schema or names another state is served
 * material failing verification, so it surfaces as a `KeyingVerificationError`
 * for incident reporting; other failures stay availability errors.
 */
export async function loadServedStateEnvelopes(
  reader: Pick<ApiClient, "getPrincipalMemberEnvelopesResult">,
  state: Pick<
    PrincipalStateResponse,
    "principalId" | "principalType" | "stateHash"
  >,
): Promise<CurrentPrincipalMemberEnvelopesResponse | null> {
  const result = await reader.getPrincipalMemberEnvelopesResult(
    state.principalType,
    state.principalId,
    state.stateHash,
  );
  if (result.ok) return result.data;
  if (result.kind === "http" && result.status === 404) return null;
  if (result.kind === "shape")
    throw new KeyingVerificationError("invalid_shape", result.message);
  result.report();
  throw new Error(result.message);
}

type AdmissionRuntimeService = Pick<
  InternalRuntime,
  "identityLinks" | "sessionGeneration" | "workflowInput"
>;

export function createRosterAdmissionEvidence(
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
        projection: members.current.currentProjection,
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
            identityBundleFingerprint:
              await computeUserIdentityBundleFingerprint(pin.identity),
            signingKeyFingerprint: pin.identity.signingKeyFingerprint,
            verified: pin.verified,
          }
        : null;
    },
    loadStateEnvelopes: (state) =>
      loadServedStateEnvelopes(runtime.apiClient, state),
  };
}
