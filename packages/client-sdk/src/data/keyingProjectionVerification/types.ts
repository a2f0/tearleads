import type {
  PrincipalPolicyCheckpoint,
  ReferencedPrincipalHead,
  VerifiedPrincipalPolicyCurrent,
  VerifiedPrincipalPolicySelection,
} from "@tearleads/crypto";
import type {
  PrincipalPolicyBundleResponse,
  PrincipalStateResponse,
  ProjectionPolicyEvidenceResponse,
} from "@tearleads/validators/response";
import type { PrincipalPolicyCurrentEvidence } from "../principals/principalPolicyEvidence";
import type { ExecSql } from "../sqlite/sqlSchema";
import type { TrustedUserIdentity } from "../trustedUserIdentity";

export type ProjectionUserKey = TrustedUserIdentity;

export type ProjectionUserKeyResolver = (
  userId: string,
) => Promise<ProjectionUserKey | null>;

export type PrincipalPolicyCache = Map<string, PrincipalPolicyCurrentEvidence>;

/**
 * The cached principal policy bundles verification reads, supplied by the
 * caller so verification does not depend on Principal Policy's store. Each
 * method ensures the principal policy tables on the executor it was opened on.
 */
export interface PrincipalPolicyBundleReader {
  ensurePrincipalPolicyTables(): Promise<void>;
  loadPrincipalPolicyBundle(
    principalType: PrincipalStateResponse["principalType"],
    principalId: string,
  ): Promise<PrincipalPolicyBundleResponse | null>;
  /** The newest stored bundle containing exactly `reference`, never a guess. */
  loadPrincipalPolicyBundleForReference(
    reference: ReferencedPrincipalHead,
    checkpoint: PrincipalPolicyCheckpoint | null,
  ): Promise<PrincipalPolicyBundleResponse | null>;
}

/**
 * Opens the bundle reader on one executor. Verification opens it on the
 * executor each read runs on, a locked transaction handle included, so every
 * read sees that executor's snapshot.
 */
export type OpenPrincipalPolicyBundleReader = (
  execSql: ExecSql,
) => PrincipalPolicyBundleReader;

export interface PrincipalPolicyResolveRequest {
  /** Reuse authenticated local ancestry before an authorized online recovery. */
  readonly preferLocalHistory?: boolean | undefined;
  /** One recovery view: the warmer's operation unless a caller supplies its own. */
  readonly recoveryBatch?: object | undefined;
  readonly organizationId: string;
  readonly reference: ReferencedPrincipalHead;
  readonly stillCurrent?: (() => boolean) | undefined;
}

export interface ResolvedPrincipalPolicyEvidence {
  readonly stillCurrent: () => boolean;
  readonly organizationId: string;
  readonly policy: VerifiedPrincipalPolicyCurrent;
  readonly dependencies: readonly VerifiedPrincipalPolicyCurrent[];
}

export interface ReferencedPrincipalPolicyWarmRequest {
  readonly organizationId: string;
  readonly references: readonly ReferencedPrincipalHead[];
  readonly stillCurrent?: (() => boolean) | undefined;
}

export interface ProjectionPolicyHistoryResolveRequest {
  /** Authenticate terminal evidence first; its consumer must validate durable currency. */
  readonly historicalProof?: boolean | undefined;
  readonly organizationId: string;
  readonly evidence: ProjectionPolicyEvidenceResponse;
  readonly references: readonly ReferencedPrincipalHead[];
  readonly stillCurrent?: (() => boolean) | undefined;
}

export interface ResolvedProjectionPolicyHistory {
  readonly policies: readonly VerifiedPrincipalPolicySelection[];
  readonly stillCurrent: () => boolean;
}

export type ReferencedPrincipalPolicyWarmer = ((
  input: ReferencedPrincipalPolicyWarmRequest,
) => Promise<void>) & {
  readonly resolveProjectionHistory?:
    | ((
        input: ProjectionPolicyHistoryResolveRequest,
      ) => Promise<ResolvedProjectionPolicyHistory>)
    | undefined;
  readonly resolveReference?:
    | ((
        input: PrincipalPolicyResolveRequest,
      ) => Promise<ResolvedPrincipalPolicyEvidence>)
    | undefined;
};

export class ProjectionVerificationCancelledError extends Error {
  constructor() {
    super("Projection verification generation expired");
    this.name = "ProjectionVerificationCancelledError";
  }
}

const projectionVerificationCancellation =
  new ProjectionVerificationCancelledError();

export function isProjectionVerificationCancelledError(
  error: unknown,
): error is ProjectionVerificationCancelledError {
  return error === projectionVerificationCancellation;
}

export function rethrowProjectionVerificationCancelled(error: unknown): void {
  if (isProjectionVerificationCancelledError(error)) throw error;
}

export async function nullOnProjectionVerificationCancellation<T>(
  operation: () => Promise<T>,
): Promise<T | null> {
  try {
    return await operation();
  } catch (error) {
    if (isProjectionVerificationCancelledError(error)) return null;
    throw error;
  }
}

export function assertProjectionVerificationCurrent(
  stillCurrent: (() => boolean) | undefined,
): void {
  if (stillCurrent?.() === false) {
    throw projectionVerificationCancellation;
  }
}

export function generationGuardedPrincipalPolicyWarmer(
  warmer: ReferencedPrincipalPolicyWarmer | undefined,
  stillCurrent: (() => boolean) | undefined,
): ReferencedPrincipalPolicyWarmer | undefined {
  if (!warmer || !stillCurrent) return warmer;
  const guard =
    (operation: ReferencedPrincipalPolicyWarmer) =>
    async (input: ReferencedPrincipalPolicyWarmRequest) => {
      assertProjectionVerificationCurrent(stillCurrent);
      await operation({ ...input, stillCurrent });
      assertProjectionVerificationCurrent(stillCurrent);
    };
  const guardWithCapabilities = (
    operation: ReferencedPrincipalPolicyWarmer,
  ): ReferencedPrincipalPolicyWarmer => {
    const guarded = guard(operation);
    const resolve = operation.resolveReference;
    const resolveProjectionHistory = operation.resolveProjectionHistory;
    return Object.assign(guarded, {
      ...(resolveProjectionHistory
        ? {
            resolveProjectionHistory: async (
              input: ProjectionPolicyHistoryResolveRequest,
            ) => {
              const current = () =>
                stillCurrent() && input.stillCurrent?.() !== false;
              assertProjectionVerificationCurrent(current);
              const result = await resolveProjectionHistory({
                ...input,
                stillCurrent: current,
              });
              assertProjectionVerificationCurrent(current);
              return result;
            },
          }
        : {}),
      ...(resolve
        ? {
            resolveReference: async (input: PrincipalPolicyResolveRequest) => {
              const current = () =>
                stillCurrent() && input.stillCurrent?.() !== false;
              assertProjectionVerificationCurrent(current);
              const result = await resolve({ ...input, stillCurrent: current });
              assertProjectionVerificationCurrent(current);
              return result;
            },
          }
        : {}),
    });
  };
  return guardWithCapabilities(warmer);
}

export function withGenerationGuardedPolicyWarmer<
  Input extends {
    readonly stillCurrent?: (() => boolean) | undefined;
    readonly warmReferencedPrincipalPolicies?:
      | ReferencedPrincipalPolicyWarmer
      | undefined;
  },
>(input: Input): Input {
  return {
    ...input,
    warmReferencedPrincipalPolicies: generationGuardedPrincipalPolicyWarmer(
      input.warmReferencedPrincipalPolicies,
      input.stillCurrent,
    ),
  };
}
