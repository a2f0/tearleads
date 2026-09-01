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

export function rethrowProjectionVerificationCancelled(error: unknown): void {
  if (
    error instanceof ProjectionVerificationCancelledError ||
    (error instanceof Error &&
      error.name === "ProjectionVerificationCancelledError")
  ) {
    throw error;
  }
}

export function generationGuardedPrincipalPolicyWarmer(
  warmer: ReferencedPrincipalPolicyWarmer | undefined,
  stillCurrent: (() => boolean) | undefined,
): ReferencedPrincipalPolicyWarmer | undefined {
  if (!warmer || !stillCurrent) return warmer;
  return async (input) => {
    if (!stillCurrent()) throw new ProjectionVerificationCancelledError();
    await warmer({ ...input, stillCurrent });
    if (!stillCurrent()) throw new ProjectionVerificationCancelledError();
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
