import type { ApiClient } from "@tearleads/api-client";
import type {
  PrincipalPolicyExternalAuthority,
  PrincipalPolicyHistoryProgressOptions,
  PrincipalPolicyHistoryVerifier,
  ReferencedPrincipalHead,
  VerifiedPrincipalPolicyHistory,
} from "@tearleads/crypto";
import type { PrincipalPolicyHistorySourceResponse } from "@tearleads/validators/response";
import type { PrincipalHistoryPrefix } from "../../data/persistence/principalHistoryPrefixPersistence";
import type { PrincipalHistoryStage } from "../../data/persistence/principalHistoryStagePersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import type { TrustedUserIdentityResolver } from "../../data/trustedUserIdentity";

export interface PublicPrincipalHistoryOptions {
  readonly apiClient: Pick<ApiClient, "getProjectionPolicyHistoryPages">;
  readonly source: PrincipalPolicyHistorySourceResponse;
  readonly organizationId: string;
  readonly execSql: ExecSql;
  readonly protection: PrincipalPolicyHistoryProgressOptions;
  readonly resolveTrustedUserIdentity: TrustedUserIdentityResolver;
  readonly stillCurrent: () => boolean;
  readonly signal?: AbortSignal | undefined;
  readonly offline?: boolean | undefined;
  /** Retry disposable evidence loss once from signatures, without reusing hints. */
  readonly replay?: boolean | undefined;
  readonly strictAdmins?: boolean | undefined;
  /** Already verified organization binding; included in the protected cache scope. */
  readonly authorityGroupId?: string | undefined;
  readonly loadExternalAuthority?:
    | ((
        references: readonly ReferencedPrincipalHead[],
        cachedPrefix?: boolean,
      ) => Promise<PrincipalPolicyExternalAuthority | undefined>)
    | undefined;
}

export interface PublicPrincipalHistoryProgress {
  readonly id: string;
  readonly scopeId: string;
  readonly verifier: PrincipalPolicyHistoryVerifier;
  readonly completedHead: ReferencedPrincipalHead | null;
  readonly afterVersion: number;
  readonly saved: PrincipalHistoryStage | null;
  readonly cachedPrefix: PrincipalHistoryPrefix | null;
  readonly authorityReference: ReferencedPrincipalHead | null;
}

/** Public authorization only; caller must check directory binding and local pins. */
export interface RecoveredPublicPrincipalHistory {
  readonly scopeId: string;
  readonly history: VerifiedPrincipalPolicyHistory;
}
