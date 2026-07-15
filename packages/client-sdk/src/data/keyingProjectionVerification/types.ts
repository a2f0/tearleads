import type {
  ReferencedPrincipalHead,
  VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import type { TrustedUserIdentity } from "../trustedUserIdentity";

export type ProjectionUserKey = TrustedUserIdentity;

export type ProjectionUserKeyResolver = (
  userId: string,
) => Promise<ProjectionUserKey | null>;

export type PrincipalPolicyCache = Map<string, VerifiedPrincipalPolicy>;

export interface ReferencedPrincipalPolicyWarmRequest {
  readonly organizationId: string;
  readonly references: readonly ReferencedPrincipalHead[];
}

export type ReferencedPrincipalPolicyWarmer = (
  input: ReferencedPrincipalPolicyWarmRequest,
) => Promise<void>;
