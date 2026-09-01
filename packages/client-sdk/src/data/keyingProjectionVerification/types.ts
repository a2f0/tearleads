import type {
  ReferencedPrincipalHead,
  VerifiedPrincipalPolicy,
} from "@symcrypt/crypto";
import type { TrustedUserIdentity } from "../trustedUserIdentity";

export type ProjectionUserKey = TrustedUserIdentity;

export type ProjectionUserKeyResolver = (
  userId: string,
) => Promise<ProjectionUserKey | null>;

export type PrincipalPolicyCache = Map<string, VerifiedPrincipalPolicy>;

export interface ReferencedPrincipalPolicyWarmRequest {
  readonly organizationId: string;
  readonly references: readonly ReferencedPrincipalHead[];
  readonly stillCurrent?: (() => boolean) | undefined;
}

export type ReferencedPrincipalPolicyWarmer = (
  input: ReferencedPrincipalPolicyWarmRequest,
) => Promise<void>;

export class ProjectionVerificationCancelledError extends Error {
  constructor() {
    super("Projection verification generation expired");
    this.name = "ProjectionVerificationCancelledError";
  }
}

export function isProjectionVerificationCancelledError(
  error: unknown,
): error is ProjectionVerificationCancelledError {
  return (
    error instanceof ProjectionVerificationCancelledError ||
    (error instanceof Error &&
      error.name === "ProjectionVerificationCancelledError")
  );
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
    throw new ProjectionVerificationCancelledError();
  }
}

export function generationGuardedPrincipalPolicyWarmer(
  warmer: ReferencedPrincipalPolicyWarmer | undefined,
  stillCurrent: (() => boolean) | undefined,
): ReferencedPrincipalPolicyWarmer | undefined {
  if (!warmer || !stillCurrent) return warmer;
  return async (input) => {
    assertProjectionVerificationCurrent(stillCurrent);
    await warmer({ ...input, stillCurrent });
    assertProjectionVerificationCurrent(stillCurrent);
  };
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
