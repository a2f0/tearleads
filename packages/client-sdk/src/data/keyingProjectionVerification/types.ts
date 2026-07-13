import type {
  ReferencedPrincipalHead,
  VerifiedPrincipalPolicy,
} from "@tearleads/crypto";

export interface ProjectionUserKey {
  readonly encapsulationPublicKey: Uint8Array;
  readonly signingPublicKey: Uint8Array;
  readonly userId: string;
}

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
