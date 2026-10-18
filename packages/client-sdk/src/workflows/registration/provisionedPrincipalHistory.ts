import type { PrincipalPolicyHistoryProgressOptions } from "@tearleads/crypto";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import { assertProjectionVerificationCurrent } from "../../data/keyingProjectionVerification/types";
import type { PrincipalHistoryProtectionLease } from "../../data/principals/principalHistoryProtection";
import { principalPolicyReferenceFromBundle } from "../../data/principals/principalPolicyAdminSigners";
import type { ExecSql, ExecSqlClientLike } from "../../data/sqlite/sqlSchema";
import type {
  TrustedUserIdentity,
  TrustedUserIdentityResolver,
} from "../../data/trustedUserIdentity";
import { createPrincipalCurrentRecoveryBatch } from "../principals/principalCurrentRecoveryBatch";
import type { PrincipalPolicyPageReader } from "../principals/principalPolicyHistoryReader";
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
 * It is bound to the provisioning scope: the database the bootstrap committed
 * to and the identity that signed it. Failure leaves the online path.
 */
export type ProvisionedPrincipalHistoryPrimer = (input: {
  /** The database client the provisioning bootstrap committed to. */
  readonly database: ExecSqlClientLike;
  /** Whether the identity that provisioned is still the active one. */
  readonly isCurrent: () => boolean;
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
): PrincipalPolicyPageReader {
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
    historyReader: provisionedPolicyPages(input.policies),
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

/** The runtime seams priming reads; none of them writes durable state. */
interface ProvisionedPrincipalHistoryRuntime {
  readonly bindLease: () => PrincipalHistoryProtectionLease | undefined;
  /** The runtime executor, only while `database` is its ready database. */
  readonly execSqlFor: (database: ExecSqlClientLike) => ExecSql | null;
  readonly logError: (message: string | Error, cause?: unknown) => void;
  /** Read-only: the identity the trust store already pins for a user. */
  readonly loadPinnedIdentity: (
    execSql: ExecSql,
    userId: string,
  ) => Promise<TrustedUserIdentity | null>;
  readonly signingFingerprint: () => string | null;
}

/**
 * Binds priming to the exact provisioning scope, captured before any await:
 * the bootstrap's database and runtime executor, the identity whose key signed
 * the founding states, and a protection lease for that identity. Every later
 * step, and every progress write inside its transaction, rechecks that scope,
 * so a switched identity or database aborts priming without a durable write.
 * Priming never writes a trust pin; it only reads the founder's existing one.
 */
export function createProvisionedPrincipalHistoryPrimer(
  runtime: ProvisionedPrincipalHistoryRuntime,
): ProvisionedPrincipalHistoryPrimer {
  return async (input) => {
    try {
      await primeInProvisioningScope(runtime, input);
    } catch (error) {
      runtime.logError(
        "Provisioned principal history was not primed; recovery reads it online",
        error,
      );
    }
  };
}

async function primeInProvisioningScope(
  runtime: ProvisionedPrincipalHistoryRuntime,
  input: Parameters<ProvisionedPrincipalHistoryPrimer>[0],
): Promise<void> {
  // Everything below is captured synchronously, before the first await.
  const founderFingerprint =
    input.policies.organization.currentState.signerUserKeyFingerprint;
  const execSql = runtime.execSqlFor(input.database);
  const scopeCurrent = () =>
    execSql !== null &&
    input.isCurrent() &&
    runtime.execSqlFor(input.database) === execSql &&
    runtime.signingFingerprint() === founderFingerprint;
  const lease = scopeCurrent() ? runtime.bindLease() : undefined;
  if (!execSql || !lease) return;
  const resolveTrustedUserIdentity: TrustedUserIdentityResolver = async (
    signerUserId,
  ) => {
    if (signerUserId !== input.userId) return null;
    assertProjectionVerificationCurrent(scopeCurrent);
    const identity = await runtime.loadPinnedIdentity(execSql, input.userId);
    assertProjectionVerificationCurrent(scopeCurrent);
    return identity?.signingKeyFingerprint === founderFingerprint
      ? identity
      : null;
  };
  await queuePrincipalRecovery(execSql, input.organizationId, () =>
    lease(({ protection, stillCurrent }) =>
      primeProvisionedPrincipalHistory({
        execSql,
        organizationId: input.organizationId,
        policies: input.policies,
        protection,
        resolveTrustedUserIdentity,
        // Progress writes check this inside their transactions.
        stillCurrent: () => stillCurrent() && scopeCurrent(),
      }),
    ),
  );
}
