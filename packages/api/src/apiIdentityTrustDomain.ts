import { canonicalIdentityTrustDomain } from "@tearleads/crypto";
import { readApiPublicOrigin } from "./apiPublicOrigin";

interface ApiIdentityTrustDomainEnv {
  readonly API_IDENTITY_TRUST_DOMAIN?: string | undefined;
  readonly API_PUBLIC_ORIGIN?: string | undefined;
  readonly NODE_ENV?: string | undefined;
}

/** Stable identity-link.v1 scope; unlike authentication origins, retains base paths. */
export function readApiIdentityTrustDomain(
  env: ApiIdentityTrustDomainEnv = process.env,
): string | null {
  const configured = env.API_IDENTITY_TRUST_DOMAIN?.trim();
  if (!configured) return readApiPublicOrigin(env);
  let domain: string;
  try {
    domain = canonicalIdentityTrustDomain(configured);
  } catch (error) {
    throw new Error(
      `API_IDENTITY_TRUST_DOMAIN: ${error instanceof Error ? error.message : "invalid URL"}`,
      { cause: error },
    );
  }
  if (env.NODE_ENV?.trim() === "production" && !domain.startsWith("https:")) {
    throw new Error(
      "API_IDENTITY_TRUST_DOMAIN must use https when NODE_ENV=production",
    );
  }
  return domain;
}

/** A null configured scope is permitted only by non-production composition. */
export function resolveApiIdentityTrustDomain(
  configured: string | null,
  requestUrl?: string,
): string {
  if (configured !== null) return configured;
  if (!requestUrl)
    throw new Error(
      "Identity trust domain requires an explicit request URL or configured scope",
    );
  return new URL(requestUrl).origin;
}
