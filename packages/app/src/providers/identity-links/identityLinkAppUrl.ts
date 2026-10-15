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
  if (current.protocol === "http:" || current.protocol === "https:")
    return current.origin;
  throw new Error(
    "Configure the web app URL before sharing an identity link from this device.",
  );
}
