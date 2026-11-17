import type { PrincipalHistoryProtectionLease } from "../../../src/data/principals/principalHistoryProtection";
import { PrincipalPolicyService } from "../../../src/workflows/principals/principalPolicyService";
import type { PrincipalPolicyCollaborators } from "../../../src/workflows/principals/runtimePolicyRecovery";

/**
 * Binds `runtime` a policy service the way a runtime snapshot does: over that
 * runtime's own API client, executor, state, and utilities, with `lease` as
 * its history custody (none when omitted). A runtime derived with another API
 * client or state needs its own call, as a new snapshot gets its own service.
 * Partial fixtures pass as they are: production always supplies every
 * collaborator, and a service without a lease never reads the rest.
 */
export function withPrincipalPolicies<
  T extends { readonly apiClient: object; readonly infra: object },
>(
  runtime: T,
  lease?: PrincipalHistoryProtectionLease | undefined,
): NoInfer<T> & { readonly principalPolicies: PrincipalPolicyService } {
  return {
    ...runtime,
    principalPolicies: new PrincipalPolicyService({
      ...(runtime as unknown as PrincipalPolicyCollaborators),
      withPrincipalHistoryProtection: lease,
    }),
  };
}
