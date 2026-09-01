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

export function generationGuardedPrincipalPolicyWarmer(
  warmer: ReferencedPrincipalPolicyWarmer | undefined,
  stillCurrent: (() => boolean) | undefined,
): ReferencedPrincipalPolicyWarmer | undefined {
  return warmer && stillCurrent
    ? (input) => warmer({ ...input, stillCurrent })
    : warmer;
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
