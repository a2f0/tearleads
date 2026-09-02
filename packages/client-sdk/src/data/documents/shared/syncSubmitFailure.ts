import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";

export interface DocumentSyncSubmitFailure {
  readonly code?: string | undefined;
  readonly message: string;
  readonly ok: false;
  readonly report: () => void;
  readonly stalePrincipalPolicies?:
    | readonly PrincipalPolicyBundleResponse[]
    | undefined;
  readonly status: number | null;
}
