import type { ManagedPrincipalKind } from "@tearleads/crypto";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";

/**
 * Where a workflow reads a principal's current signed policy. The API client is
 * the production reader and satisfies this port as it is; a workflow that has
 * already verified a directory can serve its pinned heads instead. A bundle is
 * untrusted until the caller checks it against a signed head or checkpoint,
 * whichever reader supplied it.
 */
export interface CurrentPrincipalPolicyReader {
  readonly getCurrentPrincipalPolicy: (
    principalType: ManagedPrincipalKind,
    principalId: string,
  ) => Promise<PrincipalPolicyBundleResponse | null>;
}
