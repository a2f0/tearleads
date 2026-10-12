/** Browser CORS policy; billing redirects have their own allowlist. */
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

  return "*";
}
