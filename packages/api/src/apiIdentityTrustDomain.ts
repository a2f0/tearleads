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
  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new Error("API_IDENTITY_TRUST_DOMAIN must be an absolute URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("API_IDENTITY_TRUST_DOMAIN must use http or https");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(
      "API_IDENTITY_TRUST_DOMAIN must not include credentials, query or fragment",
    );
  }
  if (env.NODE_ENV?.trim() === "production" && url.protocol !== "https:") {
    throw new Error(
      "API_IDENTITY_TRUST_DOMAIN must use https when NODE_ENV=production",
    );
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
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
