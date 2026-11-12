import { KeyingVerificationError } from "./keying/verificationError";

function invalidTrustDomain(message: string): never {
  throw new KeyingVerificationError("invalid_domain", message);
}

/** Shared identity-link scope encoding; authentication origins omit the path. */
export function canonicalIdentityTrustDomain(
  value: string,
  base?: string,
): string {
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
  // Do not backtrack over internal slash runs in a host-provided API base URL.
  const pathname = url.pathname;
  let end = pathname.length;
  while (end > 0 && pathname[end - 1] === "/") end -= 1;
  return `${url.origin}${pathname.slice(0, end)}`;
}
