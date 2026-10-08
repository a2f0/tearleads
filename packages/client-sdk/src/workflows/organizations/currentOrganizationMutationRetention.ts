import type { ApiClient } from "@tearleads/api-client";
import type { PrincipalPolicyHistoryProgressOptions } from "@tearleads/crypto";
import type { PutPrincipalPolicyRequest } from "@tearleads/validators/request";
import type { PrincipalPolicyMutationResponse } from "@tearleads/validators/response";
import { assertProjectionVerificationCurrent } from "../../data/keyingProjectionVerification/types";
import { scopedGroupHistoryProtection } from "../../data/principals/principalHistoryScopeProtection";
import { principalPolicyReferenceFromBundle } from "../../data/principals/principalPolicyAdminSigners";
import type { PrincipalPolicyRecoveryRuntime } from "../principals/runtimePolicyRecovery";
import type { loadCurrentOrganizationAuthority } from "./currentOrganizationAuthority";
import {
  type AcknowledgedPrincipalCurrentInput,
  retainAcknowledgedPrincipalCurrents,
} from "./retainAcknowledgedPrincipalCurrents";

/** Couple directory acknowledgements to any newly created group under the same lease. */
export function createCurrentOrganizationMutationRetention(input: {
  readonly runtime: PrincipalPolicyRecoveryRuntime;
  readonly authority: Awaited<
    ReturnType<typeof loadCurrentOrganizationAuthority>
  >;
  readonly protection: PrincipalPolicyHistoryProgressOptions;
  readonly readPages: ApiClient["getPrincipalPolicyPages"];
  readonly organizationId: string;
  readonly directoryRecovery: AcknowledgedPrincipalCurrentInput["recovery"];
  readonly stillCurrent: () => boolean;
}) {
  const retain = async (
    entries: readonly AcknowledgedPrincipalCurrentInput[],
  ) => {
    assertProjectionVerificationCurrent(input.stillCurrent);
    await retainAcknowledgedPrincipalCurrents({
      execSql: input.runtime.infra.execSql,
      organizationId: input.organizationId,
      entries,
      stillCurrent: input.stillCurrent,
    });
  };
  return {
    retainDirectory: (
      request: PutPrincipalPolicyRequest,
      response: PrincipalPolicyMutationResponse,
    ) => retain([{ request, response, recovery: input.directoryRecovery }]),
    retainCreatedGroup: (receipt: {
      readonly request: PutPrincipalPolicyRequest;
      readonly response: PrincipalPolicyMutationResponse;
      readonly organizationRequest: PutPrincipalPolicyRequest;
      readonly organizationResponse: PrincipalPolicyMutationResponse;
    }) => {
      const adminHead = {
        ...principalPolicyReferenceFromBundle(input.authority.admins.current),
        principalType: "group" as const,
      };
      return retain([
        {
          initialGroup: true,
          request: receipt.request,
          response: receipt.response,
          recovery: {
            apiClient: { getPrincipalPolicyPages: input.readPages },
            expectedHead: principalPolicyReferenceFromBundle(receipt.response),
            protection: scopedGroupHistoryProtection(
              input.protection,
              input.organizationId,
              input.authority.descriptor.adminGroupId,
            ),
            resolveTrustedUserIdentity:
              input.runtime.resolveTrustedUserIdentity,
            loadExternalAuthority: async () => ({
              currentHead: adminHead,
              states: [
                {
                  head: adminHead,
                  projection: input.authority.admins.policy.projection,
                },
              ],
            }),
          },
        },
        {
          request: receipt.organizationRequest,
          response: receipt.organizationResponse,
          recovery: input.directoryRecovery,
        },
      ]);
    },
  };
}
