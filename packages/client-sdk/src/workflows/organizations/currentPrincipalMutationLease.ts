import type { PrincipalPolicyPageCurrent } from "@tearleads/api-client";
import type { PrincipalPolicyHistoryProgressOptions } from "@tearleads/crypto";
import { assertProjectionVerificationCurrent } from "../../data/keyingProjectionVerification/types";
import { readPrincipalHistoryProtection } from "../../data/principals/principalHistoryRuntime";
import { directoryHistoryProtection } from "../../data/principals/principalHistoryScopeProtection";
import { principalPolicyReferenceFromBundle } from "../../data/principals/principalPolicyAdminSigners";
import {
  apiPrincipalPolicyPageReader,
  type PrincipalPolicyPageReader,
} from "../principals/principalPolicyHistoryReader";
import {
  createRuntimePrincipalPolicyCurrentResolver,
  type PrincipalPolicyRecoveryRuntime,
} from "../principals/runtimePolicyRecovery";
import type { AcknowledgedPrincipalCurrentInput } from "./retainAcknowledgedPrincipalCurrents";

interface CurrentPrincipalMutationLeaseContext {
  readonly protection: PrincipalPolicyHistoryProgressOptions;
  readonly stillCurrent: () => boolean;
  readonly resolveCurrentPolicy: NonNullable<
    ReturnType<typeof createRuntimePrincipalPolicyCurrentResolver>
  >;
  readonly historyReader: PrincipalPolicyPageReader;
  readonly directoryRecovery: (
    current: PrincipalPolicyPageCurrent,
  ) => AcknowledgedPrincipalCurrentInput["recovery"];
}

type CurrentPrincipalMutationLease = <T>(
  callerCurrent: () => boolean,
  work: (context: CurrentPrincipalMutationLeaseContext) => Promise<T>,
) => Promise<T>;

/** One lifetime fence and private custody boundary for every current-policy mutation. */
export function createCurrentPrincipalMutationLease(
  runtime: PrincipalPolicyRecoveryRuntime,
): CurrentPrincipalMutationLease | undefined {
  const lease = readPrincipalHistoryProtection(runtime);
  const resolveCurrentPolicy =
    createRuntimePrincipalPolicyCurrentResolver(runtime);
  const historyReader = apiPrincipalPolicyPageReader(runtime.apiClient);
  if (!lease || !resolveCurrentPolicy || !historyReader) return undefined;
  return async <T>(
    callerCurrent: () => boolean,
    work: (context: CurrentPrincipalMutationLeaseContext) => Promise<T>,
  ): Promise<T> =>
    lease(async ({ protection, stillCurrent: leaseCurrent }) => {
      let active = true;
      const stillCurrent = () => active && leaseCurrent() && callerCurrent();
      try {
        assertProjectionVerificationCurrent(stillCurrent);
        const result = await work({
          protection,
          stillCurrent,
          resolveCurrentPolicy,
          historyReader,
          directoryRecovery: (current) => ({
            historyReader,
            expectedHead: principalPolicyReferenceFromBundle(current),
            protection: directoryHistoryProtection(protection),
            resolveTrustedUserIdentity: runtime.resolveTrustedUserIdentity,
          }),
        });
        assertProjectionVerificationCurrent(stillCurrent);
        return result;
      } finally {
        active = false;
      }
    });
}
