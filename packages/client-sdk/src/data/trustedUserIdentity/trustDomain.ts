import { KeyingVerificationError } from "@tearleads/crypto";

interface IdentityTrustDomainInput {
  readonly apiBaseUrl: string | null | undefined;
  readonly ambientHref?: string | null | undefined;
  readonly identityTrustDomain?: string | null | undefined;
}

function invalidTrustDomain(message: string): never {
  throw new KeyingVerificationError("invalid_domain", message);
}

function canonicalHttpUrl(value: string, base?: string): string {
  let url: URL;
  try {
    url = base ? new URL(value, base) : new URL(value);
  } catch {
    return invalidTrustDomain(
      "Identity trust domain must resolve to an absolute HTTP(S) URL",
    );
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return invalidTrustDomain(
      "Identity trust domain must use the HTTP or HTTPS protocol",
    );
  }
  if (url.username || url.password) {
    return invalidTrustDomain(
      "Identity trust domain must not contain URL credentials",
    );
  }
  if (url.search || url.hash) {
    return invalidTrustDomain(
      "Identity trust domain must not contain a query or fragment",
    );
  }

  const pathname = url.pathname.replace(/\/+$/u, "");
  return `${url.origin}${pathname}`;
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
    return canonicalHttpUrl(override);
  }

  const apiBaseUrl = (input.apiBaseUrl ?? "").trim();
  const ambientHref = input.ambientHref ?? readAmbientHref();
  if (/^https?:\/\//iu.test(apiBaseUrl)) {
    return canonicalHttpUrl(apiBaseUrl);
  }
  if (!ambientHref || !isHttpUrl(ambientHref)) {
    return null;
  }
  return canonicalHttpUrl(apiBaseUrl || "/", ambientHref);
}
