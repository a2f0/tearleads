import type { ApiClient } from "@tearleads/api-client";
import type { PrincipalPolicyHistoryProgressOptions } from "@tearleads/crypto";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import type { PrincipalHistoryProtectionLease } from "../../data/principals/principalHistoryProtection";
import { principalPolicyReferenceFromBundle } from "../../data/principals/principalPolicyAdminSigners";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import type {
  LocalUserIdentityCandidate,
  TrustedUserIdentity,
  TrustedUserIdentityResolver,
} from "../../data/trustedUserIdentity";
import { createPrincipalCurrentRecoveryBatch } from "../principals/principalCurrentRecoveryBatch";
import { queuePrincipalRecovery } from "../principals/principalRecoveryQueue";

/** The version-1 policies a provisioning request signed and its response acknowledged. */
interface ProvisionedPrincipalPolicies {
  readonly adminGroup: PrincipalPolicyBundleResponse;
  readonly memberGroup: PrincipalPolicyBundleResponse;
  readonly organization: PrincipalPolicyBundleResponse;
}

/**
 * Records verified recovery progress for an organization's founding policy
 * heads, so the device's first scoped recovery of them needs no history read.
 * Failure leaves the ordinary online recovery in place.
 */
export type ProvisionedPrincipalHistoryPrimer = (input: {
  readonly organizationId: string;
  readonly policies: ProvisionedPrincipalPolicies;
  readonly userId: string;
}) => Promise<void>;

/**
 * Serves only the acknowledged initial heads, each complete in one page. The
 * ordinary verifier still checks every signature, the directory binding and
 * strict Admins rules before any progress is saved.
 */
function provisionedPolicyPages(
  policies: ProvisionedPrincipalPolicies,
): Pick<ApiClient, "getPrincipalPolicyPages"> {
  const bundles = [
    policies.organization,
    policies.adminGroup,
    policies.memberGroup,
  ];
  return {
    async *getPrincipalPolicyPages(principalType, principalId, options = {}) {
      const bundle = bundles.find(
        ({ currentState }) =>
          currentState.principalType === principalType &&
          currentState.principalId === principalId,
      );
      if (
        !bundle ||
        options.resume !== undefined ||
        (options.afterVersion ?? 0) !== 0 ||
        (options.stateHash !== undefined &&
          options.stateHash !== bundle.currentState.stateHash)
      )
        throw new Error(
          "Provisioned principal history holds only the acknowledged initial heads",
        );
      yield {
        ok: true,
        data: {
          ...structuredClone(bundle),
          historyPage: { afterVersion: 0, nextAfterVersion: null },
        },
      };
    },
  };
}

async function primeProvisionedPrincipalHistory(input: {
  readonly execSql: ExecSql;
  readonly organizationId: string;
  readonly policies: ProvisionedPrincipalPolicies;
  readonly protection: PrincipalPolicyHistoryProgressOptions;
  readonly resolveTrustedUserIdentity: TrustedUserIdentityResolver;
  readonly stillCurrent: () => boolean;
}): Promise<void> {
  const { recover } = createPrincipalCurrentRecoveryBatch();
  const options = {
    apiClient: provisionedPolicyPages(input.policies),
    execSql: input.execSql,
    offline: false,
    organizationId: input.organizationId,
    protection: input.protection,
    resolveTrustedUserIdentity: input.resolveTrustedUserIdentity,
    stillCurrent: input.stillCurrent,
  };
  // Scoped recovery of each group also completes the directory and strict
  // Admins stages; Members reuses them through the shared batch.
  for (const group of [input.policies.adminGroup, input.policies.memberGroup])
    await recover({
      ...options,
      reference: principalPolicyReferenceFromBundle(group),
    });
}

/** Binds priming to the runtime's history custody and the founder's own keys. */
export function createProvisionedPrincipalHistoryPrimer(dependencies: {
  readonly bindLease: () => PrincipalHistoryProtectionLease | undefined;
  readonly execSql: () => ExecSql | null;
  readonly localIdentity: () => LocalUserIdentityCandidate | null;
  readonly logError: (message: string | Error, cause?: unknown) => void;
  readonly pinLocalUserIdentity: (
    userId: string,
    candidate: LocalUserIdentityCandidate,
  ) => Promise<TrustedUserIdentity>;
}): ProvisionedPrincipalHistoryPrimer {
  return async ({ organizationId, policies, userId }) => {
    try {
      const lease = dependencies.bindLease();
      const execSql = dependencies.execSql();
      const candidate = dependencies.localIdentity();
      if (!lease || !execSql || !candidate) return;
      // The founder signed every provisioned state with these keys and has
      // just pinned them; no other signer can appear in this history.
      const resolveTrustedUserIdentity: TrustedUserIdentityResolver = async (
        signerUserId,
      ) =>
        signerUserId === userId
          ? dependencies.pinLocalUserIdentity(userId, candidate)
          : null;
      await queuePrincipalRecovery(execSql, organizationId, () =>
        lease(({ protection, stillCurrent }) =>
          primeProvisionedPrincipalHistory({
            execSql,
            organizationId,
            policies,
            protection,
            resolveTrustedUserIdentity,
            stillCurrent,
          }),
        ),
      );
    } catch (error) {
      dependencies.logError(
        "Provisioned principal history was not primed; recovery reads it online",
        error,
      );
    }
  };
}
