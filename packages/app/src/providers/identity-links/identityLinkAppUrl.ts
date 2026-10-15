/** Native shells share the web application's URL for the same deployment. */
export function identityLinkAppUrl(input: {
  apiBaseUrl: string;
  currentHref: string;
  configuredUrl?: string | undefined;
}): string {
  if (input.configuredUrl) return input.configuredUrl;
  const api = new URL(input.apiBaseUrl, input.currentHref);
  if (api.origin === "https://api.tearleads.com")
    return "https://app.tearleads.com";
  if (api.origin === "https://api-staging.tearleads.com")
    return "https://app-staging.tearleads.com";
  const current = new URL(input.currentHref);
  if (
    (current.protocol === "http:" || current.protocol === "https:") &&
    current.origin !== "https://localhost"
  )
    return current.origin;
  throw new Error(
    "Configure the web app URL before sharing an identity link from this device.",
  );
}

/** The origin is only display/launch data; verification uses the token's scope. */
export function identityLinkFromToken(
  token: string,
  input: Parameters<typeof identityLinkAppUrl>[0],
): string {
  let origin: string;
  try {
    origin = identityLinkAppUrl(input);
  } catch {
    // Importing an already received token also works before a custom native
    // host configures its public URL. Sharing still requires that configuration.
    origin = "https://app.tearleads.com";
  }
  return new URL(`/app/contacts/import/${token}`, origin).href;
}
