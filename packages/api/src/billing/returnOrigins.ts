/** Stripe return targets are independent of the API's browser CORS policy. */
interface BillingReturnEnv {
  readonly API_BILLING_RETURN_ORIGINS?: string | undefined;
  readonly NODE_ENV?: string | undefined;
}

export function readBillingReturnOrigins(
  env: BillingReturnEnv = process.env,
): readonly string[] {
  const configured = env.API_BILLING_RETURN_ORIGINS?.trim();
  if (!configured) {
    if (env.NODE_ENV?.trim() === "production") {
      throw new Error(
        "API_BILLING_RETURN_ORIGINS is required when NODE_ENV=production",
      );
    }
    return [];
  }
  const origins = configured.split(",").map((origin) => origin.trim());
  return origins.map((origin) => {
    let url: URL;
    try {
      url = new URL(origin);
    } catch {
      throw new Error(
        "API_BILLING_RETURN_ORIGINS must contain http(s) origins",
      );
    }
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      url.hostname.includes("*") ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      throw new Error(
        "API_BILLING_RETURN_ORIGINS must contain http(s) origins",
      );
    }
    return url.origin;
  });
}
