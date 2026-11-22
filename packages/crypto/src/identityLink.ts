import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import { isUuidV4String } from "@tearleads/validators/util";
import { canonicalIdentityTrustDomain } from "./identityTrustDomain";

/** The app route that imports an identity link; its token follows. */
export const IDENTITY_LINK_PATH = "/app/contacts/import/";

/**
 * What an identity link vouches for: the account `userId` in the deployment
 * named by `identityTrustDomain`, holding the keys that
 * `computeUserIdentityBundleFingerprint` commits to as `fingerprint`.
 */
export interface IdentityLinkExpectation {
  readonly identityTrustDomain: string;
  readonly userId: string;
  readonly fingerprint: string;
}

/** The versioned link token, base64url without padding. */
export function encodeIdentityLinkToken(
  expectation: IdentityLinkExpectation,
): string {
  return bytesToBase64(
    new TextEncoder().encode(
      JSON.stringify([
        1,
        expectation.identityTrustDomain,
        expectation.userId,
        expectation.fingerprint,
      ]),
    ),
  )
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function decodeToken(token: string): unknown {
  if (!/^[A-Za-z0-9_-]+$/u.test(token)) return null;
  try {
    const base64 = token.replaceAll("-", "+").replaceAll("_", "/");
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        base64ToBytes(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")),
      ),
    );
  } catch {
    return null;
  }
}

function isCanonicalTrustDomain(value: string): boolean {
  try {
    return canonicalIdentityTrustDomain(value) === value;
  } catch {
    return false;
  }
}

function toExpectation(payload: unknown): IdentityLinkExpectation | null {
  if (
    !Array.isArray(payload) ||
    payload.length !== 4 ||
    payload[0] !== 1 ||
    typeof payload[1] !== "string" ||
    typeof payload[2] !== "string" ||
    typeof payload[3] !== "string" ||
    !/^[a-f0-9]{64}$/u.test(payload[3]) ||
    !isUuidV4String(payload[2]) ||
    payload[2] !== payload[2].toLowerCase() ||
    !isCanonicalTrustDomain(payload[1])
  ) {
    return null;
  }
  return {
    identityTrustDomain: payload[1],
    userId: payload[2],
    fingerprint: payload[3],
  };
}

/**
 * Reads an identity link, or returns null for anything but one complete
 * canonical link: an HTTP(S) URL without credentials, query, or fragment whose
 * path is the import route and a token that re-encodes to itself.
 */
export function decodeIdentityLink(
  value: string,
): IdentityLinkExpectation | null {
  if (value.length > 4096) return null;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !url.pathname.startsWith(IDENTITY_LINK_PATH)
  ) {
    return null;
  }
  const token = url.pathname.slice(IDENTITY_LINK_PATH.length);
  const expectation = toExpectation(decodeToken(token));
  if (!expectation || encodeIdentityLinkToken(expectation) !== token) {
    return null;
  }
  return expectation;
}
