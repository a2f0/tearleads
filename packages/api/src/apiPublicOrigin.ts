import { canonicalAuthOrigin } from "@tearleads/crypto";

interface ApiPublicOriginEnv {
  readonly API_PUBLIC_ORIGIN?: string | undefined;
  readonly NODE_ENV?: string | undefined;
}

/**
 * The origin login challenges must be signed for (#2365 finding 25).
 * Production names it, since behind the tunnel the request URL is a loopback
 * address. Elsewhere null lets each request's own origin stand in, which an
 * in-process client that addressed this API shares. That fallback trusts the
 * request's Host header, which a relaying API controls, so relay protection
 * holds only where API_PUBLIC_ORIGIN is set.
 */
export function readApiPublicOrigin(
  env: ApiPublicOriginEnv = process.env,
): string | null {
  const production = env.NODE_ENV?.trim() === "production";
  const configured = env.API_PUBLIC_ORIGIN?.trim();
  if (configured) {
    return parseApiPublicOrigin(configured, production);
  }
  if (production) {
    throw new Error("API_PUBLIC_ORIGIN is required when NODE_ENV=production");
  }
  return null;
}

/**
 * The startup warning for a server whose login challenges fall back to the
 * Host header, or null when an origin is configured or the process is a test
 * run. Logged once by the entrypoint, so a deployment that forgot
 * NODE_ENV=production says so.
 */
export function apiPublicOriginFallbackWarning(
  env: ApiPublicOriginEnv = process.env,
): string | null {
  if (readApiPublicOrigin(env) !== null || env.NODE_ENV?.trim() === "test") {
    return null;
  }
  return "API_PUBLIC_ORIGIN is unset: login challenges are bound to each request's Host header, which a relaying API controls. Set it in any deployment that clients reach over a network.";
}

/**
 * Clients sign the origin alone, so anything after it would be silently
 * dropped; a path, query, fragment or credentials are refused instead.
 * Production requires https, the scheme its public listener serves.
 */
function parseApiPublicOrigin(configured: string, production: boolean): string {
  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new Error("API_PUBLIC_ORIGIN must be an absolute URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("API_PUBLIC_ORIGIN must use http or https");
  }
  if (
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== "" ||
    url.username !== "" ||
    url.password !== ""
  ) {
    throw new Error(
      "API_PUBLIC_ORIGIN must be a bare origin, with no path, query, fragment or credentials",
    );
  }
  if (production && url.protocol !== "https:") {
    throw new Error(
      "API_PUBLIC_ORIGIN must use https when NODE_ENV=production",
    );
  }
  return canonicalAuthOrigin(url.origin);
}
