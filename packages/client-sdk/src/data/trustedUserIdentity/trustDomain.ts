import { canonicalIdentityTrustDomain } from "@tearleads/crypto";

interface IdentityTrustDomainInput {
  readonly apiBaseUrl: string | null | undefined;
  readonly ambientHref?: string | null | undefined;
  readonly identityTrustDomain?: string | null | undefined;
}

function readAmbientHref(): string | null {
  if (typeof globalThis.location !== "object") {
    return null;
  }
  return globalThis.location.href;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Resolve the stable host-controlled namespace used by durable identity pins.
 * Relative API URLs require a browser origin or an explicit absolute override;
 * a non-browser client without either remains unavailable and fails closed when
 * remote identity material is requested.
 */
export function resolveIdentityTrustDomain(
  input: IdentityTrustDomainInput,
): string | null {
  const override = input.identityTrustDomain?.trim();
  if (override) {
    return canonicalIdentityTrustDomain(override);
  }

  const apiBaseUrl = (input.apiBaseUrl ?? "").trim();
  const ambientHref = input.ambientHref ?? readAmbientHref();
  if (/^https?:\/\//iu.test(apiBaseUrl)) {
    return canonicalIdentityTrustDomain(apiBaseUrl);
  }
  if (!ambientHref || !isHttpUrl(ambientHref)) {
    return null;
  }
  return canonicalIdentityTrustDomain(apiBaseUrl || "/", ambientHref);
}
