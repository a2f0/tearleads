import type {
  ApiClient,
  PrincipalPolicyPageCurrent,
  RequestFailure,
} from "@tearleads/api-client";
import type {
  PrincipalPolicyExternalAuthority,
  PrincipalPolicyHistoryProgressOptions,
  PrincipalPolicyStateChainEntry,
  ReferencedPrincipalHead,
  VerifiedPrincipalPolicyCurrent,
} from "@tearleads/crypto";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import type { TrustedUserIdentityResolver } from "../../data/trustedUserIdentity";

export interface RecoverPrincipalPolicyHistoryOptions {
  readonly apiClient: Pick<ApiClient, "getPrincipalPolicyPages">;
  readonly execSql: ExecSql;
  readonly organizationId: string;
  readonly expectedHead: ReferencedPrincipalHead;
  /** Only use locally authenticated completed evidence; never perform HTTP. */
  readonly offline?: boolean | undefined;
  /** Device-controlled key and stable identity/trust-policy context, never supplied by the API. */
  readonly protection: PrincipalPolicyHistoryProgressOptions;
  readonly retainedReferences?: readonly ReferencedPrincipalHead[] | undefined;
  /** Strict Admins mode checks every historical projection in a separate cache scope. */
  readonly historyVerification?: "standard" | "direct-admins" | undefined;
  readonly resolveTrustedUserIdentity: TrustedUserIdentityResolver;
  /** Return only authority already authenticated by this client. */
  readonly loadExternalAuthority?:
    | ((
        entries: readonly PrincipalPolicyStateChainEntry[],
      ) => Promise<PrincipalPolicyExternalAuthority | undefined>)
    | undefined;
  readonly stillCurrent: () => boolean;
  readonly signal?: AbortSignal | undefined;
}

export interface RecoveredPrincipalPolicyHistory {
  readonly current: PrincipalPolicyPageCurrent;
  readonly policy: VerifiedPrincipalPolicyCurrent;
}

export class PrincipalPolicyHistoryReadError extends Error {
  constructor(readonly failure: RequestFailure) {
    super(failure.message);
    this.name = "PrincipalPolicyHistoryReadError";
  }
}
