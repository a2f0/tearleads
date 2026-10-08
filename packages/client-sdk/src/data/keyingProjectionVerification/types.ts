import type {
  ReferencedPrincipalHead,
  VerifiedPrincipalPolicyCurrent,
  VerifiedPrincipalPolicySelection,
} from "@tearleads/crypto";
import type {
  PrincipalPolicyBundleResponse,
  ProjectionPolicyEvidenceResponse,
} from "@tearleads/validators/response";
import type { PrincipalPolicyCurrentEvidence } from "../principals/principalPolicyEvidence";
import type { TrustedUserIdentity } from "../trustedUserIdentity";

export type ProjectionUserKey = TrustedUserIdentity;

export type ProjectionUserKeyResolver = (
  userId: string,
) => Promise<ProjectionUserKey | null>;

export type PrincipalPolicyCache = Map<string, PrincipalPolicyCurrentEvidence>;

export interface PrincipalPolicyResolveRequest {
  /** Reuse authenticated local ancestry before an authorized online recovery. */
  readonly preferLocalHistory?: boolean | undefined;
  /** Identity of one projection collection, never caller-supplied evidence. */
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

export interface PrincipalPolicyBundleCacheRequest {
  readonly bundles: readonly PrincipalPolicyBundleResponse[];
  readonly organizationId: string;
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

export type PrincipalPolicyBundleCacher = (
  input: PrincipalPolicyBundleCacheRequest,
) => Promise<void>;

export type ReferencedPrincipalPolicyWarmer = ((
  input: ReferencedPrincipalPolicyWarmRequest,
) => Promise<void>) & {
  readonly cacheBundles?: PrincipalPolicyBundleCacher | undefined;
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
      ...(operation.cacheBundles
        ? {
            cacheBundles: async (input: PrincipalPolicyBundleCacheRequest) => {
              assertProjectionVerificationCurrent(stillCurrent);
              await operation.cacheBundles?.({ ...input, stillCurrent });
              assertProjectionVerificationCurrent(stillCurrent);
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
