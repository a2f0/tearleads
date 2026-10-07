import type { PutPrincipalPolicyRequest } from "@tearleads/validators/request";
import type { PrincipalPolicyMutationResponse } from "@tearleads/validators/response";
import { assertProjectionVerificationCurrent } from "../../data/keyingProjectionVerification/types";
import { advanceKeyingCheckpointsAtomically } from "../../data/persistence/keyingCheckpointAdvancePersistence";
import { readPrincipalHistoryProtection } from "../../data/principals/principalHistoryRuntime";
import { directoryHistoryProtection } from "../../data/principals/principalHistoryScopeProtection";
import { principalPolicyReferenceFromBundle } from "../../data/principals/principalPolicyAdminSigners";
import {
  createRuntimePrincipalPolicyCurrentResolver,
  type PrincipalPolicyRecoveryRuntime,
} from "../principals/runtimePolicyRecovery";
import { createSelectedCurrentGroupMetadataContainerVerifier } from "./currentGroupMetadataAuthority";
import { loadCurrentOrganizationAuthority } from "./currentOrganizationAuthority";
import type { PrincipalMutationRecoveryApi } from "./principalMutationJournalManagement";
import { retainAcknowledgedPrincipalCurrents } from "./retainAcknowledgedPrincipalCurrents";

type Runtime = PrincipalPolicyRecoveryRuntime & {
  readonly apiClient: PrincipalPolicyRecoveryRuntime["apiClient"] &
    Pick<PrincipalMutationRecoveryApi, "recoverPendingPrincipalMutation">;
};

interface Input {
  readonly organizationId: string;
  readonly signerUserId: string;
  readonly stillCurrent: () => boolean;
}

type Authority = Awaited<ReturnType<typeof loadCurrentOrganizationAuthority>>;

export interface CurrentOrganizationMutationContext extends Authority {
  readonly verifyMetadataContainer: ReturnType<
    typeof createSelectedCurrentGroupMetadataContainerVerifier
  >;
  readonly retainDirectory: (
    request: PutPrincipalPolicyRequest,
    response: PrincipalPolicyMutationResponse,
  ) => Promise<void>;
}

/** Keep directory authoring and exact acknowledgement inside one private lease. */
export function createRuntimeCurrentOrganizationMutation(runtime: Runtime) {
  const lease = readPrincipalHistoryProtection(runtime);
  const resolveCurrentPolicy =
    createRuntimePrincipalPolicyCurrentResolver(runtime);
  const readPages = runtime.apiClient.getPrincipalPolicyPages?.bind(
    runtime.apiClient,
  );
  if (!lease || !resolveCurrentPolicy || !readPages) return undefined;
  return async <T>(
    input: Input,
    work: (context: CurrentOrganizationMutationContext) => Promise<T>,
  ): Promise<T> => {
    const owned = { ...input };
    return lease(async ({ protection, stillCurrent: leaseCurrent }) => {
      let active = true;
      const stillCurrent = () =>
        active && leaseCurrent() && owned.stillCurrent();
      try {
        assertProjectionVerificationCurrent(stillCurrent);
        await runtime.apiClient.recoverPendingPrincipalMutation(
          owned.organizationId,
        );
        assertProjectionVerificationCurrent(stillCurrent);
        const authority = await loadCurrentOrganizationAuthority({
          execSql: runtime.infra.execSql,
          organizationId: owned.organizationId,
          resolveCurrentPolicy,
          stillCurrent,
        });
        if (
          !authority.admins.policy.projection.some(
            (member) =>
              member.userId === owned.signerUserId && member.role === "admin",
          )
        )
          throw new Error("Organization admin authority is required");
        const current = () => stillCurrent() && authority.stillCurrent();
        await advanceKeyingCheckpointsAtomically({
          access: [],
          execSql: runtime.infra.execSql,
          organizationId: owned.organizationId,
          policies: [authority.directory.policy, authority.admins.policy],
          stillCurrent: current,
        });
        const result = await work({
          ...authority,
          stillCurrent: current,
          verifyMetadataContainer:
            createSelectedCurrentGroupMetadataContainerVerifier({
              authority,
              organizationId: owned.organizationId,
              stillCurrent: current,
            }),
          retainDirectory: async (request, response) => {
            assertProjectionVerificationCurrent(current);
            await retainAcknowledgedPrincipalCurrents({
              execSql: runtime.infra.execSql,
              organizationId: owned.organizationId,
              entries: [
                {
                  request,
                  response,
                  recovery: {
                    apiClient: { getPrincipalPolicyPages: readPages },
                    expectedHead: principalPolicyReferenceFromBundle(
                      authority.directory.current,
                    ),
                    protection: directoryHistoryProtection(protection),
                    resolveTrustedUserIdentity:
                      runtime.resolveTrustedUserIdentity,
                  },
                },
              ],
              stillCurrent: current,
            });
          },
        });
        assertProjectionVerificationCurrent(current);
        return result;
      } finally {
        active = false;
      }
    });
  };
}
