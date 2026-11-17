import { assertProjectionVerificationCurrent } from "../../../data/keyingProjectionVerification/types";
import { KeyingCheckpointRepository } from "../../../data/persistence/keyingCheckpoints/keyingCheckpointRepository";
import type { TrustedUserIdentityResolver } from "../../../data/trustedUserIdentity";
import {
  createCurrentPrincipalMutationLease,
  type PrincipalPolicyRuntime,
} from "../../principals/principalPolicyService";
import type { loadCurrentOrganizationAuthority } from "../currentOrganizationAuthority";
import { loadCurrentOrganizationMutationAuthority } from "./currentOrganizationMutationAuthority";
import { createCurrentOrganizationMutationRetention } from "./currentOrganizationMutationRetention";
import type { PrincipalMutationRecoveryApi } from "./principalMutationJournalManagement";

type Runtime = PrincipalPolicyRuntime & {
  readonly apiClient: Pick<
    PrincipalMutationRecoveryApi,
    "recoverPendingPrincipalMutation"
  >;
  readonly resolveTrustedUserIdentity: TrustedUserIdentityResolver;
};

interface Input {
  readonly organizationId: string;
  readonly signerUserId: string;
  readonly stillCurrent: () => boolean;
}

type Authority = Awaited<ReturnType<typeof loadCurrentOrganizationAuthority>>;

export type CurrentOrganizationMutationContext = Authority &
  Awaited<ReturnType<typeof createCurrentOrganizationMutationRetention>>;

/** Keep directory authoring and exact acknowledgement inside one private lease. */
export function createRuntimeCurrentOrganizationMutation(runtime: Runtime) {
  const lease = createCurrentPrincipalMutationLease(runtime.principalPolicies);
  if (!lease) return undefined;
  return async <T>(
    input: Input,
    work: (context: CurrentOrganizationMutationContext) => Promise<T>,
  ): Promise<T> => {
    const owned = { ...input };
    return lease(
      owned.stillCurrent,
      async ({
        protection,
        historyReader,
        stillCurrent,
        resolveCurrentPolicy,
        directoryRecovery,
      }) => {
        const { authority } = await loadCurrentOrganizationMutationAuthority({
          execSql: runtime.infra.execSql,
          organizationId: owned.organizationId,
          signerUserId: owned.signerUserId,
          recoverPendingPrincipalMutation: (organizationId) =>
            runtime.apiClient.recoverPendingPrincipalMutation(organizationId),
          resolveCurrentPolicy,
          stillCurrent,
        });
        const current = () => stillCurrent() && authority.stillCurrent();
        await new KeyingCheckpointRepository(
          runtime.infra.execSql,
        ).advanceKeyingCheckpointsAtomically({
          access: [],
          organizationId: owned.organizationId,
          policies: [authority.directory.policy, authority.admins.policy],
          stillCurrent: current,
        });
        const result = await work({
          ...authority,
          stillCurrent: current,
          ...(await createCurrentOrganizationMutationRetention({
            runtime,
            authority,
            protection,
            historyReader,
            organizationId: owned.organizationId,
            directoryRecovery: directoryRecovery(authority.directory.current),
            stillCurrent: current,
          })),
        });
        assertProjectionVerificationCurrent(current);
        return result;
      },
    );
  };
}
