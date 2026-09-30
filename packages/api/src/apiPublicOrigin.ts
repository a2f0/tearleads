import { canonicalAuthOrigin } from "@tearleads/crypto";

interface ApiPublicOriginEnv {
  readonly API_PUBLIC_ORIGIN?: string | undefined;
  readonly NODE_ENV?: string | undefined;
}

/**
 * The origin login challenges must be signed for (#2365 finding 25).
 * Production names it, since behind the tunnel the request URL is a loopback
 * address; elsewhere null lets each request's own origin stand in, which an
 * in-process client that addressed this API shares.
 */
export function readApiPublicOrigin(
  env: ApiPublicOriginEnv = process.env,
): string | null {
  const configured = env.API_PUBLIC_ORIGIN?.trim();
  if (configured) {
    return canonicalAuthOrigin(configured);
  }
  if (env.NODE_ENV?.trim() === "production") {
    throw new Error("API_PUBLIC_ORIGIN is required when NODE_ENV=production");
  }
  return null;
}
