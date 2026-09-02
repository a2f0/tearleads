import type {
  ReferencedPrincipalHead,
  VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import type { TrustedUserIdentity } from "../trustedUserIdentity";

export type ProjectionUserKey = TrustedUserIdentity;

export type ProjectionUserKeyResolver = (
  userId: string,
) => Promise<ProjectionUserKey | null>;

export type PrincipalPolicyCache = Map<string, VerifiedPrincipalPolicy>;

export interface ReferencedPrincipalPolicyWarmRequest {
  readonly organizationId: string;
  /** Receives policies that were fully verified without durable persistence. */
  readonly onVerifiedPolicies?:
    | ((policies: readonly VerifiedPrincipalPolicy[]) => void)
    | undefined;
  readonly references: readonly ReferencedPrincipalHead[];
  readonly stillCurrent?: (() => boolean) | undefined;
}

export interface PrincipalPolicyBundleCacheRequest {
  readonly bundles: readonly PrincipalPolicyBundleResponse[];
  readonly organizationId: string;
  readonly stillCurrent?: (() => boolean) | undefined;
}

export type PrincipalPolicyBundleCacher = (
  input: PrincipalPolicyBundleCacheRequest,
) => Promise<void>;

export type ReferencedPrincipalPolicyWarmer = ((
  input: ReferencedPrincipalPolicyWarmRequest,
) => Promise<void>) & {
  readonly cacheBundles?: PrincipalPolicyBundleCacher | undefined;
  readonly reportsVerifiedPolicies?: true | undefined;
  readonly verifyWithoutPersistence?:
    | ReferencedPrincipalPolicyWarmer
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
    return Object.assign(guarded, {
      ...(operation.cacheBundles
        ? {
            cacheBundles: async (input: PrincipalPolicyBundleCacheRequest) => {
              assertProjectionVerificationCurrent(stillCurrent);
              await operation.cacheBundles?.({ ...input, stillCurrent });
              assertProjectionVerificationCurrent(stillCurrent);
            },
          }
        : {}),
      ...(operation.reportsVerifiedPolicies
        ? { reportsVerifiedPolicies: true as const }
        : {}),
    });
  };
  const guarded = guardWithCapabilities(warmer);
  return warmer.verifyWithoutPersistence
    ? Object.assign(guarded, {
        verifyWithoutPersistence: guardWithCapabilities(
          warmer.verifyWithoutPersistence,
        ),
      })
    : guarded;
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
