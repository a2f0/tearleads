import {
  computeUserIdentityBundleFingerprint,
  decodeIdentityLink,
  encodeIdentityLinkToken,
  IDENTITY_LINK_PATH,
  type IdentityLinkExpectation,
} from "@tearleads/crypto";
import type { ValidatedUserIdentityCandidate } from "./types";

/** A supplied link alone cannot establish evidence of server tampering. */
class IdentityLinkMismatchError extends Error {
  constructor() {
    super(
      "The identity keys do not match this link. Ask the person to confirm their identity link through your trusted channel.",
    );
    this.name = "IdentityLinkMismatchError";
  }
}

function invalidLink(): never {
  throw new Error("Enter a complete Tearleads identity link.");
}

function httpUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return invalidLink();
  }
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    return invalidLink();
  return url;
}

export function parseIdentityLink(value: string): IdentityLinkExpectation {
  return decodeIdentityLink(value) ?? invalidLink();
}

/** Versioned, domain-separated tuple: exact keys, algorithms and account scope. */
export function identityLinkFingerprint(
  identity: ValidatedUserIdentityCandidate,
): Promise<string> {
  return computeUserIdentityBundleFingerprint(identity);
}

export async function createIdentityLink(
  identity: ValidatedUserIdentityCandidate,
  appUrl: string,
): Promise<string> {
  const url = httpUrl(appUrl);
  url.pathname =
    IDENTITY_LINK_PATH +
    encodeIdentityLinkToken({
      identityTrustDomain: identity.identityTrustDomain,
      userId: identity.userId,
      fingerprint: await identityLinkFingerprint(identity),
    });
  url.search = "";
  url.hash = "";
  return url.href;
}

export async function assertIdentityLinkMatches(
  expectation: IdentityLinkExpectation,
  identity: ValidatedUserIdentityCandidate,
): Promise<void> {
  if ((await identityLinkFingerprint(identity)) !== expectation.fingerprint) {
    throw new IdentityLinkMismatchError();
  }
}
