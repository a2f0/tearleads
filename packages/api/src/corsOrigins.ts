/**
 * Reading and parsing of the API's allowed CORS origins. A leaf module so
 * both the route app (CORS middleware) and individual routes (e.g. the
 * Stripe Billing Portal's return-url allowlist) can consume it without an
 * import cycle through routeApp.
 */
export type ApiCorsOrigins = "*" | readonly string[];

interface ApiCorsEnv {
  readonly API_CORS_ORIGINS?: string | undefined;
  readonly NODE_ENV?: string | undefined;
}

function parseConfiguredApiCorsOrigins(value: string): ApiCorsOrigins {
  const origins = value
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  if (origins.length === 0) {
    throw new Error("API_CORS_ORIGINS must include at least one origin");
  }
  if (origins.includes("*")) {
    if (origins.length > 1) {
      throw new Error("API_CORS_ORIGINS cannot mix * with explicit origins");
    }
    return "*";
  }

  return origins;
}

export function readApiCorsOrigins(
  env: ApiCorsEnv = process.env,
): ApiCorsOrigins {
  const configured = env.API_CORS_ORIGINS?.trim();
  if (configured) {
    return parseConfiguredApiCorsOrigins(configured);
  }
  if (env.NODE_ENV?.trim() === "production") {
    throw new Error("API_CORS_ORIGINS is required when NODE_ENV=production");
  }

  return "*";
}
